const net = require('net');
const path = require('path');
const { PIPE_PREFIX, OUTPUT_BUFFER_SIZE } = require('./constants');
const registry = require('./registry');
const { resolveKey } = require('./keys');
const { ScreenBuffer } = require('./screen-buffer');
const { markRead, clearRead } = require('./guard');

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

  // Determine shell
  const shell = command || process.env.COMSPEC || 'cmd.exe';
  const shellArgs = args.length > 0 ? args : [];

  // Get terminal size
  const cols = process.stdout.columns || 120;
  const rows = process.stdout.rows || 30;

  // Virtual screen buffer (replaces raw line ring buffer)
  const screen = new ScreenBuffer(cols, rows, OUTPUT_BUFFER_SIZE);

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

  // Forward PTY output to stdout and screen buffer
  ptyProcess.onData((data) => {
    process.stdout.write(data);
    screen.write(data);
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
    screen.resize(newCols, newRows);
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
          const response = handleCommand(cmd, ptyProcess, screen, paneId);
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

  // Cleanup on exit (guarded against multiple calls)
  let cleanedUp = false;

  function cleanup() {
    if (cleanedUp) return;
    cleanedUp = true;
    try { registry.unregister(paneId); } catch {}
    try { pipeServer.close(); } catch {}
    try { ptyProcess.kill(); } catch {}
    if (process.stdin.isTTY) {
      try { process.stdin.setRawMode(false); } catch {}
    }
  }

  ptyProcess.onExit(({ exitCode }) => {
    cleanup();
    process.exit(exitCode != null ? exitCode : 0);
  });
  process.on('SIGINT', () => { cleanup(); process.exit(130); });
  process.on('SIGTERM', () => { cleanup(); process.exit(143); });
  process.on('exit', () => {
    // Safety net: only sync operations, no process.exit() call
    if (!cleanedUp) {
      try { registry.unregister(paneId); } catch {}
    }
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

function handleCommand(cmd, ptyProcess, screen, paneId) {
  switch (cmd.cmd) {
    case 'type':
      clearRead(paneId);
      ptyProcess.write(cmd.text);
      return { ok: true };

    case 'notify': {
      const text = (cmd.text || '').trim();
      if (!text) {
        return { ok: true };
      }

      const rendered = `\r\n[duo] ${text}\r\n`;
      process.stdout.write(rendered);
      screen.write(rendered);
      return { ok: true };
    }

    case 'submit': {
      clearRead(paneId);
      const delay = cmd.delay || 0;
      if (cmd.text) {
        ptyProcess.write(cmd.text);
      }
      if (delay > 0) {
        setTimeout(() => {
          for (const key of (cmd.keys || ['Enter'])) {
            ptyProcess.write(resolveKey(key));
          }
        }, delay);
      } else {
        for (const key of (cmd.keys || ['Enter'])) {
          ptyProcess.write(resolveKey(key));
        }
      }
      return { ok: true };
    }

    case 'keys':
      clearRead(paneId);
      for (const key of (cmd.keys || [])) {
        ptyProcess.write(resolveKey(key));
      }
      return { ok: true };

    case 'read': {
      const n = cmd.lines || 50;
      const lines = screen.getScrollback(n);
      // Screen buffer already strips ANSI; just filter empty lines
      const clean = lines.filter(l => l.trim().length > 0).join('\n');
      markRead(paneId);
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
