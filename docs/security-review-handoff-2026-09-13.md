# Handoff: full security and bug review, 1.9.1 through 1.13 (unreleased)

**For:** an agent picking this up cold.
**Written:** 2026-09-13.
**Ask:** a full security and bug review of everything that has shipped since the last full
audit.

---

## 1. Scope, exactly

The last full audit is `docs/security-audit-2026-08-14.md`, merged as PR #188 at commit
`e781743`. Everything after that commit is your scope and nothing before it is.

```
git log --oneline e781743..main
git diff --stat e781743..main
```

What that range contains, as of 2026-09-13:

| | |
|---|---|
| Commits | 327 |
| Merged PRs | 97 |
| Files touched | 201 |
| Releases | 1.9.1 (08-19), 1.10.0 (08-26), 1.11.0 (08-30), 1.12.0 (09-04) |
| Unreleased | everything on `main` since 1.12.0, shipping as 1.13 |

Two prior documents already cover part of this. Read both before starting so you do not
repeat them:

- `docs/security-audit-2026-08-14.md` is the baseline. Its threat model and its
  "Positive findings worth preserving" sections are still the reference; do not re-derive
  them, verify they still hold.
- `docs/security-review-1.10.0.md` covers only the 1.9.1 to 1.10.0 range and only five
  areas. It is a narrow pass, not an audit. Treat 1.10.0 as reviewed-lightly, not reviewed.

That leaves **1.10.0 through 1.13 essentially unreviewed**, which is the bulk of the range.

---

## 2. Verify the last audit's open items first

This is the cheapest high-value work in the whole job, because the findings are already
written and you only have to check whether they were acted on. From that audit's
"Prioritized recommendations":

**Claimed fix-now items.** Check each one landed and landed correctly, not just that a
commit mentions it:

- **M1** `SIDECAR_GET_NWC` split so the raw connection string is only behind `REVEAL_NWC`'s
  step-up.
- **M2** WebLN `getBalance` / `getInfo` gated by permission tier or a per-(account, host)
  prompt.
- **E2** `host` derived from `sender.url` in both RPC handlers, not from the message body.
- **N4** `https:` required on LNURL callbacks. I can see three `protocol !== 'https:'`
  guards in `sidepanel.js`, so this looks done. Confirm they cover every callback path,
  including the keysend one added by PR #291.
- **N3** QR-image fetch routed through `safeFetchUrl`. **Probably NOT done.**
  `safeFetchUrl` appears only in `background.js` and has zero uses in `sidepanel.js`. Start
  here; it is a concrete, checkable gap.
- **K3** `logn` capped on ncryptsec decrypt. `nip49.js` is vendored and hash-pinned, and
  there is now a `nip49-worker.js`; check where the cap actually lives.
- **E4** `"externally_connectable"` declared. Present in `manifest.json`. Confirm the value
  is the deny-everything form.

**Product decisions that were left open.** Find out whether each was decided, and if so
whether the decision is reflected in `PRIVACY.md`:

- **M3** nostrarchives as a social-graph disclosure. It now appears only as an app-catalog
  entry in `welcome.js`, not as a search API. Verify no code path still queries it.
- **M4** ncryptsec-QR in the backup sheet, `showSaveFilePicker`.
- **S1 / S2 / M6** encrypting drafts and pay-meta, and a "clear site history" affordance.
- **K4** whether `trusted` keeps silent DM decrypt.

**Hygiene list.** Item 10 of that section is a list of small things (false comments in
`crypto.js` and the `qrSecret` TTL, `nsecEncode` inside the try, `no-referrer` on `<video>`,
T1 hash-challenge in `update-vendor.sh`, an Apache-2.0 NOTICE for jsQR, `ws://` rejection,
the NIP-04 fallback on the NWC relay backup). Sweep it.

---

## 3. Where to look, in priority order

Churn numbers below are `e781743..main`. High churn in a security-critical file is the
signal; high churn in a theme file is not.

### Tier 1: key material and spend paths

Anything here can lose someone their identity or their money.

- **`keystore.js`** (+296 / -38). The passkey key-slot work landed in this range. Slot
  migration is the thing to read hardest: a migration that leaves an old slot decryptable,
  or that can be made to run twice, is the worst bug available in this codebase. See
  `test/keystore-slot-migration.test.js` for what the author believed.
- **`pdf-backup.js`** (+680 / -46). This prints private keys onto a page. Nearly doubled in
  size. Check what reaches the DOM, what reaches a blob URL, and whether anything is left
  in memory or in a detached document afterwards.
- **`nip49-worker.js`** (new, 24 lines). Small, but it exists to move ncryptsec work off the
  main thread, so check what crosses the worker boundary and whether the worker is
  terminated.
- **`crypto.js`** (+6 / -3). Tiny diff, but read all of it.
- **WebLN keysend, PR #291.** From an outside contributor. A spend path reachable from a
  website. Check amount handling, the budget interaction, and that the destination is
  validated. Note the reporter observed per-recipient splitting behavior during testing, so
  confirm the loop cannot be driven past a budget by a page.
- **`wallet-budgets.js`**, `zap-requests.js`. Budget enforcement is the only thing between
  a compromised or hostile page and a drained wallet.

### Tier 2: the gate between a website and a key

- **`background.js`** (+1121 / -53). The message router, the permission tiers, the prompt
  payloads. Re-verify the router's gating end to end rather than trusting the prior audit,
  because a third of the file is new.
  - Specifically: the "sealed content" memory added in #316 / #317 holds **plaintext** in a
    `Map` in the service worker for 120 seconds, keyed by host, pubkey and ciphertext. It is
    new state that holds decrypted user content. Check the key scoping, the TTL, the cap,
    and that it can never be read by the page (it should only reach the approval surfaces).
- **`content.js`** (+477 / -32). Injects UI into arbitrary pages and parses page-supplied
  invoices. The pay pill is new in this range. This is a prime spoofing and injection
  surface: check that nothing from the page reaches innerHTML, and that the pill cannot be
  made to impersonate extension chrome.
- **`prompt.js`** (+219 / -29) and the panel's inline approval. **Approvals render in two
  places**, `prompt.html` and `sidepanel.js`. A fix or a gap in one is not a fix or a gap in
  both. Enumerate both surfaces for every finding here.
- **`permissions.js`**, **`relax-grants.js`**. Relax mode is timed auto-signing on a shared
  host, which is the highest-consequence consent feature in the product. Check expiry,
  re-binding, and that a grant cannot outlive an account switch.

### Tier 3: relay-controlled data and trust decisions

- **`ws-guard.js`** (new, 89 lines) and **`relay-health.js`** (new, 297). Both new network
  surfaces, neither ever reviewed.
- **`wot.js`** (new, 200). Ranks search results by web of trust. It makes no network calls
  itself, but it turns relay-supplied data into a trust signal shown to the user, and issue
  #298 is open about impersonators in search. A wrong answer here has a phishing
  consequence, so treat correctness bugs as security bugs.
- **`sidepanel.js`** (+7304 / -504). The bulk of the range. You cannot read all of it. Read
  it by surface: every place a relay-supplied string becomes DOM, every place a profile
  field becomes an href, every `innerHTML`, and the zap and payment paths.

### Tier 4: shipped surface area

- **`relay-rider.js`** (new, 1087 lines) plus `relay-rider.html`. This is a hidden game,
  reachable from the mark at the foot of the About card. **Review it as shipped code**, it
  is real attack surface in the packaged extension. `test/relay-rider.test.js` asserts it
  touches no `chrome.*`, no `fetch`, no `WebSocket` and no settings; verify that is true
  rather than assuming. One thing to know: it is deliberately undocumented, and it is
  absent from `CHANGELOG.md`, `help.html` and the site on purpose. Do not add it to any of
  them, and do not treat its absence there as a finding.
- **`manifest.json`** (+3 / -1). Small diff, read every line.
- **`scripts/package.sh`**. Decides what ships. Confirm nothing added in this range
  (`test/`, `docs/`, `.claude/`, scratch files) reaches the zip.
- New files never reviewed at all: `emoji-data.js`, `theme-tile.js`, plus the Tier 1 and 3
  files already listed.

---

## 4. A doc that is already half your report

`docs/issue-kind-1-nevent-signing.md` closes with a section titled **"Open, Reviewed But Not
Changed"**: six things found while investigating that bug, none of them fixed, at least two
of which are consent problems rather than cosmetics. Start there, because someone already
did the reading:

- **Batched approvals preview only the head.** `pendingView` groups the showing request with
  every queued entry sharing host, account and kind, and "Allow all (N)" signs the group.
  Same-kind does stop a site slipping a different event type into a batch, but two different
  notes are the same kind, so a site can have a second kind-1 signed off a card that
  describes the first. Confirm or refute this; if it holds it is the most serious thing in
  the document.
- **`batchKeyOf` groups on a null kind**, so `nip04.encrypt` and `nip44.encrypt` from one
  host and account share a batch key despite being different methods.
- **The panel's approval preview touches the network before approval.**
  `renderNotePreview` resolves embeds from relays and fetches OG metadata for every https
  link in the content, from the signing screen. `prompt.js` deliberately does the opposite.
  A request merely being reviewed has already reached out.
- **`noteLike` and the unreadable check assume a normalized kind**, safe only because
  `handleNostrRpc` guarantees it today.
- **Page comments cannot quote** (`buildWebComment` emits no `q` tags).
- **User rejections are not logged**, so "I said no and it happened anyway" would arrive
  with no evidence.

The same file's "Regression Coverage" section names the tests that already exist
(`sign-event-shape`, `approval-kind-isolation`, `quote-tags`), which tells you what is
already defended and what is not.

---

## 5. Known-live issues worth folding in

These are open and may be security-adjacent rather than cosmetic:

- **#298** search cannot distinguish an impersonator from the real account. Phishing.
- **#274** `getRelays()` ignores NIP-65 and the "use only my relays" toggle, so clients
  publish to relays the user excluded. A privacy and intent violation, not just a bug.
- **#280** Recent Activity shows that something was signed but not what. An auditability
  gap in the one log the user has.
- **#207** passkey unlock. Touches the keystore; relevant to Tier 1.

---

## 6. How to run and verify

- **`npm test` is fully green.** 1389 tests, 0 failures as of 2026-09-13. If you find an
  older note claiming the suite is permanently two-red over `nostr-tools`, that is stale and
  was fixed; those tests now load the vendored bundle through `vm`. **A red run is a real
  regression, so do not excuse one.**
- **CI does not run the tests.** The `verify` job runs `sha256sum -c` against
  `scripts/vendor-hashes.sha256` and nothing else. A green check on a PR says the vendored
  files are unmodified. It says nothing about correctness.
- **Testing unpacked has three traps**, all of which will waste your time and send you
  chasing phantom bugs:
  1. Reloading the extension is not enough. Reload the extension, then the page tab (the
     provider is injected at `document_start`), then close and reopen the side panel.
  2. `version.js` lies after a branch checkout.
  3. The extension ID comes from the load path, so never uninstall and reload from a
     different directory.
  Before theorizing about any behavior, confirm which build is actually live by checking the
  service worker console.
- The MV3 service worker is evicted at roughly 30 seconds idle. Any finding that depends on
  in-memory state in `background.js` must account for that, in both directions: state that
  is lost, and state that survives longer than intended.

---

## 7. What to produce

Write `docs/security-audit-2026-09-13.md`, following the structure of the 2026-08-14 audit
so the two can be read side by side: executive summary, threat model delta, numbered
sections per surface, findings with severity, positive findings worth preserving, and a
prioritized recommendations list at the end.

For each finding give the file and line, the concrete path from attacker to impact, and a
proposed fix. A finding without a path to impact is an observation, so label it as one.

Also produce a short verdict on each of the prior audit's open items from section 2 above:
fixed, not fixed, or no longer applicable.

---

## 8. Ground rules

- **Report, do not fix.** This is a review. Do not change product code, do not commit, do
  not push, and do not open issues without asking first. The document is the deliverable.
- **Do not delete branches or close issues** on your own judgment.
- Never publish or quote real user content, keys, or spam-campaign text in findings or
  fixtures; use synthetic examples.
- If you need to test against a live Lightning address or relay, ask first rather than
  spending from a real wallet.
- Where the prior audit recorded a design decision with a reason, argue with the reason
  rather than restating the finding. Several of the open items are deliberate trade-offs,
  not oversights.
