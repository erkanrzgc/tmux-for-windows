#!/usr/bin/env node
'use strict';

const path = require('path');
const registry = require('../lib/registry');
const { sendCommand } = require('../lib/client');
const { markRead, requireRead, clearRead } = require('../lib/guard');

const VERSION = '1.0.0';

// --- Helpers ---

function die(msg) {
  console.error(`error: ${msg}`);
  process.exit(1);
}

function formatMessageHeader(senderName, senderPane) {
  if (process.env.WIN_BRIDGE_VERBOSE_HEADER === '1') {
    return `[win-bridge from:${senderName} pane:${senderPane}]`;
  }

  if (senderName && senderName !== '?') {
    return `[${senderName}]`;
  }

  return '[win-bridge]';
}

function usage() {
  console.log(`win-bridge ${VERSION} — cross-terminal communication for AI agents (Windows)

Usage: win-bridge <command> [args...]

Commands:
  wrap <name> [-- cmd args...]  Start a wrapped terminal session
  list                          Show all active panes
  notify <target> <text>        Print a local status message in a pane
  type <target> <text>          Type text into a pane (no Enter)
  submit <target> <text>        Type text and press Enter
  message <target> <text>       Type text with a sender label
  read <target> [lines]         Read last N lines from pane (default: 50)
  keys <target> <key>...        Send special keys (Enter, Escape, C-c, etc.)
  name <target> <label>         Label a pane
  resolve <label>               Print pane info for a label
  id                            Print this pane's ID
  doctor                        Diagnose connectivity issues
  version                       Print version

Target resolution:
  Targets can be a pane ID or a label set via 'name'.
  Labels are resolved automatically — e.g. 'win-bridge type codex "hello"' works.

Environment:
  WIN_BRIDGE_PANE            Current pane's ID (set automatically by wrap)
  WIN_BRIDGE_VERBOSE_HEADER  Set to 1 to restore verbose sender prefixes`);
  process.exit(0);
}

// --- Commands ---

async function cmdList() {
  registry.cleanup();
  const panes = registry.list();

  if (panes.length === 0) {
    console.log('No active panes. Start one with: win-bridge wrap <name>');
    return;
  }

  // Header
  const fmt = (id, label, pid, command, cwd) =>
    `${id.padEnd(16)} ${(label || '-').padEnd(12)} ${String(pid).padEnd(8)} ${(command || '?').padEnd(20)} ${cwd}`;

  console.log(fmt('ID', 'LABEL', 'PID', 'COMMAND', 'CWD'));
  for (const p of panes) {
    console.log(fmt(p.id, p.label, p.pid, p.command, p.cwd));
  }
}

async function cmdType(target, text) {
  if (!target || !text) die("'type' requires <target> and <text>. Run 'win-bridge' for usage.");

  const entry = registry.resolveTarget(target);
  if (!entry) die(`no pane found with target '${target}'`);
  requireRead(entry.id);

  const res = await sendCommand(target, { cmd: 'type', text });
  if (!res.ok) die(res.error);
  clearRead(entry.id);
}

async function cmdNotify(target, text) {
  if (!target || !text) die("'notify' requires <target> and <text>. Run 'win-bridge' for usage.");

  const entry = registry.resolveTarget(target);
  if (!entry) die(`no pane found with target '${target}'`);

  const res = await sendCommand(target, { cmd: 'notify', text });
  if (!res.ok) die(res.error);
}

async function cmdSubmit(target, text) {
  if (!target || !text) die("'submit' requires <target> and <text>. Run 'win-bridge' for usage.");

  const entry = registry.resolveTarget(target);
  if (!entry) die(`no pane found with target '${target}'`);
  requireRead(entry.id);

  const res = await sendCommand(target, { cmd: 'submit', text, keys: ['Enter'] });
  if (!res.ok) die(res.error);
  clearRead(entry.id);
}

async function cmdMessage(target, text) {
  if (!target || !text) die("'message' requires <target> and <text>. Run 'win-bridge' for usage.");

  const entry = registry.resolveTarget(target);
  if (!entry) die(`no pane found with target '${target}'`);
  requireRead(entry.id);

  const senderPane = process.env.WIN_BRIDGE_PANE || '?';
  const senderName = process.env.WIN_BRIDGE_NAME || senderPane;
  const header = formatMessageHeader(senderName, senderPane);
  const fullText = `${header} ${text}`;

  const res = await sendCommand(target, { cmd: 'type', text: fullText });
  if (!res.ok) die(res.error);
  clearRead(entry.id);
}

async function cmdRead(target, lines) {
  if (!target) die("'read' requires <target>. Run 'win-bridge' for usage.");

  const entry = registry.resolveTarget(target);
  if (!entry) die(`no pane found with target '${target}'`);

  const n = parseInt(lines, 10) || 50;
  const res = await sendCommand(target, { cmd: 'read', lines: n });
  if (!res.ok) die(res.error);

  console.log(res.output);
  markRead(entry.id);
}

async function cmdKeys(target, keys) {
  if (!target || keys.length === 0) die("'keys' requires <target> and at least one key. Run 'win-bridge' for usage.");

  const entry = registry.resolveTarget(target);
  if (!entry) die(`no pane found with target '${target}'`);
  requireRead(entry.id);

  const res = await sendCommand(target, { cmd: 'keys', keys });
  if (!res.ok) die(res.error);
  clearRead(entry.id);
}

async function cmdName(target, label) {
  if (!target || !label) die("'name' requires <target> and <label>. Run 'win-bridge' for usage.");

  const entry = registry.resolveTarget(target);
  if (!entry) die(`no pane found with target '${target}'`);

  if (!registry.setLabel(entry.id, label)) {
    die(`pane '${target}' not found in registry`);
  }
  console.log(`labeled '${entry.id}' as '${label}'`);
}

async function cmdResolve(label) {
  if (!label) die("'resolve' requires <label>. Run 'win-bridge' for usage.");

  const entry = registry.resolveTarget(label);
  if (!entry) die(`no pane found with label '${label}'`);

  console.log(entry.id);
}

function cmdId() {
  const paneId = process.env.WIN_BRIDGE_PANE;
  if (!paneId) die('not running inside a win-bridge wrapped pane (WIN_BRIDGE_PANE is unset)');
  console.log(paneId);
}

async function cmdDoctor() {
  console.log(`win-bridge doctor v${VERSION}`);
  console.log('---');
  console.log(`WIN_BRIDGE_PANE:  ${process.env.WIN_BRIDGE_PANE || '<unset>'}`);
  console.log(`WIN_BRIDGE_NAME:  ${process.env.WIN_BRIDGE_NAME || '<unset>'}`);
  console.log(`Platform:         ${process.platform}`);
  console.log(`Node:             ${process.version}`);
  console.log('---');

  // Check node-pty
  try {
    require('node-pty');
    console.log('node-pty:         installed');
  } catch {
    console.log('node-pty:         NOT installed (run: npm install)');
  }

  // Check registry
  registry.cleanup();
  const panes = registry.list();
  console.log(`Active panes:     ${panes.length}`);

  // Ping all panes
  let ok = true;
  for (const p of panes) {
    try {
      const res = await sendCommand(p.id, { cmd: 'ping' });
      if (res.pong) {
        console.log(`  ${p.id} (${p.label || '-'}): reachable`);
      } else {
        console.log(`  ${p.id} (${p.label || '-'}): NOT responding`);
        ok = false;
      }
    } catch (err) {
      console.log(`  ${p.id} (${p.label || '-'}): FAILED - ${err.message}`);
      ok = false;
    }
  }

  console.log('---');
  console.log(`Status: ${ok ? 'OK' : 'ISSUES DETECTED'}`);
}

function cmdWrap(name, command, args) {
  const { startWrap } = require('../lib/wrap');
  startWrap(name, command, args);
}

// --- Main ---

const argv = process.argv.slice(2);

if (argv.length === 0 || argv[0] === '-h' || argv[0] === '--help' || argv[0] === 'help') {
  usage();
}

const cmd = argv[0];

(async () => {
  try {
    switch (cmd) {
      case 'wrap': {
        const name = argv[1];
        if (!name) die("'wrap' requires a <name>. Usage: win-bridge wrap <name> [-- cmd args...]");
        // Parse: win-bridge wrap <name> [-- command args...]
        const dashIdx = argv.indexOf('--');
        let command = null;
        let args = [];
        if (dashIdx !== -1) {
          command = argv[dashIdx + 1] || null;
          args = argv.slice(dashIdx + 2);
        }
        cmdWrap(name, command, args);
        break;
      }
      case 'list':
        await cmdList();
        break;
      case 'notify':
        await cmdNotify(argv[1], argv[2]);
        break;
      case 'type':
        await cmdType(argv[1], argv[2]);
        break;
      case 'submit':
      case 'send':
        await cmdSubmit(argv[1], argv[2]);
        break;
      case 'message':
      case 'msg':
        await cmdMessage(argv[1], argv[2]);
        break;
      case 'read':
        await cmdRead(argv[1], argv[2]);
        break;
      case 'keys':
        await cmdKeys(argv[1], argv.slice(2));
        break;
      case 'name':
        await cmdName(argv[1], argv[2]);
        break;
      case 'resolve':
        await cmdResolve(argv[1]);
        break;
      case 'id':
        cmdId();
        break;
      case 'doctor':
        await cmdDoctor();
        break;
      case 'version':
      case '--version':
      case '-v':
        console.log(`win-bridge ${VERSION}`);
        break;
      default:
        die(`unknown command: ${cmd}. Run 'win-bridge' for usage.`);
    }
  } catch (err) {
    die(err.message);
  }
})();
