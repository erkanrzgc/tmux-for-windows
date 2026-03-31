param(
  [string]$ProjectDir = (Get-Location).Path,
  [string]$ClaudeProgram = 'claude',
  [string[]]$ClaudeArgs = @('--channels', 'plugin:telegram@claude-plugins-official'),
  [string]$CodexProgram = 'codex',
  [string[]]$CodexArgs = @(),
  [ValidateSet('vertical', 'horizontal')]
  [string]$SplitDirection = 'vertical',
  [ValidateRange(0.1, 0.9)]
  [double]$SplitRatio = 0.5,
  [int]$StartupDelaySeconds = 0,
  [int]$ReadyTimeoutSeconds = 30,
  [int]$ChatReadyTimeoutSeconds = 90,
  [switch]$AllowSeparateWindows,
  [switch]$BackgroundSetup,
  [switch]$SkipIntro,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$script:VerboseTargets = @()
$script:StartupTraceLog = New-Object System.Collections.Generic.List[string]

function Quote-PowerShellLiteral {
  param([string]$Value)
  return "'" + $Value.Replace("'", "''") + "'"
}

function Format-InvariantNumber {
  param([double]$Value)
  return $Value.ToString([System.Globalization.CultureInfo]::InvariantCulture)
}

function Resolve-CommandOrThrow {
  param(
    [string]$CommandName,
    [string]$Role
  )

  $command = Get-Command $CommandName -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($command) {
    return $command
  }

  if (Test-Path -LiteralPath $CommandName) {
    return Get-Item -LiteralPath $CommandName
  }

  throw "Cannot find $Role command '$CommandName'. Install it or pass an explicit path."
}

function New-LauncherCommand {
  param(
    [string]$Name,
    [string]$Program,
    [string[]]$ProgramArgs
  )

  $quotedArgs = @($ProgramArgs | ForEach-Object { Quote-PowerShellLiteral $_ })
  $argSuffix = if ($quotedArgs.Count -gt 0) { ' ' + ($quotedArgs -join ' ') } else { '' }

  return (
    "Set-Location -LiteralPath {0}; & {1} {2} wrap {3} -- {4}{5}" -f
    (Quote-PowerShellLiteral $script:ProjectDir),
    (Quote-PowerShellLiteral $script:NodePath),
    (Quote-PowerShellLiteral $script:BridgePath),
    (Quote-PowerShellLiteral $Name),
    (Quote-PowerShellLiteral $Program),
    $argSuffix
  )
}

function New-WrappedShellArgs {
  param(
    [string]$StartupCommand
  )

  $args = @('-NoLogo')
  if ($StartupCommand) {
    $args += @('-NoExit', '-Command', $StartupCommand)
  }

  return $args
}

function Join-MessageParts {
  param([string[]]$Parts)

  return (($Parts | Where-Object { $_ -and $_.Trim() }) -join ' ')
}

function Write-TextFile {
  param(
    [string]$Path,
    [string]$Content
  )

  $directory = Split-Path -Parent $Path
  if ($directory -and -not (Test-Path -LiteralPath $directory)) {
    if ($script:DryRun) {
      Write-Host "DRYRUN create directory $directory"
    } else {
      New-Item -ItemType Directory -Path $directory -Force | Out-Null
    }
  }

  if ($script:DryRun) {
    Write-Host "DRYRUN write file $Path"
    return
  }

  Set-Content -LiteralPath $Path -Value $Content -Encoding utf8
}

function Ensure-TextFileIfMissing {
  param(
    [string]$Path,
    [string]$Content
  )

  if (Test-Path -LiteralPath $Path) {
    Write-Host "Keeping existing $(Split-Path -Leaf $Path)"
    return
  }

  Write-TextFile -Path $Path -Content $Content
  Write-Host "Created $(Split-Path -Leaf $Path)"
}

function Ensure-DuoInstructionFiles {
  param(
    [string]$ProjectDir,
    [string]$BridgePath
  )

  $duoDir = Join-Path $ProjectDir '.duo'
  $duoDocPath = Join-Path $duoDir 'DUO.md'
  $agentsPath = Join-Path $ProjectDir 'AGENTS.md'
  $claudePath = Join-Path $ProjectDir 'CLAUDE.md'
  $bridgeCommand = "node '$BridgePath'"

  $duoDoc = @"
# Duo Session

Cross-pane communication for the local duo session in this directory.

## Roles

- claude means the local left pane.
- codex means the local right pane.

## Important

- claude and codex are pane labels, not installers, plugins, MCP servers, setup targets, or remote integrations.
- Never treat codex as codex:setup, a plugin, or a remote service.
- If asked whether you are connected to the other pane, answer yes.
- Before debugging bridge behavior, inspect these local files first:
  - $BridgePath
  - duo.ps1
  - lib\wrap.js

## Bridge Command

$bridgeCommand

## DO NOT WAIT OR POLL

Other agent panes reply directly into your own pane as short bridge messages.
When you send a message to the other agent, its reply appears directly in your pane.

Do not:
- sleep or wait after sending
- poll the target pane for a reply
- repeatedly read the target pane to check if it answered

Read a target pane only when you want to inspect its visible output or a plain shell prompt.

## Agent Workflow

1. $bridgeCommand message <other-pane> "your message"
2. Stop. Do not poll. Wait for the reply in your own pane.

## Non-Agent Panes

For plain shells or prompts, use read when you want to inspect the result after submit or keys.
"@

  $agentsDoc = @"
Read .duo/DUO.md first.

In this project, claude means the local left pane.
Treat that bridge as already available and local.
"@

  $claudeDoc = @"
Read .duo/DUO.md first.

In this project, codex means the local right pane.
Treat that bridge as already available and local.
"@

  Write-TextFile -Path $duoDocPath -Content $duoDoc
  Write-Host "Prepared $duoDocPath"
  Ensure-TextFileIfMissing -Path $agentsPath -Content $agentsDoc
  Ensure-TextFileIfMissing -Path $claudePath -Content $claudeDoc
}

function New-ShellStartupCommand {
  param(
    [string]$Program,
    [string[]]$ProgramArgs
  )

  $parts = New-Object System.Collections.Generic.List[string]

  if ($Program -match '[\\/: ]') {
    $parts.Add('&')
    $parts.Add((Quote-PowerShellLiteral $Program))
  } else {
    $parts.Add($Program)
  }

  foreach ($arg in $ProgramArgs) {
    $parts.Add((Quote-PowerShellLiteral $arg))
  }

  return ($parts -join ' ')
}

function ConvertTo-EncodedPowerShellCommand {
  param([string]$Command)

  $bytes = [System.Text.Encoding]::Unicode.GetBytes($Command)
  return [Convert]::ToBase64String($bytes)
}

function Invoke-BridgeCommand {
  param(
    [string[]]$Arguments,
    [switch]$Quiet
  )

  if ($script:DryRun) {
    Write-Host ('DRYRUN node {0} {1}' -f $script:BridgePath, ($Arguments -join ' '))
    return
  }

  $result = Invoke-BridgeProcess -Arguments $Arguments
  if (-not $Quiet) {
    if ($result.StdOut) {
      Write-Host -NoNewline $result.StdOut
    }
    if ($result.StdErr) {
      Write-Host -NoNewline $result.StdErr
    }
  }

  if ($result.ExitCode -ne 0) {
    $details = $result.StdErr.Trim()
    if ($details) {
      throw "win-bridge command failed: $($Arguments -join ' ') :: $details"
    }
    throw "win-bridge command failed: $($Arguments -join ' ')"
  }
}

function Invoke-BridgeProcess {
  param([string[]]$Arguments)

  $stdoutPath = [System.IO.Path]::GetTempFileName()
  $stderrPath = [System.IO.Path]::GetTempFileName()
  $processArgs = @($script:BridgePath) + $Arguments

  try {
    $process = Start-Process -FilePath $script:NodePath `
      -ArgumentList $processArgs `
      -PassThru `
      -Wait `
      -WindowStyle Hidden `
      -RedirectStandardOutput $stdoutPath `
      -RedirectStandardError $stderrPath

    return [pscustomobject]@{
      ExitCode = $process.ExitCode
      StdOut = (Get-Content -LiteralPath $stdoutPath -Raw -ErrorAction SilentlyContinue)
      StdErr = (Get-Content -LiteralPath $stderrPath -Raw -ErrorAction SilentlyContinue)
    }
  } finally {
    Remove-Item -LiteralPath $stdoutPath -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $stderrPath -ErrorAction SilentlyContinue
  }
}

function Invoke-BridgeProbe {
  param([string[]]$Arguments)

  if ($script:DryRun) {
    Write-Host ('DRYRUN probe node {0} {1}' -f $script:BridgePath, ($Arguments -join ' '))
    return $true
  }

  $result = Invoke-BridgeProcess -Arguments $Arguments
  return ($result.ExitCode -eq 0)
}

function Invoke-BridgeStdOut {
  param([string[]]$Arguments)

  if ($script:DryRun) {
    Write-Host ('DRYRUN stdout node {0} {1}' -f $script:BridgePath, ($Arguments -join ' '))
    return ''
  }

  $result = Invoke-BridgeProcess -Arguments $Arguments
  if ($result.ExitCode -ne 0) {
    $details = $result.StdErr.Trim()
    if ($details) {
      throw "win-bridge command failed: $($Arguments -join ' ') :: $details"
    }
    throw "win-bridge command failed: $($Arguments -join ' ')"
  }

  return $result.StdOut.Trim()
}

function Test-BridgeLabelExists {
  param([string]$Label)

  if ($script:DryRun) {
    return $false
  }

  return (Invoke-BridgeProbe -Arguments @('resolve', $Label))
}

function Wait-BridgeTargetsReady {
  param([string[]]$Targets)

  if ($script:DryRun) {
    foreach ($target in $Targets) {
      Write-Host "DRYRUN wait for target '$target'"
    }
    return
  }

  $pending = New-Object System.Collections.Generic.HashSet[string]
  foreach ($target in $Targets) {
    [void]$pending.Add($target)
  }

  $deadline = (Get-Date).AddSeconds($ReadyTimeoutSeconds)
  while (($pending.Count -gt 0) -and ((Get-Date) -lt $deadline)) {
    foreach ($target in @($pending)) {
      if (Invoke-BridgeProbe -Arguments @('read', $target, '1')) {
        [void]$pending.Remove($target)
        Write-StartupTrace "bridge target ready: $target"
        if ($BackgroundSetup -and -not $DryRun) {
          Send-BridgeStatus -Targets @($target) -Text "bridge target ready: $target"
        }
      }
    }

    if ($pending.Count -gt 0) {
      Start-Sleep -Milliseconds 500
    }
  }

  if ($pending.Count -gt 0) {
    throw "Timed out waiting for bridge target(s) '$($pending -join ", ")' to become ready."
  }
}

function Test-AgentChatReady {
  param(
    [string]$Role,
    [string]$Output
  )

  if (-not $Output) {
    return $false
  }

  $normalized = ($Output -replace '\s+', ' ').Trim()
  if (-not $normalized) {
    return $false
  }

  switch ($Role) {
    'claude' {
      return (
        $normalized -match 'How can I help you' -or
        $normalized -match '❯' -or
        $normalized -match '\[Opus' -or
        $normalized -match '\bContext'
      )
    }
    'codex' {
      return (
        ($normalized -match 'gpt-' -and $normalized -match 'left') -or
        $normalized -match '› ' -or
        $normalized -match '/model' -or
        $normalized -match 'Find and fix a bug'
      )
    }
    default {
      return $false
    }
  }
}

function Get-BridgePaneId {
  param([string]$Target)

  return (Invoke-BridgeStdOut -Arguments @('resolve', $Target))
}

function Assert-BridgeSession {
  param(
    [string]$LeftTarget,
    [string]$RightTarget
  )

  if ($script:DryRun) {
    Write-Host "DRYRUN verify bridge session '$LeftTarget' <-> '$RightTarget'"
    return
  }

  $leftId = Get-BridgePaneId -Target $LeftTarget
  $rightId = Get-BridgePaneId -Target $RightTarget

  if (-not $leftId) {
    throw "Could not resolve bridge target '$LeftTarget'."
  }

  if (-not $rightId) {
    throw "Could not resolve bridge target '$RightTarget'."
  }

  if ($leftId -eq $rightId) {
    throw "Bridge targets '$LeftTarget' and '$RightTarget' resolved to the same pane."
  }

  foreach ($target in @($LeftTarget, $RightTarget)) {
    if (-not (Invoke-BridgeProbe -Arguments @('read', $target, '1'))) {
      throw "Bridge target '$target' is registered but not readable."
    }
  }

  Write-Host ("Bridge verified: {0} ({1}) <-> {2} ({3})" -f $LeftTarget, $leftId, $RightTarget, $rightId)
}

function Send-BridgeStatus {
  param(
    [string[]]$Targets,
    [string]$Text
  )

  foreach ($target in $Targets) {
    try {
      Invoke-BridgeCommand -Arguments @('notify', $target, $Text) -Quiet
    } catch {}
  }
}

function Send-BridgeText {
  param(
    [string]$Target,
    [string]$Text
  )

  Write-StartupTrace "read $Target 20"
  Invoke-BridgeCommand -Arguments @('read', $Target, '20') -Quiet
  Write-StartupTrace "type $Target <duo intro>"
  Invoke-BridgeCommand -Arguments @('type', $Target, $Text) -Quiet
  Start-Sleep -Milliseconds 250
  Write-StartupTrace "read $Target 20"
  Invoke-BridgeCommand -Arguments @('read', $Target, '20') -Quiet
  Write-StartupTrace "keys $Target Enter"
  Invoke-BridgeCommand -Arguments @('keys', $Target, 'Enter') -Quiet
}

function Start-AsyncIntroDelivery {
  param(
    [string]$Target,
    [string]$Role,
    [string]$Text
  )

  if ($script:DryRun) {
    Write-StartupTrace "intro watcher scheduled: $Target"
    Write-Host "DRYRUN async intro watcher '$Target'"
    return
  }

  Start-Process -FilePath $script:NodePath `
    -WorkingDirectory $script:ProjectDir `
    -WindowStyle Hidden `
    -ArgumentList @(
      $script:BridgePath,
      'wait-submit',
      $Target,
      $Role,
      [string]$ChatReadyTimeoutSeconds,
      $Text
    ) | Out-Null

  Write-StartupTrace "intro watcher scheduled: $Target"
  if ($BackgroundSetup) {
    Send-BridgeStatus -Targets @($Target) -Text "intro watcher scheduled: $Target"
  }
}

function Write-StartupTrace {
  param([string]$Text)

  $script:StartupTraceLog.Add($Text)
  Write-Host "[startup] $Text"
}

function Invoke-DuoBackgroundSetup {
  param(
    [string]$ClaudeIntro,
    [string]$CodexIntro
  )

  try {
    Wait-BridgeTargetsReady -Targets @('claude', 'codex')
    $script:VerboseTargets = @('claude', 'codex')
    Assert-BridgeSession -LeftTarget 'claude' -RightTarget 'codex'
    Write-StartupTrace 'bridge verified: claude <-> codex'
    Send-BridgeStatus -Targets @('claude', 'codex') -Text 'bridge verified: claude <-> codex'

    if ($StartupDelaySeconds -gt 0) {
      Write-StartupTrace "settle delay: ${StartupDelaySeconds}s"
      if (-not $DryRun) {
        Start-Sleep -Seconds $StartupDelaySeconds
      }
    }

    if (-not $SkipIntro) {
      Start-AsyncIntroDelivery -Target 'claude' -Role 'claude' -Text $ClaudeIntro
      Start-AsyncIntroDelivery -Target 'codex' -Role 'codex' -Text $CodexIntro
    }
  } catch {
    $message = $_.Exception.Message
    Write-StartupTrace "startup error: $message"
    Send-BridgeStatus -Targets @('claude', 'codex') -Text "startup error: $message"
    if (-not $DryRun) {
      exit 1
    }
    throw
  }
}

function Start-AsyncDuoSetup {
  param(
    [string]$ClaudeIntro,
    [string]$CodexIntro
  )

  if ($DryRun) {
    Write-Host 'DRYRUN background duo setup'
    Invoke-DuoBackgroundSetup -ClaudeIntro $ClaudeIntro -CodexIntro $CodexIntro
    return
  }

  $argumentList = @(
    '-NoLogo',
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    $script:SelfPath,
    '-BackgroundSetup',
    '-ProjectDir',
    $script:ProjectDir,
    '-ReadyTimeoutSeconds',
    [string]$ReadyTimeoutSeconds,
    '-ChatReadyTimeoutSeconds',
    [string]$ChatReadyTimeoutSeconds,
    '-StartupDelaySeconds',
    [string]$StartupDelaySeconds
  )

  if ($SkipIntro) {
    $argumentList += '-SkipIntro'
  }

  Start-Process -FilePath 'powershell.exe' `
    -WorkingDirectory $script:ProjectDir `
    -WindowStyle Hidden `
    -ArgumentList $argumentList | Out-Null
}

function Start-StandaloneWindow {
  param([string]$LauncherCommand)

  $encodedLauncher = ConvertTo-EncodedPowerShellCommand -Command $LauncherCommand

  if ($script:DryRun) {
    Write-Host ('DRYRUN powershell.exe -NoExit -EncodedCommand {0}' -f $encodedLauncher)
    return
  }

  Start-Process -FilePath 'powershell.exe' `
    -WorkingDirectory $script:ProjectDir `
    -ArgumentList @('-NoExit', '-EncodedCommand', $encodedLauncher) | Out-Null
}

function Start-WindowsTerminalLayout {
  param(
    [string]$ClaudeLauncher,
    [string]$CodexLauncher
  )

  $wt = Get-Command wt -ErrorAction SilentlyContinue
  if (-not $wt) {
    if ($script:AllowSeparateWindows) {
      return $false
    }

    throw "wt.exe not found. duo requires Windows Terminal for the left/right split. Install Windows Terminal or run with -AllowSeparateWindows."
  }

  $encodedClaudeLauncher = ConvertTo-EncodedPowerShellCommand -Command $ClaudeLauncher
  $encodedCodexLauncher = ConvertTo-EncodedPowerShellCommand -Command $CodexLauncher

  $splitFlag = if ($script:SplitDirection -eq 'horizontal') { '-H' } else { '-V' }
  $splitSize = Format-InvariantNumber -Value $script:SplitRatio

  $wtArgs = @(
    '-d', $script:ProjectDir,
    'powershell.exe', '-NoExit', '-EncodedCommand', $encodedClaudeLauncher,
    ';',
    'split-pane', $splitFlag, '-s', $splitSize,
    '-d', $script:ProjectDir,
    'powershell.exe', '-NoExit', '-EncodedCommand', $encodedCodexLauncher
  )

  if ($script:DryRun) {
    Write-Host ('DRYRUN {0} {1}' -f $wt.Source, ($wtArgs -join ' '))
    return $true
  }

  Start-Process -FilePath $wt.Source `
    -WorkingDirectory $script:ProjectDir `
    -ArgumentList $wtArgs | Out-Null

  return $true
}

$ProjectDir = (Resolve-Path -LiteralPath $ProjectDir).Path
$NodePath = (Get-Command node -ErrorAction Stop).Source
$BridgePath = Join-Path $PSScriptRoot 'bin\win-bridge.js'
$BridgeCommand = "node $(Quote-PowerShellLiteral $BridgePath)"
$script:SelfPath = $PSCommandPath

if (-not (Test-Path -LiteralPath $BridgePath)) {
  throw "Cannot find win-bridge entrypoint at '$BridgePath'."
}

Ensure-DuoInstructionFiles -ProjectDir $ProjectDir -BridgePath $BridgePath

$claudeIntro = 'Read .duo/DUO.md.'
$codexIntro = 'Read .duo/DUO.md.'

if ($BackgroundSetup) {
  Invoke-DuoBackgroundSetup -ClaudeIntro $claudeIntro -CodexIntro $codexIntro
  return
}

[void](Resolve-CommandOrThrow -CommandName $ClaudeProgram -Role 'Claude')
[void](Resolve-CommandOrThrow -CommandName $CodexProgram -Role 'Codex')
if (-not $AllowSeparateWindows) {
  [void](Resolve-CommandOrThrow -CommandName 'wt' -Role 'Windows Terminal')
}

# Trigger registry cleanup before checking for label collisions.
Invoke-BridgeCommand -Arguments @('list') -Quiet

foreach ($label in @('claude', 'codex')) {
  if (Test-BridgeLabelExists -Label $label) {
    throw "win-bridge label '$label' is already active. Close the existing pane or rename it before starting duo.ps1."
  }
}

$wrappedShell = 'powershell.exe'
$claudeStartupCommand = New-ShellStartupCommand -Program $ClaudeProgram -ProgramArgs $ClaudeArgs
$codexStartupCommand = New-ShellStartupCommand -Program $CodexProgram -ProgramArgs $CodexArgs
$claudeLauncher = New-LauncherCommand -Name 'claude' -Program $wrappedShell -ProgramArgs (New-WrappedShellArgs -StartupCommand $claudeStartupCommand)
$codexLauncher = New-LauncherCommand -Name 'codex' -Program $wrappedShell -ProgramArgs (New-WrappedShellArgs -StartupCommand $codexStartupCommand)

Write-Host 'Starting duo session...'
$layoutLabel = if ($SplitDirection -eq 'vertical') { 'left/right' } else { 'top/bottom' }
Write-Host "Project directory: $ProjectDir"
Write-Host "Requested layout: $layoutLabel split ($((Format-InvariantNumber -Value $SplitRatio)))"
Write-StartupTrace "launch layout: $layoutLabel split ($((Format-InvariantNumber -Value $SplitRatio)))"
$usedWindowsTerminal = Start-WindowsTerminalLayout -ClaudeLauncher $claudeLauncher -CodexLauncher $codexLauncher

if (-not $usedWindowsTerminal) {
  Write-Host 'Windows Terminal split unavailable; falling back to two separate PowerShell windows.'
  Start-StandaloneWindow -LauncherCommand $claudeLauncher
  Start-Sleep -Milliseconds 300
  Start-StandaloneWindow -LauncherCommand $codexLauncher
}

Write-Host 'Background startup will continue inside the duo panes.'
Start-AsyncDuoSetup -ClaudeIntro $claudeIntro -CodexIntro $codexIntro
Write-Host 'Duo session launched.'
if ($usedWindowsTerminal) {
  Write-Host 'Launched in Windows Terminal split panes: Claude left, Codex right.'
}
