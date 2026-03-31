const net = require('net');
const path = require('path');
const { PIPE_PREFIX, OUTPUT_BUFFER_SIZE } = require('./constants');
const registry = require('./registry');
const { resolveKey } = require('./keys');

let pty;
try {
  pty = require('node-pty');
} catch {
  console.error('error: node-pty is not installed. Run: npm install');
  process.exit(1);
}

function generateId() {
  return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function startWrap(name, command, args) {
  const paneId = generateId();
  const pipePath = `${PIPE_PREFIX}${paneId}`;

  // Output ring buffer
  const outputLines = [];

  function pushOutput(text) {
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
      outputLines.push(line);
      if (outputLines.length > OUTPUT_BUFFER_SIZE) {
        outputLines.shift();
      }
    }
  }

  // Determine shell
  const shell = command || process.env.COMSPEC || 'cmd.exe';
  const shellArgs = args.length > 0 ? args : [];

  // Get terminal size
  const cols = process.stdout.columns || 120;
  const rows = process.stdout.rows || 30;

  // Spawn PTY
  const ptyProcess = pty.spawn(shell, shellArgs, {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: process.cwd(),
    env: {
      ...process.env,
      WIN_BRIDGE_PANE: paneId,
      WIN_BRIDGE_NAME: name || '',
    },
  });

  // Forward PTY output to stdout and buffer
  ptyProcess.onData((data) => {
    process.stdout.write(data);
    pushOutput(data);
  });

  // Forward stdin to PTY (raw mode)
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (data) => {
    ptyProcess.write(data);
  });

  // Handle terminal resize
  process.stdout.on('resize', () => {
    const newCols = process.stdout.columns || 120;
    const newRows = process.stdout.rows || 30;
    ptyProcess.resize(newCols, newRows);
  });

  // Register in registry
  registry.register(paneId, {
    label: name || null,
    pid: process.pid,
    pipe: pipePath,
    cwd: process.cwd(),
    command: shell,
  });

  // Named pipe server for remote commands
  const pipeServer = net.createServer((conn) => {
    let data = '';
    conn.on('data', (chunk) => {
      data += chunk.toString();
      // Process on newline delimiter
      if (data.includes('\n')) {
        const line = data.split('\n')[0];
        try {
          const cmd = JSON.parse(line.trim());
          const response = handleCommand(cmd, ptyProcess, outputLines, paneId);
          conn.write(JSON.stringify(response) + '\n');
        } catch (err) {
          conn.write(JSON.stringify({ ok: false, error: err.message }) + '\n');
        }
        conn.end();
      }
    });
    conn.on('error', () => {}); // ignore broken pipes
  });

  pipeServer.listen(pipePath, () => {
    // Pipe ready
  });

  pipeServer.on('error', (err) => {
    console.error(`error: cannot create named pipe: ${err.message}`);
  });

  // Cleanup on exit
  function cleanup() {
    registry.unregister(paneId);
    pipeServer.close();
    try { ptyProcess.kill(); } catch {}
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    process.exit();
  }

  ptyProcess.onExit(() => { cleanup(); });
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
  process.on('exit', () => {
    registry.unregister(paneId);
    pipeServer.close();
  });

  // Print info banner
  const label = name ? ` (${name})` : '';
  process.stderr.write([
    '',
    `\x1b[32m[win-bridge]\x1b[0m Pane \x1b[1m${paneId}\x1b[0m${label} ready!`,
    `\x1b[90m  Pipe: ${pipePath}`,
    `  Other panes can now send commands to "${name || paneId}"`,
    `  Example: win-bridge read ${name || paneId} 20\x1b[0m`,
    '',
  ].join('\r\n'));
}

function handleCommand(cmd, ptyProcess, outputLines, paneId) {
  switch (cmd.cmd) {
    case 'type':
      ptyProcess.write(cmd.text);
      return { ok: true };

    case 'notify': {
      const text = (cmd.text || '').trim();
      if (!text) {
        return { ok: true };
      }

      const rendered = `\r\n[duo] ${text}\r\n`;
      process.stdout.write(rendered);
      pushOutput(rendered);
      return { ok: true };
    }

    case 'submit':
      if (cmd.text) {
        ptyProcess.write(cmd.text);
      }
      for (const key of (cmd.keys || ['Enter'])) {
        ptyProcess.write(resolveKey(key));
      }
      return { ok: true };

    case 'keys':
      for (const key of (cmd.keys || [])) {
        ptyProcess.write(resolveKey(key));
      }
      return { ok: true };

    case 'read': {
      const n = cmd.lines || 50;
      const lines = outputLines.slice(-n);
      const raw = lines.join('\n');
      // Strip ANSI escape sequences for clean output
      const clean = raw.replace(/\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07]*\x07|\x1b\][^\x1b]*\x1b\\|\x1b\[[\d;]*m/g, '')
                       .replace(/\r/g, '')
                       .split('\n')
                       .filter(l => l.trim().length > 0)
                       .join('\n');
      return { ok: true, output: clean };
    }

    case 'info':
      return {
        ok: true,
        id: paneId,
        pid: process.pid,
        label: process.env.WIN_BRIDGE_NAME || null,
      };

    case 'ping':
      return { ok: true, pong: true };

    default:
      return { ok: false, error: `unknown command: ${cmd.cmd}` };
  }
}

module.exports = { startWrap };
