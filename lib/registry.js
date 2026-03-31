const fs = require('fs');
const path = require('path');
const net = require('net');
const { WIN_BRIDGE_DIR, REGISTRY_FILE, PIPE_PREFIX } = require('./constants');

const LOCK_FILE = path.join(WIN_BRIDGE_DIR, 'registry.lock');
const LOCK_STALE_MS = 5000;
const LOCK_WAIT_MS = 2000;

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function ensureDir() {
  fs.mkdirSync(WIN_BRIDGE_DIR, { recursive: true });
}

function loadUnlocked() {
  if (!fs.existsSync(REGISTRY_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveUnlocked(registry) {
  fs.writeFileSync(REGISTRY_FILE, JSON.stringify(registry, null, 2), 'utf8');
}

function acquireLock() {
  ensureDir();
  const deadline = Date.now() + LOCK_WAIT_MS;

  while (true) {
    try {
      return fs.openSync(LOCK_FILE, 'wx');
    } catch (err) {
      if (err.code !== 'EEXIST') {
        throw err;
      }

      try {
        const stat = fs.statSync(LOCK_FILE);
        if ((Date.now() - stat.mtimeMs) > LOCK_STALE_MS) {
          fs.unlinkSync(LOCK_FILE);
          continue;
        }
      } catch {}

      if (Date.now() >= deadline) {
        throw new Error('timed out acquiring registry lock');
      }

      sleep(25);
    }
  }
}

function releaseLock(fd) {
  try {
    fs.closeSync(fd);
  } catch {}

  try {
    fs.unlinkSync(LOCK_FILE);
  } catch {}
}

function withRegistryWrite(mutator) {
  const fd = acquireLock();
  try {
    const reg = loadUnlocked();
    const result = mutator(reg);
    saveUnlocked(reg);
    return result;
  } finally {
    releaseLock(fd);
  }
}

function load() {
  ensureDir();
  return loadUnlocked();
}

function save(registry) {
  ensureDir();
  saveUnlocked(registry);
}

function register(id, info) {
  withRegistryWrite((reg) => {
    reg[id] = {
      id,
      label: info.label || null,
      pid: info.pid || process.pid,
      pipe: info.pipe || `${PIPE_PREFIX}${id}`,
      cwd: info.cwd || process.cwd(),
      startedAt: new Date().toISOString(),
      ...info,
    };
  });
}

function unregister(id) {
  withRegistryWrite((reg) => {
    delete reg[id];
  });
}

function setLabel(id, label) {
  return withRegistryWrite((reg) => {
    if (!reg[id]) return false;
    reg[id].label = label;
    return true;
  });
}

function resolveTarget(target) {
  const reg = load();

  // Direct ID match
  if (reg[target]) return reg[target];

  // Label match
  for (const entry of Object.values(reg)) {
    if (entry.label === target) return entry;
  }

  return null;
}

function list() {
  const reg = load();
  return Object.values(reg);
}

// Remove entries whose named pipe is no longer alive
function cleanup() {
  return withRegistryWrite((reg) => {
    for (const id of Object.keys(reg)) {
      const entry = reg[id];
      try {
        process.kill(entry.pid, 0);
      } catch {
        delete reg[id];
      }
    }

    return reg;
  });
}

module.exports = { register, unregister, setLabel, resolveTarget, list, cleanup, load, save };
