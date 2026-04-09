let exp = module.exports;
const os = require('os');
const http = require('http');
const fs = require('fs');
const axios = require('axios');
const net = require('net');
const path = require('path');
const crypto = require('crypto');
const { Buffer } = require('buffer');
const { exec, execSync } = require('child_process');

const { WebSocket, createWebSocketStream } = require('ws');
const DNS_SERVERS = ['8.8.4.4', '1.1.1.1'];

const BLACK_DOMAINS = [];

const UUID = process.env.NODE_UUID || "";
const uuid = UUID.replace(/-/g, "");


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
      console.log("dns ", host, host)
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
              console.log("dns ", host, ip)
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
     console.log("password match ", !!matchedPassword )
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

          console.log("not support type", atyp );
      return false;
    }

    port = msg.readUInt16BE(offset);
    offset += 2;

    if (offset < msg.length && msg[offset] === 0x0d && msg[offset + 1] === 0x0a) {
      offset += 2;
    }

    if (isBlackDomain(host)) {
      ws.close();
           console.log("isBlackDomain", host );
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
    console.error(error.stack)
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
      console.log("handle_SsConnection fail ,invalid type", atyp)
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
    console.error(error.stack)
    return false;
  }
}

exp.createWSServer = function (httpServer, expectedPath) {
    const wss = new WebSocket.Server({ server: httpServer });
    console.log("create web socket", !!wss);
    wss.on('connection', (ws, req) => {
        const ip = req.socket.remoteAddress;
        const port = req.socket.remotePort;

        const url = req.url || '';
        console.log("wss " + url, ip, port, expectedPath);
        if (url !== expectedPath) {
            console.log(url+" not startsWith" + expectedPath)
            ws.close();
            return;
        }

        ws.once('message', msg => {
            console.log("wss msg", msg);
            if (msg.length > 17 && msg[0] === 0) {
                const id = msg.slice(1, 17);
                const isVlePro = id.every((v, i) => v == parseInt(uuid.substr(i * 2, 2), 16));
                if (isVlePro) {
                  console.log("on message handle_VlsConnection")
                    if (!handle_VlsConnection(ws, msg)) {
                        ws.close();
                    }
                    return;
                }
            }

            if (msg.length >= 58) {
                console.log("on message handle_TrojConnection")
                if (handle_TrojConnection(ws, msg)) {
                    return;
                }
            }

            const VALID = new Set([0x01, 0x03, 0x04]);
            if (msg.length > 0 && VALID.has(msg[0])) {
                console.log("on message handle_SsConnection")
                if (handle_SsConnection(ws, msg)) {
                    return;
                }
            }

            console.log("all close")
            ws.close();
        }).on('error', (err) => {
            console.log("websocket error", err)
         });
    });
}

exp.createDenoServer = function (port, expectedPath) {

   const wss = createDenoWSServer({port,expectedPath});
    console.log("create web socket", !!wss);
    wss.on('connection', (ws, req) => {
        const ip = req.socket.remoteAddress;
        const port = req.socket.remotePort;

        const url = req.url || '';
        console.log("wss2 " + url, ip, port, expectedPath);
        if (url !== expectedPath) {
            console.log(url+" not startsWith" + expectedPath)
            ws.close();
            return;
        }

        ws.once('message', msg => {
            console.log("on wss msg", msg);
            if (msg.length > 17 && msg[0] === 0) {
                const id = msg.slice(1, 17);
                const isVlePro = id.every((v, i) => v == parseInt(uuid.substr(i * 2, 2), 16));
                if (isVlePro) {
                  console.log("on message handle_VlsConnection")
                    if (!handle_VlsConnection(ws, msg)) {
                        ws.close();
                    }
                    return;
                }
            }

            if (msg.length >= 58) {
                console.log("on message handle_TrojConnection")
                if (handle_TrojConnection(ws, msg)) {
                    return;
                }
            }

            const VALID = new Set([0x01, 0x03, 0x04]);
            if (msg.length > 0 && VALID.has(msg[0])) {
                console.log("on message handle_SsConnection")
                if (handle_SsConnection(ws, msg)) {
                    return;
                }
            }

            console.log("not find all close")
            ws.close();
        }).on('error', (err) => {
            console.log("websocket error", err)
         });
    });
}

function normalizeMessage(data) {
  if (typeof data === "string") {
    return data;
  }

  if (data instanceof Uint8Array) {
    return data;
  }

  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }

  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }

  if (data instanceof Blob) {
    // 注意：这里不能直接同步返回 Uint8Array
    // Blob 需要异步 arrayBuffer()，所以最好服务端 binaryType 已经设为 "arraybuffer"
    return data;
  }

  return data;
}

function createDenoWSServer({ port, host = '0.0.0.0', expectedPath }) {
  const listeners = {
    connection: new Set(),
  };

  function emit(event, ...args) {
    const set = listeners[event];
    if (!set) return;
    for (const fn of set) {
      try {
        fn(...args);
      } catch (err) {
        console.error(`[wss ${event} handler error]`, err);
      }
    }
  }

  function createWSAdapter(socket) {
    const wsListeners = {
      open: new Set(),
      message: new Set(),
      close: new Set(),
      error: new Set(),
    };
    socket.binaryType = "arraybuffer";
    socket.addEventListener('open', () => {
      for (const fn of wsListeners.open) fn();
    });

    socket.addEventListener('message', (e) => {
      let msg = e.data;

    if (msg instanceof Blob) {
      msg = new Uint8Array(await msg.arrayBuffer());
    } else {
      msg = normalizeMessage(msg);
    }

    const isBinary = typeof msg !== "string";

    for (const fn of [...wsListeners.message]) {
      try {
        fn(msg, isBinary);
      } catch (err) {
        console.error("[ws message handler error]", err);
      }
    } 
    });

    socket.addEventListener('close', (e) => {
      for (const fn of wsListeners.close) {
        fn(e.code, e.reason);
      }
    });

    socket.addEventListener('error', (e) => {
      for (const fn of wsListeners.error) {
        fn(e);
      }
    });

 
    let ws = {
      send(data) {
        socket.send(data);
        return ws;
      },
      close(code, reason) {
        socket.close(code, reason);
        return ws;
      },
      on(event, handler) {
        return addListener(event, handler, false);
      },
      once(event, handler) {
        return addListener(event, handler, true);
      },
      off(event, handler) {
        if (wsListeners[event]) {
          wsListeners[event].delete(handler);
        }
        return ws;
      },
      removeListener(event, handler) {
        return ws.off(event, handler);
      },
      get readyState() {
        return socket.readyState;
      },
      OPEN: WebSocket.OPEN,
      CLOSING: WebSocket.CLOSING,
      CLOSED: WebSocket.CLOSED,
      raw: socket,
    };

    function addListener(event, handler, once = false) {
        if (!wsListeners[event]) {
          return ws;
        }
        const wrapped = once
          ? (...args) => {
              wsListeners[event].delete(wrapped);
              handler(...args);
            }
          : handler;

        wsListeners[event].add(wrapped);
        return ws;
      }

      return ws;
  }

  function createReqAdapter(req) {
    const urlObj = new URL(req.url);

    // 尽量模拟 Node 的 req.url，只保留 path/query
    const nodeStyleUrl = urlObj.pathname + urlObj.search;

    // 在 Deno Deploy 里通常拿不到真实 remotePort
    // IP 也未必总能拿到，这里优先从代理头取
    const xff = req.headers.get('x-forwarded-for');
    const xRealIp = req.headers.get('x-real-ip');
    const xClientPort = req.headers.get('x-client-port');

    const ip = xff
      ? xff.split(',')[0].trim()
      : (xRealIp || undefined);

    const port = xClientPort ? Number(xClientPort) : undefined;

    return {
      url: nodeStyleUrl,
      method: req.method,
      headers: Object.fromEntries(req.headers.entries()),
      socket: {
        remoteAddress: ip,
        remotePort: Number.isNaN(port) ? undefined : port,
      },
      raw: req,
    };
  }

  const server = Deno.serve({ hostname: host, port }, (req) => {
    const urlObj = new URL(req.url);

    if (urlObj.pathname !== expectedPath) {
      return new Response('not found', { status: 404 });
    }

    if (req.headers.get('upgrade') !== 'websocket') {
      return new Response('expected websocket', { status: 426 });
    }

    const { socket, response } = Deno.upgradeWebSocket(req);

    const ws = createWSAdapter(socket);
    const adaptedReq = createReqAdapter(req);

    emit('connection', ws, adaptedReq);

    return response;
  });

  return {
    server,
    on(event, handler) {
      if (listeners[event]) {
        listeners[event].add(handler);
      }
      return this;
    },
    off(event, handler) {
      if (listeners[event]) {
        listeners[event].delete(handler);
      }
      return this;
    },
    close() {
      server.shutdown();
    },
  };
}
