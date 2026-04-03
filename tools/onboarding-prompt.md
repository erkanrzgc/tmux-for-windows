# tmux-for-windows Onboarding

You are setting up **tmux-for-windows** — a Windows split-pane workflow that lets Claude Code and OpenAI Codex collaborate side by side via a terminal bridge.

## Step 1: Clone and install

```powershell
git clone https://github.com/erkanrzgc/tmux-for-windows.git "$HOME\Desktop\tmux-for-windows"
cd "$HOME\Desktop\tmux-for-windows"
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

Run these commands. If `install.ps1` completes with "Install complete", move to Step 2.

If it fails:
- `node` not found → Install Node.js 18+ from https://nodejs.org
- `npm link` permission error → Run PowerShell as Administrator
- `node-pty` build error → Install Visual Studio Build Tools: `npm install -g windows-build-tools`

## Step 2: Verify

Run:

```powershell
win-bridge version
duo doctor
```

`win-bridge version` should print `win-bridge 1.0.0`.
`duo doctor` should show all dependencies as available.

If `claude` or `codex` show as missing, install them:
- Claude Code: `npm install -g @anthropic-ai/claude-code`
- OpenAI Codex: `npm install -g @openai/codex`

## Step 3: Launch a duo session

Navigate to any project directory and run:

```powershell
duo
```

This opens Windows Terminal with two panes:
- **Left pane**: Claude Code
- **Right pane**: OpenAI Codex

Both agents receive an onboarding intro within ~5 seconds. They can communicate using `win-bridge message`.

## Step 4: How agents communicate

From Claude Code (left pane):
```
win-bridge message codex "review src/auth.ts for security issues"
```

From Codex (right pane):
```
win-bridge message claude "found an XSS vulnerability in line 42"
```

Replies appear directly in the sender's pane as `[codex]` or `[claude]`.

## Key commands

| Command | What it does |
|---|---|
| `duo` | Launch a duo session |
| `duo doctor` | Check dependencies |
| `win-bridge list` | Show active panes |
| `win-bridge read <target> 20` | Read last 20 lines from a pane |
| `win-bridge message <target> "text"` | Send a message to another agent |

## Files generated per project

When `duo` runs in a project directory, it creates:
- `.duo/DUO.md` — bridge reference
- `CLAUDE.md` — Claude Code startup instructions
- `AGENTS.md` — Codex startup instructions
- `SKILL.md` — win-bridge command card

## Done

Setup is complete. Tell the user they can now run `duo` in any project directory to start a collaborative AI agent session.
