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
UNICODE_EMOJI_JSON_VERSION=0.9.0
EMOJIBASE_DATA_VERSION=17.0.0

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
fetch unicode-emoji-json "$UNICODE_EMOJI_JSON_VERSION"
fetch emojibase-data "$EMOJIBASE_DATA_VERSION"

mkdir -p "$STAGE"
cp nostr-tools/lib/nostr.bundle.js "$STAGE/nostr-tools.js"
cp jsqr/dist/jsQR.js "$STAGE/jsqr.js"
cp qrcode-generator/dist/qrcode.js "$STAGE/qrcode-generator.js"

# emoji-data.js is REDUCED rather than copied, which makes it the second built
# bundle here. It is also the one JOIN: names come from unicode-emoji-json, search
# keywords from emojibase-data, and neither ships both.
#
# The published data-by-group.json carries a unicode_version, an emoji_version, a
# slug and a skin-tone flag per emoji, 838KB of it, and the reaction picker needs the
# character, a name to search, and the group it sits in.
#
# KEYWORDS ARE NOT OURS TO INVENT. Names are descriptions of pictures: a face people
# would call "happy" is named "grinning face", so searching by how you feel found
# nothing at all. emojibase carries CLDR 48's annotation keywords (UTS #35), which is
# Unicode's own vocabulary for exactly this, under MIT. Joined on the character with
# VS16 normalized away, because the two sets disagree about it for 152 emoji. The join
# is total today, and the check below fails the build rather than shipping a table
# where some emoji silently lost their keywords.
#
# Only keywords the name does not already contain are kept: the search reads both, so
# storing "pizza" twice would be paying bytes for nothing.
#
# Deterministic: both inputs are pinned tarballs already verified against the
# registry's integrity hashes above, the order is the source file's own (CLDR order,
# the order a picker should show), and JSON.stringify of the same structure is stable.
node -e '
  const src = require("./unicode-emoji-json/data-by-group.json");
  const eb = require("./emojibase-data/en/compact.json");
  const bare = (s) => s.replace(/\uFE0F/g, "");
  const kw = new Map();
  for (const e of eb) kw.set(bare(e.unicode), (e.tags || []).map((t) => String(t).toLowerCase()));
  let joined = 0;
  const packed = src.map((g) => [g.name, g.emojis.map((e) => {
    const tags = kw.get(bare(e.emoji));
    if (tags) joined++;
    const lower = e.name.toLowerCase();
    const extra = (tags || []).filter((t) => !lower.includes(t));
    return extra.length ? [e.emoji, e.name, extra.join(" ")] : [e.emoji, e.name];
  })]);
  const count = packed.reduce((n, g) => n + g[1].length, 0);
  if (joined !== count) {
    console.error("Keyword join is incomplete: " + joined + " of " + count + " emoji matched.");
    process.exit(1);
  }
  process.stdout.write(
    "// Emoji table for the reaction picker. GENERATED, do not edit.\n" +
    "//\n" +
    "// Sources: unicode-emoji-json@'"$UNICODE_EMOJI_JSON_VERSION"' (data-by-group.json) for the\n" +
    "// characters, names and groups; emojibase-data@'"$EMOJIBASE_DATA_VERSION"' (en/compact.json) for\n" +
    "// the search keywords, which are CLDR 48 annotations. Reduced and joined by\n" +
    "// scripts/update-vendor.sh; scripts/vendor-hashes.sha256 pins the result.\n" +
    "//\n" +
    "// Shape: [[groupName, [[char, name, keywords?], ...]], ...] with " + count + " emoji in " +
    packed.length + " groups,\n" +
    "// kept in the order the source file uses, which is CLDR order: what a picker shows.\n" +
    "// keywords is a space-separated string, present only where it adds words the name\n" +
    "// does not already carry.\n" +
    "self.SidecarEmoji = " + JSON.stringify(packed) + ";\n"
  );
' > "$STAGE/emoji-data.js"

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
sha256sum nostr-tools.js nip49.js jsqr.js qrcode-generator.js emoji-data.js > "$WORK/vendor-hashes.new"
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
cp "$STAGE/nostr-tools.js" "$STAGE/nip49.js" "$STAGE/jsqr.js" "$STAGE/qrcode-generator.js" \
   "$STAGE/emoji-data.js" .
echo
echo "Vendored bundles refreshed. Recorded hashes:"
cat scripts/vendor-hashes.sha256
echo
echo "If any file changed, update the version table in VENDOR.md to match."
