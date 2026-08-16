#!/usr/bin/env bash
# Regenerate every vendored JS bundle from pinned, official npm artifacts,
# then refresh scripts/vendor-hashes.sha256 (which CI verifies on every PR).
#
# Three of the four bundles are byte-exact copies of files published on
# registry.npmjs.org. The fourth (nip49.js) is built here, reproducibly, from
# pinned packages — nostr-tools' prebuilt browser bundle doesn't export nip49.
#
# Two gates before anything in the repo is touched:
#   1. Each tarball's sha512 is checked against the registry's dist.integrity
#      for the pinned version, before it is extracted.
#   2. The finished bundles are staged and hash-compared against the committed
#      scripts/vendor-hashes.sha256. An unexpected change aborts the run with
#      the tree untouched; after a deliberate version bump, re-run with
#      --accept-hash-change to record the new hashes.
#
# Requires: bash, curl, tar, openssl, node/npm (npm is used with --ignore-scripts only).
# See VENDOR.md for the provenance table and verification instructions.
set -euo pipefail

NOSTR_TOOLS_VERSION=2.23.11
JSQR_VERSION=1.4.0
QRCODE_GENERATOR_VERSION=2.0.4
ESBUILD_VERSION=0.28.1

ACCEPT_HASH_CHANGE=0
[ "${1:-}" = "--accept-hash-change" ] && ACCEPT_HASH_CHANGE=1

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
STAGE="$WORK/stage"
trap 'rm -rf "$WORK"' EXIT

fetch() { # fetch <package> <version> → verified tarball extracted to $WORK/<package>/
  local want actual
  want="$(npm view "$1@$2" dist.integrity | tr -d '"')"
  if [ -z "$want" ]; then
    echo "Could not read dist.integrity for $1@$2 from the npm registry." >&2
    exit 1
  fi
  curl -fsSL "https://registry.npmjs.org/$1/-/$1-$2.tgz" -o "$1.tgz"
  actual="sha512-$(openssl dgst -sha512 -binary "$1.tgz" | openssl base64 -A)"
  if [ "$actual" != "$want" ]; then
    echo "Integrity mismatch for the $1@$2 tarball — not extracting it:" >&2
    echo "  registry: $want" >&2
    echo "  download: $actual" >&2
    exit 1
  fi
  mkdir -p "$1"
  tar xzf "$1.tgz" -C "$1" --strip-components=1
}

cd "$WORK"
echo "Fetching official npm artifacts (each tarball verified against registry dist.integrity)…"
fetch nostr-tools "$NOSTR_TOOLS_VERSION"
fetch jsqr "$JSQR_VERSION"
fetch qrcode-generator "$QRCODE_GENERATOR_VERSION"

mkdir -p "$STAGE"
cp nostr-tools/lib/nostr.bundle.js "$STAGE/nostr-tools.js"
cp jsqr/dist/jsQR.js "$STAGE/jsqr.js"
cp qrcode-generator/dist/qrcode.js "$STAGE/qrcode-generator.js"

echo "Building nip49.js (reproducible: pinned nostr-tools + esbuild; nostr-tools"
echo "pins its own deps exactly, so the whole input set is deterministic)…"
mkdir nip49-build
cd nip49-build
npm init -y >/dev/null 2>&1
npm install --ignore-scripts --no-audit --no-fund --save-exact \
  "nostr-tools@$NOSTR_TOOLS_VERSION" "esbuild@$ESBUILD_VERSION" >/dev/null
printf 'export * from "nostr-tools/nip49";\n' > entry.js
npx esbuild entry.js --bundle --format=iife --global-name=SidecarNip49 \
  --outfile="$STAGE/nip49.js"

# Hash the staged bundles with bare filenames (the shape CI verifies from the
# repo root), then gate on a diff against what's committed.
cd "$STAGE"
sha256sum nostr-tools.js nip49.js jsqr.js qrcode-generator.js > "$WORK/vendor-hashes.new"
if [ -f "$ROOT/scripts/vendor-hashes.sha256" ] &&
   ! diff -u "$ROOT/scripts/vendor-hashes.sha256" "$WORK/vendor-hashes.new"; then
  if [ "$ACCEPT_HASH_CHANGE" -ne 1 ]; then
    echo
    echo "Refusing to overwrite the vendored bundles: their hashes changed." >&2
    echo "Nothing in the repo was modified." >&2
    echo
    echo "If this follows a deliberate version bump above, re-run with:" >&2
    echo "  scripts/update-vendor.sh --accept-hash-change" >&2
    exit 1
  fi
  echo "Hash change accepted (--accept-hash-change); recording the new hashes."
fi

cd "$ROOT"
cp "$WORK/vendor-hashes.new" scripts/vendor-hashes.sha256
cp "$STAGE/nostr-tools.js" "$STAGE/nip49.js" "$STAGE/jsqr.js" "$STAGE/qrcode-generator.js" .
echo
echo "Vendored bundles refreshed. Recorded hashes:"
cat scripts/vendor-hashes.sha256
echo
echo "If any file changed, update the version table in VENDOR.md to match."
