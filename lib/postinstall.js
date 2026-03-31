const fs = require('fs');
const path = require('path');
const os = require('os');

const dir = path.join(os.homedir(), '.win-bridge');
fs.mkdirSync(dir, { recursive: true });

console.log('[win-bridge] Setup complete.');
console.log(`  Registry: ${path.join(dir, 'registry.json')}`);
console.log('');
console.log('  Usage:');
console.log('    Terminal 1:  win-bridge wrap claude');
console.log('    Terminal 2:  win-bridge wrap codex');
console.log('    Anywhere:    duo');
console.log('');
console.log('  Then from inside a wrapped terminal:');
console.log('    win-bridge read codex 20');
console.log('    win-bridge type codex "review src/auth.ts"');
console.log('    win-bridge keys codex Enter');
