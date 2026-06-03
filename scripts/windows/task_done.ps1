# Run from repo root: .\scripts\windows\task_done.ps1
# Flags: -Check (format check only, no fix)

param([switch]$Check)

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent | Split-Path -Parent
$mobile = Join-Path $root "mobile"

function Step($label) { Write-Host "`n==> $label" -ForegroundColor Cyan }
function Pass($msg)   { Write-Host "  PASS: $msg" -ForegroundColor Green }
function Fail($msg)   { Write-Host "  FAIL: $msg" -ForegroundColor Red; exit 1 }
function Skip($msg)   { Write-Host "  SKIP: $msg" -ForegroundColor Yellow }

# 1. Dart format
Step "1. Dart format"
Push-Location $mobile
dart format --check lib
if ($LASTEXITCODE -ne 0) { Fail "dart format --check lib (run dart format lib to fix)" }
Pass "dart format"
Pop-Location

# 2. Flutter analyze
Step "2. Flutter analyze"
Push-Location $mobile
flutter analyze --no-fatal-infos
if ($LASTEXITCODE -ne 0) { Fail "flutter analyze" }
Pass "flutter analyze"
Pop-Location

# 3. Flutter tests
Step "3. Flutter tests"
$testDir = Join-Path $mobile "test"
if (Test-Path $testDir) {
    $testFiles = Get-ChildItem $testDir -Recurse -Filter "*_test.dart" -ErrorAction SilentlyContinue
    if ($testFiles.Count -gt 0) {
        Push-Location $mobile
        flutter test
        if ($LASTEXITCODE -ne 0) { Fail "flutter test" }
        Pass "flutter test ($($testFiles.Count) test files)"
        Pop-Location
    } else {
        Skip "no test files in mobile/test/ yet"
    }
} else {
    Skip "mobile/test/ does not exist yet"
}

# 3b. Backend tests
Step "3b. Backend tests"
$backendTest = Join-Path $root "backend" "package.json"
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
