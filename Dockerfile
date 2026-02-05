FROM node:22-bookworm

# Install Bun (required for build scripts)
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"

RUN corepack enable
WORKDIR /app

ARG OPENCLAW_DOCKER_APT_PACKAGES=""
RUN if [ -n "$OPENCLAW_DOCKER_APT_PACKAGES" ]; then \
  apt-get update && \
  DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends $OPENCLAW_DOCKER_APT_PACKAGES && \
  apt-get clean && \
  rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*; \
fi 

# ---- Speech-to-text (CPU): faster-whisper (pinned) ----
# Install as root so it's available at runtime regardless of USER.
# (If python3/pip not installed via OPENCLAW_DOCKER_APT_PACKAGES, this step will fail.)
ARG FASTER_WHISPER_VERSION="1.0.3"
ARG SOUNDFILE_VERSION="0.12.1"
RUN if command -v pip3 >/dev/null 2>&1; then \
  pip3 install --no-cache-dir  --break-system-packages \
    "faster-whisper==${FASTER_WHISPER_VERSION}" \
    "soundfile==${SOUNDFILE_VERSION}"; \
fi

# ---- Optional offline TTS: Piper (binary) ----
# Enable by passing: --build-arg INSTALL_PIPER=1
ARG INSTALL_PIPER="0"
ARG PIPER_VERSION="1.2.0"
# Optional: set this to a real sha256 to verify the download.
# If empty, checksum verification is skipped.
ARG PIPER_SHA256_X86_64=""
RUN if [ "${INSTALL_PIPER}" = "1" ]; then \
  set -eux; \
  arch="$(uname -m)"; \
  case "$arch" in \
    x86_64)  piper_arch="x86_64"; piper_sha="${PIPER_SHA256_X86_64}" ;; \
    aarch64) piper_arch="aarch64"; piper_sha="" ;; \
    *) echo "unsupported arch: $arch" && exit 1 ;; \
  esac; \
  mkdir -p /opt/piper; \
  curl -L -o /tmp/piper.tar.gz "https://github.com/rhasspy/piper/releases/download/v${PIPER_VERSION}/piper_${piper_arch}.tar.gz"; \
  if [ -n "${piper_sha}" ]; then echo "${piper_sha}  /tmp/piper.tar.gz" | sha256sum -c -; fi; \
  tar -xzf /tmp/piper.tar.gz -C /opt/piper; \
  rm -f /tmp/piper.tar.gz; \
  ln -sf /opt/piper/piper /usr/local/bin/piper; \
fi

# Optional: bake in one Piper voice model (so no downloads later)
# Enable by passing: --build-arg INSTALL_PIPER_VOICE=1
ARG INSTALL_PIPER_VOICE="0"
RUN if [ "${INSTALL_PIPER}" = "1" ] && [ "${INSTALL_PIPER_VOICE}" = "1" ]; then \
  set -eux; \
  mkdir -p /opt/piper/voices; \
  curl -L -o /opt/piper/voices/en_US-lessac-medium.onnx \
    "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx"; \
  curl -L -o /opt/piper/voices/en_US-lessac-medium.onnx.json \
    "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json"; \
fi

# ---- Build app ----
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY ui/package.json ./ui/package.json
COPY patches ./patches
COPY scripts ./scripts
RUN pnpm install --frozen-lockfile

COPY . .
RUN OPENCLAW_A2UI_SKIP_MISSING=1 pnpm build

# Force pnpm for UI build (Bun may fail on ARM/Synology architectures)
ENV OPENCLAW_PREFER_PNPM=1
RUN pnpm ui:build

ENV NODE_ENV=production



# 1. Install dependencies as root
RUN apt-get update && apt-get install -y sudo git curl procps && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# 2. Create the Homebrew directory and give ownership to the 'node' user
RUN mkdir -p /home/linuxbrew/.linuxbrew && \
    chown -R node:node /home/linuxbrew/.linuxbrew
# (Continue with your chown or other node-user tasks...)
RUN chown -R node:node /app /home/node /tmp

# 3. Switch to the non-root user for the Homebrew installation
USER node

# 4. Install Homebrew
RUN NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# 5. Set up Environment Paths (this works for the rest of the Dockerfile and the final image)
ENV PATH="/home/linuxbrew/.linuxbrew/bin:/home/linuxbrew/.linuxbrew/sbin:${PATH}"




CMD ["node", "dist/index.js", "gateway", "--allow-unconfigured"]