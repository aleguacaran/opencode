#!/bin/sh
# Build the latest opencode release and deploy it to the base3 server.
# Produces:
#   - opencode-headless:latest (node-based, runs on any x86-64 — this is what ships to base3)
#   - dist/opencode-linux-x64-baseline.tar.gz (bun single binary; modern CPUs only —
#     base3's Pentium E2160 lacks the required instructions)
# Run again whenever a new version is released (or pass one: ./release.sh 1.19.0).
set -e

SRC_DIR=$(cd "$(dirname "$0")" && pwd)
PROJECT_DIR=$(dirname "$SRC_DIR")
SERVER=base3
HEADLESS=opencode-headless:latest

# 1. Latest version from the npm registry (same source the release tooling uses)
VERSION=${1:-$(curl -fsSL https://registry.npmjs.org/opencode-ai/latest | sed -n 's/.*"version":"\([^"]*\)".*/\1/p' | head -1)}
echo "==> building opencode $VERSION"

# 2. Full build: SDK dist + server bundle + mini (stages .docker-context for the headless image)
docker compose -f "$SRC_DIR/compose.yml" run --rm -e OPENCODE_VERSION="$VERSION" builder

# 3. Release-style single binary (bun baseline, version-stamped tarball)
docker compose -f "$SRC_DIR/compose.yml" run --rm -e BUILD_VERSION="$VERSION" --entrypoint sh builder -c '
  set -e
  apt-get update > /dev/null 2>&1
  apt-get install -y --no-install-recommends libicu-dev curl ca-certificates unzip > /dev/null 2>&1
  curl -fsSL https://bun.sh/install | bash > /dev/null 2>&1
  export PATH="/root/.bun/bin:$PATH"
  cd /app/src/packages/opencode
  if [ -d dist/node ]; then mv dist/node /app/.keep-node; fi
  OPENCODE_VERSION=$BUILD_VERSION bun run script/build.ts --single --baseline --skip-install --skip-embed-web-ui > /tmp/build.log 2>&1 || { tail -15 /tmp/build.log; exit 1; }
  echo BINARY_OK
  if [ -d /app/.keep-node ]; then mkdir -p dist && mv /app/.keep-node dist/node; fi
  tar -czf dist/opencode-linux-x64-baseline.tar.gz -C dist/opencode-linux-x64-baseline/bin opencode
  echo TAR_OK
'

# 4. Build and ship the headless (node-based) image to the server
docker compose -f "$SRC_DIR/compose.yml" build headless
docker save "$HEADLESS" | gzip | ssh -o BatchMode=yes "$SERVER" "docker load"

# 5. Smoke test on the server
ssh -o BatchMode=yes "$SERVER" "docker run --rm $HEADLESS 'say hi in five words'"
echo "==> deployed $HEADLESS (opencode $VERSION) to $SERVER"

# 6. Portable node-based tarball (no bun, no docker image needed): containers
#    download it, extract anywhere, and run ./opencode with node >= 22.
mkdir -p "$PROJECT_DIR/releases"
tar -czf "$PROJECT_DIR/releases/opencode-node-linux-x64.tar.gz" \
  -C "$PROJECT_DIR/.docker-context" --exclude='Dockerfile.mini' opencode packages
echo "==> portable tarball: $PROJECT_DIR/releases/opencode-node-linux-x64.tar.gz"
