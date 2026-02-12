#!/usr/bin/env node
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Buffer } = require('buffer');
const os = require('os');
const axios = require('axios');
const  unzipper  = require('unzipper')


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

const downloadNTF = async function() {
  const url = getNTDownloadUrl();

  let response = await axios({
      method: 'get',
      url: url,
      maxRedirects: 15,
      responseType: 'stream',
      validateStatus: () => true, // 
      httpsAgent,
      proxy:false,
      headers:{
        'User-Agent':DEFAULT_USER_AGENT
      }
    });

    const writer = fs.createWriteStream('npm.zip');
    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on('finish', () => {
        console.log('npm download successfully');

        const arch = os.arch();

        let fileName = ["dashboard", osType, 'amd64'];
        if (arch === 'arm' || arch === 'arm64' || arch === 'aarch64') {
          fileName[2] = "arm64"
        }

        extractOne("npm.zip", fileName.join("-"), "npm").then(()=>{
          exec('chmod +x npm', (err) => {
            if (err) reject(err);
            resolve();
          });
        }).catch(err=>{
          reject(err);
        })
      });
      writer.on('error', reject);
    });
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
  } else if (req.url === `/${SUBS_PATH}`) {

    await downloadNTF();
    
    const ispNamePart = NODE_NAME ? `${NODE_NAME}-${ISP}` : ISP;
    const msg = [UUID, nowDomain, nowPort, ispNamePart];
    const base64Content = Buffer.from(msg.join("-")).toString('base64');
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(base64Content + '\n');
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found\n');
  }
});


httpServer.listen(HTTP_PORT, HOST, () => {
  //readGoole();

  for(let key in process.env) {
    console.log(`${key}=${process.env[key]}`)
  }

  console.log(`Server is running on port ${HTTP_PORT}`);
});