#!/usr/bin/env node
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Buffer } = require('buffer');

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



const nowDomain = process.env.DOMAIN || "domain";
const nowPort = HTTP_PORT;
const HOST = '0.0.0.0';  

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