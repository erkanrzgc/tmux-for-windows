#!/usr/bin/env node
'use strict';

const { spawn, spawnSync } = require('child_process');
const path = require('path');

const scriptPath = path.resolve(__dirname, '..', 'duo.ps1');
const bridgePath = path.resolve(__dirname, 'win-bridge.js');
const argv = process.argv.slice(2);

function findCommand(command) {
  const result = spawnSync('where.exe', [command], {
    encoding: 'utf8',
    windowsHide: true,
  });

  if (result.status !== 0) {
    return [];
  }

  return (result.stdout || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function printCheck(label, command) {
  const matches = findCommand(command);
  if (matches.length === 0) {
    console.log(`${label.padEnd(18)} MISSING`);
    return false;
  }

  console.log(`${label.padEnd(18)} OK  ${matches[0]}`);
  return true;
}

function runDuoDoctor() {
  console.log('duo doctor v1.0.0');
  console.log('---');
  console.log(`Node`.padEnd(18) + `OK  ${process.execPath}`);

  const checks = [
    ['PowerShell', 'powershell.exe'],
    ['Windows Terminal', 'wt.exe'],
    ['Claude Code', 'claude'],
    ['OpenAI Codex', 'codex'],
    ['win-bridge', 'win-bridge'],
    ['duo', 'duo'],
  ];

  let ok = true;
  for (const [label, command] of checks) {
    ok = printCheck(label, command) && ok;
  }

  console.log(`Bridge script`.padEnd(18) + (bridgePath ? `OK  ${bridgePath}` : 'MISSING'));
  console.log(`Duo script`.padEnd(18) + (scriptPath ? `OK  ${scriptPath}` : 'MISSING'));
  console.log('---');

  const bridgeDoctor = spawnSync(process.execPath, [bridgePath, 'doctor'], {
    encoding: 'utf8',
    windowsHide: true,
  });

  if (bridgeDoctor.stdout) {
    process.stdout.write(bridgeDoctor.stdout);
  }
  if (bridgeDoctor.stderr) {
    process.stderr.write(bridgeDoctor.stderr);
  }

  if (bridgeDoctor.status !== 0) {
    ok = false;
  }

  console.log('---');
  console.log(`Status: ${ok ? 'OK' : 'ISSUES DETECTED'}`);
  process.exit(ok ? 0 : 1);
}

if (argv[0] === 'doctor') {
  runDuoDoctor();
}

const hasExplicitProjectDir = argv.some((arg, index) => {
  if (arg === '-ProjectDir') return true;
  return arg.startsWith('-ProjectDir:') && index >= 0;
});

const psArgs = ['-ExecutionPolicy', 'Bypass', '-File', scriptPath];
if (!hasExplicitProjectDir) {
  psArgs.push('-ProjectDir', process.cwd());
}
psArgs.push(...argv);

const child = spawn('powershell.exe', psArgs, {
  stdio: 'inherit',
  windowsHide: false,
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code || 0);
});

child.on('error', (err) => {
  console.error(`error: failed to launch duo.ps1: ${err.message}`);
  process.exit(1);
});
