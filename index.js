#!/usr/bin/env node
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Buffer } = require('buffer');

const HTTP_PORT = process.env.HTTP_PORT || 3000;
const SUBS_PATH = process.env.SUBS_PATH || 'test';
const NODE_NAME = process.env.NODE_NAME || "defalut";
const UUID = process.env.UUID || "uuid";
const nowDomain = process.env.DOMAIN || "domain";
const nowPort = HTTP_PORT;


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


httpServer.listen(HTTP_PORT, () => {
  //readGoole();
  console.log(`Server is running on port ${HTTP_PORT}`);
});