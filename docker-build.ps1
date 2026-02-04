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
            $env:$key = $value
        }
    }
}
docker build \
  --build-arg "CLAWDBOT_DOCKER_APT_PACKAGES= $env:CLAWDBOT_DOCKER_APT_PACKAGES " \
  -t "$IMAGE_NAME" \
  -f "$ROOT_DIR/Dockerfile" \
  "$ROOT_DIR"
docker build -t openclaw:local -f Dockerfile . --build-arg CLAWDBOT_DOCKER_APT_PACKAGES="ffmpeg python3 python3-pip"