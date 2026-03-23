[CmdletBinding()]
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$ComposeArgs
)

$ErrorActionPreference = "Stop"

$repoRoot = $PSScriptRoot
$composeFile = Join-Path $repoRoot "docker-compose.self-edit.yml"

if (-not (Test-Path $composeFile)) {
    throw "Missing compose file: $composeFile"
}

if (-not $ComposeArgs -or $ComposeArgs.Count -eq 0) {
    # Default one-liner behavior: start gateway in background.
    $ComposeArgs = @("up", "-d", "openclaw-gateway")
}

Push-Location $repoRoot
try {
    Write-Host "docker compose -f docker-compose.self-edit.yml $($ComposeArgs -join ' ')"
    & docker compose -f "docker-compose.self-edit.yml" @ComposeArgs
    $exitCode = $LASTEXITCODE
}
finally {
    Pop-Location
}

if ($null -ne $exitCode -and $exitCode -ne 0) {
    exit $exitCode
}
