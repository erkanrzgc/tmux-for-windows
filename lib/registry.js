const fs = require('fs');
const path = require('path');
const net = require('net');
const { WIN_BRIDGE_DIR, REGISTRY_FILE, PIPE_PREFIX } = require('./constants');

function ensureDir() {
  fs.mkdirSync(WIN_BRIDGE_DIR, { recursive: true });
}

function load() {
  ensureDir();
  if (!fs.existsSync(REGISTRY_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function save(registry) {
  ensureDir();
  fs.writeFileSync(REGISTRY_FILE, JSON.stringify(registry, null, 2), 'utf8');
}

function register(id, info) {
  const reg = load();
  reg[id] = {
    id,
    label: info.label || null,
    pid: info.pid || process.pid,
    pipe: info.pipe || `${PIPE_PREFIX}${id}`,
    cwd: info.cwd || process.cwd(),
    startedAt: new Date().toISOString(),
    ...info,
  };
  save(reg);
}

function unregister(id) {
  const reg = load();
  delete reg[id];
  save(reg);
}

function setLabel(id, label) {
  const reg = load();
  if (!reg[id]) return false;
  reg[id].label = label;
  save(reg);
  return true;
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
  const reg = load();
  const ids = Object.keys(reg);
  let changed = false;

  for (const id of ids) {
    const entry = reg[id];
    // Check if the process is still running
    try {
      process.kill(entry.pid, 0);
    } catch {
      delete reg[id];
      changed = true;
    }
  }

  if (changed) save(reg);
  return reg;
}

module.exports = { register, unregister, setLabel, resolveTarget, list, cleanup, load, save };
