# Security review — the 1.9.1 → 1.10.0 range

Pre-submission scan of every commit between `v1.9.1` and the 1.10.0 release
tip: PRs #218–#236 (17 merged PRs, 56 files, ~7,200 insertions). The heavy
files by volume are themes and balance animation (CSS/SVG only); this review
covers every surface where the change could affect trust, money, or secrets.

Method: file-by-file diff of the range with a focus on the background message
boundary, the content-script boundary, the keystore, spend paths, signing
prompts, and anything that turns relay-controlled data into DOM. Each finding
below names the PR and states the verdict.

## Vault and keys

**Key slots migration (#220).** One random DEK now encrypts every payload and
each unlock factor wraps the DEK. Reviewed: migration is a single atomic write
with every secret decrypted back out of the *new* ciphertext and compared
byte-for-byte before anything persists; an abort leaves v1 intact. The v1
backup (`sidecar_keystore_v1_backup`) holds no new information — it is a copy
of the store that already existed — and is cleared on the first clean v2
unlock. `listSlots` exposes no wrapped material or salts (asserted by test).
The session key in `storage.session` still never touches disk. **Verdict: sound.**

**NWC re-wrap on PIN change (#218).** The bug was availability, not
confidentiality: the old ciphertext became unreadable, which fails secure. The
fix re-wraps through the slot layer's single re-wrap point, so the class of
"forgot one wrap site" is gone structurally. Test coverage in
`nwc-rewrap.test.js`. **Verdict: sound.**

## Spend paths

**Connected-site requirement for auto-pay (#235).** The money-moving function
now fails closed on the site binding itself, before the zap-record check,
rather than depending on the content-script UI gate and the host-scoping of
zap records. Tested with the zap-record stub answering *yes* on an unbound
host, proving the new gate is what declines. **Verdict: strengthens.**

**Copied-invoice detection (#223).** The provider wraps `clipboard.writeText`
in the page world and observes what the page *writes* — it never reads the
clipboard, so no new permission and no cross-page disclosure. The observation
is regex-shaped to BOLT11 and forwarded over `postMessage`; the content script
re-validates (regex + expiry) because the channel is page-controlled, and the
card itself renders only on connected sites with the same approval/budget
gates as any payment. A page spoofing the message can do no more than a page
embedding an invoice in its own DOM already could. **Verdict: no new exposure.**

**Lightning address resolution in Send (#221).** The panel fetches
`https://<domain>/.well-known/lnurlp/<name>` for a user-entered address. The
response is parsed as payment parameters and never rendered. Two notes: it is
https-only and user-initiated; and unlike the QR-image path it does not route
through the background's `safeFetchUrl` SSRF guard. Because the caller is an
extension page with broad host permissions, a deliberately crafted address
could use the panel as a reachability oracle for internal https endpoints —
the same trust a user extends to any LNURL-capable wallet when they paste an
address. **Verdict: accepted, noted.** (Hardening option for a later release:
route through `safeFetchUrl` like the QR path.)

## Signing and approval surface

**Request-shape settlement (#219).** `signEvent` params are validated at the
RPC boundary; an unparseable request can no longer reach an approval card as a
blank with Allow looking ordinary, and the composer derives the `q` tags a
proper quote needs. Approval-kind isolation covered by test. **Verdict:
strengthens.**

## Relay-controlled data into the DOM

**Notification mute lists (#233, #234).** Mute-list events, decrypted private
halves, sender profiles, and note snippets all flow into the DOM through
`textContent` and constructed nodes; no `innerHTML` handles relay data. Word
matching is case-folded and boundary-aware; nothing from the list is executed.
Decrypt failure on a private list keeps the public half applied — a relay can
serve a *stale* signed mute list (rollback), the same inherent property of any
replaceable event and unchanged by this work. **Verdict: sound.**

**Bookmarks (#230).** NIP-51 list events and the events they reference render
via `textContent`/`title` attributes; profile pictures load with
`referrerPolicy = no-referrer` like the rest of the panel. **Verdict: sound.**

**Profile links.** The bio linkifier only matches `https?://` URLs, so an
anchor's scheme can never be `javascript:`; npub mentions link to a fixed
prefix. **Verdict: sound.**

## Packaging and store surface

**Deterministic packaging + AMO source archive (#231).** Same tag produces
identical bytes; the zip strips `*.md`, `docs/`, `scripts/`, and test files;
the source archive accompanies AMO uploads. **manifest.json is unchanged
across the entire range** — no new permissions, so the store review surface is
identical to 1.9.1. New packaged files are exactly: two OFL-licensed fonts
with their license texts and one app-directory SVG. No executable code added
to the package. **Verdict: unchanged exposure.**

**Themes and balance animation (#225, #226, #232).** CSS, SVG patterns, and
vendored font binaries; fonts are parsed by the browser and carry no code. The
animation off-switch respects Reduce Motion. **Verdict: no code path.**

## Result

No vulnerabilities found in the range. Two non-blocking notes are recorded
above: the lnurlp fetch not yet behind the SSRF guard (accepted, hardening
option noted), and replaceable-event rollback as an inherent property, not a
regression. Test files added in the range cover the areas that changed
behavior: slot migration, NWC re-wrap, sign-event shape, approval-kind
isolation, copied invoices, mute matching, autopay connection gating, bookmark
sections, LN recipient resolution.
