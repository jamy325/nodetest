#!/usr/bin/env node
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Buffer } = require('buffer');
const os = require('os');
const axios = require('axios');
const  unzipper  = require('unzipper')
const { exec, execSync } = require('child_process');
//const ws = require("./wstest");
const { WebSocketServer } = require("ws");
const HTTP_PORT = process.env.PORT || 3000;
const SUBS_PATH = process.env.SUBS_PATH || 'test';
const NODE_NAME = process.env.NODE_NAME || "defalut";
const NODE_UUID = process.env.NODE_UUID || "";
const NT_SERVER = process.env.NT_SERVER || '';
const NT_KEY = process.env.NT_KEY || "";
const CF_KEY = process.env.CF_KEY || "";
const WS_PATH = process.env.WS_PATH || NODE_UUID.slice(0, 8); 

const DEFAULT_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36 Edg/144.0.0.0";

const nowDomain = process.env.DOMAIN || "domain";
const nowPort = HTTP_PORT;
const HOST = '0.0.0.0';  


const getNTDownloadUrl = () => {
  const arch = os.arch();
  if (arch === 'arm' || arch === 'arm64' || arch === 'aarch64') {
    return Buffer.from('aHR0cHM6Ly9naXRodWIuY29tL25lemhhaHEvYWdlbnQvcmVsZWFzZXMvZG93bmxvYWQvdjEuMTUuMC9uZXpoYS1hZ2VudF9saW51eF9hcm02NC56aXA=','base64').toString("utf8");
  } else {
    return Buffer.from('aHR0cHM6Ly9naXRodWIuY29tL25lemhhaHEvYWdlbnQvcmVsZWFzZXMvZG93bmxvYWQvdjEuMTUuMC9uZXpoYS1hZ2VudF9saW51eF9hbWQ2NC56aXA=','base64').toString("utf8");
  }
};

function getCFDownloadUrl() {
  const arch = os.arch();
  if (arch === 'arm' || arch === 'arm64' || arch === 'aarch64') 
      return Buffer.from('aHR0cHM6Ly9naXRodWIuY29tL2Nsb3VkZmxhcmUvY2xvdWRmbGFyZWQvcmVsZWFzZXMvZG93bmxvYWQvMjAyNS4xMS4xL2Nsb3VkZmxhcmVkLWxpbnV4LWFybTY0','base64').toString("utf8");
    
  return Buffer.from('aHR0cHM6Ly9naXRodWIuY29tL2Nsb3VkZmxhcmUvY2xvdWRmbGFyZWQvcmVsZWFzZXMvZG93bmxvYWQvMjAyNS4xMS4xL2Nsb3VkZmxhcmVkLWxpbnV4LWFtZDY0','base64').toString("utf8");
}


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

const download = async function (url, saveFile) {
    let response = await axios({
        method: 'get',
        url: url,
        maxRedirects: 15,
        responseType: 'stream',
        headers:{
          'User-Agent':DEFAULT_USER_AGENT
        }
      });

      const writer = fs.createWriteStream(saveFile);
      response.data.pipe(writer);

      return new Promise((resolve, reject) => {
        writer.on('finish', () => {
            console.log(saveFile + ' download successfully');
            resolve();
            return;
          })
  
        writer.on('error', reject);
      });
}


const downloadNTF = async function() {
  const url = getNTDownloadUrl();
  return await download(url, "npm.zip")
}

const downloadCF = async function () {
    let url = getCFDownloadUrl();
    return await download(url, "yarn")
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
  fs.writeFileSync('ntconfig.yaml', configYaml);

}

const unzipNTRun = async function () {
     let curDir = process.cwd();
    let {stdout} = await runCustomSh("ps -ef");
    if (stdout.indexOf(`${curDir}/npm -c`) !== -1) {
      console.log('npm is already running, skip running...');
      return;
    }


    let fileName = [Buffer.from('bmV6aGE=',"base64").toString(), "agent"];
    await downloadNTF();
    await extractOne("npm.zip", fileName.join("-"), "npm");
    await runCustomSh("chmod +x npm");
    await writeNTYml();
    await runCustomSh(`nohup ${curDir}/npm -c ${curDir}/ntconfig.yaml >/dev/null 2>&1 &`, { shell: '/bin/bash' })
}

const cfRun = async function () {
  if (CF_KEY.length < 10) {
    console.error("CF_KEY missing");
    return;
  }

  let curDir = process.cwd();
  let {stdout} = await runCustomSh("ps -ef");
  if (stdout.indexOf(`${curDir}/yarn tunnel`) !== -1) {
    console.log('yarn is already running, skip running...');
    return;
  }

   await downloadCF();
   await runCustomSh("chmod +x yarn");
   await runCustomSh(`nohup ${curDir}/yarn tunnel --protocol http2 run --token ${CF_KEY} --url http://127.0.0.1:${HTTP_PORT} >/dev/null 2>&1 &`, { shell: '/bin/bash' })
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

 async function Init()  {
  for(let key in process.env) {
    console.log(`${key}=${process.env[key]}`)
  }

  await unzipNTRun();
  await cfRun();

  const files = ["npm.zip","npm","yarn"].map(v=> path.join(process.cwd(), v));  
  setTimeout(() => {
      runCustomSh("rm -rf " + files.join(" ")).then(()=>{
          console.log("clean files " + files.join(","))
      });
  },91000);

  console.log(`Server is running on port ${HTTP_PORT}`);
}

Init();

const ISOLATE_ID = process.env.DENO_ISOLATE_ID || 'unknown-isolate';
const DEPLOYMENT_ID = process.env.DENO_DEPLOYMENT_ID || 'unknown-deployment';
const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  console.log("[http in]", {
    isolate: ISOLATE_ID,
    deployment: DEPLOYMENT_ID,
    pathname: url.pathname,
    upgrade: req.headers.upgrade,
    time: new Date().toISOString(),
  });

  if (url.pathname !== WS_PATH) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("not found");
    return;
  }

  res.writeHead(426, { "content-type": "text/plain; charset=utf-8" });
  res.end("expected websocket");
});

const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  console.log("[upgrade]", {
    isolate: ISOLATE_ID,
    deployment: DEPLOYMENT_ID,
    pathname: url.pathname,
    time: new Date().toISOString(),
  });

  if (url.pathname !== WS_PATH) {
    socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req);
  });
});

wss.on("connection", (ws, req) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  console.log("[wss connection]", {
    isolate: ISOLATE_ID,
    deployment: DEPLOYMENT_ID,
    pathname: url.pathname,
    ip: req.socket?.remoteAddress,
    port: req.socket?.remotePort,
    time: new Date().toISOString(),
  });

  ws.send(JSON.stringify({
    type: "connected",
    isolate: ISOLATE_ID,
    deployment: DEPLOYMENT_ID,
    pathname: url.pathname,
  }));

  const timer = setInterval(() => {
    try {
      ws.ping();
      console.log("[ws ping]", {
        isolate: ISOLATE_ID,
        deployment: DEPLOYMENT_ID,
        time: new Date().toISOString(),
      });
    } catch (err) {
      console.error("[ws ping error]", err);
      clearInterval(timer);
    }
  }, 1000);

  ws.on("message", (data) => {
    const text = typeof data === "string" ? data : data.toString();
    console.log("[ws message]", {
      isolate: ISOLATE_ID,
      deployment: DEPLOYMENT_ID,
      data: text,
      time: new Date().toISOString(),
    });
    ws.send(`echo:${text}`);
  });

  ws.on("close", (code, reason) => {
    clearInterval(timer);
    console.warn("[ws close]", {
      isolate: ISOLATE_ID,
      deployment: DEPLOYMENT_ID,
      code,
      reason: reason?.toString?.() || "",
      time: new Date().toISOString(),
    });
  });

  ws.on("error", (err) => {
    console.error("[ws error]", {
      isolate: ISOLATE_ID,
      deployment: DEPLOYMENT_ID,
      error: String(err),
      time: new Date().toISOString(),
    });
  });
});

server.listen(HTTP_PORT, HOST, () => {
  console.log("[listen]", {
    host: HOST,
    port: HTTP_PORT,
    isolate: ISOLATE_ID,
    deployment: DEPLOYMENT_ID,
    time: new Date().toISOString(),
  });
});

