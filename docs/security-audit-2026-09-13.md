# Sidecar Security Audit — 2026-09-13

**Auditor:** GLM 5.3 (z.ai)
**Version audited:** 1.12.0 + unreleased `main` (`61095f1`, shipping as 1.13)
**Scope:** Everything since the 2026-08-14 audit (`e781743`, PR #188) — 327 commits, 97 merged PRs, releases 1.9.1 through 1.12.0. The 1.9.1→1.10.0 slice was previously covered by the narrow pass in `docs/security-review-1.10.0.md` and is treated here as reviewed-lightly, not skipped.
**Method:** Six parallel deep reviews (prior-audit item verification; key material and spend paths; the background router and consent gates; the two approval surfaces and the content script; relay-controlled data into DOM; shipped-surface/packaging), each reading the `e781743..HEAD` delta plus the full current code of its files. Every load-bearing finding below was verified against current code with file:line evidence. `npm test`: **1389 pass, 0 fail** at audit time.

---

## Executive summary

**No critical or high-severity vulnerabilities were found.** The prior audit's entire fix-now list landed and landed correctly, and the interval added genuinely strong mechanisms: a DEK/slot keystore redesign that eliminates the forgot-one-wrap-site failure class by construction, `BUDGETS.reserve()` check-and-debit before keysend money moves, an encrypted-at-rest store for drafts and payment metadata, an opt-in nostrarchives flow, and a structurally clean hidden game that provably touches nothing privileged.

Five findings rose to **Medium**. None is a key-compromise bug; four of the five are consent/race gaps in the signing and payment approval machinery, which is where nearly all of this range's churn went:

| # | Severity | Finding | Where |
|---|----------|---------|-------|
| M1 | Medium | "Allow all (N)" batch approvals preview only the head event; one click signs N same-kind events, so a site can get a second kind-1 note signed off a card describing the first | `background.js:426-449`, `sidepanel.js:18084-18213` |
| M2 | Medium | The panel's approval preview fetches OG metadata, embeds, and profiles from the signing screen, before any decision — a reviewed request has already reached out | `sidepanel.js:10031, 10114, 10161, 17520` |
| M3 | Medium | BOLT11 `sendPayment` still does budget `covers()` read-then-`consume()`-after-lock-release; a burst of distinct invoices can spend past a site budget (keysend fixed this; invoices didn't) | `background.js:2394, 2498-2507` |
| M4 | Medium | A zap approval (kind 9734) binds host + account + amount but not the payee; a hostile site can redeem the approval against its own lnurl server | `zap-requests.js:65-66`, `background.js:1559-1561, 2409` |
| M5 | Medium | A racing `ensureLoaded()` can silently undo an explicit `lock()` — the keystore comes back unlocked with no PIN | `keystore.js:77-94` vs `367-373` |

The remainder are Low hardening and privacy-disclosure items, plus a set of confirmed-still-open observations carried over from `docs/issue-kind-1-nevent-signing.md`. Recommendations are consolidated at the end.

---

## Threat model delta

The 2026-08-14 threat model (assets: identity keys > NWC secrets > unauthorized signing > privacy metadata > funds; attackers: malicious page, malicious relay, third-party API, local disk, supply chain, user error) is unchanged and remains the right frame. What the interval changed about the attack surface:

- **New page-reachable spend method:** WebLN `keysend` (PR #291, outside contributor) — a page can now request direct TLV payments, not just BOLT11. Reviewed in full below; the gating holds.
- **New long-lived consent surfaces:** WebLN read grants (per host+account, session), relax grants now survive SW restarts via persisted alarms, and a 120-second plaintext "sealed content" memory in the service worker backing the #316/#317 UX.
- **New network surfaces:** `ws-guard.js` (socket plumbing only), `relay-health.js` (NIP-11 HTTPS probes of user-listed relays), and the previously-audited nostrarchives index now strictly opt-in.
- **New shipped-but-hidden code:** `relay-rider.js` (1087 lines) — verified inert (see §6).
- **Keystore re-architecture:** v1 single-KEK → v2 DEK-wrapped-by-slots, with a one-cycle v1 backup on disk.

Assets and attacker ordering are unchanged; the new weight is on the *consent* and *race* axes, which is where the Mediums sit.

---

## 1. Key management and crypto

### Architecture (verified)

The slot redesign is structurally sound. One random DEK encrypts every payload (accounts + NWC secrets); each unlock factor wraps the DEK (`keystore.js:244-322`). Migration is a single atomic store write, round-trip-verified byte-for-byte (every secret decrypted out of the *new* ciphertext) before anything persists; an abort leaves v1 intact; `store.version >= 2` prevents re-running. `unlock` and `changePin` are both `serialized()`, so no concurrent migration is possible. PIN change re-wraps only the DEK — no old-KEK-decryptable account ciphertext can be produced, closing the NWC-re-wrap bug class (confirmed independently by the 1.10.0 review and its tests). The session DEK in `chrome.storage.session` is unchanged (memory-only, default access level excludes content scripts). `crypto.js` read in full: PBKDF2-SHA-256 600k, fresh 12-byte IVs, AES-256-GCM everywhere, no padding-oracle surface; the previously false "non-extractable" header comment is now corrected.

**No passkey/WebAuthn surface actually exists yet** — the slot work is structure only; `listSlots` exposes no wrapped material or salts.

### Findings

**K-A (Medium — M5 above): racing `ensureLoaded()` undoes `lock()`.**
`ensureLoaded()` (keystore.js:77-94) is deliberately not on the serialization chain. If it passes its `if (dek) return` check, then `await sessGet()` resolves, and *then* `lock()` (367-373) runs to completion, `ensureLoaded` continues with its stale captured session value, re-imports the DEK, re-decrypts every account, and sets `unlocked`. The keystore is unlocked again immediately after an explicit lock, with no PIN. The panel calls `ensureLoaded` at the top of `handleControl` (background.js:3026), so the realistic trigger is the user clicking Lock exactly as a panel request lands. No page-facing attacker; the impact is a silently failed lock — auto-lock guarantees violated for the rest of the session, plaintext key availability extended.
*Fix:* re-check `dek === null` after every `await` in `ensureLoaded`, or put it behind a shared mutex with `lock`.

**K-B (Low): the v1 backup survives a PIN change.**
`migrateToSlots` always writes `sidecar_keystore_v1_backup` (the old store, encrypted under the *old* PIN key); it is cleared only on the next non-migrating `unlock()` (keystore.js:356-363). `changePin()`'s v1→v2 path never clears it (290, 648-680). If the PIN was changed *because* the old PIN was compromised, the adversary can still decrypt every private key from the on-disk backup until a later fresh unlock happens to clear it.
*Fix:* clear `V1_BACKUP_KEY` at the end of `changePin()`'s migration path (the new store has just been round-trip verified), or on `lock()`.

**K-C (Low): the raw `SidecarNip49.decrypt` global in the panel has no `logn` cap** — the enforced cap (sidepanel.js:6684, pre-scrypt, both worker and sync paths) lives in `decryptNcryptsec`; a null/undecodable logn still falls through bounded only by the bech32 decode. Same-origin extension code only; observation-grade hardening.

### Positive findings worth preserving

Migration atomicity + round-trip verification + one-cycle backup, exactly matching `test/keystore-slot-migration.test.js`; store-write serialization at the export boundary with a lost-write rationale comment; the scrypt `logn > 20` pre-check before the worker is ever messaged; `nip49-worker.js` verified unreachable from pages, stateless, structured-clone-only; PDF writer injection discipline (`ascii()` + `esc()` on every dynamic string, no `innerHTML` in the file, blob URL revoked synchronously, fonts fetched same-origin from the package); step-up PIN attempts share the 21-strike throttle, so no unthrottled oracle was added.

---

## 2. Spend paths: keysend, budgets, zaps

### WebLN keysend (PR #291) — verified safe

Full path traced: `window.webln.keysend` → content router → `handleWeblnRpc` (**host re-derived from `sender.url`, never the body**, background.js:3767-3772) → `normalizeKeysend` (1911-1969) → `withPayLock` → `payKeysendLocked` (2554) → `BUDGETS.reserve` → prompt or budget → NWC pay with Sidecar-generated preimage. Input hardening is thorough: `Number()` not `parseInt`, integer ≥ 1, 100M-sat cap, destination must match `^0[23][0-9a-f]{64}$`, TLV bounds, and the preimage record 5482373484 is rejected outright so a page cannot choose the payment hash. The reporter's per-recipient splitting concern is addressed: each page-initiated call goes through `BUDGETS.reserve()` (serialized check-and-debit, wallet-budgets.js:115-143) which debits *before* the spend and enforces `perPaymentSats` per reservation; refunds happen only on wallet-proven denial. `test/keysend-budget.test.js` pins "four splits cannot all clear a budget with room for two." Keysend is structurally excluded from the auto-zap allowance (no `ZAPREQ` identifier in scope, background.js:2528-2553), so a signed 21-sat zap request cannot be redeemed as a keysend.

### Findings

**W1 (Medium — M3 above): the BOLT11 invoice path kept the race keysend fixed.**
`payInvoiceLocked` does `covers()` (read, inside the pay lock) … pay … `BUDGETS.consume()` in the un-awaited `settleTail` *after* `withPayLock` releases (background.js:2498, comment at 2500-2506 acknowledging this verbatim). Attacker→impact: a page with an active budget (say 100 sats/day) fires N back-to-back `sendPayment` calls with distinct invoices; each `covers()` reads the balance before the previous `consume()` lands, so the burst exceeds the budget (each payment still ≤ `perPaymentSats`). This is the prior audit's N5, still open, and now inconsistent with the keysend path one screen over.
*Fix:* use `reserve()`/`refund()` on the invoice path exactly as keysend does — the primitives already exist and are serialized.

**W2 (Medium — M4 above): zap approvals bind host+account+amount, not payee.**
`record()` runs after the user approves signing the kind 9734 (background.js:1559-1561); `claim()` then auto-pays any invoice from that host with the matching exact amount within 180 s. The in-code argument (zap-requests.js:15-23) is that the destination is fixed by the recipient's lnurl server — but the *site* chooses which lnurl callback to hit. A hostile site that gets one "zap @alice 21 sats" approval can fetch a 21-sat invoice from its own lnurl server and call `sendPayment`; the claim matches and the money goes to the site's node with no second prompt. Bounded: requires autoZap enabled and one real user-visible signing approval per payment, and per-zap/daily caps still apply.
*Fix direction:* include the payee pubkey from the 9734's `p` tag in the record and verify it against the invoice's destination node key where derivable; at minimum document the site's lnurl flow as a trusted party.

**W3 (Low→Medium): the auto-zap daily cap is enforced read-time against a write that lands after the lock releases.**
`recordAutoZap` runs in `settleTail` (background.js:2409-2411 vs 2510); a burst of zap payments each reads `autoZapWindow().spent` before earlier writes land, so the aggregate daily cap can be exceeded by up to (n−1) × perZap. Same shape as W1. *Fix:* record the spend inside the lock, reserve-style.

**W4 (Low): `ZAPREQ.record`/`claim` can interleave and resurrect a consumed record.**
`record()` is a read-append-write on `storage.session` *outside* the pay lock; `claim()`'s read-splice-write runs inside it (zap-requests.js:89-107). If a claim's write lands between a record's read and write, the consumed single-use record is written back — one approval becomes payable twice within the TTL. Requires same-moment sign+pay, autoZap on. *Fix:* serialize record/claim on one chain, as `BUDGETS` does.

Host/account binding elsewhere verified good: budgets and zap records keyed `(pubkey, host)` with host always from `sender.url`; `tryZapAutopay` requires an explicit site binding and refuses the active-account fallback (2199-2200); zap records session-only and cleared on lock; `payable()` rejects 0/negative/fractional (the keysend-grows-allowance bug class); the 9734 is signed through the `expectedPubkey`-guarded owner path, so an account switch cannot sign as the wrong identity; limits are re-fetched at payment time rather than trusted from a stale preview; LNURL callbacks require `https:` at both call sites (sidepanel.js:16680-16681, 16699-16705).

---

## 3. The gate between a website and a key

### Router and sender gating — re-verified end to end

A third of `background.js` is new since the last audit; the gate held. Everything not in the 7-type `CONTENT_OK` allowlist requires `sender.url`/`sender.origin` under `chrome.runtime.getURL('/')`, derived from the real sender (3684-3703); `SIDECAR_GET_NWC` additionally requires exactly `sidepanel.html` (3537-3541); prompt-settle types are ext-page-only, so a content script cannot approve anything. Host is derived from `sender.url` and body hosts are discarded at every content-reachable handler (3769, 3780, 3799, 3809). Settings reads/writes from web origins are clamped to the pay-card toggle plus a documented 1-bit `hasWallet` disclosure for the bound account. `settlePrompt`'s double-settle guard, tombstones, and SW-restart `reconcileQueue` are intact — no path to a double sign. The unlock throttle (persisted, escalating, 21-strike wipe) now covers every step-up surface including `REVEAL_NWC` and `OWNER_SIGN` with PIN.

### Sealed-content memory (#316/#317)

The plaintext `Map` (background.js:1083-1104, keyed `host|pubkey|exact ciphertext`, TTL 120 s, cap 20 entries) **can never be read by the page** — verified: `sealed` flows exclusively into the two approval surfaces (prompt payload via ext-page-gated `SIDECAR_GET_PROMPT_DATA`, and `pendingView().head.data`); the page's response is only the perform output (ciphertext / signed event). Entries are created only after an approved encrypt on the page's own host/account; there is no write or read API exposed to pages, so planting or probing is impossible and cross-site/cross-account recall is impossible.

**B1 (Low): plaintext can outlive the stated 120 s, with no per-entry size cap.**
The TTL is enforced only on read (`recallSealed`); nothing sweeps expired-but-unread entries, and the relax-badge alarm (1-min period, up to 30 min) plus the queue keepalive can hold the worker awake far past 120 s. Up to 20 unbounded-length page-supplied plaintexts can sit in SW memory for tens of minutes — no message-path confidentiality break, but it contradicts the design comment and enlarges the plaintext-in-memory window for anything reading process memory.
*Fix:* sweep `sealedText` in the existing 1-min alarm tick; cap the stored string (the prompt clamps display to 220 chars anyway).

### permissions.js / relax-grants.js — verified strong

Relax expiry is triple-enforced (lazy self-expiry, persisted cross-restart alarm, `active()` filter); duration clamped at 30 min; `grant()` clears every other grant so nothing stacks; revocation covers lock, global account switch, host rebind, and host detach — a grant cannot outlive an account switch on any drivable path. `neverRelaxes` kinds are shared by one function across both gates so they cannot drift, and the destructive-overwrite check overrides relax. No fail-open on MV3 eviction was found anywhere in the new state (a per-state table was compiled; `sealedText` loss fails closed to ciphertext, grants expire on read with `Date.now()`, tombstones are non-signable).

### Findings

**G1 (Medium — M1 above): batched approvals preview only the head.**
`pendingView` groups by `batchKeyOf` = host + activePubkey + kind (`isBatchableEntry` admits any non-NIP-42 `signEvent`); the panel card previews the head only and "Allow all (N)" settles the whole group per-id with no further review (background.js:420-449, 3870-3874; sidepanel.js:18084-18213). The in-code reasoning — same-kind stops a site slipping a different event type into a batch — is true but insufficient: two *different notes* are the same kind, so a site queues benign note A, then note B, and one click described by A signs both. This confirms item (a) of the issue-kind-1 doc's open list and is the most serious consent gap in this report. Confirmed panel-only (the popup has no batch path).
*Fix:* include a content hash in the batch key, or render a scrollable list of all N payloads inside the batch card before "Allow all" is offered.

**G2 (Low): `batchKeyOf` groups on a null kind.** Encrypt requests carry `kind: null` (background.js:554-556), so `nip04.encrypt` and `nip44.encrypt` from one host+account share a batch key despite being different methods — one click approves N heterogeneous encrypts previewed as one. Confirms doc item (b). *Fix:* include `e.method` for non-signEvent entries.

**G3 (Low): user rejections are still not logged.** The only `rejected` Activity write is the shape-refusal path (background.js:1119-1125); every `decision.action === 'reject'` consumer (1455, 1770, 2439, 2585) throws without logging. "I said no and it happened anyway" arrives with no evidence. Confirms doc item (f). *Fix:* write a `rejected` Activity entry in `settlePrompt`.

**G4 (observation): the pay card is attacker-presentable.** `hasPayIntent` heuristics (content.js:305-344) let a page force the loud "Request to pay / N sats" card by wrapping a `lightning:` link in a fixed overlay — a phishing-amplification primitive. Impact capped: paying still routes through the extension approval or a budget the user granted to that host, so it is equivalent power to `webln.sendPayment`, but worth knowing the card is page-presentable. The pill/card otherwise verified: shadow-DOM isolated (`all:initial`, max z-index), every interpolation constant/number/`escapeHtml`-wrapped including the attacker-controlled BOLT11 memo, page-forgeable `copied-invoice` postMessages re-validated and treated as passive, and the open shadow root gives the page only presence-oracle + programmatic-click power, both no worse than the webln API.

---

## 4. The two approval surfaces

Every finding in this report was checked on **both** `prompt.html`/`prompt.js` and the panel's inline approval; the surfaces did not drift where it matters. Both render relay- and page-supplied strings DOM-safely (`escapeHtml` incl. `'` in prompt.js:440; the `h()` helper with `textContent` in sidepanel.js), hosts are `textContent`-assigned from router-derived values, both carry the identical unreadable-event warning and kind tables (pinned to each other by test), and both apply the destructive-overwrite lock.

**A1 (Medium — M2 above): the panel's approval preview touches the network before approval.**
`renderApprovalPreview` → `appendEventContent` → `renderNotePreview` fetches OG metadata for every https link, resolves embeds from relays, and fetches preview profiles — from the signing screen, pre-decision (sidepanel.js:10031, 10114, 10161, 17520, 17524, 17697). `prompt.js` deliberately does the opposite and documents why (181). Attacker→impact: a site submits a note stuffed with unique URLs; merely displaying the review card fires dozens of fetches to attacker-chosen hosts — IP/timing disclosure and a "was it reviewed" beacon. Confirms doc item (c).
*Fix:* defer OG/embed resolution behind an explicit gesture or tab choice (the Formatted tab is already the default — consider raw-first for approvals), or cap the fetched-URL count.

**A2 (Low): the popup's "no-network" preview isn't fully offline.** `renderLightNote` sets `im.src`/`v.src` for media URLs (prompt.js:193-203), so the popup also makes page-directed requests at review time (`no-referrer` limits the leak). The comment overstates the guarantee. *Fix:* don't set `src` in review mode.

Carried-over observations, confirmed still open and still no-impact today: `noteLike`/unreadable checks assume a normalized kind, safe only via `normalizeSignEventParams` at the `handleNostrRpc` boundary (doc item d); `buildWebComment` emits no `q` tags, so page-composed kind-1111 comments cannot quote (doc item e); the nostr-provider `writeText` wrapper is non-breaking (page can only suppress, not forge) and re-validated on receipt.

---

## 5. Relay-controlled data and trust decisions

**`ws-guard.js` — clean.** Pure WebSocket plumbing (self-closing subclass, 15 s connect reap, 64 pending cap); parses nothing relay-controlled, no DOM contact. Observation only: `reap()` force-closes the oldest pending socket at the cap without checking the deadline — self-limiting, no attacker leverage beyond slowness.

**`relay-health.js` — well-designed, two hardening items.**
Verified: `classify()` fails `writeSafe` *closed*; NIP-42 auth signing is caller-supplied and the panel gates it behind the relay allowlist with the `relay` tag re-derived and checked (sidepanel.js:13030-13035), so a relay cannot trick a sign to a non-allowlisted target; probe results render via `textContent` only.

- **R1 (Low): the NIP-11 `icon` is relay-controlled and becomes a persistent image fetch with no scheme/host validation.** relay-health.js:63-64 returns it verbatim; it is assigned as `img.src` (sidepanel.js:12776, 12797) and cached to `chrome.storage.local` for a month (12717-12730). A relay operator gets a tracking pixel fetched every time the relay editor renders that row. Not XSS (`img.src` won't execute `javascript:`, `no-referrer` set). *Fix:* require `https:` like the OG image path already does (10189).
- **R2 (observation): `nip11()` fetches without the background's `safeFetchUrl` guards** — `httpFromWss` can produce `http://`, no private-host check. URLs come from the user's own relay list, so self-inflicted only; a `ws://127.0.0.1` entry probes localhost from the panel.

**`wot.js` + search integration — the sybil question (issue #298).**
A relay cannot fabricate trust: votes are `p`-tags of kind:3 events fetched through `SimplePool` with signature verification on (no `skipVerification`), so a malicious relay can only serve stale-but-genuine follow lists (keep retracted votes alive, or drop votes — fail-open by design). Vote hygiene is correct: newest-list-per-author with in-list dedup, so relay count-multiplication does not occur. Residual gaps, both design-level:

- **R3 (observation, medium): when the WoT set is cold, ranking falls back entirely to the third-party index order** (sidepanel.js:2158), and Enter auto-picks `searchResults[0]` (2272) — the surviving half of #298: the nostrarchives index decides which lookalike sits on top until the set warms. *Mitigation:* don't auto-pick index-only results on Enter when `!warm`, or surface npub-similarity with the name.
- **R4 (observation): the WoT set is day-TTL cached** and keyed on 16-truncated hex (documented collision odds), so a retracted vouch ranks for up to a day.

**`sidepanel.js` by surface — verified clean.** All 100 `innerHTML`/`insertAdjacentHTML` hits are static markup (icon tables, SVG constants, clears); dynamic data goes through `h()`/`textContent`; the inert-textarea `decodeHtml` feeds `textContent` only. Profile `website` is scheme-normalized to `http(s)` (so no `javascript:` href), note/embed URL regexes anchor on `https?://`, NIP-05 is forced HTTPS, `picture`/`banner` go to `img.src` unvalidated (IP disclosure to a profile-chosen host — inherent Nostr tradeoff, `no-referrer` set). Zap/payment paths re-verified at payment time (limits re-fetched, amounts clamped, msats integer, metadata parsed with length caps and data-URI-only images, amountless invoices never auto-pay). The new Lightning-address/QR surfaces (PRs #317-318) render via `textContent` and canvas QR with an honest zap-vs-pay distinction — no spoofing or injection path.

---

## 6. Shipped surface: relay-rider, manifest, packaging

**`relay-rider.js` — verified inert, independently of its test.** Read in full: zero `chrome.*`/`browser.*`, zero `fetch`/`WebSocket`/`XMLHttpRequest`, zero remote URLs; only persistence is its own-origin `localStorage` best-score; no `eval`/`new Function`/`innerHTML`/`document.write`; no `message`/`storage`/`runtime` listeners; input is a fixed keycode map. Not web-accessible (no `web_accessible_resources`), lazily iframe'd and torn down on close, and a MutationObserver force-closes it whenever the approval or lock view appears, with its overlay z-index below the reserved modal band — an approval can never sit behind the game. (Deliberately undocumented by design; absence from CHANGELOG/help is not treated as a finding, per the handoff.)

**`manifest.json`** — four changes since `e781743`, all benign or net-restrictive: version bump; `ws-guard.js` added to background scripts (plumbing, above); **`"externally_connectable": {}`** — the deny-everything form (prior audit's E4, done); no new permissions, no CSP override, no `web_accessible_resources`.

**`scripts/package.sh`** — allow-listed by construction: `git archive <tag>` + explicit removals (`.claude`, `.github`, `scripts`, `assets`, `test`, `docs`, all top-level `*.md` by glob, `package.json`); `version.js` regenerated from the tag. Verified via `git check-ignore` that `font-preview.html`, `theme-preview.html`, and `local-backups/` are gitignored and never enter the archive. Nothing added in this range reaches the zip.

**New small files** — `emoji-data.js` (generated literal, hash-pinned), `theme-tile.js`/`.html` (query param used only as a data attribute and an `encodeURIComponent`'d stylesheet path, DOM built with `createElement`) — clean. `welcome.js` changes are static app-catalog entries.

**P1 (Low, privacy): new app-catalog entries hotlink third-party icon URLs** (`razr.social`, `grimoire.rocks`, `nostrhub.io` apple-touch-icons; welcome.js:296-341), joining the pre-existing Google favicon fallback — the contacted hosts learn a Sidecar user's IP at onboarding, and PRIVACY.md's "the services above are the only ones it contacts" doesn't list them. *Fix:* bundle the icons locally (as already done for other entries) or add the disclosure.

**PRIVACY.md** otherwise verified accurate against the code: encrypted drafts/pay-meta, site records and "Forget all sites," the opt-in nostrarchives index, relay-icon caching, boostagram exposure all match.

---

## 7. Prior audit open items — verdicts

| Item | Verdict | Evidence |
|---|---|---|
| M1 `SIDECAR_GET_NWC` split | **Fixed** | GET_NWC hard-gated to `sidepanel.html` sender (background.js:3525-3543); raw string only via `REVEAL_NWC` + `stepUpPin` (3545-3550); `SIDECAR_NWC_META` is metadata-only; sole GET_NWC caller is the in-memory wallet client (sidepanel.js:14821); test pins backup code uses neither |
| M2 WebLN read consent | **Fixed** | `weblnReadGate` prompts once per (host, pubkey), session-stored grant, cleared on lock; enforced at getInfo/getBalance/makeInvoice (background.js:1744-1835); `trusted` stays silent by design |
| E2 host from `sender.url` | **Fixed** | Both RPC handlers derive `rpcHost = new URL(sender.url).host` (3767-3770); body hosts discarded everywhere |
| N4 https LNURL callbacks | **Fixed** | Both callback fetches guard `protocol !== 'https:'` (sidepanel.js:16680-16681, 16699-16705); keysend has no callback URL — structurally N/A |
| N3 QR-image via `safeFetchUrl` | **Fixed** | `invoiceFromQrImage` calls `safeFetchUrl` first (background.js:2795-2802) |
| K3 `logn` cap | **Fixed** (caveats → K-C) | Enforced pre-scrypt in `decryptNcryptsec` (sidepanel.js:6684) on both worker and sync paths |
| E4 `externally_connectable` | **Fixed** | `manifest.json:65`, deny-everything form; no `onMessageExternal` |
| M3 nostrarchives | **Fixed** (opt-in) | Tri-state setting, `naEnabled()` gate on every send, first-use inline ask, 429 backoff (sidepanel.js:9048-9135); PRIVACY.md documents the disclosure; no non-catalog code path queries it |
| M4 ncryptsec backup + save picker | **Fixed** (different, sound shape) | Encrypted mode renders an ncryptsec QR page (pdf-backup.js:299-330, 862, 988); deliberately either/or — a PDF with both plain and encrypted pages would defeat the encryption (comment 323-328); `showSaveFilePicker` at sidepanel.js:7357-7377 |
| S1/S2/M6 encrypted stores + clear history | **Fixed** | `SECRET_STORES` AES-GCM for drafts and pay-meta with write-then-remove migration (background.js:214-297); `SIDECAR_FORGET_ALL_SITES` + per-site forget + UI; PRIVACY.md documents both |
| K4 `trusted` silent DM decrypt | **Kept, labeled** (deliberate) | Semantics unchanged (permissions.js:92-94); both decrypt prompts now say "Trust this site and it can read your messages without asking, until you revoke" (prompt.js:528, sidepanel.js:17789). Matches the audit's own framing; argue with the tradeoff, not the label |
| Hygiene list | **All fixed** | crypto.js header corrected; qrSecret comment accurate; `nsecEncode` inside try; `no-referrer` on `<video>`; `update-vendor.sh` refuses hash changes without `--accept-hash-change`; NOTICE carries jsQR Apache-2.0; `ws://` warned in both editors (deliberate warn-not-reject); NWC backup is NIP-44-write-only (NIP-04 read for old backups); follow/mute-list NIP-04 write fallback survives only for the 65KB cap, disclosed in UI |

The 2026-08-14 audit's "positive findings worth preserving" were re-checked and all still hold: sender gate, unspoofable prompts, grant keying with pipe delimiter, top-frame-only content scripts, no telemetry/sync-storage/remote code, hash-pinned vendors with CI enforcement.

---

## 8. `docs/issue-kind-1-nevent-signing.md` open items — verdicts

| Item | Verdict | This report |
|---|---|---|
| (a) Batch approvals preview only the head | **Confirmed open** | **G1 / M1** — Medium |
| (b) `batchKeyOf` null-kind grouping | **Confirmed open** | G2 — Low |
| (c) Panel preview touches network pre-approval | **Confirmed open** | **A1 / M2** — Medium; plus A2 (popup not fully offline either) |
| (d) `noteLike` assumes normalized kind | **Confirmed, observation** | Safe solely via `normalizeSignEventParams`; any future prompt-data path reopens it |
| (e) Page comments can't quote | **Confirmed, observation** | `buildWebComment` emits no `q` tags (sidepanel.js:3550-3569) |
| (f) User rejections not logged | **Confirmed open** | G3 — Low |

---

## 9. Known-live issues (handoff §5) — security relevance

- **#298 (impersonators in search):** structurally half-mitigated by WoT ranking — a relay cannot fabricate vouches (signature-verified, newest-list-per-author), but the cold-set fallback leaves index ordering in charge (R3).
- **#274 (`getRelays()` ignores NIP-65 and the "only my relays" toggle):** confirmed as a privacy/intent violation by the relay-traffic review — the publish/read relay set was re-verified everywhere else; this RPC surface remains the gap. Privacy, not key-exposure.
- **#280 (Activity shows that something was signed, not what):** auditability gap; compounded by G3 (rejections leave no record at all).
- **#207 (passkey unlock):** relevant to Tier 1 — the slot *structure* is ready, but no WebAuthn surface exists yet to review.

---

## Prioritized recommendations

**Fix now (next patch release):**
1. **M1/G1** — Batch "Allow all (N)": put a content hash in the batch key or render all N payloads before offering the group approve.
2. **M3/W1** — Route the BOLT11 invoice path through `BUDGETS.reserve()`/`refund()` exactly as keysend already does (the primitives exist and are serialized); fold W3 (auto-zap window write inside the lock) into the same change.
3. **M5/K-A** — Close the `ensureLoaded`/`lock` race (re-check `dek === null` after awaits or share the mutex).
4. **M2/A1** — Stop the panel approval preview from fetching OG/embeds/profiles before a decision (defer behind a gesture/tab, or cap); fix A2's `src` assignment in the popup while there.
5. **K-B** — Clear the v1 keystore backup at the end of `changePin()`'s migration path.
6. **B1** — Sweep expired `sealedText` on the existing 1-min alarm and cap the stored plaintext size.

**Design decisions needed:**
7. **M4/W2** — Decide whether zap approvals must bind the payee; if BOLT11 makes that impractical, document the site's lnurl flow as a trusted party in the zap UI.
8. **R3/#298** — Decide the cold-WoT fallback: no auto-pick of index-only results on Enter, or an explicit "unverified" marker.
9. **G3/#280** — Decide the Activity log's contract: what a signed entry records, and that rejections are recorded at all.

**Hygiene:**
10. G2 (`method` in the batch key), R1 (https-only NIP-11 icons), R2 (`safeFetchUrl` in `relay-health.nip11`), W4 (serialize `ZAPREQ.record`/`claim`), K-C (cap the raw panel `SidecarNip49` global), P1 (bundle or disclose the app-catalog icons), A2's comment wording, and carry forward #274.

---

## Conclusion

The interval since the last audit was the product's largest: a keystore re-architecture, a new spend method, two new approval UX layers, and several new network surfaces. The architecture not only held, it improved in kind — the slot design removes a whole failure class structurally, `reserve()`-style budgeting shows the right pattern (and its absence on the invoice path is notable precisely because the better pattern now sits next to it), the sealed-content memory was scoped so the page can never read it back, and even the hidden game was built with an approval-never-behind-the-overlay guarantee that its test pins. The five Mediums are consent and race gaps — batch approval scope, pre-approval network touches, two budget/approval races, and one lock race — all fixable without architectural change, none offering a path to key material. The prior audit's recommendations were acted on completely and correctly, with reasons recorded where the resolution differs from the recommendation.

*Report generated 2026-09-13 by GLM 5.3 (z.ai). Findings reference code as of commit `61095f1` (main, post-1.12.0). Tests: 1389 pass, 0 fail.*
