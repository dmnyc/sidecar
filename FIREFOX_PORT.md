# Firefox Port Plan

Plan for porting Sidecar to Firefox at **1:1 feature parity** with the Chrome build,
from a full audit of the codebase (v1.3.0, refreshed against v1.4.0 — see Status).
The good news up front: Sidecar's architecture (plain JS, no build step, `chrome.*`
callback style, `storage.session` for lock state, a persisted request queue that
already assumes the background can die at any moment) is unusually Firefox-friendly.
The port is a handful of surgical changes plus one genuinely new piece of UX
(host-permission granting), not a rewrite.

## Status — resumed post-1.4.0

The port paused while 1.4.0 shipped to Chrome. The branch has since been rebased
onto 1.4.0 (plus the auto-lock UI follow-up), the cross-browser origin-gate fix is
folded in, and implementation is complete through W6:

| Workstream | State |
|---|---|
| W1 manifest (one file, both browsers) | ✅ done |
| W2 background event page | ✅ done (lifetime tests remain — see W2 item 4) |
| W3 MAIN-world provider injection | ✅ done — Chrome benefits too (CSP-proof, race-free) |
| W4 host-permission recovery UX | ✅ done — panel banner, welcome-page gate, live grant/revoke listeners |
| W5 sidebar wiring | ✅ done |
| W6 shims | ✅ done in code (update check, scrollbars, pay-menu fallback); popup sizing + clipboard are QA items |
| W7 docs | README + help notes done; PRIVACY.md line deferred to AMO submission |
| W8 AMO listing | not started — holds until the parity benchmark passes |

**1.4.0 audit deltas** — features added since the original v1.3.0 audit, all
Firefox-clean: the debug panel (#103), auto-lock hardening + settings UI +
composer-typing activity (#105/#110), the What's-new help section pinned to the
build's tag, draft @-mention rehydration (#108), and the supply-chain refresh
(#107: nostr-tools 2.23.11, MIT QR encoder — panel-side only). None add
Chrome-only API surface, and the background's `importScripts` list — and therefore
the manifest `background.scripts` list — is unchanged.

One real parity bug was found and fixed during the refresh: **dev-build detection**
keyed off a missing manifest `update_url`, which Chrome's Web Store injects at
packaging time but AMO never does — so every production Firefox install would have
been treated as a dev build (bug button, debug-log buffering). Detection now asks
`management.getSelf()` for `installType === 'development'` on Firefox and fails
closed while that async answer is pending.

**Next:** run the parity benchmark below on Firefox 128 ESR + current release,
then W8.

## Target baseline

**Firefox 128 (ESR) or later**, because 128 is the first release with everything we
need in one place:

| Capability we rely on | Minimum Firefox |
|---|---|
| `storage.session` | 115 |
| `background.scripts` + `background.service_worker` coexisting in one manifest | 121 |
| Host permissions shown in the MV3 install prompt | 127 |
| `world: "MAIN"` in `content_scripts` (CSP-proof provider injection) | **128** |
| `optional_host_permissions` | **128** |

Set `browser_specific_settings.gecko.strict_min_version: "128.0"`.

**Out of scope:** Firefox for Android (no `sidebar_action` there — the whole UI has
no home). Revisit as a separate project if there's demand.

## Compatibility audit

Everything `chrome.*` the code touches, and its fate on Firefox (the `chrome.`
namespace itself works in Firefox, callbacks and `runtime.lastError` included — no
polyfill needed):

| API surface | Where | Firefox status |
|---|---|---|
| `storage.local`, `storage.session`, `storage.onChanged` | keystore, crypto, permissions, budgets, panel | ✅ Works as-is |
| `runtime.sendMessage/onMessage/connect/onConnect/getURL/getManifest/reload/id` | all layers | ✅ Works as-is |
| `tabs.query/create/update/reload/sendMessage` | panel, background | ✅ Works as-is |
| `windows.create/get/getCurrent/update/remove/onRemoved` (prompt popup placement) | `background.js:384–430` | ✅ Works as-is |
| `alarms` (auto-lock, queue keepalive) | `background.js` | ✅ Works; verify sub-minute clamping (see W2) |
| `notifications.create` (`type: 'basic'`) | `background.js:1220` | ✅ Works as-is |
| `contextMenus` (link/selection/image pay menus) | `background.js:1293–1298` | ✅ Works; verify `targetUrlPatterns: ['lightning:*']` (see W6) |
| `chrome.runtime.onInstalled/onStartup` | `background.js` | ✅ Works as-is |
| **`background.service_worker` + `importScripts`** | `manifest.json`, `background.js:11`, `background.js:1272` | ❌ Firefox MV3 has no SW background — event page instead |
| **`chrome.sidePanel.*`** (`setPanelBehavior`, `open`) | `background.js:187,195` | ❌ Firefox uses `sidebar_action` / `sidebarAction` |
| **`chrome.runtime.requestUpdateCheck`** | `sidepanel.js` (About + Settings) | ✅ Feature-detected and hidden on Firefox (done; AMO auto-updates) |
| **`<script src>` provider injection** | was `content.js` | ✅ Replaced by a `world: "MAIN"` content script (W3, done — Chrome too) |
| **`host_permissions: ["https://*/*"]` granted at install** | `manifest.json` | ✅ Grant-recovery UX shipped (W4, done): panel banner + welcome gate |
| **`update_url` absent ⇒ dev build** heuristic | `background.js`, `sidepanel.js` | ✅ Fixed — AMO never injects `update_url`; Firefox now uses `management.getSelf().installType` |
| `navigator.clipboard.writeText` (copy npub/invoice/etc.) | `sidepanel.js` (8 call sites) | ✅ Works in user-gesture handlers; QA item |
| `::-webkit-scrollbar*`, `::-webkit-details-marker` | `styles.css` | ⚠️ Cosmetic — add Firefox equivalents (W6) |

Everything else — WebCrypto (PBKDF2/AES-GCM), WebSocket relay + NWC connections,
`fetch` from background and panel (CORS-exempt for granted hosts), fonts, QR libs —
is standard web platform and carries over unchanged.

## Workstreams

### W1 — Manifest: one file, both browsers (no build step added)

Chrome ≥121 and Firefox ≥121 each ignore the other's keys, so a single
`manifest.json` serves both and preserves the "no build step" property:

- `background`: keep `service_worker: "background.js"`, **add**
  `scripts: ["nostr-tools.js", "crypto.js", "keystore.js", "permissions.js", "signer.js", "wallet-budgets.js", "nwc-client.js", "jsqr.js", "background.js"]`.
  Chrome uses the worker; Firefox loads the scripts list into an event page.
- **Add** `sidebar_action`: `{ "default_panel": "sidepanel.html", "default_title": "Sidecar", "default_icon": "icons/icon48.png", "open_at_install": false }`
  alongside the existing `side_panel` key.
- **Add** `browser_specific_settings.gecko`: `{ "id": "sidecar@sidecar.top", "strict_min_version": "128.0" }`
  (an explicit ID is mandatory for MV3 on AMO; Chrome ignores the key with a console warning).
- Content-script change per W3 below.

Fallback if the Chrome Web Store ever rejects the extra keys (it currently only
warns): a ~10-line `scripts/package-firefox.sh` that strips/patches the manifest
into a `dist-firefox/` zip. Plan A is the single manifest; keep the script in the
back pocket.

### W2 — Background: service worker → event page

Firefox runs the background as a non-persistent **event page** (a hidden window,
not a worker). It suspends after ~30s idle just like Chrome's SW, so Sidecar's
existing survival machinery — keystore state mirrored to `storage.session`, the
persisted request queue + reconcile, alarms for auto-lock — is exactly the right
design already. Changes:

1. `background.js:11` — guard the eager load:
   `if (typeof importScripts === 'function') importScripts(...)`.
   In Chrome the SW loads its deps as today; in Firefox the manifest `scripts`
   list (W1) has already loaded them in the same order. No other code motion.
2. `background.js:1272` — the lazy `importScripts('jsqr.js')` for QR-image paying:
   same guard. Firefox gets `jsqr.js` from the manifest list (256 KB parsed once
   per event-page start; acceptable, and only when the background wakes).
3. `self.SidecarKeystore` etc. — `self` exists on both a worker and a window; no change.
4. **Lifetime verification (test, not code):** confirm on Firefox that
   (a) the 0.5-minute queue-keepalive alarm actually fires at 30s or is clamped to
   60s — either is fine since correctness rests on the queue, but we should know;
   (b) an in-flight NWC payment over WebSocket completes if the event page is
   near its idle limit; (c) `about:debugging` → *Terminate background script*
   mid-queue reproduces the same recover-on-wake behavior we get from Chrome's SW
   kills.

### W3 — Provider injection: `world: "MAIN"` content script

Today `content.js:10–15` injects `nostr-provider.js` via a `<script src>` tag. On
Firefox, a strict page CSP **can block that**, silently breaking `window.nostr` on
exactly the security-conscious sites a signer serves. Firefox 128's `world: "MAIN"`
injection is explicitly not subject to page CSP — and Chrome has supported the same
key since 111. So fix it once, for both browsers, at the root:

- Add a second `content_scripts` entry:
  `{ "matches": ["<all_urls>"], "js": ["nostr-provider.js"], "run_at": "document_start", "world": "MAIN", "all_frames": false }`.
- Delete the tag-injection block from `content.js` (and the now-unneeded
  `web_accessible_resources` entry).
- `nostr-provider.js` already talks to `content.js` over `window.postMessage`-style
  eventing, which is identical in a MAIN-world script. Verify the
  document_start ordering guarantee (provider must define `window.nostr` before any
  page script runs) on both browsers.

This is the one change that also *improves* the Chrome build (guaranteed-synchronous
injection, no more races on fast-executing pages).

### W4 — Host permissions UX (the real new work)

On Firefox MV3, `host_permissions: ["https://*/*"]` is shown in the install prompt
(127+) but the user can **uncheck it, or revoke it later** from `about:addons`.
Without the grant: no content script → no `window.nostr`, no paste guard, no
Pay-with-Sidecar card; background `fetch`es (link previews, LNURL, profile imports,
uploads) lose their CORS exemption. Chrome has no equivalent state, so this is the
one place parity requires *new* surface:

1. **Detection** — on panel init, `browser.permissions.contains({ origins: ['https://*/*'] })`.
2. **Recovery UI** — if missing, a persistent, non-dismissable banner in the side
   panel: *"Sidecar can't see websites yet — grant access to sign in on Nostr
   apps"*, with a button that calls `permissions.request(...)` (valid gesture:
   button click in an extension page).
3. **Onboarding** — the welcome/first-run flow checks the grant before declaring
   setup complete.
4. **`permissions.onRemoved` listener** — flip the banner back on live if the user
   revokes mid-session.
5. Guard all four `chrome.permissions` calls so they're no-ops on Chrome (where
   `contains` simply always returns true — the code can be unconditional, which
   keeps one code path).

For development: temporary loads via `about:debugging` grant install-time
permission requests silently on current Firefox (the `granted_host_permissions`
manifest key is privileged-only and ignored for ordinary add-ons — don't ship it).
If a dev build still lacks site access, it can be toggled at
`about:addons` → Permissions; the README dev-install section documents this.

### W5 — Sidebar wiring

- `background.js:186–188` — guard: `if (chrome.sidePanel) chrome.sidePanel.setPanelBehavior(...)`.
- `background.js:194–196` — in the `action.onClicked` listener:
  `if (chrome.sidePanel) { chrome.sidePanel.open({ tabId }) } else { browser.sidebarAction.toggle() }`.
  `sidebarAction.toggle()`/`.open()` must be called **synchronously** in the
  user-input handler — no `await` before it. The current listener is synchronous;
  keep it that way.
- Accepted platform variance: Chrome's panel is per-tab-ish, Firefox's sidebar is
  per-window and persists across tab switches. No code change; the panel already
  resolves "current tab" via `tabs.query({ active: true })` per operation. The
  prompt-popup placement logic (`background.js:384+`) is window-based and carries
  over untouched.

### W6 — Small shims and polish

| Item | Change |
|---|---|
| Update check button (`sidepanel.js:6658–6680`) | `if (!chrome.runtime.requestUpdateCheck)` hide the Updates control; AMO auto-updates. About dialog text says "updates via Firefox Add-ons" on Firefox. |
| `targetUrlPatterns: ['lightning:*']` (`background.js:1295`) | Verify Firefox accepts the non-standard scheme in menu URL patterns; if not, drop `targetUrlPatterns` on Firefox and filter by `info.linkUrl` prefix in the click handler (works everywhere). |
| Scrollbars (`styles.css`, 4 `::-webkit-scrollbar*` rules) | Add `scrollbar-width: thin; scrollbar-color: <thumb> <track>` on the same containers. |
| `::-webkit-details-marker` | Add `summary { list-style: none }` / `summary::marker { content: none }`. |
| Clipboard copies (8 sites in `sidepanel.js`) | All are click-handler-gated, so they should just work; QA each. Add `clipboardWrite` permission **only** if a copy proves flaky — it changes the AMO permission prompt. |
| Popup window chrome | Firefox `type: 'popup'` windows render slightly different chrome; verify the 400×628-ish prompt isn't clipped, adjust `POPUP_W/H` per-browser if needed. |
| Private browsing | Firefox disables extensions in PB windows by default; add a help.html note. |

### W7 — Docs & site

- README: Firefox install section (AMO link once live; dev flow =
  `about:debugging#/runtime/this-firefox` → *Load Temporary Add-on* → pick
  `manifest.json`), plus the host-permission grant step.
- `help.html` + `welcome.js` copy: anywhere that says "Chrome" or
  `chrome://extensions` gets browser-neutral or dual-path wording.
- PRIVACY.md: storage/permissions story is identical; add one line that Firefox
  users can revoke site access (and what breaks).
- sidecar.top: update via the existing `update-sidecar-site` flow once the AMO
  listing is live (add the AMO badge next to the Chrome Web Store one).

### W8 — AMO submission

- Register `sidecar@sidecar.top`; create the AMO listing (reuse Chrome Web Store
  copy/screenshots; retake the hero screenshot in Firefox chrome).
- No build step ⇒ the uploaded zip **is** the source; still pre-write reviewer
  notes: why `<all_urls>` (NIP-07 signers must be able to provide `window.nostr`
  on any Nostr client, which can be any domain), why `notifications`/`alarms`/
  `contextMenus`, and that all crypto is local (link PRIVACY.md).
- Expect a manual review pass given broad host permissions + key handling; budget
  calendar time (days-to-weeks), not work time.
- Versioning: keep versions in lockstep with Chrome from one tag; the single
  manifest makes this automatic.

## 1:1 parity benchmark

Parity is **measured, not asserted**: every feature below is executed on Chrome
(stable, as control) and Firefox 128 ESR + current release, same account fixtures,
same wallet, and must behave identically. The matrix lives as a checklist
(`docs/parity-firefox.md` or a tracking issue) with per-cell pass/fail + notes.

### Feature matrix (each row = scripted manual test)

| # | Feature | Acceptance check |
|---|---|---|
| 1 | First-run: PIN setup, strength meter | identical flow, keystore created |
| 2 | Generate key + guided profile setup (name/photo/bio, kind 0 publish) | profile visible on relays |
| 3 | Import nsec/hex with live profile preview; ncryptsec (NIP-49) import/export | preview renders; round-trip decrypts |
| 4 | Multi-account: add ≥3, drag-reorder, switch active, per-site binding + wrong-account guard, reload offer | binding survives switch; guard fires on multi-login clients |
| 5 | Lock/auto-lock: timer fires, background restart re-locks/restores per design | kill background mid-session (about:debugging / SW kill) — identical recovery |
| 6 | NIP-07 surface: `getPublicKey`, `signEvent`, `nip04.*`, `nip44.*`, `getRelays` | script-driven check on a test page, all six methods |
| 7 | Approval prompt: correct window placement (multi-window!), kind labels, queue counter, clear-backlog | burst 10 requests; none lost across a background kill |
| 8 | NIP-42 relay auth auto-sign | client stays connected, no prompt |
| 9 | nsec paste guard | blocked everywhere except import field |
| 10 | Per-site permissions & Connected Sites (approve, reject, move account, revoke); port-aware `localhost:3000` vs `:5173` | identical persistence |
| 11 | Profile: edit/publish kind 0, following count, NIP-05 check, lightning-address sync offer | identical |
| 12 | NIP-65 outbox editor (kind 10002 read/write markers) | publish + re-read |
| 13 | Backups: NIP-78 encrypted to relays, signed JSON export, vault export/restore **cross-browser** (Chrome vault → Firefox restore and vice versa) | byte-compatible restore |
| 14 | Follow-list recovery (kind 3 scan/republish) | identical candidate list |
| 15 | Composer: draft autosave, send countdown/cancel, @-mention pills (follows + global), note/nevent/naddr embeds, link previews, media upload (Blossom + nostr.build fallback), client tag toggle | post from Firefox verifiable in a client |
| 16 | Notifications page: replies/mentions/reposts/reactions/zaps, mute filtering, open-in-client | identical |
| 17 | System notification toasts (`notifications.create`) | renders (Firefox styling differs — allowed) |
| 18 | NWC wallet: connect, balance, send BOLT11 + lightning address (LNURL), receive invoice + QR, paginated history w/ details, connection backup/export | payment succeeds end-to-end |
| 19 | WebLN provider: approval prompt, per-site daily budget set/edit/revoke | budget enforced across background restarts |
| 20 | Pay-with-Sidecar card on invoice-showing pages | card appears on signed-in apps only |
| 21 | Context-menu pays: `lightning:` link, selected BOLT11, QR image | all three decode & prompt |
| 22 | Auto-approve zaps: under-limit silent, over-limit/daily-cap/non-zap/locked all prompt | identical thresholds |
| 23 | Help & welcome pages, About dialog | correct browser-specific copy (allowed variance) |
| 24 | Reset Sidecar (type-to-confirm wipe) | storage fully cleared |
| 25 | *(1.4.0)* Auto-lock settings UI: timer change applies immediately, migration notice, composer typing counts as activity | identical behavior + wording |
| 26 | *(1.4.0)* Debug panel & dev badge: appear on a temporary/unpacked load, NEVER on a store install (Chrome: `update_url`; Firefox: `management.getSelf`) | AMO-signed build shows no bug button |
| 27 | *(1.4.0)* Settings → What's new opens `help.html#whats-new` pinned to this build's tag | correct tag on both |
| 28 | *(1.4.0)* Composer draft resume rehydrates @-mention pills | identical |
| 29 | *(1.4.0)* Pay-with-Sidecar toggle persists and applies on page load (settings envelope fix) | saved "off" respected after reload |

### Firefox-specific adversarial tests

- **Strict-CSP page** — a local test page with `script-src 'self'`: `window.nostr`
  must exist (this is what W3 buys us).
- **Host permission revoked** mid-session — banner appears, re-grant restores
  everything without a browser restart.
- **Event-page kill** during: queued signing burst, in-flight NWC payment, composer
  countdown. Queue reconcile must match Chrome behavior.
- **Client grid** — sign in + sign + zap on: Jumble, Coracle, noStrudel, Primal,
  YakiHonne, Snort (the README's client families).

### Exit criteria

- 29/29 matrix rows pass on Firefox 128 ESR and current Firefox release.
- The only permitted deltas are the four **declared platform variances**:
  (1) sidebar is per-window not per-tab; (2) update-check button hidden (AMO
  auto-updates); (3) install-time host-permission prompt + recovery banner exists;
  (4) native toast styling. Anything else failing blocks release.
- Chrome regression pass on the same build (single manifest = single artifact),
  since W3 changes injection for Chrome too.

## Sequencing & effort

| Phase | Work | Estimate |
|---|---|---|
| 1 | W1 + W2 (manifest, background loading, first boot in Firefox) | ✅ done |
| 2 | W3 + W5 (MAIN-world injection, sidebar wiring) — signer usable end-to-end | ✅ done |
| 3 | W4 + W6 (permission UX, shims, CSS) | ✅ done |
| 4 | Full parity benchmark on both browsers + fixes it shakes out | 3–5 days — **next** |
| 5 | W7 + W8 (docs, site, AMO listing + review) | docs mostly done; AMO = 1 day work + review wait |

Phases 1–3 are implemented; what remains is testing latency, not build work. The
current branch is a temporarily-loadable Firefox build worth putting in testers'
hands now.

## Risks

| Risk | Mitigation |
|---|---|
| User declines/revokes host permissions and thinks Sidecar is broken | W4 banner + onboarding gate; help.html section |
| AMO review friction over `<all_urls>` + key custody | Reviewer notes prepared up front; plain-JS source is fully auditable |
| Firefox event-page suspension differs subtly from Chrome SW timing | The queue/reconcile design is timing-agnostic; adversarial kill tests in the benchmark |
| Chrome Web Store objects to Firefox-only manifest keys | Currently warning-only; packaging script fallback ready |
| `world: "MAIN"` regression on Chrome (injection rewrite) | Benchmark runs the full matrix on Chrome too before release |
