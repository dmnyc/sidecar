# Sidecar — repository instructions

## Branch naming

Use a prefix that describes the work, such as `feat/`, `fix/`, or `docs/`.
Do not use `claude/` or `codex/` as a branch prefix in this repo: a branch is
named for what it changes, never for what wrote it.

## Commits, pull requests and merging

Commits are authored and committed as the maintainer:
`The Daniel <dmnyc@users.noreply.github.com>`, with no `Co-Authored-By`
trailers, session links, or "Generated with" lines. A pull request
description ends with one attribution line in the house style: a drink emoji, a
past-tense drink verb, and the tool that did the work, linked. Work done with
Claude Code reads `🍊 Twisted with [Claude Code](https://claude.com/claude-code)`;
work done with GLM reads `🍸 Decanted with [GLM](https://z.ai)`. Check a pull
request's description after creating it, since some tools append footers of
their own — those are removed, not kept.

A pull request is opened and then it waits: the maintainer tests the branch
before it merges. Do not merge a pull request — including one you opened —
without the maintainer's explicit approval of that change. The squash-merge
practice governs how a pull request merges, not when.

Squash-merge pull requests. GitHub then creates and signs the commit on `main`,
so it shows as Verified even when the branch's own commits were unsigned.

## UI rules

## Row controls in a narrow panel (the recurring remove-button mistake)

The panel is a ~360px sidebar; a modal sheet is 344px max, 300px of usable width
after its padding. Desktop-dialog muscle memory — actions sitting inline *beside*
content — does not fit in that width, and the recurring result is a row where the
content ellipsizes to nothing while a label and two buttons jam against it.

The grammar that already exists in this codebase, in order of preference:

1. **The inline action slot (`.item-actions`) holds one or two icon buttons —
   nothing with words.** It is `flex-shrink: 0` on purpose: buttons keep their
   metrics and the content beside them does the truncating. A label plus two
   buttons is roughly 200px of minimum width; beside content in 300px there is
   no room for either to be usable.

2. **A confirm that has words takes its own full-width row below the content.**
   The row becomes a column — content on top, controls stretched beneath
   (`flex-direction: column; align-items: stretch`). This is the connected-site
   row (`.site-item` + `.site-controls` in styles.css) and the wallet tx row
   (`.tx-row`). `.confirm-msg` is `flex: 1` because it was built for that
   full-width row; dropping it into a side-by-side slot is the layout bug, not a
   styling problem to patch with smaller text.

3. **Or replace the row's content entirely.** The account switcher's two-tap
   confirm rewrites the row's own two lines ("Switch to X?" → "Tap again to
   confirm") — zero added chrome.

Never make controls fit by shrinking them: no smaller font-size or padding on
buttons, no wrapped or abbreviated button labels ("Rmv?"), no compressed confirm
text. If something has to shrink, the layout is wrong — stack it (rule 2).
Truncation belongs to prose only: `white-space: nowrap; overflow: hidden;
text-overflow: ellipsis` on the line, and `min-width: 0` on the flex child so it
can actually shrink.

## Translation (i18n)

Every page loads `i18n.js` first; the panel takes `t`, `tn` and `I18N` from it. The
design, and the reasons behind each rule here, are in `docs/i18n-design.md`.

- **New user-facing text goes through `t()`.** The key is the English itself:
  `t('Copy')`. Untranslated, it reads as the key, so English never needs a locale file.
- **One template per sentence, never glued fragments.** Word order differs between
  languages: `t('{{name}} removed from {{host}}', { name, host })`, not
  `name + ' removed from ' + host`.
- **Plurals take `tn(one, other, count)`**, never a `n === 1 ? '' : 's'` ternary:
  `tn('{{count}} relay', '{{count}} relays', n)`. Locales supply every form their
  language has (`_one`, `_few`, `_many`, `_other`, …) under the singular key.
- **Data is a parameter, never part of the text.** Names, amounts, hosts, keys and kind
  numbers go in as `{{values}}`, so a translation cannot alter what an approval card
  says is being paid or signed.
- **Numbers and dates go through `I18N.fmtNum`, `I18N.fmtDate` and
  `I18N.fmtRelative`**, never `toLocaleString('en-US')` or a hand-written "5m ago".
- **Translated text goes into `textContent`.** Never build `innerHTML` from `t()`;
  where markup is needed, build it with `h()` around translated fragments. Locale files
  are rejected by the tests if they contain markup.
- **Static HTML uses `data-i18n`** (and `data-i18n-placeholder`, `-title`,
  `-aria-label`, `-alt`), keeping the English in the markup.
- **New keys go at the end of each locale file**, never in the middle, so parallel
  pull requests do not conflict.
- **Check new UI in the pseudo-locale**: Settings → Developer → Pseudo-locale (en-XA)
  accents and pads every wrapped string by 40%. Overflow there is where German breaks,
  and a label that stays plain is one that was never wrapped.
- **`dir="auto"` on user-written content only** (notes, names, bios, the composer),
  never on translated interface text.
- **Errors returned to web pages over NIP-07 stay English**: apps match on them.
