#!/usr/bin/env bash
# Regenerate every vendored JS bundle from pinned, official npm artifacts,
# then refresh scripts/vendor-hashes.sha256 (which CI verifies on every PR).
#
# Three of the four bundles are byte-exact copies of files published on
# registry.npmjs.org. The fourth (nip49.js) is built here, reproducibly, from
# pinned packages — nostr-tools' prebuilt browser bundle doesn't export nip49.
#
# Requires: bash, curl, tar, node/npm (npm is used with --ignore-scripts only).
# See VENDOR.md for the provenance table and verification instructions.
set -euo pipefail

NOSTR_TOOLS_VERSION=2.23.11
JSQR_VERSION=1.4.0
QRCODE_GENERATOR_VERSION=2.0.4
ESBUILD_VERSION=0.28.1

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
cd "$WORK"

fetch() { # fetch <package> <version> → extracted to $WORK/<package>/
  curl -fsSL "https://registry.npmjs.org/$1/-/$1-$2.tgz" -o "$1.tgz"
  mkdir -p "$1"
  tar xzf "$1.tgz" -C "$1" --strip-components=1
}

echo "Fetching official npm artifacts…"
fetch nostr-tools "$NOSTR_TOOLS_VERSION"
fetch jsqr "$JSQR_VERSION"
fetch qrcode-generator "$QRCODE_GENERATOR_VERSION"

cp nostr-tools/lib/nostr.bundle.js "$ROOT/nostr-tools.js"
cp jsqr/dist/jsQR.js "$ROOT/jsqr.js"
cp qrcode-generator/dist/qrcode.js "$ROOT/qrcode-generator.js"

echo "Building nip49.js (reproducible: pinned nostr-tools + esbuild; nostr-tools"
echo "pins its own deps exactly, so the whole input set is deterministic)…"
mkdir nip49-build
cd nip49-build
npm init -y >/dev/null 2>&1
npm install --ignore-scripts --no-audit --no-fund --save-exact \
  "nostr-tools@$NOSTR_TOOLS_VERSION" "esbuild@$ESBUILD_VERSION" >/dev/null
printf 'export * from "nostr-tools/nip49";\n' > entry.js
npx esbuild entry.js --bundle --format=iife --global-name=SidecarNip49 \
  --outfile="$ROOT/nip49.js"

cd "$ROOT"
sha256sum nostr-tools.js nip49.js jsqr.js qrcode-generator.js > scripts/vendor-hashes.sha256
echo
echo "Vendored bundles refreshed. Recorded hashes:"
cat scripts/vendor-hashes.sha256
echo
echo "If any file changed, update the version table in VENDOR.md to match."
