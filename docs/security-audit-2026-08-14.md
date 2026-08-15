# Sidecar Security Audit — 2026-08-14

**Auditor:** GLM 5.3 (z.ai)
**Version audited:** 1.9.0 (`main` @ `e4b515c`)
**Scope:** Full application — key management and crypto, extension attack surface, persistent storage and backups, vendored third-party code and remote-code risk, network and wallet surfaces. Vendored library internals were scanned for backdoors but not line-audited; everything else was read and traced in source.
**Method:** Five parallel deep audits of the source tree, followed by independent verification of every load-bearing finding against the actual code. All file/line references below were confirmed at audit time.

---

## Executive summary

**No critical or high-severity vulnerabilities were found.** The core is defensively built and, unusually for a browser extension, documents its own security reasoning in comments at the exact places that matter:

- Private keys and NWC connection secrets are **AES-GCM encrypted at rest** under a PBKDF2-SHA256 key derived with 600k iterations from a per-keystore random salt. No plaintext key material is ever written to disk.
- The signing path is gated by a strict **extension-origin sender check**, exact-match host scoping, and an **unforgeable, double-settle-proof approval prompt**.
- There is **no telemetry**, no key material in any log path, no `chrome.storage.sync` usage (no browser-account exfiltration path), no `web_accessible_resources`, no remote code in any shipped file, and no `eval`/`new Function` anywhere in first-party code.
- All four vendored libraries match their pinned SHA-256 hashes, verified by CI on every push.

Six findings rose to **Medium** — none is a key-compromise bug; they are consent gaps, privacy disclosures, and one step-up bypass that together define the recommended work:

| # | Severity | Finding | Where |
|---|----------|---------|-------|
| M1 | Medium | `SIDECAR_GET_NWC` returns the raw NWC secret with no PIN step-up, one line above the handler that requires it | `background.js:2588-2597` |
| M2 | Medium | WebLN `getBalance`/`getInfo`/`makeInvoice` bypass per-site permission tiers — any webpage silently reads the wallet balance while unlocked | `background.js:1357-1424` |
| M3 | Medium | The entire follow list is POSTed to api.nostrarchives.com (500-pubkey chunks) from ordinary compose typing, with no UI indication | `sidepanel.js:5374-5386` |
| M4 | Medium | The printable backup PDF carries the plaintext nsec (text + QR) and defaults to `~/Downloads`, npub prefix in the filename | `pdf-backup.js:357-367, 425-427` |
| M5 | Medium | Unpublished compose drafts and payment counterparty metadata persist unencrypted on disk indefinitely | `sidepanel.js:6465, 9624` |
| M6 | Medium | Durable plaintext host↔identity correlation (which sites you use as which account, plus payment history) | `background.js:107, 143, 196` |

The remainder are Low/Info hardening items, several already documented as accepted risks in the code itself. Recommendations are consolidated and prioritized at the end.

---

## Threat model

Sidecar is a browser-extension NIP-07 signer with NWC wallet features. The assets an attacker wants, in order of value:

1. **Identity keys** (nsec) — total loss of the Nostr identity on compromise.
2. **NWC connection secrets** — spend authority over the linked wallet, bypassing Sidecar's budget and confirmation gates entirely when used directly.
3. **Unauthorized signing** — events signed as the user without consent (spoofing, wipe attacks, proof-of-personhood oracles).
4. **Privacy metadata** — social graph, balance, site/identity correlation, DM contents via decrypt grants.
5. **Funds** — payments beyond what the user approved.

Attackers considered: a malicious or compromised web page; a malicious relay; a malicious third-party API; local disk access (another OS user, seizure, malware, cloud-sync clients watching `~/Downloads`); supply-chain compromise of vendored code; and the user's own mistakes.

---

## 1. Key management and crypto

### Architecture (verified)

- Keys at rest: `chrome.storage.local['sidecar_keystore']`, per-account `{ pubkey, enc: { iv, ct } }` — AES-GCM ciphertext only (`keystore.js:8-14, 232-241`).
- KEK: PBKDF2-SHA256, 600k iterations, 16-byte random salt per keystore, PIN minimum 8 chars enforced in the trusted context, not just the UI (`crypto.js:15, 50-57`).
- Decrypted keys live only in a service-worker `Map`; `getPrivkey` is SW-internal (`keystore.js:35, 379-386`).
- The derived key parks in `chrome.storage.session` (memory-only, cleared on browser exit, default `TRUSTED_CONTEXTS` so content scripts cannot read it) so unlock survives MV3 SW eviction. Rehydration requires passing an AES-GCM verifier check — a tampered session fails closed (`keystore.js:45-82`).
- Brute force: persisted (restart-surviving) unlock throttle shared across all step-up surfaces, 21 strikes → full wipe (`background.js:2061-2203`).

### Exfiltration-path inventory

Key material leaves storage only via: SW-internal sign paths; `SIDECAR_REVEAL_NSEC`/`REVEAL_NWC` (extension pages + PIN step-up); the one-time nsec shown at account generation; vault export (fresh password, PBKDF2-600k/AES-GCM file); and the user-initiated backup sheet. **No path logs, fetches, or error-reports key material. No page-supplied input can be turned into a key exfiltration.** The `dlog` trace is dev-build-gated and records type/method/host/timing/error only; the prompt-queue session mirror runs everything through a `sanitizeEntry` that strips event content; the Activity log stores host/method/kind/pubkey/amount only.

### Findings

**K1 (Medium — the M1 above): `SIDECAR_GET_NWC` bypasses the reveal step-up.**
`background.js:2588-2590` returns the decrypted connection string to any extension context while unlocked, directly above `SIDECAR_REVEAL_NWC` (`:2591-2597`) whose comment states the raw string must *always* require a PIN step-up. The NWC secret held raw is spend authority outside all of Sidecar's budget gates. Today the callers are all first-party panel code (~8 sites), so exploitation requires an XSS bug in an extension page — but the step-up exists precisely to defend that class.
*Recommendation:* split the API — a metadata-only GET (presence, alias), keep the raw string strictly behind `REVEAL_NWC`; migrate display-only call sites to `SIDECAR_HAS_NWC`.

**K2 (Low): kind 22242 (NIP-42 relay auth) is a consent-free signing oracle.**
Any non-blocked site, with no prior login, can obtain (while unlocked) a valid signature by the *active* account over a page-chosen `(relay, challenge)` pair — a proof-of-personhood token the user never consent to (`background.js:810-839, 886-897, 1024-1028`). Event shape is tightly validated (only `relay`/`challenge` tags, empty content, ±600s skew) so no arbitrary payload can be signed. Documented in-code as a deliberate tradeoff.
*Recommendation:* require an existing site binding for the exemption rather than falling back to the globally active account, or restrict the `relay` tag to user-configured relays.

**K3 (Low): crafted ncryptsec forces a ~1GB synchronous scrypt in the panel.**
`nip49.js:1689-1696` trusts `logn` from the pasted string, bounded only by noble's 1GB `maxmem`; `logn ≈ 20` means N = 2^20 → minutes of main-thread scrypt in the side panel (freeze/OOM). User action required — DoS only, no decryption oracle (AEAD fails closed, errors unified).
*Recommendation:* reject `logn > 20` before calling scrypt; move the `nsecEncode` call inside the try block (currently a raw nostr-tools error escapes on malformed key length). Sidecar's own encryption is fixed at `logn = 16` — no parameter-downgrade risk.

**K4 (Low): `trusted` tier auto-allows `nip04/nip44.decrypt`** — "Trust this site" grants silent DM reading forever until revoked (`permissions.js:81-92`). Standard signer semantics, but the sharpest edge of the tier.
*Recommendation:* keep decrypt at ask-tier even for trusted sites, or say "this site will be able to read your DMs" in the trust confirmation.

**K5 (Info, doc bug): `crypto.js:5-6` claims the derived key is non-extractable; it necessarily is** (`crypto.js:71` — extractable, raw-exported to session storage for SW-eviction survival). The design is right; the comment is now false. Fix the comment, and consider surfacing the "auto-lock = Never keeps the unlock in memory all session" tradeoff in the settings UI.

**K6 (Info, doc bug): `qrSecret`'s comment promises time-boxing that doesn't exist** — the TTL is checked only at claim time; an unclaimed scanned nsec sits in the module var until SW death or lock (`background.js:1323-1326`). Benign in practice (MV3 kills the SW at ~30s idle; cleared on lock); the comment overstates the guarantee.

### Positive findings worth preserving

Sender gate on crown-jewel handlers (`background.js:2661-2692`); host identity never page-supplied on the signing path; no `externally_connectable`; store-write serialization preventing lost keystore updates (with a concurrency test to prove it); wipe discipline on lock/removal/duplicate-import/PIN-change; fail-closed `ownerSign(expectedPubkey)` against stale panels; MV3 lifecycle used as defense-in-depth (decrypted keys die with the SW); clipboard auto-clear after 60s.

---

## 2. Extension attack surface

### Manifest inventory

| Permission | Verdict |
|---|---|
| `storage`, `sidePanel`/`sidebar_action`, `alarms`, `contextMenus`, `notifications` | All used, all necessary. Notifications carry no secrets. |
| `host_permissions: https://*/*` | Broad but load-bearing for a universal NIP-07 provider (CORS-free OG previews, tab-URL visibility for paid-tab notifications). Cannot be narrowed without breaking "works on any site." |
| `content_scripts` `<all_urls>`, `document_start`, top-frame only | Necessary. Top-frame-only is good — iframes get no `window.nostr`. |
| `world: MAIN` for `nostr-provider.js` | Best practice: browser-injected at document_start, immune to page CSP, no `<script>` DOM insertion anywhere. |
| **Absent:** `web_accessible_resources` | Excellent — web pages cannot load, frame, or fingerprint any extension resource; prompt.html is unreachable from the web. |
| **Absent:** CSP override, `externally_connectable` | Default MV3 CSP stands; no inline scripts in any extension page. External messaging posture is correct but implicit — see E4. |

### Verified defenses

- **Sender gate:** every non-`CONTENT_OK` message type requires `sender.url`/`sender.origin` under `runtime.getURL()` — unlock, reveal, owner-sign/decrypt, prompt-settle, QR-secret, and settings handlers are unreachable from any content-script context. Content scripts are limited to a fixed 7-type allowlist; settings writes from web origins are clamped to the pay-card toggle only, and settings reads return nothing fingerprintable.
- **Prompt transport:** prompt decisions are extension-page-only; `settlePrompt` double-settle-guards; prompt ids are random; closing the popup without deciding rejects. The displayed host is `textContent`-assigned from the queue entry tracing to `location.host` — a page cannot spoof what the prompt shows. Interrupted entries become never-signable tombstones.
- **DOM safety:** all `innerHTML` uses are static SVG/CSS, clears, or escaped; approval previews build DOM with `createElement`/`textContent`; `href`/`src` assignments require `https?://` so `javascript:` URIs cannot pass. No eval/`new Function`/`document.write` anywhere in first-party code.
- **Grant keying:** exact-match `host|pubkey` with a pipe delimiter — no host-prefix collision ("evil.com" can never inherit "evil.com.attacker.com"); no subdomain wildcarding anywhere; unknown hosts fail toward prompting.
- **Relax mode:** session-only, max 30 min, single window, revoked on lock/account-switch/host-detach; control kinds (24133 NIP-46, 23194/23195 NWC) and replaceable kinds (0/3/10000) never relax, with both approval surfaces sharing one `neverRelaxes` flag.

### Findings

**E1 (Medium — the M2 above): WebLN reads bypass permission tiers.**
`weblnUnlockGate` (`background.js:1357-1373`) returns immediately when the keystore is unlocked — it is an *unlock* gate, not a *consent* gate — and `handleWeblnRpc` (`:1384`) enforces only the `blocked` tier. Any webpage calling `window.webln.enable()` then `getBalance()` silently learns the balance, node alias, and wallet node pubkey whenever the vault is unlocked (the common state during browsing), with zero prompts, at any trust tier including "never seen this site." Worse, the first call silently binds the host to the active account (`setSiteAccount`, `:1440`), so no prompt appears later either.
*Recommendation:* route `getBalance`/`getInfo` through the permission tiers (treat like the ask tier), or prompt once per (account, host) as decrypt-burst coalescing already does. `sendPayment` is correctly gated and is not affected.

**E2 (Low/hardening): the two RPC handlers take `host` from the message body.** `SIDECAR_NOSTR_RPC`/`SIDECAR_WEBLN_RPC` (`background.js:2722-2728`) trust `message.host`, while every sibling handler derives it from `new URL(sender.url).host` with comments saying it must never come from the body. Safe today (web pages cannot reach `onMessage`; `content.js` is first-party), but a future content-script refactor that forwards a page-influenced host would let a page inherit another host's `trusted` tier silently.
*Recommendation:* derive host from `sender.url` in these two handlers and ignore the body field.

**E3 (Low): NIP-42 silent signing oracle** — see K2.

**E4 (Info): make the external-connection posture structural.** No `externally_connectable` and no `onMessageExternal` listener means web pages and other extensions cannot message the extension — but this rests on never adding a handler. Declare `"externally_connectable": {}` (denies all) in the manifest.

**E5 (Low): `SIDECAR_FETCH_OG` SSRF guard is name-based only** (`background.js:65-96, 2277-2316`). The guard is unusually thorough — scheme restriction, embedded-credential rejection, IPv4/IPv6 private ranges, CGNAT, `.localhost`/`.local`/`.internal`, and post-redirect re-checks — but a public DNS name resolving to a private IP (DNS rebinding / attacker zone) still gets fetched by the CORS-exempt SW. Exposure is constrained to OG meta tags of HTML responses.
*Recommendation:* resolve and check the IP, or at minimum reject responses that redirect to a host resolving private.

---

## 3. Persistent storage and backups

### Storage inventory (complete)

**At rest, encrypted (AES-GCM under the PIN-derived key):** `sidecar_keystore` (all nsecs), `sidecar_nwc_connections` (all NWC secrets). Nothing else sensitive is encrypted; nothing sensitive is stored any weaker than this.

**`chrome.storage.session` (memory-only, cleared on browser exit):** the derived KEK (`sidecar_session`, by design — see K5), prompt queue metadata (sanitized), relax grants, pending zaps (host/pubkey/msat, 180s TTL, cleared on lock), approve counts. All correctly scoped to session lifetime.

**`chrome.storage.local`, plaintext — sensitive:**
- `sidecar_pay_meta` (payment counterparties, user-typed comments, fees; capped 300) — **M5**
- `sidecar_compose_drafts` (unpublished note drafts, never sent to relays) — **M5**
- `sidecar_site_accounts` + `sidecar_site_authorized` + `sidecar_activity` (host↔pubkey maps, up to 200 signing/payment history entries) — **M6**

**`chrome.storage.local`, plaintext — trivial:** settings, relay lists, permissions tiers, wallet budgets, seen-notifications timestamps, replaceable baselines (counts and field *names* only, never content), unlock-throttle counters, tip-dismissal booleans.

**`chrome.storage.sync`: none. Zero findings.** There is no browser-account sync exfiltration path. No `localStorage`, `sessionStorage`, or IndexedDB anywhere.

### Findings

**S1 (Medium — M5): drafts and pay metadata unencrypted on disk.** Anyone with profile-disk access recovers unpublished drafts (arguably more sensitive than published notes precisely because they were never sent) and payment counterparties.
*Recommendation:* either move both under the keystore's derived-key encryption (they are already per-pubkey) or document the tradeoff in PRIVACY.md; counterparty addresses and comments could be shortened/hashed if full encryption is rejected.

**S2 (Medium — M6): durable site/identity correlation.** The three host↔pubkey maps form a permanent log of which sites this person signs into as which identity, plus what they paid. Activity is capped at 200; the site maps are uncapped.
*Recommendation:* add a user-facing "clear site history" and/or a retention cap on the site maps; document in PRIVACY.md.

**S3 (Medium — M4): the printable backup PDF is not encrypted.**
Correcting any assumption of an "encrypted backup PDF": it carries the **plaintext nsec** as selectable Courier text (`pdf-backup.js:357-360`) and as a vector QR (`:367`), with the npub's first 12 chars in the filename (`sidecar-key-<prefix>.pdf`, `:425-427`), landing in `~/Downloads` — which cloud sync clients commonly watch. The in-app warnings are strong, plain, and honest, and the design rationale (a paper backup must be restorable by a human with no tool and no remembered password) is legitimate and documented.
*Recommendation:* (a) offer an optional second page with an **ncryptsec QR** — the NIP-49 encryptor is already vendored and already offered in the key-backup modal's ncryptsec tab; (b) prefer `showSaveFilePicker` over a bare `a.download` so the user chooses the destination instead of defaulting to Downloads.

**S4 (Low): NWC relay backup publishes the spendable secret** (self-encrypted, NIP-44 with a tagged NIP-04 fallback) as kind 30078 to the user's relays (`sidepanel.js:7388-7426`). Adds little *new* exposure — it is encrypted to the very identity whose compromise already means total loss — but identity and wallet secrets then share one blast radius, and NIP-04 is deprecated crypto. Restore validates with a `getInfo` round-trip before saving, and a test pins that the "Backed up ✓" status cannot lie about a stale ciphertext. Worth a sentence in the docs; consider dropping the NIP-04 fallback.

**S5 (Info): `replaceable-baseline` is a documented fail-open safety net.** A poisoned baseline (a genuinely-signed stale small list served to a fresh install) can suppress a future wipe warning; the module header states this precisely and that absence of a warning never means safe. Correct framing — a net, not a gate. No action.

---

## 4. Third-party and vendored code

### Verdict: clean, with a strong supply-chain posture

| File | Upstream / version | Provenance | Verdict |
|---|---|---|---|
| `nostr-tools.js` | nostr-tools 2.23.11 | byte-identical to npm dist; SHA-256 pinned + CI-enforced | Clean |
| `nip49.js` | built from nostr-tools 2.23.11 + pinned noble/scure deps, esbuild 0.28.1 | hash pinned | Clean — zero network calls, zero eval |
| `jsqr.js` | jsQR 1.4.0 | byte-identical to npm dist; pinned | Clean |
| `qrcode-generator.js` | Kazuhiko Arase 2.0.4 | byte-identical; pinned; MIT header intact | Clean |

All four hashes verified live against `scripts/vendor-hashes.sha256`; `.github/workflows/verify-vendor.yml` enforces them on every push/PR. Red-flag scan of each vendored file found nothing malicious: nostr-tools contains WebSocket/fetch sites, but they are all spec-defined nostr functionality (NIP-05/11/39/57) that Sidecar's first-party code **never calls** — dormant capability, not active behavior. No `eval`, `atob` blobs, `document.write`, obfuscated segments, or `chrome.*` access in any vendored file.

**Remote code: none in any shipped file.** All HTML pages load only local scripts. `package.json` has zero dependencies and zero devDependencies. The packaged dist zips contain only git-tracked files — nothing extra, nothing injected. `fonts/` is all local woff2 with OFL licenses; `themes/` has no scripts, no remote `url()`, no `javascript:` URIs.

### Findings

**T1 (Low, build tooling): `scripts/update-vendor.sh:50` rewrites the hash file from whatever it just downloaded.** A tampered npm artifact would be silently accepted with a fresh "valid" hash; CI protects against later drift, not a bad upstream at update time.
*Recommendation:* before overwriting, compare each new hash against the existing file and abort on unexpected change, forcing the human diff-review VENDOR.md already prescribes; optionally verify against npm's `dist.integrity` metadata. (This is also a manifest-repack attack vector if the npm account is ever compromised.)

**T2 (Low, dev-only): `font-preview.html` references Google Fonts** (as do the welcome/wallets pages' favicon and app-icon images, though those are passive `<img>` loads, not code). The preview file is gitignored and excluded from packaging, so nothing shipped references it — but if ever committed it would be a store-policy remote-resource violation.
*Recommendation:* delete or strip the dev preview pages; note that `wallets.js:57` pings Google's favicon service for a static curated domain list (no user data; swap for local icons if zero third-party pings is the goal).

---

## 5. Network and wallet surfaces

### Outbound inventory (complete)

- **WebSockets:** 5 bootstrap default relays; `purplepag.es` (read aggregator, always appended); 16 hardcoded follow-scan/publish relays (follow-list recovery); user relays (settings + NIP-65); the NWC wallet relay from the connection string. All `wss://` by default.
- **HTTPS:** mempool.space and Coinbase price APIs (currency pair only — no amounts, no wallet data); api.nostrarchives.com (see N1); nostr.build and user Blossom servers (user-initiated uploads with signed auth); NIP-05 `.well-known` and LNURL endpoints; one rizful.com onboarding call (one-time code + pubkey, response scheme-validated and `getInfo`-verified before storing); OG previews behind the SSRF guard; Google favicons (static list).
- **No `sendBeacon`, no XHR, no analytics, no telemetry to sidecar.top.** Nostr.band is not referenced (correctly — it is defunct).

### Findings

**N1 (Medium — M3): the entire follow list is disclosed to a centralized third party.**
`naMetadata` (`sidepanel.js:5374-5386`) POSTs up to-500-pubkey chunks of the user's **whole follow list** to `api.nostrarchives.com/v1/profiles/metadata` to backfill names/pictures — and `naSuggest` (`:5355`) fires from ordinary compose-box typing. Relays already see follow-list fetches, but this adds a *new centralized observer* that would otherwise see nothing, correlatable across sessions by IP. For a user with a sensitive follow set, opening the mention autocomplete discloses their graph to one company with zero UI indication.
*Recommendation:* gate behind an explicit setting (default off, like "Confirm background app-data syncs") or at minimum document in PRIVACY.md; name resolution could ride the relay fetch that already happens.

**N2 (Low): `ws://` relay URLs accepted everywhere** — settings input, follow-scan normalization (`sidepanel.js:7831, 10703`), NIP-65 lists fetched from relays, and NWC connection strings passed straight to `new WebSocket` (`nwc-client.js`). Cleartext relays expose traffic metadata to network observers (content stays NIP-04/44-encrypted).
*Recommendation:* warn on or reject `ws://` in the inputs; log a warning when an NWC string uses it.

**N3 (Low): QR-image context-menu fetch bypasses the SSRF guard.** `invoiceFromQrImage` (`background.js:1993`) fetches the right-clicked image URL CORS-exempt with no `safeFetchUrl` check — unlike the OG path. User-initiated, and only a QR-decoded invoice ever leaves the worker, but it can probe internal URLs.
*Recommendation:* route through the existing `safeFetchUrl` (one line).

**N4 (Low): LNURL callback scheme unvalidated.** `meta.callback` is attacker-controlled (whoever controls the lightning-address domain) and an `http://` callback is followed — payment metadata in cleartext, MITM-swappable invoice (`sidepanel.js:10428-10430`).
*Recommendation:* require `cb.protocol === 'https:'` before fetching.

**N5 (Low, race): budget/auto-zap debit lands outside the payment lock.** `payInvoiceLocked` (`background.js:1859-1873`) fires the budget `consume` without awaiting, releasing the per-account pay lock before the storage write lands — a burst of same-amount `sendPayment`s gets a small retry window against the budget check. Deliberate tradeoff (issue #138: bookkeeping must not delay the page reply); payments themselves are serialized.
*Recommendation:* decrement an in-memory `remaining` counter synchronously inside the lock, keeping storage as the durable mirror.

**N6 (Info): media loads leak the user's IP to arbitrary hosts** (profile pictures, note media) — inherent to Nostr. `referrerPolicy = 'no-referrer'` is set on images but **not on `<video>`** (`sidepanel.js:5552`) — trivially fixable.

### NWC deep-dive: strong

Secret encrypted at rest under the same KEK; commands limited to `get_info/get_balance/pay_invoice/make_invoice/list_transactions/lookup_invoice`; **amountless invoices never auto-pay** (always prompt); responses filtered by wallet-pubkey author AND NIP-04-decrypted with the connection secret — a crafted relay response cannot inject anything, and results render via `textContent` only. The walletDenied/indeterminate contract prevents false "failed" reports on spent payments. Auto-zap approvals are single-use, amount-bound, 180s TTL, host+account-bound, with read-time clamping to hard ceilings (1000 sats/zap, 100k/day) in addition to write-time.

### Relay handling: no relay-driven sign path

The service worker has no relay pool at all — it only signs and returns; only owner-initiated panel actions publish. No NIP-46 bunker, no `get_event`. Every relay-supplied string renders through `textContent`/DOM builders with `https?://`-only URL filters — no `javascript:` hrefs possible, no injection surface found in any rendering path.

---

## Prioritized recommendations

**Fix now (next patch release):**
1. **M1** — Split `SIDECAR_GET_NWC` into metadata-only; raw string only behind `REVEAL_NWC`'s step-up.
2. **M2** — Gate WebLN `getBalance`/`getInfo` behind the permission tiers or a one-time per-(account, host) prompt.
3. **E2** — Derive `host` from `sender.url` in the two RPC handlers.
4. **N4 / N3 / K3** — Three one-to-few-line hardening patches: require `https:` on LNURL callbacks, route QR-image fetch through `safeFetchUrl`, cap `logn` on ncryptsec decrypt.
5. **E4** — Declare `"externally_connectable": {}` in the manifest.

**Product decisions needed:**
6. **M3** — Decide nostrarchives: opt-in setting (recommended), document in PRIVACY.md, or drop in favor of relay-based name resolution.
7. **M4** — Add the optional ncryptsec-QR page to the backup sheet; prefer `showSaveFilePicker`.
8. **S1/S2/M6** — Decide on encrypting drafts/pay-meta and a "clear site history" affordance; document current behavior in PRIVACY.md either way.
9. **K4** — Decide whether `trusted` keeps silent DM decrypt, and label the consequence.

**Hygiene:**
10. Fix the false comments (K5 `crypto.js` header, K6 `qrSecret` TTL); move `nsecEncode` inside the try; add `no-referrer` to `<video>`; T1 hash-challenge in `update-vendor.sh`; add an Apache-2.0 NOTICE for jsQR; reject or warn on `ws://` relays (N2); consider dropping the NIP-04 fallback on the NWC relay backup (S4).

---

## Conclusion

Sidecar's security architecture is well above the bar for a browser-extension key custodian: encrypted-at-rest keys with a fail-closed unlock path, a rigorously gated message router, an unspoofable approval prompt, hash-pinned vendored dependencies, and no telemetry or remote code whatsoever. The audit found no path by which a web page, relay, or third-party API can extract key material. The Medium findings are consent and privacy gaps — a step-up bypass usable only from inside the extension, wallet-balance disclosure to arbitrary sites, a social-graph disclosure to a centralized API, and on-disk data that outlives its sensitivity — plus a set of small hardening gaps on secondary fetch paths. All are fixable without architectural change; the four one-line patches (recommendations 4) are the cheapest risk reduction available.

*Report generated 2026-08-14 by GLM 5.3 (z.ai). Findings reference code as of commit `e4b515c` (v1.9.0).*
