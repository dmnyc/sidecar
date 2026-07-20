# Vendored code provenance

Sidecar has no build step: what ships is what's committed. Third-party code is
vendored as four bundled files, each traceable to an official artifact published
on registry.npmjs.org. This file records exactly where each bundle comes from so
that anyone can re-derive and verify them — no trust in this repo required.

`scripts/vendor-hashes.sha256` holds the SHA-256 of each vendored file and is
checked by CI on every push and pull request. To verify a checkout yourself:

```sh
sha256sum -c scripts/vendor-hashes.sha256
```

To verify provenance from scratch (or refresh the bundles), run
`scripts/update-vendor.sh`: it downloads the pinned versions below from
registry.npmjs.org, copies the official files into place, rebuilds `nip49.js`,
and rewrites the hash file. After running it against a clean checkout,
`git diff` should be empty.

## The bundles

| File | Package | Upstream file | License | SHA-256 |
|---|---|---|---|---|
| `nostr-tools.js` | [`nostr-tools@2.23.11`](https://www.npmjs.com/package/nostr-tools/v/2.23.11) | `lib/nostr.bundle.js` (byte-exact) | Unlicense | `ad5733e6a9bef26e60f61d712a073ff79263b678d7dcf0c562e26dc389a89562` |
| `nip49.js` | built from `nostr-tools@2.23.11` (see below) | — (reproducible local build) | Unlicense (+ MIT deps) | `bf2f461cfc78120933e1a745697f7a5cc735d535353b38fbba2dbeb96231fd6a` |
| `jsqr.js` | [`jsqr@1.4.0`](https://www.npmjs.com/package/jsqr/v/1.4.0) | `dist/jsQR.js` (byte-exact) | Apache-2.0 | `bc40c8a15196236b2314db0856f72ca0b49980cd5413b8c852a7349f5fee0859` |
| `qrcode-generator.js` | [`qrcode-generator@2.0.4`](https://www.npmjs.com/package/qrcode-generator/v/2.0.4) | `dist/qrcode.js` (byte-exact) | MIT | `79ec86f82856005b1c887905cfccfcfbec3821ca61c7fd5a952faa5f778f791c` |

All licenses are permissive and compatible with this repository's MIT license.
(The previous QR renderer, `qrious`, was GPL-3.0 and has been replaced by
`qrcode-generator` plus the first-party `qr.js` adapter.)

## How `nip49.js` is built

nostr-tools' prebuilt browser bundle doesn't export the NIP-49 module, so
`nip49.js` is bundled by `scripts/update-vendor.sh` from official packages only:

- Entry: `export * from "nostr-tools/nip49";`
- Bundler: `esbuild@0.28.1`, `--bundle --format=iife --global-name=SidecarNip49`
- Input: `nostr-tools@2.23.11`, which pins its own dependencies **exactly**
  (`@noble/ciphers@2.1.1`, `@noble/hashes@2.0.1`, `@scure/base@2.0.0`, …), so
  the entire input set is deterministic and the output is byte-reproducible.
- npm is invoked with `--ignore-scripts`; nothing from the registry executes
  during the build.

Rebuilding with the same pins yields the same SHA-256 as the table above.
The build is verified against the NIP-49 spec test vector
(`ncryptsec1qgg99…` + password `nostr` → `35014541…378683`).

## Updating

1. Edit the version pins at the top of `scripts/update-vendor.sh`.
2. Run the script; review the diff of the regenerated bundles.
3. Update the version/hash table above to match `scripts/vendor-hashes.sha256`.
4. Commit the bundles, the hash file, and this table together — CI fails if
   the files and the hash file ever disagree.
