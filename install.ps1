param(
  [switch]$SkipVerify
)

$ErrorActionPreference = 'Stop'

function Test-CommandExists {
  param([string]$Name)

  return [bool](Get-Command $Name -ErrorAction SilentlyContinue | Select-Object -First 1)
}

function Assert-CommandExists {
  param(
    [string]$Name,
    [string]$Label
  )

  if (-not (Test-CommandExists -Name $Name)) {
    throw "$Label was not found on PATH. Install it first and rerun install.ps1."
  }
}

Write-Host 'Installing tmux-for-windows...'
Write-Host "Project: $PSScriptRoot"

Assert-CommandExists -Name 'node' -Label 'Node.js'
Assert-CommandExists -Name 'npm' -Label 'npm'
Assert-CommandExists -Name 'powershell.exe' -Label 'PowerShell'

Push-Location $PSScriptRoot
try {
  Write-Host ''
  Write-Host '[1/4] Installing npm dependencies'
  npm install
  if ($LASTEXITCODE -ne 0) {
    throw "npm install failed with exit code $LASTEXITCODE."
  }

  Write-Host ''
  Write-Host '[2/4] Linking CLI commands'
  npm link
  if ($LASTEXITCODE -ne 0) {
    throw "npm link failed with exit code $LASTEXITCODE."
  }

  if ($SkipVerify) {
    Write-Host ''
    Write-Host 'Install complete. Verification skipped.'
    return
  }

  Write-Host ''
  Write-Host '[3/4] Verifying win-bridge'
  win-bridge version
  if ($LASTEXITCODE -ne 0) {
    throw "win-bridge version failed with exit code $LASTEXITCODE."
  }

  Write-Host ''
  Write-Host '[4/4] Running duo doctor'
  duo doctor
  if ($LASTEXITCODE -ne 0) {
    throw "duo doctor failed with exit code $LASTEXITCODE."
  }

  Write-Host ''
  Write-Host 'Install complete.'
  Write-Host 'You can now run: duo'
} finally {
  Pop-Location
}
