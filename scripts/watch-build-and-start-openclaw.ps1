param(
    [string]$RepoRoot = ".",
    [string]$ImageRef = "",
    [string]$ServiceName = "openclaw-gateway",
    [int]$IntervalSec = 20,
    [int]$TimeoutMinutes = 240
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-Log {
    param(
        [string]$Message,
        [string]$LogPath
    )
    $line = "[{0}] {1}" -f (Get-Date).ToString("yyyy-MM-dd HH:mm:ss"), $Message
    $line | Tee-Object -FilePath $LogPath -Append | Out-Null
}

function Get-TrackedBuildProcesses {
    param(
        [string]$RepoPath,
        [string]$TargetImage
    )
    $results = @()
    foreach ($name in @("docker.exe", "com.docker.cli.exe")) {
        $results += Get-CimInstance Win32_Process -Filter "name = '$name'" -ErrorAction SilentlyContinue
    }

    $repoLower = $RepoPath.ToLowerInvariant()
    $imageLower = $TargetImage.ToLowerInvariant()

    return @($results | Where-Object {
            $cmd = [string]$_.CommandLine
            if (-not $cmd) { return $false }
            $lower = $cmd.ToLowerInvariant()
            if (-not ($lower -match "(^|\s)build(\s|$)")) { return $false }
            if ($lower.Contains($repoLower)) { return $true }
            if ($imageLower -and $lower.Contains($imageLower)) { return $true }
            if ($lower.Contains("dockerfile")) { return $true }
            return $false
        })
}

function Get-ImageId {
    param([string]$TargetImage)
    try {
        $id = (& docker image inspect --format "{{.Id}}" $TargetImage 2>$null | Select-Object -First 1).Trim()
        if ($LASTEXITCODE -ne 0 -or -not $id) {
            return $null
        }
        return $id
    } catch {
        return $null
    }
}

$resolvedRepo = (Resolve-Path $RepoRoot).Path
if (-not $ImageRef) {
    $ImageRef = if ($env:OPENCLAW_IMAGE) { $env:OPENCLAW_IMAGE } else { "openclaw:audio" }
}
$interval = [Math]::Max(5, $IntervalSec)
$deadline = (Get-Date).AddMinutes([Math]::Max(1, $TimeoutMinutes))
$logPath = Join-Path $resolvedRepo ".openclaw-build-monitor.log"

Push-Location $resolvedRepo
try {
    Write-Log "Watcher started. repo=$resolvedRepo image=$ImageRef service=$ServiceName interval=${interval}s timeout=${TimeoutMinutes}m" $logPath

    $composeArgs = @("-f", "docker-compose.yml")
    if (Test-Path "docker-compose.extra.yml") {
        $composeArgs += @("-f", "docker-compose.extra.yml")
    }

    $initialImageId = Get-ImageId -TargetImage $ImageRef
    if ($initialImageId) {
        Write-Log "Initial image id: $initialImageId" $logPath
    } else {
        Write-Log "Initial image not found yet: $ImageRef" $logPath
    }

    $buildSeen = $false
    while ((Get-Date) -lt $deadline) {
        $buildProcs = Get-TrackedBuildProcesses -RepoPath $resolvedRepo -TargetImage $ImageRef
        if ($buildProcs.Count -gt 0) {
            $buildSeen = $true
            Write-Log "Build in progress (tracked processes: $($buildProcs.Count)). Waiting..." $logPath
            Start-Sleep -Seconds $interval
            continue
        }

        $currentImageId = Get-ImageId -TargetImage $ImageRef
        if (-not $currentImageId) {
            Write-Log "No inspectable image yet for $ImageRef. Waiting..." $logPath
            Start-Sleep -Seconds $interval
            continue
        }

        if ($buildSeen) {
            Write-Log "Build finished. Resolved image id: $currentImageId" $logPath
            break
        }

        if ($initialImageId -and $currentImageId -ne $initialImageId) {
            Write-Log "Image changed without observed build process. New image id: $currentImageId" $logPath
            break
        }

        if (-not $initialImageId) {
            Write-Log "Image is now available: $currentImageId" $logPath
            break
        }

        Write-Log "No tracked build detected yet; image unchanged. Waiting..." $logPath
        Start-Sleep -Seconds $interval
    }

    if ((Get-Date) -ge $deadline) {
        Write-Log "Timeout reached before build completion detection. Exiting." $logPath
        exit 1
    }

    $started = $false
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        Write-Log "Starting compose service (attempt $attempt): docker compose $($composeArgs -join ' ') up -d --force-recreate $ServiceName" $logPath
        & docker compose @composeArgs up -d --force-recreate $ServiceName 2>&1 | Tee-Object -FilePath $logPath -Append | Out-Null
        if ($LASTEXITCODE -eq 0) {
            $started = $true
            break
        }
        Start-Sleep -Seconds 10
    }

    if (-not $started) {
        Write-Log "Failed to start $ServiceName after retries." $logPath
        exit 1
    }

    Write-Log "Compose start succeeded. Service status:" $logPath
    & docker compose @composeArgs ps $ServiceName 2>&1 | Tee-Object -FilePath $logPath -Append | Out-Null
    Write-Log "Watcher completed successfully." $logPath
    exit 0
} finally {
    Pop-Location
}

