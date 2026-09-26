# Multilingual support — design

Status: proposal. Nothing described here is implemented yet.

Sidecar has no translation layer today. This document measures what would need
to change, describes how Jumble (a Nostr web client that ships 19 languages)
solves the same problem, and proposes a design that fits Sidecar's constraints:
vanilla JS, no build step, and every third-party file vendored and hash-checked
(see `VENDOR.md`).

The short version: copy Jumble's key format and conventions, not its library.

## 1. What Sidecar has today

### No translation layer

- No `_locales/` folder, no `chrome.i18n` calls, no `default_locale` in
  `manifest.json`. Every string is hard-coded English.

### How many strings

Rough counts of English string literals, excluding comments and protocol
constants:

| File | Strings |
|---|---|
| `sidepanel.js` | ~940 |
| `prompt.js` | ~150 |
| `welcome.js` | ~100 |
| `composer-core.js` | ~50 |
| `background.js` | ~50 |
| `compose.js` | ~40 |
| `content.js` | ~20 |
| `wallets.js` | ~13 |

Static HTML adds about 180 text nodes in `sidepanel.html` and 20–40 more across
`welcome.html`, `prompt.html` and `wallets.html`. `help.html` holds another ~240
blocks of documentation prose.

That is about 1,300 strings in JS and 400 in HTML, roughly the size of Jumble's
~1,200 keys.

### How the UI is built

- `h()` from `composer-core.js`, destructured into `sidepanel.js`.
- `textContent` assignments (~1,000 in `sidepanel.js`).
- 105 `innerHTML` templates in `sidepanel.js`, plus the in-page pill and card in
  `content.js`.
- `toast()` (`sidepanel.js:456`), 123 calls.

### Patterns that won't translate as written

- **Sentences glued together with `+`** (~120 in `sidepanel.js`), e.g.
  `displayName(a) + ' removed from ' + host`. Word order differs between
  languages, so each needs to become one template.
- **English-only plurals**: `n + ' relay' + (n === 1 ? '' : 's')`. Polish,
  Russian and Arabic have more than two plural forms.
- **`relativeTime()`** (`sidepanel.js:4704`) hard-codes `'just now'`, `'5m ago'`.
- **~40 places force `toLocaleString('en-US')`**, including fiat formatting at
  `sidepanel.js:16088` and `:16327`. Dates meanwhile use the browser's locale
  (`toLocaleDateString(undefined, …)`), so numbers and dates can already
  disagree.
- **Kind names are defined twice**: `KIND_NAMES` at `sidepanel.js:9486` and
  `kindLabel` in `prompt.js:156`.

### Right-to-left

- `styles.css` has ~121 left/right-specific properties (`margin-left`,
  `padding-right`, `left:`, `text-align: left`, `border-left`, …). `welcome.css`
  has 12, `help.css` 4. Most theme files have none; `par-avion.css` has 3,
  `werkstatte.css` 2, `cast-iron.css` 1.
- User-written text (notes, names, bios, the composer) has no `dir="auto"`.

## 2. How Jumble does it

Reference: `github.com/CodyTseng/jumble`, `src/i18n/index.ts` and
`src/i18n/locales/*.ts`.

- **Library**: i18next + react-i18next + i18next-browser-languagedetector.
- **Locale files**: 19 TypeScript files (`ar`, `de`, `en`, `es`, `fa`, `fr`,
  `hi`, `hu`, `it`, `ja`, `ko`, `pl`, `pt-BR`, `pt-PT`, `ru`, `th`, `tr`, `zh`,
  `zh-TW`), each ~1,200 lines of flat key/value pairs.
- **Keys are the English sentence itself**:
  `t('Failed to republish to relay: {{url}}. Error: {{error}}', { url, error })`.
  A missing translation falls back to English.
- **Plurals** use suffixes: `'minute ago_one': '{{count}} minute ago'`,
  `'minute ago_other': '{{count}} minutes ago'`.
- **Detection** maps the browser language to a supported one: `zh`, `zh-CN`,
  `zh-SG` → `zh`; any other `zh-*` → `zh-TW`; otherwise the first supported
  prefix match, else `en`.
- **Picker**: Settings → General → Languages, a select listing each language by
  its own name (`LocalizedLanguageNames`: `Deutsch`, `日本語`, `العربية`, …).
  `i18n.changeLanguage()` switches live.
- **Dates**: custom i18next formatters (`date`, `date_short`) with a per-language
  dayjs format string.
- **Right-to-left**: `ar` and `fa` are listed in `RTL_LANGUAGES`;
  `applyDocumentDirection()` sets `<html dir lang>` on every language change. The
  app is wrapped in a Radix `DirectionProvider`.
- **Contributor rules** (`AGENTS.md`):
  - New keys are appended at the end of every locale file, never inserted in the
    middle, to avoid merge conflicts.
  - Untranslated keys are acceptable while a feature is on trial.
  - Adding a language: new locale file, register it in `src/i18n/index.ts`,
    update `detectLanguage`, add to `RTL_LANGUAGES` if needed.
  - Right-to-left rules: use logical CSS properties instead of left/right (except
    elements anchored to the screen edge); mirror navigation chevrons with
    `rtl:-scale-x-100`; put `dir="auto"` on user-written content only, never on
    translated interface text; smoke-test in Arabic.

## 3. Proposed design for Sidecar

### 3.1 A small `i18n.js` instead of i18next

Vendoring i18next would add a sixth hashed bundle and ~40 KB, and Jumble uses it
mostly because it has React and a bundler. Sidecar needs three things from it:
`{{var}}` substitution, plurals, and English fallback. That is about 100 lines.

`i18n.js` exposes:

```js
window.SidecarI18n = {
  t,            // t(key, params) → string
  lang,         // active language code
  dir,          // 'ltr' | 'rtl'
  ready,        // Promise, resolves once the locale is loaded
  fmtNum,       // Intl.NumberFormat with the active language
  fmtDate,      // Intl.DateTimeFormat with the active language
  fmtRelative,  // Intl.RelativeTimeFormat with the active language
};
```

Each page loads it before `composer-core.js`.

- **Keys are natural-language English**, as in Jumble. The code stays readable,
  English needs no locale file, and the 93 test files that assert on English text
  keep passing because `t()` returns the key when there is no translation.
- **Plural forms** are chosen with `Intl.PluralRules(lang).select(count)`, so a
  key can have `_zero`, `_one`, `_two`, `_few`, `_many` and `_other` variants.
  Polish, Russian and Arabic get their extra forms, not just one/other.
- **Fallback order**: active language → base language (`pt-BR` → `pt`) →
  English key.

### 3.2 Two layers of locale files

**`_locales/<lang>/messages.json`**, plus `"default_locale": "en"` in the
manifest. Used only for:

- The manifest `name`, `description` and `action.default_title`
  (`__MSG_extName__`). This also localizes the Chrome Web Store and AMO listings.
- `content.js`.

`chrome.i18n` follows the browser's UI language and can't be switched at
runtime, so it can't back the in-app picker. It does suit `content.js`: the pay
pill and card live in **open** shadow roots (`content.js:1009`, `:1083`,
`:1221`) that the page can read. Following the browser's language there reveals
nothing the page doesn't already know from `navigator.language`. Following a
user override would give sites one more fingerprinting bit, which conflicts with
the care already taken at `background.js:2872`. `chrome.i18n.getMessage` is also
synchronous and available to content scripts, so no extra loading is needed.

**`locales/<lang>.json`** for everything else. JSON rather than `.js` because a
locale file is data, not code, so a pull request changing one is easier to
review.

Both folders ship automatically: `scripts/package.sh` packages from a
`git archive` and only strips named folders.

### 3.3 Choosing the language

- New setting `sidecar_settings.language`, default `'auto'`.
- `'auto'` resolves `chrome.i18n.getUILanguage()` with Jumble's detection logic.
- The picker goes in Settings → Appearance (`sidepanel.html:334`), listing each
  language by its own name.
- `chrome.storage` is asynchronous, so each page's startup awaits
  `SidecarI18n.ready` before first render. A copy of the resolved language code in
  `localStorage` (shared by all extension pages) lets English skip the locale fetch
  entirely, so the English path has no added latency.
- Each extension page loads its locale with
  `fetch(chrome.runtime.getURL('locales/' + lang + '.json'))`.
- On a language change (`chrome.storage.onChanged`), reload open extension pages.
  Re-rendering 21k lines of imperative DOM code in place isn't practical, and
  Jumble's live switching relies on React re-rendering.

### 3.4 Static HTML

Attributes, applied once at load by `i18n.js`:

```html
<button data-i18n="Appearance">Appearance</button>
<input data-i18n-placeholder="Search" placeholder="Search">
<button data-i18n-title="Copy" data-i18n-aria-label="Copy" title="Copy" aria-label="Copy">
```

The English stays in the markup, so an untranslated page still reads correctly
and a failed locale load degrades to English.

### 3.5 Refactors while wrapping strings

- **Concatenated sentences** become one template each:
  `t('{{name}} removed from {{host}}', { name: displayName(a), host })`.
- **Plural ternaries** become `_one` / `_other` keys:
  `t('{{count}} relay', { count: n })`.
- **`relativeTime()`** switches to `Intl.RelativeTimeFormat(lang, { style: 'narrow' })`,
  which covers every language with no translation work.
- **`toLocaleString('en-US')`** calls and the fiat `Intl.NumberFormat('en-US', …)`
  calls switch to a shared `fmtNum()` that uses the active language. Date calls
  that pass `undefined` or `[]` pass the active language instead, so numbers and
  dates agree.
- **Kind names**: merge `KIND_NAMES` (`sidepanel.js:9486`) and `kindLabel`
  (`prompt.js:156`) into `composer-core.js`, then translate once.

**Safety rule:** translated text goes into `textContent` only. Anything placed
into `innerHTML` is escaped with the existing `escapeHtml`. Where markup is
unavoidable (e.g. `<b>` around an amount), build it with `h()` around translated
fragments instead of translating HTML. A test rejects HTML in locale files,
because locale files are now something a pull request can change.

### 3.6 `background.js`

The service worker has no DOM, but produces user-visible text in three ways.

1. **Errors returned to web pages** through NIP-07 (e.g.
   `'signEvent: event.kind must be a non-negative integer'`, `background.js:1124`)
   **stay English.** Apps may match on them, so they are part of the API.
2. **Errors shown in the panel** (62 `toast(r.error)`-style call sites in
   `sidepanel.js`) carry an `errorKey` and `errorParams` alongside the existing
   English `error`. The panel translates the key and falls back to `error`.
3. **Notifications and context menus**: `notify()` (`background.js:2851`, e.g.
   `'Payment sent — N sats'`) and context-menu titles use `t()`, with `i18n.js`
   loaded through the existing `importScripts` list (and the Firefox
   `background.scripts` list in `manifest.json`). Menus are rebuilt on a language
   change.

### 3.7 The approval prompt needs extra care

`prompt.js` is where users decide what to sign, encrypt and pay. A mistranslated
"sign", "encrypt" or "pay 33,000 sats" is a security bug, not a cosmetic one.

- Keep amounts, hosts, pubkeys and kind numbers outside the translated text, as
  interpolated values formatted by code.
- Always show the kind number next to its translated name.
- Require a native-speaker review of `prompt.js` and unlock/backup strings
  before a language ships. Mark these keys in the locale files (e.g. a
  `security-critical` list the coverage test knows about) so a reviewer can find
  them.

### 3.8 Layout and typography

German and Russian run 30–40% longer than English, and Sidecar lives in a ~360px
panel whose modal sheets have 300px of usable width. The `CLAUDE.md` rule for row
controls ("stack, don't shrink": never shrink font-size or padding, never
abbreviate labels, move a worded confirm to its own full-width row) is exactly
the rule translations will stress.

- **Pseudo-locale.** Add `en-XA`: every string accented and padded ~40%, e.g.
  `[Ŝéţţîñĝš ·····]`. Selectable only in the Developer section. It finds overflow
  and strings that were never wrapped in `t()` without waiting for translators.
  Jumble doesn't do this; here it should be part of the infrastructure phase.
- **Fonts.** Themes use Latin-only display fonts (Cinzel, Oswald, Limelight,
  Apogee Telemetry, Syncopate, …). Chinese, Japanese, Korean, Arabic and Cyrillic
  glyphs fall back per character. Make sure every theme's font stack ends in
  `system-ui, sans-serif` so the fallback is deliberate.
- **Letter-spacing and uppercase.** There are ~45 `letter-spacing` /
  `text-transform: uppercase` rules across `styles.css` and the themes. Reset them
  under `:lang(zh)`, `:lang(ja)`, `:lang(ko)`, `:lang(ar)`, `:lang(fa)`, where
  they are meaningless or harmful.

### 3.9 Right-to-left (later phase)

- Set `<html dir lang>` from `SidecarI18n.dir` on every extension page.
- Convert the ~121 left/right properties in `styles.css` (and the handful in
  `welcome.css`, `help.css` and three themes) to logical properties:
  `margin-inline-start`, `padding-inline-end`, `inset-inline-start`,
  `text-align: start`, `border-inline-start`. Keep physical properties only for
  things anchored to the screen edge, following Jumble's exception list.
- Mirror back and drill-in chevrons in `ICONS` with
  `[dir="rtl"] .icon-back { transform: scaleX(-1); }`.
- **`dir="auto"` on user-written content can ship now**, independent of
  translation: note bodies, display names, bios, the composer textarea. It helps
  Arabic and Persian users even in an English interface. Don't put it on
  translated interface text.

### 3.10 Tests and conventions

- Tests pull function source out of the files into `vm` contexts with a fixed set
  of globals (e.g. `test/nip05-states.test.js`). Any function that starts calling
  `t()` needs a shared `test/helpers/i18n.js` that injects an English `t` and the
  formatters.
- New test, in the existing `node --test` style:
  - every `t('…')` literal in the source is a key in `en`;
  - every key in a locale exists in `en`;
  - `{{placeholders}}` match between `en` and each locale;
  - no markup in translations;
  - `data-i18n*` attributes in HTML reference known keys.
- Add an i18n section to `CLAUDE.md` / `AGENTS.md` modelled on Jumble's: wrap new
  strings in `t()`, append new keys at the end of each locale file, never
  concatenate translated fragments, `dir="auto"` on user content, check new UI in
  the pseudo-locale.

## 4. Phases

1. **Infrastructure.** `i18n.js`, the language setting and picker, `_locales` for
   the manifest, the `Intl` formatters, the pseudo-locale, the test helper and
   coverage tests, the `CLAUDE.md` section. Useful even in English only, because
   numbers, dates and relative times start agreeing with each other.
2. **First-run and security screens.** `welcome.html` / `welcome.js`, the unlock
   screen, `prompt.html` / `prompt.js`, and the `content.js` pay pill and card.
3. **`sidepanel.js` by area**, one pull request each: settings, wallet,
   notifications, composer, profiles, relays, backups. Partial coverage is safe
   because untranslated text falls back to English.
4. **Two or three first languages** with native reviewers available. Jumble is
   MIT-licensed, so shared Nostr terms (Follow, Relays, Mute, Repost, Zap) can be
   seeded from its locale files, with credit in `NOTICE`.
5. **Right-to-left**, and `help.html` as whole translated pages
   (`help.<lang>.html`) rather than string-by-string.

## 5. Open questions

- Which languages first, and who reviews them?
- Should `help.html` be translated at all, or link out to translated docs?
- Should the pay card in `content.js` ever follow the in-app language override,
  accepting the fingerprinting cost, or always follow the browser?
