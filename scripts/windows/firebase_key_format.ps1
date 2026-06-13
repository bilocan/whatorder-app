# Extracts the Firebase private key from a service account JSON and formats it
# for use as a Vercel environment variable (real newlines → literal \n).
#
# Usage:
#   .\firebase_key_format.ps1 path\to\service-account.json
#
# Paste the output into Vercel → Settings → Environment Variables → FIREBASE_PRIVATE_KEY

param(
    [Parameter(Mandatory)]
    [string]$ServiceAccountPath
)

$json = Get-Content $ServiceAccountPath -Raw | ConvertFrom-Json
$formatted = $json.private_key -replace "`r`n", "\n" -replace "`n", "\n"

Write-Host ""
Write-Host "FIREBASE_PRIVATE_KEY value (copy everything between the lines):"
Write-Host "----------------------------------------------------------------"
Write-Host $formatted
Write-Host "----------------------------------------------------------------"
