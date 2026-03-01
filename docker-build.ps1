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

# Voice/image presets:
# - voice-lite (default): small voice-capable image (ffmpeg only, no bundled offline STT/TTS models)
# - voice-full: heavier image with python/pip for faster-whisper and optional Piper
if (-not $env:OPENCLAW_VOICE_PROFILE) { $env:OPENCLAW_VOICE_PROFILE = "voice-lite" }

$profile = $env:OPENCLAW_VOICE_PROFILE.ToLowerInvariant()
if (($profile -ne "voice-lite") -and ($profile -ne "voice-full")) {
    throw "Unsupported OPENCLAW_VOICE_PROFILE '$($env:OPENCLAW_VOICE_PROFILE)'. Use 'voice-lite' or 'voice-full'."
}

if (-not $env:OPENCLAW_IMAGE) { $env:OPENCLAW_IMAGE = "openclaw:audio" }

# If caller did not explicitly set OPENCLAW_DOCKER_APT_PACKAGES, choose profile defaults.
if ([string]::IsNullOrEmpty($env:OPENCLAW_DOCKER_APT_PACKAGES)) {
    if ($profile -eq "voice-full") {
        $env:OPENCLAW_DOCKER_APT_PACKAGES = "ffmpeg python3 python3-pip"
    } else {
        $env:OPENCLAW_DOCKER_APT_PACKAGES = "ffmpeg"
    }
}

# Piper defaults can be overridden via env.
# voice-lite: disable Piper
# voice-full: enable Piper binary, keep voice model optional/off by default
if ([string]::IsNullOrEmpty($env:OPENCLAW_INSTALL_PIPER)) {
    $env:OPENCLAW_INSTALL_PIPER = if ($profile -eq "voice-full") { "1" } else { "0" }
}
if ([string]::IsNullOrEmpty($env:OPENCLAW_INSTALL_PIPER_VOICE)) {
    $env:OPENCLAW_INSTALL_PIPER_VOICE = "0"
}

$dockerArgs = @(
    "build",
    "--build-arg", "OPENCLAW_DOCKER_APT_PACKAGES=$env:OPENCLAW_DOCKER_APT_PACKAGES",
    "--build-arg", "INSTALL_PIPER=$env:OPENCLAW_INSTALL_PIPER",
    "--build-arg", "INSTALL_PIPER_VOICE=$env:OPENCLAW_INSTALL_PIPER_VOICE",
    "-t", $env:OPENCLAW_IMAGE,
    "-f", (Join-Path $rootDir "Dockerfile"),
    $rootDir
)

Write-Host "Building profile: $profile"
Write-Host "Image tag: $($env:OPENCLAW_IMAGE)"
Write-Host "APT packages: $($env:OPENCLAW_DOCKER_APT_PACKAGES)"
Write-Host "INSTALL_PIPER: $($env:OPENCLAW_INSTALL_PIPER)"
Write-Host "INSTALL_PIPER_VOICE: $($env:OPENCLAW_INSTALL_PIPER_VOICE)"

& docker @dockerArgs
# Examples:
# $env:OPENCLAW_VOICE_PROFILE="voice-lite"; .\docker-build.ps1
# $env:OPENCLAW_VOICE_PROFILE="voice-full"; .\docker-build.ps1
