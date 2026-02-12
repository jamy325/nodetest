let exp = module.exports;
const { WebSocket, createWebSocketStream } = require('ws');
const DNS_SERVERS = ['8.8.4.4', '1.1.1.1'];

const BLACK_DOMAINS = [];

function isBlackDomain(host) {
  if (!host) return true;

  const hostLower = host.toLowerCase();
  return BLACK_DOMAINS.some(blocked => {
    return hostLower === blocked || hostLower.endsWith('.' + blocked);
  });
}

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
  
  let host = '';
    switch (ATYP) {
    case 1: { // IPv4: 4 bytes
        const ipv4Bytes = msg.slice(i, i + 4);
        host = Array.from(ipv4Bytes).join('.');
        i += 4;
        break;
    }

    case 2: { // Domain: 1 byte length + N bytes domain
        const len = msg.readUInt8(i);
        i += 1;

        host = msg.slice(i, i + len).toString('utf8'); // 或 msg.toString('utf8', i, i + len)
        i += len;
        break;
    }

    case 3: { // IPv6: 16 bytes
        const ipv6Bytes = msg.slice(i, i + 16);
        i += 16;

        const parts = [];
        for (let off = 0; off < 16; off += 2) {
            parts.push(ipv6Bytes.readUInt16BE(off).toString(16));
        }
        host = parts.join(':');
        break;
    }

    default:
        host = '';
        break;
    }

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


function handle_TrojConnection(ws, msg) {
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
    if (cmd !== 0x01)
         return false;

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
      host = msg.slice(offset, offset + 16).reduce((s, b, i, a) => (i % 2 ? s.concat(a.slice(i - 1, i + 1)) : s), []).map(b => b.readUInt16BE(0).toString(16)).join(':');
      offset += 16;
    } else {
      return false;
    }

    port = msg.readUInt16BE(offset);
    offset += 2;

    if (offset < msg.length && msg[offset] === 0x0d && msg[offset + 1] === 0x0a) {
      offset += 2;
    }

    if (isBlockedDomain(host)) {
      ws.close();
      return false;
    }

    const duplex = createWebSocketStream(ws);
    resolveHost(host)
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

function handle_SsConnection(ws, msg) {
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

    if (isBlockedDomain(host)) {
      ws.close();
      return false;
    }
    const duplex = createWebSocketStream(ws);
    resolveHost(host)
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

exp.createWSServer = function (httpServer, expectedPath) {
    const wss = new WebSocket.Server({ server: httpServer });
    wss.on('connection', (ws, req) => {
        const url = req.url || '';
        if (!url.startsWith(expectedPath)) {
            ws.close();
            return;
        }

        ws.once('message', msg => {
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

            const VALID = new Set([0x01, 0x03, 0x04]);
            if (msg.length > 0 && VALID.has(msg[0]) {
                if (handle_SsConnection(ws, msg)) {
                    return;
                }
            }

            ws.close();
        }).on('error', () => { });
    });
}