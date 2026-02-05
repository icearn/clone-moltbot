# --- 0. LOAD .env ---
$envFile = Join-Path $PSScriptRoot ".env"
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        $line = $_.Trim()
        if (-not $line -or $line.StartsWith('#')) { return }
        if ($line.StartsWith('export ')) { $line = $line.Substring(7).Trim() }

        $parts = $line -split '=', 2
        if ($parts.Count -lt 2) { return }

        $key = $parts[0].Trim()
        if (-not $key) { return }

        $value = $parts[1].Trim()
        if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
            $value = $value.Substring(1, $value.Length - 2)
        }

        $existing = [System.Environment]::GetEnvironmentVariable($key, "Process")
        if ([string]::IsNullOrEmpty($existing)) {
            Set-Item -Path "Env:$key" -Value $value
        }
    }
}

# --- 1. CONFIGURATION ---
# Define your extra mounts here (comma separated)
# Format: "HostPath:ContainerPath,HostPath2:ContainerPath2"
# Example: "C:\Your\Host\Path:/target/container/path"
$ExtraMounts = if ([string]::IsNullOrEmpty($env:CLAWDBOT_EXTRA_MOUNTS)) {
    "D:\\Software\\moltmount:/home/node"
} else {
    $env:CLAWDBOT_EXTRA_MOUNTS
}

# Set standard environment variables
if (-not $env:CLAWDBOT_IMAGE) { $env:CLAWDBOT_IMAGE = "openclaw:audio" }
if (-not $env:CLAWDBOT_CONFIG_DIR) { $env:CLAWDBOT_CONFIG_DIR = "$HOME\.openclaw" }
if (-not $env:CLAWDBOT_WORKSPACE_DIR) { $env:CLAWDBOT_WORKSPACE_DIR = "$HOME\.openclaw\workspace" }

# Generate a random token if not already set
if (-not $env:CLAWDBOT_GATEWAY_TOKEN) {
    $env:CLAWDBOT_GATEWAY_TOKEN = -join ((0..31) | ForEach-Object { "{0:x2}" -f (Get-Random -Max 256) })
}
Write-Host "Gateway Token: $env:CLAWDBOT_GATEWAY_TOKEN"

# --- 2. GENERATE docker-compose.extra.yml ---
$mountsList = $ExtraMounts -split ','
$yamlContent = @"
services:
  openclaw-gateway:
    volumes:
"@

function Format-DockerPath {
    param ($PathString)
    if (-not $PathString) { return $null }
    
    # Split host:container
    $parts = $PathString -split ':', 2
    if ($parts.Count -lt 2) { return $PathString } # Return as-is if parsing fails
    
    $hostPath = $parts[0]
    $containerPath = $parts[1]
    
    # Try to resolve host path to absolute path to handle relative paths correctly
    if (Test-Path $hostPath) {
        $hostPath = (Resolve-Path $hostPath).Path
    }
    
    # Normalize backslashes to forward slashes for better Docker compatibility
    $hostPath = $hostPath -replace '\\', '/'
    
    return "$($hostPath):$($containerPath)"
}

$hasMounts = $false
foreach ($mount in $mountsList) {
    if ($mount.Trim()) {
        $formatted = Format-DockerPath -PathString $mount.Trim()
        $yamlContent += "`n      - `"$formatted`""
        $hasMounts = $true
    }
}

if ($hasMounts) {
    $yamlContent += @"

  openclaw-cli:
    volumes:
"@
    foreach ($mount in $mountsList) {
        if ($mount.Trim()) {
            $formatted = Format-DockerPath -PathString $mount.Trim()
            $yamlContent += "`n      - `"$formatted`""
        }
    }
}

$yamlContent | Out-File -Encoding UTF8 docker-compose.extra.yml
Write-Host "Created docker-compose.extra.yml with normalized paths"

# --- 3. RUN COMMANDS ---
Write-Host "`nRun these commands to start:" -ForegroundColor Cyan
Write-Host "docker compose -f docker-compose.yml -f docker-compose.extra.yml run --rm openclaw-cli onboard"
Write-Host "docker compose -f docker-compose.yml -f docker-compose.extra.yml up -d openclaw-gateway"

docker compose -f docker-compose.yml -f docker-compose.extra.yml run --rm openclaw-cli onboard --install-daemon
