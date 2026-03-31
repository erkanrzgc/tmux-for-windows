#!/usr/bin/env node
'use strict';

const { spawn } = require('child_process');
const path = require('path');

const scriptPath = path.resolve(__dirname, '..', 'duo.ps1');
const argv = process.argv.slice(2);

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
