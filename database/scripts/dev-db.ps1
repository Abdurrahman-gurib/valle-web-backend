# =============================================================
# VALLE Advenature Park - isolated local PostgreSQL dev instance
#
# Runs a throwaway PostgreSQL cluster in database\.pgdata on port 5433,
# completely separate from any system-wide PostgreSQL service.
#
# Usage:  .\dev-db.ps1 <init|start|stop|status|reset|seed>
#
#   init    initdb + start + create valle_park + apply schema.sql & seed.sql
#   start   start the dev instance (port 5433)
#   stop    stop the dev instance
#   status  show whether the instance is running
#   reset   stop and delete the data directory (full wipe)
#   seed    re-apply schema.sql + seed.sql to the running instance
#
# Set $env:PGBIN to point at your PostgreSQL bin folder if it is not
# at the default "C:\Program Files\PostgreSQL\18\bin".
# =============================================================

param([string]$cmd = "status")

$ErrorActionPreference = "Stop"

$PgBin = if ($env:PGBIN) { $env:PGBIN } else { "C:\Program Files\PostgreSQL\18\bin" }
$DbDir = Split-Path -Parent $PSScriptRoot          # ...\Database
$DataDir = Join-Path $DbDir ".pgdata"
$LogFile = Join-Path $DataDir "log.txt"
$SchemaFile = Join-Path $DbDir "schema.sql"
$SeedFile = Join-Path $DbDir "seed.sql"
$Port = 5433
$Db = "valle_park"

$PgCtl = Join-Path $PgBin "pg_ctl.exe"
$InitDb = Join-Path $PgBin "initdb.exe"
$CreateDb = Join-Path $PgBin "createdb.exe"
$Psql = Join-Path $PgBin "psql.exe"

if (-not (Test-Path $PgCtl)) {
    Write-Host "PostgreSQL binaries not found at '$PgBin'." -ForegroundColor Red
    Write-Host "Install PostgreSQL 18 or set `$env:PGBIN to your PostgreSQL bin folder."
    exit 1
}

function Start-DevDb {
    # Start-Process gives the server its own (hidden) console; run via "&" the
    # spawned postgres.exe inherits THIS console's handles and the script hangs
    # until the server exits.
    $ctlArgs = "-D `"$DataDir`" -o `"-p $Port`" -l `"$LogFile`" -w start"
    # NOTE: -Wait would block on the whole process TREE (incl. the server) in
    # Windows PowerShell 5.1, so wait on the pg_ctl process object only.
    $p = Start-Process -FilePath $PgCtl -ArgumentList $ctlArgs -WindowStyle Hidden -PassThru
    if (-not $p.WaitForExit(60000)) { throw "pg_ctl start timed out (see $LogFile)" }
    if ($p.ExitCode -ne 0) { throw "pg_ctl start failed (see $LogFile)" }
    $PgIsReady = Join-Path $PgBin "pg_isready.exe"
    foreach ($i in 1..30) {
        & $PgIsReady -h localhost -p $Port *> $null
        if ($LASTEXITCODE -eq 0) { return }
        Start-Sleep -Milliseconds 500
    }
    throw "server did not become ready on port $Port (see $LogFile)"
}

function Stop-DevDb {
    & $PgCtl -D $DataDir stop
}

function Invoke-SqlApply {
    Write-Host "Applying schema.sql ..." -ForegroundColor Cyan
    & $Psql -h localhost -p $Port -U postgres -d $Db -v ON_ERROR_STOP=1 -f $SchemaFile
    if ($LASTEXITCODE -ne 0) { throw "schema.sql failed" }
    Write-Host "Applying seed.sql ..." -ForegroundColor Cyan
    & $Psql -h localhost -p $Port -U postgres -d $Db -v ON_ERROR_STOP=1 -f $SeedFile
    if ($LASTEXITCODE -ne 0) { throw "seed.sql failed" }
    Write-Host "Database '$Db' is ready on port $Port." -ForegroundColor Green
}

switch ($cmd) {

    "init" {
        if (Test-Path $DataDir) {
            Write-Host "Data directory already exists: $DataDir" -ForegroundColor Yellow
            Write-Host "Run '.\dev-db.ps1 reset' first for a clean re-init."
            exit 1
        }
        if (-not (Test-Path $SeedFile)) {
            Write-Host "seed.sql not found - generating it ..." -ForegroundColor Cyan
            node (Join-Path $PSScriptRoot "generate-seed.js")
            if ($LASTEXITCODE -ne 0) { throw "generate-seed.js failed" }
        }
        Write-Host "Initialising cluster in $DataDir ..." -ForegroundColor Cyan
        & $InitDb -D $DataDir -U postgres -A trust -E UTF8 --no-instructions
        if ($LASTEXITCODE -ne 0) { throw "initdb failed" }
        Start-DevDb
        Write-Host "Creating database '$Db' ..." -ForegroundColor Cyan
        & $CreateDb -h localhost -p $Port -U postgres $Db
        if ($LASTEXITCODE -ne 0) { throw "createdb failed" }
        Invoke-SqlApply
    }

    "start" {
        if (-not (Test-Path $DataDir)) {
            Write-Host "No data directory. Run '.\dev-db.ps1 init' first." -ForegroundColor Yellow
            exit 1
        }
        & (Join-Path $PgBin "pg_isready.exe") -h localhost -p $Port *> $null
        if ($LASTEXITCODE -eq 0) {
            Write-Host "Dev PostgreSQL already running on port $Port." -ForegroundColor Green
            exit 0
        }
        Start-DevDb
        Write-Host "Dev PostgreSQL running on port $Port." -ForegroundColor Green
    }

    "stop" {
        Stop-DevDb
    }

    "status" {
        if (-not (Test-Path $DataDir)) {
            Write-Host "Not initialised (no $DataDir). Run '.\dev-db.ps1 init'."
            exit 0
        }
        & $PgCtl -D $DataDir status
    }

    "reset" {
        if (Test-Path $DataDir) {
            try { Stop-DevDb } catch {}
            Remove-Item -Recurse -Force $DataDir -Confirm:$false
            Write-Host "Removed $DataDir. Run '.\dev-db.ps1 init' to start fresh." -ForegroundColor Green
        } else {
            Write-Host "Nothing to reset ($DataDir does not exist)."
        }
    }

    "seed" {
        Invoke-SqlApply
    }

    default {
        Write-Host "Usage: .\dev-db.ps1 <init|start|stop|status|reset|seed>"
        exit 1
    }
}
