const net = require('net');
const { PIPE_TIMEOUT } = require('./constants');
const registry = require('./registry');

function sendCommand(target, command) {
  return new Promise((resolve, reject) => {
    const entry = registry.resolveTarget(target);
    if (!entry) {
      reject(new Error(`no pane found with target '${target}'`));
      return;
    }

    const pipePath = entry.pipe;
    const client = net.createConnection(pipePath, () => {
      client.write(JSON.stringify(command) + '\n');
    });

    let data = '';
    let resolved = false;

    function tryResolve() {
      if (resolved) return;
      if (data.includes('\n')) {
        resolved = true;
        const line = data.split('\n')[0];
        try {
          resolve(JSON.parse(line));
        } catch {
          resolve({ ok: false, error: 'invalid response' });
        }
        client.destroy();
      }
    }

    client.on('data', (chunk) => {
      data += chunk.toString();
      tryResolve();
    });

    client.on('end', () => {
      if (!resolved) {
        resolved = true;
        try {
          resolve(JSON.parse(data.trim()));
        } catch {
          resolve({ ok: false, error: 'invalid response' });
        }
      }
    });

    client.on('error', (err) => {
      reject(new Error(`cannot connect to '${target}' (pipe: ${pipePath}): ${err.message}`));
    });

    setTimeout(() => {
      client.destroy();
      reject(new Error(`timeout connecting to '${target}'`));
    }, PIPE_TIMEOUT);
  });
}

module.exports = { sendCommand };
