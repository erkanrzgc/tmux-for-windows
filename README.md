# tmux-for-windows

One-command dual-agent setup with terminal bridge for AI agents on Windows.

- **For you** — `duo` opens a split terminal with Claude Code and OpenAI Codex side by side, ready to collaborate
- **For agents** — `win-bridge` CLI lets any agent read, type into, and send keys to any pane
- **Agent-to-agent** — Claude Code can prompt Codex in the next pane, and Codex replies back. Any agent that can run commands can participate.

```powershell
win-bridge read codex 20                        # read the pane
win-bridge message codex "review src/auth.ts"   # send a message
win-bridge keys codex Enter                     # press enter
```

## Install

```powershell
git clone https://github.com/erkanrzgc/tmux-for-windows.git
cd tmux-for-windows
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

This installs:

- **node-pty** native terminal emulation
- **win-bridge** CLI for cross-pane agent communication
- **duo** CLI for launching split-pane agent sessions

Everything links into your PATH via `npm link`.

## Quick Start

Open any project directory and run:

```powershell
duo
```

Or launch for a specific directory:

```powershell
duo -ProjectDir C:\path\to\project
```

What happens:

1. Windows Terminal opens with a left/right split
2. Claude Code starts in the left pane, Codex in the right
3. Both agents receive an inline onboarding intro within ~5 seconds
4. Agents read `.duo/DUO.md` and are ready to collaborate

## Keybindings

Windows Terminal default keybindings for pane management:

### Panes

| Key | Action |
|---|---|
| `Alt+Shift+D` | Split pane (duplicate) |
| `Alt+Shift+-` | Split pane horizontal |
| `Alt+Shift+=` | Split pane vertical |
| `Alt+Arrow` | Navigate between panes |
| `Ctrl+Shift+W` | Close pane |

### Tabs

| Key | Action |
|---|---|
| `Ctrl+Shift+T` | New tab |
| `Ctrl+Tab` | Next tab |
| `Ctrl+Shift+Tab` | Previous tab |
| `Ctrl+Shift+W` | Close tab |

### Scrolling

| Key | Action |
|---|---|
| `Ctrl+Shift+Up` | Scroll up |
| `Ctrl+Shift+Down` | Scroll down |
| `Ctrl+Shift+PgUp` | Scroll page up |
| `Ctrl+Shift+PgDn` | Scroll page down |

## win-bridge

A CLI for cross-pane communication. Any tool that can run commands can use it — Claude Code, Codex, or a plain script.

| Command | Description |
|---|---|
| `win-bridge list` | Show all active panes |
| `win-bridge read <target> [lines]` | Read last N lines from a pane (default: 20) |
| `win-bridge message <target> <text>` | Send a labeled message and press Enter |
| `win-bridge type <target> <text>` | Type text into a pane (no Enter) |
| `win-bridge submit <target> <text>` | Type text and press Enter |
| `win-bridge submit-file <target> <file>` | Read text from file and submit |
| `win-bridge keys <target> <key>...` | Send special keys (Enter, Escape, C-c, etc.) |
| `win-bridge name <target> <label>` | Label a pane for easy addressing |
| `win-bridge resolve <label>` | Look up a pane by label |
| `win-bridge id` | Print this pane's ID |
| `win-bridge doctor` | Diagnose connectivity issues |

### Read Guard

`win-bridge` enforces a read-before-act cycle:

1. `read` the target pane
2. `message`, `type`, `submit`, or `keys`
3. `read` again before the next interaction

For agent panes, do not poll for replies. The other agent replies directly into your pane.

## duo

| Command | Description |
|---|---|
| `duo` | Launch a duo session in the current directory |
| `duo -ProjectDir <path>` | Launch for a specific directory |
| `duo -SplitDirection horizontal` | Top/bottom split instead of left/right |
| `duo -SplitRatio 0.6` | Adjust split ratio (default: 0.5) |
| `duo -SkipIntro` | Skip onboarding intro delivery |
| `duo -DryRun` | Trace the launch without opening anything |
| `duo doctor` | Check environment and dependencies |

## Generated Files

When `duo` launches, it generates these files in the target project:

| File | Purpose |
|---|---|
| `.duo/DUO.md` | Full bridge reference and collaboration rules |
| `CLAUDE.md` | Claude Code reads this at startup (bridge commands, session role) |
| `AGENTS.md` | Codex reads this at startup (bridge commands, session role) |
| `SKILL.md` | win-bridge command reference card |

## Architecture

```
duo (PowerShell)
  |-- Creates instruction files (.duo/DUO.md, CLAUDE.md, AGENTS.md, SKILL.md)
  |-- Opens Windows Terminal with two split panes
  |     |-- Left:  win-bridge wrap claude -- claude
  |     |-- Right: win-bridge wrap codex -- codex
  |-- Launches duo-setup.js (single background Node.js process)
        |-- Phase 1: Ping both panes in parallel until registered
        |-- Phase 2: Verify bridge (both panes reachable and distinct)
        |-- Phase 3: Deliver intro to both agents simultaneously
```

Each wrapped pane runs a named-pipe server. `win-bridge` commands communicate via these pipes — no file polling, no HTTP.

## Troubleshooting

```powershell
duo doctor       # check all dependencies
win-bridge doctor  # check pane connectivity, prune stale entries
duo -DryRun      # trace the launch flow without opening panes
```

## Requirements

- Windows Terminal
- PowerShell
- Node.js 18+
- `claude` CLI on PATH
- `codex` CLI on PATH

## License

This project is licensed under the MIT License. See the LICENSE file for more details.
