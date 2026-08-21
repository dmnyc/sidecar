# Build and verification instructions for reviewers

This document accompanies the source-code submission for Sidecar on
addons.mozilla.org. It explains exactly how the uploaded add-on package is
produced, how to reproduce it byte-for-byte, and where every piece of
machine-generated code comes from.

**Short version:** Sidecar has no build step. The extension is plain JavaScript,
loaded as classic scripts. What ships is what is committed, with two exceptions,
both documented below: four vendored third-party bundles, and a generated
one-line `version.js`.

---

## 1. Toolchain

Reproducing the add-on package needs only:

| Tool | Purpose | Version |
|---|---|---|
| `git` | checkout, archive | any recent |
| `bash`, `zip`, `find`, `touch` | packaging | any recent |
| `node` + `npm` | *only* to re-derive the vendored bundles (§4) | node ≥ 18 |

No compiler, transpiler, or bundler runs at package time. `node` is needed only
if you want to independently re-derive the vendored files; it is not required to
reproduce the package itself.

## 2. Reproduce the submitted package

From a clean checkout of this repository at the release tag:

```sh
git checkout v<VERSION>
scripts/package.sh v<VERSION>
```

This writes two files:

- `dist/sidecar-<VERSION>-firefox.zip` — the AMO package
- `dist/sidecar-<VERSION>.zip` — the Chrome package

The build is deterministic. Every file is stamped with the tag's commit date in
UTC and entries are added in sorted order, so the same tag produces the same
bytes on any machine. The SHA-256 printed by the script should match the one
published in this release's GitHub release notes, and the file you were sent.

> Packages for version 1.9.1 and earlier were built before determinism was added.
> For those, extract both archives and compare the contents; they will be
> identical, but the archive bytes will differ because file mtimes came from the
> moment of packaging.

## 3. What `package.sh` does

It is a copy-and-prune, not a build:

1. `git archive <tag>` extracts the repository at the tag.
2. Development-only paths are deleted: `.github/`, `scripts/`, `assets/`,
   `test/`, `docs/`, `.claude/`, and the top-level Markdown files
   (`README.md`, `CHANGELOG.md`, `PRIVACY.md`, and the rest), plus
   `package.json`.
3. `version.js` is generated — a single line recording the version and commit,
   shown in the About dialog. It is the only generated first-party file.
4. `manifest.json` is reduced to one browser's keys. The repository keeps the
   union of both browsers' manifest keys so the extension can be loaded unpacked
   in either browser without a build step. At package time the Firefox zip drops
   `side_panel`, `minimum_chrome_version`, `externally_connectable`, the
   `sidePanel` permission, and `background.service_worker`; the Chrome zip drops
   `sidebar_action`, `browser_specific_settings`, and `background.scripts`. No
   other file is modified.
5. The result is zipped.

No file contents are otherwise transformed. Every `.js` file in the package is
byte-identical to the same file in this repository at the tag, except
`version.js`.

## 4. Vendored third-party code

Four files in the package are third-party bundles rather than hand-written
source. They are the reason this source submission exists.

| File | Origin | Modified? |
|---|---|---|
| `nostr-tools.js` | `nostr-tools@2.23.11`, `lib/nostr.bundle.js` from npm | No — byte-exact copy |
| `jsqr.js` | `jsqr@1.4.0`, `dist/jsQR.js` from npm | No — byte-exact copy |
| `qrcode-generator.js` | `qrcode-generator@2.0.4`, `dist/qrcode.js` from npm | No — byte-exact copy |
| `nip49.js` | built here with `esbuild@0.28.1` from `nostr-tools@2.23.11` | Generated, see below |

None of the four are minified or obfuscated. They are readable bundler output,
shipped as published upstream.

**`nip49.js` is the only file we generate ourselves.** nostr-tools' prebuilt
browser bundle does not export its NIP-49 module, so it is bundled separately
from the same pinned package:

- entry point: `export * from "nostr-tools/nip49";`
- command: `esbuild entry.js --bundle --format=iife --global-name=SidecarNip49`

### Re-deriving and verifying all four

```sh
scripts/update-vendor.sh
git diff          # expected to be empty
```

`scripts/update-vendor.sh` downloads each pinned package from
`registry.npmjs.org`, verifies each tarball's SHA-512 against the registry's own
`dist.integrity` value *before extracting it*, copies the three byte-exact files
into place, rebuilds `nip49.js` with the pinned esbuild, and compares the results
against the committed hashes. An unexpected change aborts with the tree
untouched.

To check the committed files without network access:

```sh
sha256sum -c scripts/vendor-hashes.sha256
```

These hashes are also verified by CI on every push and pull request.
`VENDOR.md` carries the same provenance table with the expected hashes and
license for each file.

## 5. Things that may look like minified code and are not

A handful of first-party lines are very long. All of them are **inline SVG path
data** for icons and illustrations, embedded as string literals so the extension
makes no network requests and needs no image assets:

| File | Line | Content |
|---|---|---|
| `welcome.js` | 282 | app logo, inline `<svg>` |
| `wallets.js` | 38 | wallet logo, inline `<svg>` |
| `sidepanel.js` | 89 | decorative icon `<g>` element |
| `pdf-backup.js` | 556 | illustration path data for the printable backup sheet |
| `content.js` | 349–353 | logo path data |

Every one is a single string of SVG coordinates. No first-party JavaScript in
this repository is minified, transpiled, concatenated, or otherwise
machine-generated.

## 6. Remote code

None. Sidecar loads and executes no remote code. There is no `eval`, no
dynamically constructed script, and no code fetched at runtime. All scripts are
classic `<script src="...">` or `importScripts()` references to files inside the
package.

Network access is limited to: user-configured Nostr relays over WebSocket,
user-configured Lightning wallet relays (NWC, also WebSocket), user-configured
Blossom media servers for uploads the user initiates, and link-preview or avatar
fetches for content the user is viewing. There is no analytics, telemetry, or
error reporting of any kind. `PRIVACY.md` in the source package documents this in
full.

## 7. Questions

The complete source, including this file, is at
<https://github.com/dmnyc/sidecar> under the MIT license. Every released version
is tagged, and each GitHub release carries the same packages submitted to the
stores along with their SHA-256 hashes.
