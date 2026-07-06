# Run from repo root: .\scripts\windows\task_done.ps1

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent | Split-Path -Parent
$dashboard = Join-Path $root "dashboard"

function Step($label) { Write-Host "`n==> $label" -ForegroundColor Cyan }
function Pass($msg)   { Write-Host "  PASS: $msg" -ForegroundColor Green }
function Fail($msg)   { Write-Host "  FAIL: $msg" -ForegroundColor Red; exit 1 }
function Skip($msg)   { Write-Host "  SKIP: $msg" -ForegroundColor Yellow }

# 1. TypeScript check
Step "1. TypeScript check"
$dashboardPkg = Join-Path $dashboard "package.json"
if (Test-Path $dashboardPkg) {
    Push-Location $dashboard
    npx tsc --noEmit
    if ($LASTEXITCODE -ne 0) { Fail "tsc --noEmit" }
    Pass "tsc --noEmit"
    Pop-Location
} else {
    Skip "dashboard/package.json not found"
}

# 2. ESLint
Step "2. ESLint"
if (Test-Path $dashboardPkg) {
    Push-Location $dashboard
    npx eslint src --max-warnings 0
    if ($LASTEXITCODE -ne 0) { Fail "eslint src --max-warnings 0" }
    Pass "eslint src --max-warnings 0"
    Pop-Location
} else {
    Skip "dashboard/package.json not found"
}

# 3. Dashboard tests
Step "3. Dashboard tests"
$testDir = Join-Path $dashboard "src\__tests__"
if (Test-Path $testDir) {
    $testFiles = Get-ChildItem $testDir -Recurse -Include "*.test.ts", "*.test.tsx" -ErrorAction SilentlyContinue
    if ($testFiles.Count -gt 0) {
        Push-Location $dashboard
        npm test
        if ($LASTEXITCODE -ne 0) { Fail "npm test" }
        Pass "npm test ($($testFiles.Count) test files)"
        Pop-Location
    } else {
        Skip "no test files in dashboard/src/__tests__/ yet"
    }
} else {
    Skip "dashboard/src/__tests__/ does not exist yet"
}

# 3b. Backend tests
Step "3b. Backend tests"
$backendTest = Join-Path $root "backend\package.json"
if (Test-Path $backendTest) {
    $pkg = Get-Content $backendTest | ConvertFrom-Json
    $hasJest = $pkg.devDependencies.PSObject.Properties.Name -contains "jest" -or
               $pkg.dependencies.PSObject.Properties.Name -contains "jest"
    if ($hasJest) {
        Push-Location (Join-Path $root "backend")
        npm test
        if ($LASTEXITCODE -ne 0) { Fail "npm test" }
        Pass "npm test"
        Pop-Location
    } else {
        Skip "jest not configured in backend yet"
    }
} else {
    Skip "backend/package.json not found"
}

Write-Host "`nAll checks passed." -ForegroundColor Green

# Checks are done — git may print warnings to stderr (e.g. CRLF notices);
# don't let those terminate the commit-suggestion section under PS 5.1.
$ErrorActionPreference = "Continue"

# Suggested commit — app repo
Step "Suggested commit (app)"
$changed = git diff --stat HEAD 2>$null
if (-not $changed) { $changed = git status --short 2>$null }
if ($changed) { Write-Host $changed }
Write-Host ""
Write-Host "  Copy and edit:" -ForegroundColor Cyan
Write-Host @'
git commit -m "feat: <summary>

- <optional detail>"
'@

# Suggested commit — vault repo
$vault = Join-Path $root "..\whatorder-vault"
if (Test-Path $vault) {
    Step "Suggested commit (vault)"
    Push-Location $vault
    $vaultChanged = git diff --stat HEAD 2>$null
    if (-not $vaultChanged) { $vaultChanged = git status --short 2>$null }
    if ($vaultChanged) { Write-Host $vaultChanged }
    Pop-Location
    Write-Host ""
    Write-Host "  Copy and edit:" -ForegroundColor Cyan
    Write-Host @'
git commit -m "chore: <summary>

- <optional detail>"
'@
}
