const crypto = require('node:crypto');
const WebSocket = require('ws');

const INSTANCE_ID = crypto.randomUUID();
let exp = module.exports;

console.log('[boot]', INSTANCE_ID, new Date().toISOString());

if (globalThis.addEventListener) {
  globalThis.addEventListener('unhandledrejection', (e) => {
    console.error('[unhandledrejection]', INSTANCE_ID, e.reason);
  });

  globalThis.addEventListener('error', (e) => {
    console.error('[global error]', INSTANCE_ID, e.error ?? e.message);
  });
}

try {
  if (typeof Deno !== 'undefined' && Deno.addSignalListener) {
    Deno.addSignalListener('SIGINT', () => {
      console.warn('[sigint]', INSTANCE_ID, 'shutdown incoming');
    });
  }
} catch (err) {
  console.warn('[signal-listener-failed]', INSTANCE_ID, err);
}

const ISOLATE_ID = process.env.DENO_ISOLATE_ID || 'unknown-isolate';
const DEPLOYMENT_ID = process.env.DENO_DEPLOYMENT_ID || 'unknown-deployment';

console.log('[boot]', {
  isolate: ISOLATE_ID,
  deployment: DEPLOYMENT_ID,
  time: new Date().toISOString(),
});

try {
  Deno.addSignalListener('SIGINT', () => {
    console.warn('[sigint]', {
      isolate: ISOLATE_ID,
      deployment: DEPLOYMENT_ID,
      time: new Date().toISOString(),
    });
  });
} catch {}

exp.createWSServer = function (httpServer, expectedPath) {
  const wss = new WebSocket.Server({ server: httpServer });
  console.log('[create web socket]', INSTANCE_ID, !!wss);

  wss.on('connection', (ws, req) => {
    const ip = req?.socket?.remoteAddress;
    const port = req?.socket?.remotePort;
    const url = req?.url || '';

    console.log('[wss connection]', {
        isolate: ISOLATE_ID,
        deployment: DEPLOYMENT_ID,
        url,
        ip,
        port,
        expectedPath,
        });

    console.log('[wss connection]', INSTANCE_ID, {
      url,
      ip,
      port,
      expectedPath,
    });

    ws.on('error', (err) => {
      console.error('[ws error]', INSTANCE_ID, err);
    });

    ws.on('close', (code, reason) => {
      console.warn('[ws close]', INSTANCE_ID, code, String(reason || ''));
    });

    ws.on('message', (data) => {
      console.log('[ws message]', INSTANCE_ID, String(data));
    });

    if (url !== expectedPath) {
      ws.send(JSON.stringify({
        type: 'path_mismatch',
        url,
        expectedPath,
        instanceId: INSTANCE_ID,
      }));

      // 关键：持续产生流量，避免“只是空闲连接”
      const timer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          try {
            ws.ping();
            console.log('[ws ping]', INSTANCE_ID, url);
          } catch (err) {
            console.error('[ws ping error]', INSTANCE_ID, err);
            clearInterval(timer);
          }
        } else {
          clearInterval(timer);
        }
      }, 1000);

      ws.on('close', () => clearInterval(timer));
      ws.on('error', () => clearInterval(timer));

      // 先不要 close，观察 20~30 秒
      setTimeout(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'test_done',
            instanceId: INSTANCE_ID,
          }));
          ws.close(1000, 'test complete');
        }
      }, 30000);

      return;
    }

    ws.send(JSON.stringify({
      type: 'connected',
      instanceId: INSTANCE_ID,
      url,
    }));
  });

  return wss;
};