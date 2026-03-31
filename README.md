# tmux-for-windows

Windows split-pane workflow for AI agents.

`tmux-for-windows` provides:

- `duo`: opens a Windows Terminal split with Claude Code on the left and OpenAI Codex on the right
- `win-bridge`: lets one pane read, type into, and send keys to another pane
- local duo onboarding that teaches both agents how to collaborate without polling

This project is inspired by tmux-based agent workflows on Linux, but it is implemented for Windows with PowerShell, Windows Terminal, and named pipes.

## Requirements

- Windows Terminal
- PowerShell
- Node.js 18+
- `claude` available on `PATH`
- `codex` available on `PATH`

## Install From Source

Recommended:

```powershell
git clone https://github.com/erkanrzgc/tmux-for-windows.git
cd tmux-for-windows
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

Manual flow:

```powershell
git clone https://github.com/erkanrzgc/tmux-for-windows.git
cd tmux-for-windows
npm install
npm link
win-bridge version
duo -DryRun
```

What each step does:

- `install.ps1` runs the full source install and verification flow for Windows
- `npm install` installs the local project dependencies
- `npm link` links `win-bridge` and `duo` into your user PATH
- `win-bridge version` confirms the CLI is callable
- `duo -DryRun` confirms the launch script and bridge flow resolve correctly without opening a real session

If you want a broader environment check, run:

```powershell
duo doctor
win-bridge doctor
```

## Quick Start

Open a project directory and run:

```powershell
duo
```

Or launch for a specific directory:

```powershell
duo -ProjectDir C:\path\to\project
```

`duo` opens a left/right split, starts Claude Code and OpenAI Codex, verifies the bridge, then sends each pane a short collaboration intro.

## Troubleshooting

Use these commands first:

```powershell
duo doctor
win-bridge doctor
duo -DryRun
```

`duo doctor` checks whether PowerShell, Windows Terminal, Claude Code, Codex, `win-bridge`, and `duo` are available on your machine.
`win-bridge doctor` also prunes stale pane entries from the local registry when it finds unreachable panes.

## win-bridge Commands

```powershell
win-bridge list
win-bridge read codex 20
win-bridge message codex "review src/auth.ts"
win-bridge read codex 20
win-bridge keys codex Enter
```

Core commands:

- `wrap <name> [-- cmd args...]`
- `list`
- `read <target> [lines]`
- `message <target> <text>`
- `type <target> <text>`
- `submit <target> <text>`
- `keys <target> <key>...`
- `name <target> <label>`
- `resolve <label>`
- `id`
- `doctor`

## Read Guard

`win-bridge` enforces a read-before-act cycle:

1. `read` the target pane
2. `message`, `type`, `submit`, or `keys`
3. `read` again before the next interaction

For agent panes, do not poll for replies. The other agent replies back into your own pane.

## Example Duo Flow

```powershell
win-bridge read claude 20
win-bridge message claude "Please review src/auth.ts"
win-bridge read claude 20
win-bridge keys claude Enter
```

Replies appear in your pane with a short sender prefix such as `[claude]`.

Set `WIN_BRIDGE_VERBOSE_HEADER=1` if you want the older verbose header format.

## Notes

- `claude` and `codex` are local pane labels
- `duo` uses Windows Terminal split panes by default
- `.duo/DUO.md`, `AGENTS.md`, and `CLAUDE.md` are generated in the target project directory to document the local collaboration contract
