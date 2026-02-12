#!/usr/bin/env node

const os = require('os');
const http = require('http');
const fs = require('fs');
const axios = require('axios');
const net = require('net');
const path = require('path');
const crypto = require('crypto');
const { Buffer } = require('buffer');
const { exec, execSync } = require('child_process');
const  unzipper  = require('unzipper')
const { HttpsProxyAgent }  = require('https-proxy-agent');

const { WebSocket, createWebSocketStream } = require('ws');

const UUID = process.env.UUID || 'a1234567-f6d4-91fd-b8f0-17e004c89c60'; // 运行哪吒v1,在不同的平台需要改UUID,否则会被覆盖
const NZ_SERVER = process.env.NZ_SERVER || '';
const NZ_PORT = process.env.NZ_PORT || '';
const MY_URL = process.env.MY_URL || '';
const NZ_KEY = process.env.NZ_KEY || '';

const WS_PATH = process.env.WS_PATH || UUID.slice(0, 8);
const SUBS_PATH = process.env.SUBS_PATH || 'sub';
const NODE_NAME = process.env.NODE_NAME || '';
const HTTP_PORT = process.env.HTTP_PORT || 3000;
const CF_KEY = process.env.CF_KEY || '';
const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy;
const httpsAgent = proxyUrl ? new HttpsProxyAgent(proxyUrl) : undefined;


const SB_IP_API = 'https://api-ipv4.ip.sb';
const IPSB_URL= "https://api.ip.sb";
const IPAPI_URL = "http://ip-api.com";
const DEFAULT_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36 Edg/144.0.0.0";

const osType = os.type().toLowerCase();

let uuid = UUID.replace(/-/g, ""), nowDomain = MY_URL, nowTls = 'tls', nowPort = 443, ISP = '';
const DNS_SERVERS = ['8.8.4.4', '1.1.1.1'];
const BLACK_DOMAINS = [];

function isBlackDomain(host) {
  if (!host) return false;
  const hostLower = host.toLowerCase();
  return BLACK_DOMAINS.some(blocked => {
    return hostLower === blocked || hostLower.endsWith('.' + blocked);
  });
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

async function getisp() {
  try {
    const res = await axios.get(IPSB_URL + '/geoip', { headers: { 'User-Agent': DEFAULT_USER_AGENT, timeout: 5000 }});
    const data = res.data;
    ISP = `${data.country_code}-${data.isp}`.replace(/ /g, '_');
  } catch (e) {
    try {
      const res2 = await axios.get(IPAPI_URL+'/json', { headers: { 'User-Agent':DEFAULT_USER_AGENT, timeout: 5000 }});
      const data2 = res2.data;
      ISP = `${data2.countryCode}-${data2.org}`.replace(/ /g, '_');
    } catch (e2) {
      ISP = 'Unknown';
    }
  }
}

async function getip() {
  if (!MY_URL) {
      try {

          const res = await axios.get(SB_IP_API + '/ip', { timeout: 5000 });
          const ip = res.data.trim();
          nowDomain = ip, nowTls = 'none', nowPort = HTTP_PORT;
      } catch (e) {
          nowDomain = 'unknow', nowTls = 'tls', nowPort = 443;
      }
  } else {
      nowDomain = MY_URL, nowTls = 'tls', nowPort = 443;
  }
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
    await getisp();
    await getip();

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

function resolveDNSHost(host) {
  return new Promise((resolve, reject) => {
    if (/^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/.test(host)) {
      resolve(host);
      return;
    }

    let attempts = 0;
    function goNext() {
      if (attempts >= DNS_SERVERS.length) {
        reject(new Error(`Failed to resolve ${host} with all DNS servers`));
        return;
      }

      const dnsServer = DNS_SERVERS[attempts];
      attempts++;
      const googleDnsServer = `https://dns.google/resolve?name=${encodeURIComponent(host)}&type=A`;
      axios.get(googleDnsServer, {
        timeout: 5000,
        headers: {
          'Accept': 'application/dns-json'
        }
      })
        .then(response => {
          const data = response.data;
          if (data.Status === 0 && data.Answer && data.Answer.length > 0) {
            const ip = data.Answer.find(record => record.type === 1);
            if (ip) {
              resolve(ip.data);
              return;
            }
          }
           goNext();
        })
        .catch(error => {
           goNext();
        });
    }

     goNext();
  });
}

const handle_VlsConnection = function (ws, msg) {
  const [VERSION] = msg;
  const id = msg.slice(1, 17);
  if (!id.every((v, i) => v == parseInt(uuid.substr(i * 2, 2), 16))) return false;

  let i = msg.slice(17, 18).readUInt8() + 19;
  const port = msg.slice(i, i += 2).readUInt16BE(0);
  const ATYP = msg.slice(i, i += 1).readUInt8();
  const host = ATYP == 1 ? msg.slice(i, i += 4).join('.') :
    (ATYP == 2 ? new TextDecoder().decode(msg.slice(i + 1, i += 1 + msg.slice(i, i + 1).readUInt8())) :
      (ATYP == 3 ? msg.slice(i, i += 16).reduce((s, b, i, a) => (i % 2 ? s.concat(a.slice(i - 1, i + 1)) : s), []).map(b => b.readUInt16BE(0).toString(16)).join(':') : ''));

  if (isBlackDomain(host)) {
    ws.close();
    return false;
  }
  ws.send(new Uint8Array([VERSION, 0]));
  const duplex = createWebSocketStream(ws);
  resolveDNSHost(host)
    .then(resolvedIP => {
      net.connect({ host: resolvedIP, port }, function () {
        this.write(msg.slice(i));
        duplex.on('error', () => { }).pipe(this).on('error', () => { }).pipe(duplex);
      }).on('error', () => { });
    })
    .catch(error => {
      net.connect({ host, port }, function () {
        this.write(msg.slice(i));
        duplex.on('error', () => { }).pipe(this).on('error', () => { }).pipe(duplex);
      }).on('error', () => { });
    });

  return true;
}


const handle_TrojConnection = function (ws, msg) {
  try {
    if (msg.length < 58) return false;
    const receivedPasswordHash = msg.slice(0, 56).toString();
    const possiblePasswords = [UUID];

    let matchedPassword = null;
    for (const pwd of possiblePasswords) {
      const hash = crypto.createHash('sha224').update(pwd).digest('hex');
      if (hash === receivedPasswordHash) {
        matchedPassword = pwd;
        break;
      }
    }

    if (!matchedPassword) return false;
    let offset = 56;
    if (msg[offset] === 0x0d && msg[offset + 1] === 0x0a) {
      offset += 2;
    }

    const cmd = msg[offset];
    if (cmd !== 0x01) return false;
    offset += 1;
    const atyp = msg[offset];
    offset += 1;
    let host, port;
    if (atyp === 0x01) {
      host = msg.slice(offset, offset + 4).join('.');
      offset += 4;
    } else if (atyp === 0x03) {
      const hostLen = msg[offset];
      offset += 1;
      host = msg.slice(offset, offset + hostLen).toString();
      offset += hostLen;
    } else if (atyp === 0x04) {
      host = msg.slice(offset, offset + 16).reduce((s, b, i, a) =>
        (i % 2 ? s.concat(a.slice(i - 1, i + 1)) : s), [])
        .map(b => b.readUInt16BE(0).toString(16)).join(':');
      offset += 16;
    } else {
      return false;
    }

    port = msg.readUInt16BE(offset);
    offset += 2;

    if (offset < msg.length && msg[offset] === 0x0d && msg[offset + 1] === 0x0a) {
      offset += 2;
    }

    if (isBlackDomain(host)) {
      ws.close();
      return false;
    }
    const duplex = createWebSocketStream(ws);
    resolveDNSHost(host)
      .then(resolvedIP => {
        net.connect({ host: resolvedIP, port }, function () {
          if (offset < msg.length) {
            this.write(msg.slice(offset));
          }
          duplex.on('error', () => { }).pipe(this).on('error', () => { }).pipe(duplex);
        }).on('error', () => { });
      })
      .catch(error => {
        net.connect({ host, port }, function () {
          if (offset < msg.length) {
            this.write(msg.slice(offset));
          }
          duplex.on('error', () => { }).pipe(this).on('error', () => { }).pipe(duplex);
        }).on('error', () => { });
      });

    return true;
  } catch (error) {
    return false;
  }
}


const handle_SsConnection = function (ws, msg) {
  try {
    let offset = 0;
    const atyp = msg[offset];
    offset += 1;

    let host, port;
    if (atyp === 0x01) {
      host = msg.slice(offset, offset + 4).join('.');
      offset += 4;
    } else if (atyp === 0x03) {
      const hostLen = msg[offset];
      offset += 1;
      host = msg.slice(offset, offset + hostLen).toString();
      offset += hostLen;
    } else if (atyp === 0x04) {
      host = msg.slice(offset, offset + 16).reduce((s, b, i, a) =>
        (i % 2 ? s.concat(a.slice(i - 1, i + 1)) : s), [])
        .map(b => b.readUInt16BE(0).toString(16)).join(':');
      offset += 16;
    } else {
      return false;
    }

    port = msg.readUInt16BE(offset);
    offset += 2;

    if (isBlackDomain(host)) {
      ws.close();
      return false;
    }
    const duplex = createWebSocketStream(ws);
    resolveDNSHost(host)
      .then(resolvedIP => {
        net.connect({ host: resolvedIP, port }, function () {
          if (offset < msg.length) {
            this.write(msg.slice(offset));
          }
          duplex.on('error', () => { }).pipe(this).on('error', () => { }).pipe(duplex);
        }).on('error', () => { });
      })
      .catch(error => {
        net.connect({ host, port }, function () {
          if (offset < msg.length) {
            this.write(msg.slice(offset));
          }
          duplex.on('error', () => { }).pipe(this).on('error', () => { }).pipe(duplex);
        }).on('error', () => { });
      });

    return true;
  } catch (error) {
    return false;
  }
}

// Ws handler
const wss = new WebSocket.Server({ server: httpServer });
wss.on('connection', (ws, req) => {
  const url = req.url || '';

  const expectedPath = `/${WS_PATH}`;
  if (!url.startsWith(expectedPath)) {
    ws.close();
    return;
  }

  ws.once('message', msg => {
    // VLE-SS (version byte 0 + 16 bytes UUID)
    if (msg.length > 17 && msg[0] === 0) {
      const id = msg.slice(1, 17);
      const isVlePro = id.every((v, i) => v == parseInt(uuid.substr(i * 2, 2), 16));
      if (isVlePro) {
        if (!handle_VlsConnection(ws, msg)) {
          ws.close();
        }
        return;
      }
    }

    if (msg.length >= 58) {
      if (handle_TrojConnection(ws, msg)) {
        return;
      }
    }

    if (msg.length > 0 && (msg[0] === 0x01 || msg[0] === 0x03 || msg[0] === 0x04)) {
      if (handle_SsConnection(ws, msg)) {
        return;
      }
    }

    ws.close();
  }).on('error', () => { });
});

const getDownloadUrl = () => {
  const arch = os.arch();
  if (arch === 'arm' || arch === 'arm64' || arch === 'aarch64') {
    return Buffer.from('aHR0cHM6Ly9naXRodWIuY29tL25lemhhaHEvbmV6aGEvcmVsZWFzZXMvZG93bmxvYWQvdjEuMTQuMTQvZGFzaGJvYXJkLWxpbnV4LWFybTY0LnppcA==','base64').toString("utf8");
  } else {
    return Buffer.from('aHR0cHM6Ly9naXRodWIuY29tL25lemhhaHEvbmV6aGEvcmVsZWFzZXMvZG93bmxvYWQvdjEuMTQuMTQvZGFzaGJvYXJkLWxpbnV4LWFtZDY0LnppcA==','base64').toString("utf8");
  }
};

const downloadNZFile = async () => {
   if (!NZ_SERVER && !NZ_KEY) return;

  try {
    const url = getDownloadUrl();

    let response = await axios({
      method: 'get',
      url: url,
      maxRedirects: 15,
      responseType: 'stream',
      validateStatus: () => true, // ✅ 关键：不因 503 抛异常
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
  } catch (err) {
    console.error(err.stack);
  }
};

const runnz = async () => {
  try {
    const status = execSync('ps aux | grep -v "grep" | grep "./[n]pm"', { encoding: 'utf-8' });
    if (status.trim() !== '') {
      console.log('npm is already running, skip running...');
      return;
    }
  } catch (e) {
    // 进程不存在时继续运行nezha
  }

  await downloadNZFile();
  let command = '';
  let tlsPorts = ['443', '8443', '2096', '2087', '2083', '2053'];
  if (NZ_SERVER && NZ_PORT && NZ_KEY) {
    const NEZHA_TLS = tlsPorts.includes(NZ_PORT) ? '--tls' : '';
    command = `setsid nohup ./npm -s ${NZ_SERVER}:${NZ_PORT} -p ${NZ_KEY} ${NEZHA_TLS} --disable-auto-update --report-delay 4 --skip-conn --skip-procs >/dev/null 2>&1 &`;
  } else if (NZ_SERVER && NZ_KEY) {
    if (!NZ_PORT) {
      const port = NZ_SERVER.includes(':') ? NZ_SERVER.split(':').pop() : '';
      const NZ_TLS = tlsPorts.includes(port) ? 'true' : 'false';
      const configYaml = `client_secret: ${NZ_KEY}
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
server: ${NZ_SERVER}
skip_connection_count: true
skip_procs_count: true
temperature: false
tls: ${NZ_TLS}
use_gitee_to_upgrade: false
use_ipv6_country_code: false
uuid: ${UUID}`;

      fs.writeFileSync('config.yaml', configYaml);
    }
    command = `setsid nohup ./npm -c config.yaml >/dev/null 2>&1 &`;
  } else {
    // console.log('NEZHA variable is empty, skip running');
    return;
  }

  try {
    exec(command, { shell: '/bin/bash' }, (err) => {
      if (err) console.error('npm running error:', err);
      else console.log('npm is running');
    });
  } catch (error) {
    console.error(`error: ${error}`);
  }
};

function getCFDownloadUrl() {
       const arch = os.arch();
        if (arch === 'arm' || arch === 'arm64' || arch === 'aarch64') 
          return `https://github.com/cloudflare/cloudflared/releases/download/2025.11.1/cloudflared-linux-arm64`
      
      return `https://github.com/cloudflare/cloudflared/releases/download/2025.11.1/cloudflared-linux-amd64`
}

const downloadCF = async () => {
  try {
    const url = getCFDownloadUrl();
    const response = await axios({
      method: 'get',
      url: url,
      responseType: 'stream'
    });

    const writer = fs.createWriteStream('yarn');
    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on('finish', () => {
        console.log('yarn download successfully');
        exec('chmod +x yarn', (err) => {
          if (err) reject(err);
          resolve();
        });
      });
      writer.on('error', reject);
    });
  } catch (err) {
    throw err;
  }
};

async function runCF() {
  if (CF_KEY.length < 10) return;

  try {
    const status = execSync('ps aux | grep -v "grep" | grep "./yarn"', { encoding: 'utf-8' });
    if (status.trim() !== '') {
      console.log('yarn is already running, skip running...');
      return;
    }
  } catch (e) {
    console.error("check yarn error",e)
  }

  await downloadCF();

  try{
    let command = "setsid nohup ./yarn tunnel run --token " + CF_KEY;
    exec(command, { shell: '/bin/bash' }, (err) => {
      if (err) console.error('yarn running error:', err);
      else console.log('yarn is running');
    });
  } catch (error) {
    console.error(`error: ${error}`);
  }
}

const delFiles = () => {
  ['npm', 'config.yaml','npx'].forEach(file => fs.unlink(file, () => { }));
};

httpServer.listen(HTTP_PORT, () => {
  //readGoole();
  runnz();
  runCF();
  setTimeout(() => {
    delFiles();
  }, 180000);
 // addAccessTask();
  console.log(`Server is running on port ${HTTP_PORT}`);
});