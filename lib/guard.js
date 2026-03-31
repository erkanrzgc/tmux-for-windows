const fs = require('fs');
const path = require('path');
const os = require('os');

function guardPath(paneId) {
  const safe = paneId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(os.tmpdir(), `win-bridge-read-${safe}`);
}

function markRead(paneId) {
  fs.writeFileSync(guardPath(paneId), '', 'utf8');
}

function requireRead(paneId) {
  if (!fs.existsSync(guardPath(paneId))) {
    console.error(`error: must read the pane before interacting. Run: win-bridge read ${paneId}`);
    process.exit(1);
  }
}

function clearRead(paneId) {
  try { fs.unlinkSync(guardPath(paneId)); } catch {}
}

module.exports = { markRead, requireRead, clearRead };
