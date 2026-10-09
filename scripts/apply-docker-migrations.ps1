$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$migrationsPath = Join-Path $root "database\migrations"
$migrations = Get-ChildItem -Path $migrationsPath -Filter "*.sql" | Sort-Object Name

if (-not $migrations -or $migrations.Count -eq 0) {
    throw "No SQL files found in $migrationsPath"
}

foreach ($f in $migrations) {
    Write-Host ">>> $($f.Name)"
    Get-Content -Path $f.FullName -Raw | docker compose exec -T postgres psql -U course -d course
    if ($LASTEXITCODE -ne 0) {
        throw "Migration failed: $($f.Name)"
    }
}

Write-Host "Done."
