#!/usr/bin/env bash
# Files the PREVIOUS release's artifacts and working docs under archive/<version>/,
# leaving only the version being packaged loose at the top of dist/ and store/.
#
# Both directories are gitignored, so nothing here touches the repo. It runs from
# package.sh rather than living in a checklist, because a step somebody has to
# remember is a step that gets skipped on the one busy night it mattered.
#
# Moves only, never deletes. Every artifact except a local pre-release build is
# also a published GitHub release asset, but this script has no way to check that
# and should not act as though it can.
#
# Usage: scripts/archive-release.sh X.Y.Z    (the version being packaged: KEPT at root)
set -euo pipefail

KEEP="${1:?usage: archive-release.sh X.Y.Z (the version being packaged)}"
KEEP="${KEEP#v}"
cd "$(dirname "$0")/.."

moved=0
for dir in dist store; do
  [ -d "$dir" ] || continue
  for path in "$dir"/*; do
    [ -f "$path" ] || continue
    file="$(basename "$path")"

    # The version this file belongs to, from its own name. A file with no version
    # in it is not ours to file, so it stays put.
    ver="$(printf '%s' "$file" | grep -oE '[0-9]+\.[0-9]+\.([0-9]+|x)' | head -1 || true)"
    [ -n "$ver" ] || continue
    [ "$ver" = "$KEEP" ] && continue

    # A 1.5.x doc covers the 1.5 line; file it with 1.5.0 rather than alone.
    ver="${ver%.x}"; case "$ver" in *.*.*) ;; *) ver="$ver.0" ;; esac

    dest="$dir/archive/$ver"
    mkdir -p "$dest"
    # Fail closed: an existing file at the destination means two different builds
    # share a name, and silently overwriting one is how the other disappears.
    if [ -e "$dest/$file" ]; then
      echo "archive-release: $dest/$file already exists, leaving $path alone" >&2
      continue
    fi
    mv "$path" "$dest/$file"
    moved=$((moved + 1))
  done
done

echo "archive-release: filed ${moved} file(s); ${KEEP} stays at the top of dist/ and store/"
