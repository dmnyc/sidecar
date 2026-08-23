#!/usr/bin/env bash
# Builds the source-code archive that accompanies an AMO submission.
#
# AMO requires a source submission for any add-on containing machine-generated
# code. Sidecar has no build step for its own code, but it ships four vendored
# third-party bundles — three copied byte-exact from npm, and nip49.js which is
# built here with esbuild. That is enough to require this, and Mozilla has asked
# for it directly, so it is uploaded with every AMO submission unconditionally
# rather than argued about per release.
#
# The archive is the repository at the tag: all first-party source, the vendoring
# and packaging scripts, the tests, and REVIEWERS.md (the build and verification
# instructions). The standard it has to meet is that a reviewer can reproduce the
# submitted package from this archive alone — so everything that produces,
# verifies, or documents a shipped file is in it.
#
# The only things held back are local tooling config and docs a reviewer would be
# actively misled by (see EXCLUDE below). Nothing that affects the build is
# removed, and REVIEWERS.md §8 lists the exclusions rather than leaving a reviewer
# to notice the gap — a source archive that quietly omits things is worse than one
# that omits nothing.
#
# Deterministic, like scripts/package.sh: same tag in, same bytes out.
#
# Usage: scripts/package-source.sh [vX.Y.Z]   (default: the manifest's version)
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"

MANIFEST_VERSION=$(grep -m1 '"version"' manifest.json | sed -E 's/.*"version"[^"]*"([^"]+)".*/\1/')
TAG="${1:-v${MANIFEST_VERSION}}"

if ! git rev-parse --verify --quiet "refs/tags/${TAG}" >/dev/null; then
  echo "Tag '${TAG}' not found. Usage: scripts/package-source.sh [vX.Y.Z]" >&2
  exit 1
fi

VERSION_NO_V="${TAG#v}"
OUT="dist/sidecar-${VERSION_NO_V}-source.zip"
SOURCE_DATE=$(TZ=UTC git log -1 --format=%cd --date=format-local:'%Y%m%d%H%M.%S' "${TAG}^{commit}")

STAGE="$(mktemp -d)/sidecar-${VERSION_NO_V}-source"
trap 'rm -rf "$(dirname "$STAGE")"' EXIT
mkdir -p "${STAGE}"
git archive "${TAG}" | tar -x -C "${STAGE}"

if [ ! -f "${STAGE}/REVIEWERS.md" ]; then
  echo "REVIEWERS.md is not present at ${TAG}. The source archive is not much use" >&2
  echo "without the build instructions — commit it before tagging." >&2
  exit 1
fi

# Held back from the archive. Two kinds, and nothing else qualifies:
#
#   Local tooling config — not source for anything that ships, not read by any
#   build step, and of no use to a reviewer.
#
#   Superseded docs — a doc that describes a state the code left behind costs a
#   reviewer time and can actively mislead. FIREFOX_PORT.md is a port PLAN whose
#   own status line reads "DONE. Shipped in 1.5.0"; BROWSER_PARITY.md replaced it
#   and describes the build that actually exists. The 1.8.0 release copy is store
#   text for a version two releases back.
#
# Everything that produces or verifies a shipped file stays, including docs that
# still describe live code: docs/relay-doctor.md (documents a shipped script) and
# docs/security-audit-2026-08-14.md (the current posture, remediated in 1.9.1) are
# deliberately IN. If you add to this list, add the reason, and update REVIEWERS.md §8.
EXCLUDE=(
  .claude
  CLAUDE.md
  FIREFOX_PORT.md
  docs/release-1.8.0-description.md
  docs/release-1.8.0-guide.md
)
for path in "${EXCLUDE[@]}"; do
  rm -rf "${STAGE:?}/${path}"
done

mkdir -p dist
rm -f "${ROOT}/${OUT}"
find "${STAGE}" -exec touch -t "${SOURCE_DATE}" {} +
( cd "$(dirname "${STAGE}")" && find . -type f | LC_ALL=C sort | zip -qXD "${ROOT}/${OUT}" -@ )

files=$(unzip -Z1 "${ROOT}/${OUT}" | grep -vc '/$')
sha=$(shasum -a 256 "${ROOT}/${OUT}" | awk '{print $1}')
echo "Built ${OUT}"
echo "  files:   ${files}"
echo "  sha256:  ${sha}"
echo
echo "Upload this alongside the add-on package, and paste the contents of"
echo "REVIEWERS.md (or a link to it) into the build-instructions field."
