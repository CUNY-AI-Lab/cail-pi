# CUNY AI Lab x Pi setup for Windows PowerShell:
#
#   irm https://raw.githubusercontent.com/CUNY-AI-Lab/cail-pi/main/install.ps1 | iex
#
# Checks for Git, installs Pi with Pi's official installer (which installs
# Node.js too when needed), then runs the CUNY AI Lab setup,
# `npx.cmd @cuny-ai-lab/cail-pi`. To pass options to that setup:
#
#   & ([scriptblock]::Create((irm https://raw.githubusercontent.com/CUNY-AI-Lab/cail-pi/main/install.ps1))) --doctor
#
# `iex` runs this inside the participant's own window, so the script never
# calls `exit` (that would close the window) and returns instead.

function Install-CailPi {
  $piInstallerUrl = "https://pi.dev/install.ps1"
  $cailPackage = "@cuny-ai-lab/cail-pi"

  # Rebuild PATH the way a new PowerShell window would, to pick up what Pi's
  # installer saved to the user PATH (Node.js and Pi itself).
  function Update-SessionPath {
    $machine = [Environment]::GetEnvironmentVariable("Path", "Machine")
    $user = [Environment]::GetEnvironmentVariable("Path", "User")
    $env:Path = (@($machine, $user) | Where-Object { $_ }) -join ";"
  }

  function Test-Pi {
    if (-not (Get-Command pi.cmd -ErrorAction SilentlyContinue)) { return $false }
    & pi.cmd --version *> $null
    return $LASTEXITCODE -eq 0
  }

  Write-Host ""
  Write-Host "CUNY AI Lab x Pi setup"
  Write-Host ""

  if (-not (Get-Command git.exe -ErrorAction SilentlyContinue)) {
    Write-Host "Git is not installed yet. Install Git for Windows:"
    Write-Host ""
    Write-Host "  winget install --id Git.Git -e"
    Write-Host ""
    Write-Host "or download it from https://git-scm.com/downloads/win"
    Write-Host "Then close PowerShell, open a new PowerShell window, and run this setup command again."
    Write-Host ""
    return
  }

  if (Test-Pi) {
    Write-Host "Pi $(& pi.cmd --version) is already installed."
  } else {
    # A separate PowerShell process, so an `exit` in Pi's installer cannot
    # close this window. It shares this console, so its questions still work.
    $shell = (Get-Process -Id $PID).Path
    & $shell -NoProfile -ExecutionPolicy Bypass -Command "irm '$piInstallerUrl' | iex"
    if ($LASTEXITCODE -ne 0) {
      Write-Host ""
      Write-Host "Pi's installer did not finish. Fix the problem it reported, then run this setup command again."
      Write-Host ""
      return
    }
    Update-SessionPath
    if (-not (Test-Pi)) {
      Write-Host ""
      Write-Host "Pi was installed, but it does not start yet. Open a new PowerShell window and run this setup command again."
      Write-Host ""
      return
    }
  }

  Write-Host ""
  Write-Host "Running the CUNY AI Lab setup..."
  & npx.cmd --yes $cailPackage @args
}

Install-CailPi @args
