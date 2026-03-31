// Map human-readable key names to terminal escape sequences
const KEY_MAP = {
  'Enter':    '\r',
  'Return':   '\r',
  'Escape':   '\x1b',
  'Esc':      '\x1b',
  'Tab':      '\t',
  'Space':    ' ',
  'Backspace': '\x7f',
  'Delete':   '\x1b[3~',
  'Up':       '\x1b[A',
  'Down':     '\x1b[B',
  'Right':    '\x1b[C',
  'Left':     '\x1b[D',
  'Home':     '\x1b[H',
  'End':      '\x1b[F',
  'PageUp':   '\x1b[5~',
  'PageDown': '\x1b[6~',
  'Insert':   '\x1b[2~',
  'F1':       '\x1bOP',
  'F2':       '\x1bOQ',
  'F3':       '\x1bOR',
  'F4':       '\x1bOS',
  'F5':       '\x1b[15~',
  'F6':       '\x1b[17~',
  'F7':       '\x1b[18~',
  'F8':       '\x1b[19~',
  'F9':       '\x1b[20~',
  'F10':      '\x1b[21~',
  'F11':      '\x1b[23~',
  'F12':      '\x1b[24~',
  // Ctrl combinations: C-a through C-z
  'C-a': '\x01', 'C-b': '\x02', 'C-c': '\x03', 'C-d': '\x04',
  'C-e': '\x05', 'C-f': '\x06', 'C-g': '\x07', 'C-h': '\x08',
  'C-i': '\x09', 'C-j': '\x0a', 'C-k': '\x0b', 'C-l': '\x0c',
  'C-m': '\x0d', 'C-n': '\x0e', 'C-o': '\x0f', 'C-p': '\x10',
  'C-q': '\x11', 'C-r': '\x12', 'C-s': '\x13', 'C-t': '\x14',
  'C-u': '\x15', 'C-v': '\x16', 'C-w': '\x17', 'C-x': '\x18',
  'C-y': '\x19', 'C-z': '\x1a',
};

function resolveKey(name) {
  return KEY_MAP[name] || name;
}

module.exports = { resolveKey, KEY_MAP };
