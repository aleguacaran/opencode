#!/usr/bin/env bash
# Install the latest node-based opencode release from GitHub releases.
#
# Usage: install-opencode.sh [DEST]        (default DEST: /opt/opencode)
#
# Downloads the newest `node-v<version>` release from
# https://github.com/aleguacaran/opencode/releases, verifies it against the
# sha256 digest reported by the GitHub API, and extracts the launcher
# (`opencode`) plus its `packages/` tree into DEST. Requires curl and tar;
# the installed binary needs node >= 22 at runtime.
#
# The launcher resolves its packages relative to its own location, so install
# it to a real directory (not behind a symlink) and put that directory on PATH.

set -euo pipefail

REPO="aleguacaran/opencode"
ASSET="opencode-node-linux-x64.tar.gz"
DEST="${1:-/opt/opencode}"

command -v curl >/dev/null || { echo "error: curl is required" >&2; exit 1; }
command -v tar >/dev/null || { echo "error: tar is required" >&2; exit 1; }

# Resolve the latest release asset URL and its digest from the GitHub API.
json=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest")
url=$(printf '%s' "$json" | tr ',' '\n' | sed -n "s/.*\"browser_download_url\": *\"\([^\"]*\)\".*/\1/p")
digest=$(printf '%s' "$json" | tr ',' '\n' | sed -n "s/.*\"digest\": *\"\([^\"]*\)\".*/\1/p")
[ -n "$url" ] || { echo "error: could not resolve the latest release asset" >&2; exit 1; }

# Download and verify against the digest reported by the API.
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
echo "Downloading $url"
curl -fsSL -o "$tmp/$ASSET" "$url"
actual=$(sha256sum "$tmp/$ASSET" | cut -d' ' -f1)
expected=${digest#sha256:}
if [ -n "$expected" ] && [ "$actual" != "$expected" ]; then
  echo "error: sha256 mismatch (expected $expected, got $actual)" >&2
  exit 1
fi

# Extract into a staging dir and swap into place so reinstalls are clean.
rm -rf "$DEST.new"
mkdir -p "$DEST.new"
tar -xzf "$tmp/$ASSET" -C "$DEST.new"
rm -rf "$DEST"
mv "$DEST.new" "$DEST"

if command -v node >/dev/null; then
  echo "Installed opencode $("$DEST/opencode" --version) to $DEST/opencode"
else
  echo "Installed to $DEST/opencode (node not present at install time; skipped smoke test)"
fi
