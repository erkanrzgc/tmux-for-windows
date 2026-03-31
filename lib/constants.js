const path = require('path');
const os = require('os');

const HOME = os.homedir();
const WIN_BRIDGE_DIR = path.join(HOME, '.win-bridge');
const REGISTRY_FILE = path.join(WIN_BRIDGE_DIR, 'registry.json');
const PIPE_PREFIX = '\\\\.\\pipe\\win-bridge-';

// Ring buffer size for output capture (lines)
const OUTPUT_BUFFER_SIZE = 1000;

// Named pipe timeout (ms)
const PIPE_TIMEOUT = 5000;

module.exports = {
  HOME,
  WIN_BRIDGE_DIR,
  REGISTRY_FILE,
  PIPE_PREFIX,
  OUTPUT_BUFFER_SIZE,
  PIPE_TIMEOUT,
};
