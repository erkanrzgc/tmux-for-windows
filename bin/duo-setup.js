#!/usr/bin/env node
'use strict';

// All-in-one duo setup: wait for panes, verify bridge, deliver intros.
// Runs as a single Node.js process — no repeated Start-Process overhead.

const fs = require('fs');
const registry = require('../lib/registry');
const { sendCommand } = require('../lib/client');

const POLL_MS = 200;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isAgentChatReady(role, output) {
  if (!output) return false;
  const normalized = String(output).replace(/\s+/g, ' ').trim();
  if (!normalized) return false;

  const lineCount = output.split('\n').filter(l => l.trim().length > 0).length;

  switch (role) {
    case 'claude':
      return (
        lineCount >= 6 ||
        /How can I help you/i.test(normalized) ||
        /❯/.test(normalized) ||
        /\[Opus/i.test(normalized) ||
        /\[claude-/i.test(normalized) ||
        /\bContext\b/i.test(normalized) ||
        /Try a task/i.test(normalized) ||
        /What would you like/i.test(normalized)
      );
    case 'codex':
      return (
        lineCount >= 4 ||
        /OpenAI Codex/i.test(normalized) ||
        /gpt-/i.test(normalized) ||
        /\/model/i.test(normalized) ||
        /Find and fix a bug/i.test(normalized) ||
        /Explain this codebase/i.test(normalized) ||
        /type your task/i.test(normalized) ||
        /ask me/i.test(normalized)
      );
    default:
      return false;
  }
}

function log(msg) {
  process.stderr.write(`[duo-setup] ${msg}\n`);
}

// Phase 1: wait for both panes to register in the bridge
async function waitForPanes(targets, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  const pending = new Set(targets);

  while (pending.size > 0 && Date.now() < deadline) {
    for (const target of [...pending]) {
      try {
        const res = await sendCommand(target, { cmd: 'ping' });
        if (res && res.pong) {
          pending.delete(target);
          log(`${target} registered`);
        }
      } catch {}
    }
    if (pending.size > 0) await sleep(POLL_MS);
  }

  if (pending.size > 0) {
    throw new Error(`timed out waiting for pane(s): ${[...pending].join(', ')}`);
  }
}

// Phase 2: verify bridge session (both panes reachable and distinct)
async function verifyBridge(left, right) {
  const leftEntry = registry.resolveTarget(left);
  const rightEntry = registry.resolveTarget(right);

  if (!leftEntry) throw new Error(`cannot resolve '${left}'`);
  if (!rightEntry) throw new Error(`cannot resolve '${right}'`);
  if (leftEntry.id === rightEntry.id) throw new Error(`'${left}' and '${right}' resolved to same pane`);

  // Verify both are readable
  const [lr, rr] = await Promise.all([
    sendCommand(left, { cmd: 'read', lines: 1 }),
    sendCommand(right, { cmd: 'read', lines: 1 }),
  ]);

  if (!lr.ok) throw new Error(`'${left}' not readable`);
  if (!rr.ok) throw new Error(`'${right}' not readable`);

  log(`bridge verified: ${left} (${leftEntry.id}) <-> ${right} (${rightEntry.id})`);
}

// Phase 3: wait for chat ready + submit intro (per agent, run in parallel)
async function deliverIntro(target, role, introFile, timeoutMs) {
  const text = fs.readFileSync(introFile, 'utf8').trim();
  if (!text) throw new Error(`intro file empty: ${introFile}`);

  const deadline = Date.now() + timeoutMs;
  let pollCount = 0;

  while (Date.now() < deadline) {
    try {
      const res = await sendCommand(target, { cmd: 'read', lines: 20 });
      pollCount++;
      if (res.ok && isAgentChatReady(role, res.output)) {
        log(`${role} ready after ${pollCount} polls, submitting intro`);
        const sr = await sendCommand(target, { cmd: 'submit', text, keys: ['Enter'], delay: 150 });
        if (!sr.ok) throw new Error(sr.error);
        return;
      }
    } catch (err) {
      if (Date.now() >= deadline) break;
    }
    await sleep(POLL_MS);
  }

  // Fallback: submit anyway
  log(`${role} timed out after ${pollCount} polls, submitting anyway`);
  const sr = await sendCommand(target, { cmd: 'submit', text, keys: ['Enter'], delay: 150 });
  if (!sr.ok) throw new Error(sr.error);
}

// --- Main ---

async function main() {
  const args = process.argv.slice(2);
  // duo-setup <readyTimeout> <introTimeout> <claudeIntroFile> <codexIntroFile>
  const readyTimeoutMs = (parseInt(args[0], 10) || 30) * 1000;
  const introTimeoutMs = (parseInt(args[1], 10) || 15) * 1000;
  const claudeIntroFile = args[2] || null;
  const codexIntroFile = args[3] || null;

  try {
    // Phase 1: wait for panes (parallel ping)
    log('waiting for panes...');
    await waitForPanes(['claude', 'codex'], readyTimeoutMs);

    // Phase 2: verify bridge
    await verifyBridge('claude', 'codex');

    // Phase 3: deliver intros in parallel
    if (claudeIntroFile && codexIntroFile) {
      log('delivering intros...');
      await Promise.all([
        deliverIntro('claude', 'claude', claudeIntroFile, introTimeoutMs),
        deliverIntro('codex', 'codex', codexIntroFile, introTimeoutMs),
      ]);
      log('done');
    }
  } catch (err) {
    log(`error: ${err.message}`);
    process.exit(1);
  }
}

main();
