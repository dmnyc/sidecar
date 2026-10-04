# Translation (i18n): handoff, 2026-10-03

Where the translation work stands and everything left to do. The design and the
reasons behind each rule are in `docs/i18n-design.md`; the working rules are in
`CLAUDE.md` under “Translation (i18n)”. This document is the to-do list.

## Where it stands

The design has five phases. Phase 1 (infrastructure) and phase 2 (first-run and
security screens) are done. Phase 3, translating `sidepanel.js` one area per pull
request, is written in full but only partly merged. Phases 4 and 5 have not started.

**Merged:** settings (#395), wallet (#396), composer (#397), notifications (#405).

**Open, held for 1.16** (no i18n ships in 1.15.x):

| PR | Branch | Area | Size | State on main 810643f |
|---|---|---|---|---|
| #431 | `feat/i18n-profiles` | Profiles | +166/−153 | merges clean |
| #435 | `feat/i18n-relays` | Relays, and the “Use for notifications only” label | +129/−87 | conflicts in `CHANGELOG.md` only |
| #436 | `feat/i18n-backups` | Lazarus, encrypted export, import | +448/−200 | merges clean |
| #438 | `feat/i18n-accounts` | Accounts | +119/−77 | merges clean |
| #439 | `feat/i18n-sites` | Connected sites and About | +175/−129 | merges clean |
| #440 | `feat/i18n-remainder` | The rest of the panel | +157/−115 | conflicts in `sidepanel.js` |

Checked by merging all six onto main on a scratch branch: they do not conflict with
each other, only with work merged since they were written.

There are no translations yet. The only locale file is `locales/en-XB.json`, the
pseudo-locale (Settings → Developer → Pseudo-locale), and `_locales/en` for the
manifest. Everything below is about making text *translatable*; phase 4 is when
anything is actually translated.

## 1. Land the six open PRs (before 1.16)

1. **#435:** rebase on main. The conflict is the CHANGELOG’s Unreleased section; keep
   main’s entries and add this PR’s below them.
2. **#440:** rebase on main and resolve four hunks, all where today’s merges touched
   the same lines, plus one with #431 once that has landed:
   - **The Saved sheet (#444):** main replaced the single “Bookmarks” heading with the
     Saved heading and Bookmarks/Highlights tabs, already through `t()`. Keep main’s
     version; drop the PR’s `t('Bookmarks')` heading.
   - **The bookmark row’s actions (#444):** main added the ⋮ menu before the remove
     button. Keep `if (menu) actions.append(menu.btn);` and take the PR’s
     `iconButton(t('Remove bookmark'), …)`.
   - **The account overview (#449):** main now reads `if (!open)` from
     `accountStatsOpen()`. Keep main’s logic and take the PR’s
     `document.createTextNode(t('Overview'))`.
   - **Bookmarks no relay returns (#444):** the PR still draws the “Not on your relays”
     section, through `t('Not on your relays')`. Main removed that section on purpose:
     bookmarks no relay can find are now left out. Keep main’s version, and drop the
     PR’s `missing` block and its key.
   - **“Scan or copy to pay from any wallet.”, with #431:** #431 wraps it as `tSec(…)`,
     #440 as `t(…)`, so whichever lands second conflicts. Keep `tSec`: it is on a
     payment surface.
3. Merge in the order of the table. After each, run `npm test` and look at the area in
   the pseudo-locale, since a missed key shows up there as plain, unaccented text.

## 2. Text that is still untranslated after all six

Found by scanning main with all six PRs applied. The scan reads `textContent`, `title`,
`placeholder`, `aria-label` and `alt` set from string literals, `toast()`/`notify()`
calls, and literals glued to a variable with `+`. It misses text built in template
literals or `innerHTML`, so treat this as a floor.

### sidepanel.js

- **Glued sentences**, each needing one template rather than `'Text ' + value`:
  - `'Switched to ' + displayName(a)`, in both switch paths (the account list and the
    header menu): `t('Switched to {{name}}', { name })`.
  - `'Switch to ' + name + '?'` and `'Tap again to confirm'` on the header menu’s
    two-tap confirm; the account list’s `'Set as active?'` and `'Tap again to confirm'`.
  - `'Switch account — ' + displayName(active)` (the chip’s tooltip).
  - `'Looking up ' + raw + '…'` (search status).
  - `'You were on ' + versionCard.from + '.'` (the version card).
  - `'Key read from ' + …` (import), `'Received ' + …` (wallet),
    `'Run by ' + … + '. They hold the funds, not Sidecar — you can switch to a
    self-custodial wallet later.'` (the custodial wallet note, one sentence with a
    name in it), `'Open in ' + client` (poll results),
    `'Thank you! Zapped ' + …` (About’s zap).
- **Accounts and its overview:** “Connected”, “Backed up”, “Not backed up”,
  “Account created”, “Account added”, “Account removed”, “npub copied”, “Add account”,
  “Saved — store it safely, never by email”, “No active account.”, and the import field’s
  placeholder “nsec1…, ncryptsec1…, or 64-char hex” (only “or 64-char hex” is words).
- **Composer and panel messages:** “That looks like a secret key. For safety, paste your
  nsec only into the key import field.”, “Use Cancel to close. Your draft is kept.”,
  “Locked due to inactivity”, the two “Post this” labels.
- **Search:** “Also search every Nostr name? This uses a third-party index … ” (a
  privacy disclosure: use `tSec`).
- **About:** the “About” heading. “Sidecar”, “GitHub” and “Relay Rider” are names;
  leave them.
- **Dev tools:** “Could not save the demo setting” (×2). Dev-only; low priority.
- **On this day:** deliberately out of scope (see §5).

### background.js (the worker)

- **Context-menu titles:** “Pay this invoice with Sidecar” (×2), “Pay Lightning invoice
  with Sidecar”, “Pay QR code with Sidecar”. Set once at worker start; do it after
  `I18N.ready`, as “Highlight with Sidecar” already is.
- **Notifications:** “No Lightning invoice found in the selection.”,
  `'Payment sent — ' + …` (×2), `'Too many attempts — try again in ' + …` (a `tn()`
  with a count of minutes or seconds).
- **Stay English:** “Sidecar does not support webln.” and other errors returned to web
  pages (apps match on them), “Unknown control message: …”, “Detached …” (internal).

### Other scripts

- **scan-qr.js:** “Point the camera at the QR code on your sheet.”,
  “Found it — sending to Sidecar…”.
- **wallets.js:** “Get this wallet →”.
- **Stay English:** content.js’s “Sidecar request failed: …” (returned to the page),
  keystore.js’s migration errors and permissions.js’s “Invalid permission level”
  (internal), composer-core.js’s `'Nostr ' + …` and `'Bearer ' + …` (HTTP auth
  headers, not text), highlight-event.js’s alt tag “Highlight from …” (published event
  data; see §3).

### Static HTML without `data-i18n`

**sidepanel.html** (about 30 strings):
- **Header tooltips:** “Switch account”, “Find a profile or note”, “Your bookmarks”
  (should now say Saved; it opens Bookmarks and Highlights), “Help & guides”, “Lock”.
- **Search:** the placeholder “npub, note, nevent, naddr, or username”, “Name search
  scope”, “Close search” (title and aria-label).
- **Site-access banner:** “Sidecar can’t see websites yet.”, “Grant site access so
  Nostr apps can use your signer.”, “Grant access”.
- **Accounts tab:** the “Accounts” heading, “Explore Nostr apps →”, “Share Sidecar with
  a friend”.
- **Activity tab:** the “Activity” heading, “Connected sites”, “Recent activity”, the
  hint “Each site stays with the account it signed in with. Tap Use, then sign in again
  to move one.”, “Filter by site…” (×2), “Clear history”.
- **Composer and timers:** “Try the composer →”, “Mining”, “Restart timer” / “Restart
  auto-sign timer”, “End auto-sign” (title and aria-label).
- **Relays:** the placeholder “wss://relay.example.com” (an example; can stay).
- **Dev badge:** “Sidecar dev build”.

Some of these may be relabeled from script by element ID; check each in the
pseudo-locale before wrapping it. Eleven others (“Generate new”, “Import nsec”, “Add
account”, “Show more”, “Settings”, “Post a note”, “Comment on this page”, “Bootstrap
relays”, “Close”, scan-qr’s “Cancel”) already have keys from script, so confirm they are
applied rather than adding `data-i18n` twice.

**welcome.html:** the pin instructions (“Open the Extensions menu (the puzzle-piece
icon) in your browser toolbar, pin Sidecar, then click it to open the side panel.”),
and “New to Nostr? {nostr.how} is a good place to start.” and “Find more apps at
{nostrapps.com} and {nostr.net}”, which are sentences with links in them: one key each
through `I18N.fill`, never fragments.

**scan-qr.html:** “Scan your backup sheet” (title and heading), “Starting the camera…”.

**Names that stay as they are:** theme names (Speakeasy … Turnstile), the client list
(Jumble, Primal, YakiHonne, …), Turnstile’s “Uptown”/“Downtown” signs (already
`translate="no"`: tilework), “Relay Rider”, and the linked site names.

## 3. Features added since phase 3: review items

- **GIF picker (#441)** and **highlights (#444):** first review done 2026-10-02, no
  unwrapped interface text. Still to do:
  - The GIF picker in the pseudo-locale in both composers. The risk is the panel
    toolbar wrapping with five buttons.
  - The background `notify()` messages for highlights.
  - Decide whether a highlight’s `alt` tag (“Highlight from …”) should follow the
    author’s language. It is published event data, like the client tag; English is
    defensible.
  - Deliberately English: the GIF topic chips (search terms the index is tagged with)
    and the “nostr.build” link name.
- **NIP-85 provider lists (#448):** about ten new `tSec` strings on both approval
  screens: “Trust provider list”, “Provider”, “{{key}} at {{relay}}”, “Scores”, “More
  providers”, “Private entries”, “Encrypted, not shown”, “Providers”, “None”, and the
  empty-list warning. They are security-reviewed text, so a translator needs to check
  them against the English, not just translate.
- **Saved sheet (#444):** “Copy source note ID” is new; the rest was written through
  `t()`.
- **#446, #447, #449:** no new interface text.

## 4. Phase 4: the first languages

Not started. The design doc’s open questions still stand:
- **Which two or three languages first, and who reviews them?** Phase 4 needs native
  reviewers, not machine output.
- Shared Nostr terms (Follow, Relays, Mute, Repost, Zap) can be seeded from Jumble’s
  MIT-licensed locale files, with credit in `NOTICE`.
- New keys go at the end of each locale file, so parallel PRs do not conflict.

## 5. Deferred on purpose

- **On this day:** about 27 strings of curated history and quotes. Translating them is a
  content project, not string-wrapping, and was put off on 2026-09-29.
- **Phase 5:** right-to-left, and `help.html` as whole translated pages
  (`help.<lang>.html`). Also open: whether `help.html` is translated at all, and whether
  `content.js`’s pay card should ever follow the in-app language override (it would
  cost a fingerprinting signal).
- **Store copy** is per store and per language, outside the extension.

## How to re-run the scan

Merge the open i18n branches onto a scratch branch from main (in a spare worktree),
then look for interface strings set from literals rather than `t()`/`tn()`/`tSec()`:
`textContent`, `title`, `placeholder`, `aria-label` and `alt` assignments, `toast()`
and `notify()` calls, and literals joined to a variable with `+`. For the static
pages, list text and attributes without a `data-i18n` (or `data-i18n-placeholder`,
`-title`, `-aria-label`, `-alt`) attribute, then check each against the keys the
script already uses. Delete the scratch branch afterwards.
