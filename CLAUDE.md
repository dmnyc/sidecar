# Sidecar — UI rules

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
