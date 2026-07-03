# FILE: linux-build.Dockerfile
# Purpose: Linux build host for `bun run dist:desktop:linux`, for use on non-Linux
# development machines (e.g. building a Linux desktop artifact from macOS via Docker).
# node-pty is a native addon, so it must be installed/compiled inside a real Linux
# environment matching the target architecture — see validateDesktopNativeBuildHost
# in scripts/lib/desktop-platform-build-config.ts.

FROM oven/bun:1.3.12-debian

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    python3 \
    make \
    g++ \
    git \
    fakeroot \
    && curl -fsSL https://deb.nodesource.com/setup_24.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace
