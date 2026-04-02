'use strict';

/**
 * Minimal virtual terminal screen buffer.
 *
 * Handles carriage return (\r) overwrite, newline (\n) scroll,
 * basic CSI cursor movement and erase sequences.
 * Stores only text — ANSI color/style codes are consumed but not stored.
 */

const DEFAULT_COLS = 120;
const DEFAULT_ROWS = 30;

class ScreenBuffer {
  constructor(cols, rows, scrollbackLimit) {
    this.cols = cols || DEFAULT_COLS;
    this.rows = rows || DEFAULT_ROWS;
    this.scrollbackLimit = scrollbackLimit || 1000;

    // Screen: 2D array of characters
    this.buffer = [];
    for (let r = 0; r < this.rows; r++) {
      this.buffer.push(this._emptyLine());
    }

    this.cursorRow = 0;
    this.cursorCol = 0;
    this.scrollback = [];

    // Parser state: 'normal', 'esc', 'csi', 'osc'
    this.state = 'normal';
    this.csiParams = '';
  }

  _emptyLine() {
    return new Array(this.cols).fill(' ');
  }

  _scrollUp() {
    // Push top line to scrollback
    const line = this.buffer.shift().join('').trimEnd();
    this.scrollback.push(line);
    if (this.scrollback.length > this.scrollbackLimit) {
      this.scrollback.shift();
    }
    // Add empty line at bottom
    this.buffer.push(this._emptyLine());
  }

  _ensureCursorBounds() {
    if (this.cursorCol < 0) this.cursorCol = 0;
    if (this.cursorCol >= this.cols) this.cursorCol = this.cols - 1;
    if (this.cursorRow < 0) this.cursorRow = 0;
    if (this.cursorRow >= this.rows) this.cursorRow = this.rows - 1;
  }

  _parseCsiParams() {
    // Parse "N;M" style params, default to 1 for missing values
    return this.csiParams.split(';').map(s => {
      const n = parseInt(s, 10);
      return isNaN(n) ? 1 : n;
    });
  }

  _handleCsi(finalChar) {
    const params = this._parseCsiParams();
    const n = params[0] || 1;

    switch (finalChar) {
      case 'A': // Cursor Up
        this.cursorRow -= n;
        break;
      case 'B': // Cursor Down
        this.cursorRow += n;
        break;
      case 'C': // Cursor Forward
        this.cursorCol += n;
        break;
      case 'D': // Cursor Back
        this.cursorCol -= n;
        break;
      case 'H': // Cursor Position (row;col, 1-based)
      case 'f':
        this.cursorRow = (params[0] || 1) - 1;
        this.cursorCol = (params[1] || 1) - 1;
        break;
      case 'J': { // Erase in Display
        const mode = params[0] || 0;
        if (mode === 0) {
          // Clear from cursor to end
          this._clearLine(this.cursorRow, this.cursorCol, this.cols);
          for (let r = this.cursorRow + 1; r < this.rows; r++) {
            this.buffer[r] = this._emptyLine();
          }
        } else if (mode === 1) {
          // Clear from start to cursor
          for (let r = 0; r < this.cursorRow; r++) {
            this.buffer[r] = this._emptyLine();
          }
          this._clearLine(this.cursorRow, 0, this.cursorCol + 1);
        } else if (mode === 2 || mode === 3) {
          // Clear entire screen
          for (let r = 0; r < this.rows; r++) {
            this.buffer[r] = this._emptyLine();
          }
        }
        break;
      }
      case 'K': { // Erase in Line
        const mode = params[0] || 0;
        if (mode === 0) {
          this._clearLine(this.cursorRow, this.cursorCol, this.cols);
        } else if (mode === 1) {
          this._clearLine(this.cursorRow, 0, this.cursorCol + 1);
        } else if (mode === 2) {
          this.buffer[this.cursorRow] = this._emptyLine();
        }
        break;
      }
      case 'G': // Cursor Horizontal Absolute
        this.cursorCol = n - 1;
        break;
      case 'd': // Cursor Vertical Absolute
        this.cursorRow = n - 1;
        break;
      case 'm': // SGR (colors/style) — ignore
        break;
      case 'h': // Set Mode (e.g. ?25h show cursor) — ignore
      case 'l': // Reset Mode (e.g. ?25l hide cursor) — ignore
      case 'r': // Set Scrolling Region — ignore for now
      case 'n': // Device Status Report — ignore
      case 's': // Save Cursor Position — ignore
      case 'u': // Restore Cursor Position — ignore
        break;
      default:
        // Unknown CSI sequence — ignore
        break;
    }

    this._ensureCursorBounds();
  }

  _clearLine(row, from, to) {
    if (row < 0 || row >= this.rows) return;
    const line = this.buffer[row];
    for (let c = from; c < to && c < this.cols; c++) {
      line[c] = ' ';
    }
  }

  /**
   * Process raw PTY data through the state machine.
   */
  write(data) {
    for (let i = 0; i < data.length; i++) {
      const ch = data[i];
      const code = data.charCodeAt(i);

      switch (this.state) {
        case 'normal':
          if (code === 0x1b) {
            // ESC
            this.state = 'esc';
          } else if (ch === '\r') {
            // Carriage return: move cursor to column 0
            this.cursorCol = 0;
          } else if (ch === '\n') {
            // Line feed: move cursor down, scroll if needed
            this.cursorRow++;
            if (this.cursorRow >= this.rows) {
              this.cursorRow = this.rows - 1;
              this._scrollUp();
            }
          } else if (ch === '\t') {
            // Tab: advance to next tab stop (multiple of 8)
            this.cursorCol = Math.min(this.cols - 1, (Math.floor(this.cursorCol / 8) + 1) * 8);
          } else if (ch === '\b' || code === 0x08) {
            // Backspace
            if (this.cursorCol > 0) this.cursorCol--;
          } else if (code === 0x07) {
            // BEL — ignore
          } else if (code >= 0x20) {
            // Printable character
            if (this.cursorCol >= this.cols) {
              // Line wrap
              this.cursorCol = 0;
              this.cursorRow++;
              if (this.cursorRow >= this.rows) {
                this.cursorRow = this.rows - 1;
                this._scrollUp();
              }
            }
            this.buffer[this.cursorRow][this.cursorCol] = ch;
            this.cursorCol++;
          }
          // Control chars < 0x20 not handled above are ignored
          break;

        case 'esc':
          if (ch === '[') {
            this.state = 'csi';
            this.csiParams = '';
          } else if (ch === ']') {
            this.state = 'osc';
            this.oscData = '';
          } else if (ch === '(' || ch === ')') {
            // Character set designation — skip next char
            i++; // skip the set designator
            this.state = 'normal';
          } else {
            // Two-character escape (e.g. ESC M = reverse index)
            if (ch === 'M') {
              // Reverse index: cursor up, scroll down if at top
              if (this.cursorRow === 0) {
                this.buffer.pop();
                this.buffer.unshift(this._emptyLine());
              } else {
                this.cursorRow--;
              }
            }
            this.state = 'normal';
          }
          break;

        case 'csi':
          if ((code >= 0x30 && code <= 0x3f)) {
            // Parameter bytes: 0-9, ;, <, =, >, ?
            this.csiParams += ch;
          } else if (code >= 0x20 && code <= 0x2f) {
            // Intermediate bytes — accumulate with params
            this.csiParams += ch;
          } else if (code >= 0x40 && code <= 0x7e) {
            // Final byte — execute
            this._handleCsi(ch);
            this.state = 'normal';
          } else {
            // Invalid — abort
            this.state = 'normal';
          }
          break;

        case 'osc':
          // Consume until BEL (0x07) or ST (ESC \)
          if (code === 0x07) {
            this.state = 'normal';
          } else if (code === 0x1b) {
            // Check for ST (ESC \)
            if (i + 1 < data.length && data[i + 1] === '\\') {
              i++; // skip the backslash
              this.state = 'normal';
            } else {
              this.state = 'esc';
            }
          }
          // OSC content is discarded
          break;
      }
    }
  }

  /**
   * Resize the screen buffer.
   */
  resize(cols, rows) {
    const oldRows = this.rows;
    const oldCols = this.cols;
    this.cols = cols || DEFAULT_COLS;
    this.rows = rows || DEFAULT_ROWS;

    // Adjust row count
    if (this.rows < oldRows) {
      // Push excess top lines to scrollback
      const excess = oldRows - this.rows;
      for (let i = 0; i < excess; i++) {
        const line = this.buffer.shift().join('').trimEnd();
        this.scrollback.push(line);
        if (this.scrollback.length > this.scrollbackLimit) {
          this.scrollback.shift();
        }
      }
      this.cursorRow = Math.max(0, this.cursorRow - excess);
    } else if (this.rows > oldRows) {
      const extra = this.rows - oldRows;
      for (let i = 0; i < extra; i++) {
        this.buffer.push(this._emptyLine());
      }
    }

    // Adjust column count per line
    if (this.cols !== oldCols) {
      for (let r = 0; r < this.buffer.length; r++) {
        const line = this.buffer[r];
        if (this.cols > oldCols) {
          // Extend with spaces
          while (line.length < this.cols) line.push(' ');
        } else {
          // Truncate
          this.buffer[r] = line.slice(0, this.cols);
        }
      }
    }

    this._ensureCursorBounds();
  }

  /**
   * Get last N lines from scrollback + current screen.
   * Returns array of trimmed strings (empty lines preserved for structure).
   */
  getScrollback(n) {
    // Collect current screen lines
    const screenLines = [];
    for (let r = 0; r < this.rows; r++) {
      screenLines.push(this.buffer[r].join('').trimEnd());
    }

    // Combine scrollback + screen
    const all = this.scrollback.concat(screenLines);

    // Return last N lines
    const count = Math.min(n, all.length);
    return all.slice(-count);
  }

  /**
   * Get only the visible screen content (no scrollback).
   */
  getScreen() {
    const lines = [];
    for (let r = 0; r < this.rows; r++) {
      lines.push(this.buffer[r].join('').trimEnd());
    }
    return lines;
  }
}

module.exports = { ScreenBuffer };
