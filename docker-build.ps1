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
$rootDir = $PSScriptRoot

if (-not $env:OPENCLAW_IMAGE) { $env:OPENCLAW_IMAGE = "openclaw:local" }
if (-not $env:OPENCLAW_DOCKER_APT_PACKAGES) { $env:OPENCLAW_DOCKER_APT_PACKAGES = "" }

$dockerArgs = @(
    "build",
    "--build-arg", "OPENCLAW_DOCKER_APT_PACKAGES=$env:OPENCLAW_DOCKER_APT_PACKAGES",
    "-t", $env:OPENCLAW_IMAGE,
    "-f", (Join-Path $rootDir "Dockerfile"),
    $rootDir
)

& docker @dockerArgs
#docker build -t openclaw:local -f Dockerfile . --build-arg OPENCLAW_DOCKER_APT_PACKAGES="ffmpeg python3 python3-pip"
