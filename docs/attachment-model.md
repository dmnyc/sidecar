# Attachments that live outside the prose

How Sidecar models image and video attachments in a composer: where the URL lives,
how the order is changed, and what goes on the wire. Written to be copied into
another project, so it describes the shape and the reasoning rather than this
codebase's function names.

The whole design is one decision with consequences: **an attachment is a slot on
the draft, not text in the editor.**

## The problem it solves

The obvious implementation uploads a file and drops its URL into the editor at the
caret. It is the shape most clients ship, and it has three faults that only appear
in use:

1. **It writes into the middle of a sentence.** The upload finishes whenever it
   finishes, and the caret is wherever you left it, so the URL lands inside the
   thought you were typing and you type around it afterwards.
2. **The URL is prose now,** so every later operation has to reason about text that
   is secretly structured. Reordering two images means cutting and pasting two URLs
   in the right order without disturbing the words between them.
3. **Preview lies.** What the editor shows and what publishes are the same string,
   so there is nothing to preview, and the moment you want them to differ (a
   description, an ordering, a trailing block) there is nowhere to put the
   difference.

## The model

```
draft = {
  text:  "what the person actually wrote",
  media: [ { url, alt, isVideo, ... }, ... ],   // ordered, authoritative
}
```

`text` never contains an attachment URL. `media` is an ordered array and its order
is the only ordering that exists. Nothing else records it.

Two pure functions bridge the two at publish time, and they are the entire contract:

```js
// What the note says on the wire. Also what Preview shows, so the review window
// previews the note that will go out rather than the half the editor was showing.
composeNoteContent(text, media) {
  const prose = String(text || '').trim();
  const urls = (media || []).map((m) => m && m.url).filter(Boolean);
  if (!urls.length) return prose;
  return (prose ? prose + '\n\n' : '') + urls.join('\n');
}

// One metadata tag per DESCRIBED attachment, in draft order. Undescribed media
// contributes nothing at all.
imetaTagsForMedia(media) -> [['imeta', 'url ' + url, 'alt ' + alt], ...]
```

**The wire format does not change.** The URL in the content is still what every
client reads. The restructuring is entirely on the authoring side, which is what
makes it adoptable: a note of bare URLs publishes byte-identical to what it
published before any of this existed.

## Why `alt` hangs off the same slot

An empty description emits no tag at all, never an empty one. Half the value of
alt text is that its absence is legible; a note carrying `alt ""` for every image
is worse than a note carrying nothing, because it looks described.

Because the tags are generated from the array in order, the description follows its
image through a reorder for free. That is the payoff for having one authoritative
order: no second structure to keep in step, and no way for the two to disagree.

Cap the description by CODE POINTS, not code units. A `slice(0, 2000)` on a string
ending in an emoji ships half a surrogate pair. `Array.from(s).slice(0, N).join('')`
counts characters.

## Reordering: two mechanisms, one array

Both do the same two lines against the same array, then re-render and save:

```js
const moved = media.splice(from, 1)[0];
media.splice(to, 0, moved);
```

**Drag and drop** on the thumbnails, enabled only when there is more than one.
`dragstart` records the index, `dragover` calls `preventDefault` (without it the
drop never fires) and marks the target, `drop` performs the splice, `dragend`
clears state. Clear the drop-target class on every cell at `dragend`, not just the
one that fired, or a cancelled drag leaves a highlight behind.

**Arrow steppers** on each thumbnail, and these are not a nicety. **HTML5 drag and
drop never fires on touch**, so on a phone the strip had no reordering at all, and a
keyboard had none either. The steppers are buttons, which touch and Tab both reach.

The first and last cells omit the arrow that would do nothing rather than showing a
disabled one: a disabled control is an answer to a question nobody asked.

If an editor can be open against an attachment (a description editor, say), **flush
it before the splice**. It was opened against an index, and the splice moves what
that index means.

## Migration, if drafts already exist

Drafts saved under the old model carry the URLs in their text. On restore, strip any
line that is exactly an attachment's URL, or publishing appends it a second time.

Be precise about what you strip: **only a boundary occurrence**, meaning the URL
alone on its line. A URL a person deliberately wrote inside a sentence ("mirror at
https://x/a.png if the first dies") is authored prose and must survive. A URL twice
on one line is ambiguous; leave it.

## The drawer

Attachments that are no longer visible in the editor need somewhere to be accounted
for. One collapsed line, "3 attachments, added to the end of your post", expanding
to one row per URL.

Make it **read-only**. The order it shows is the thumbnails' order, and reordering
belongs to the thumbnails. Two places to change one array is two places to keep in
step and a race when both are open.

## What this buys, in order of how much it matters

- The editor holds only what the person wrote.
- Preview is now meaningfully different from the editor, and therefore worth having.
- Reordering is an array splice instead of a text transformation.
- Per-attachment metadata has an obvious home, and follows its attachment.
- Removing an attachment is `splice(i, 1)`, with no text to clean up.

## Things that will bite

- **Preview must call `composeNoteContent`.** If Preview renders `text`, it shows a
  different note than the one that publishes, which is the original fault wearing a
  different hat.
- **The uploading state must not resize the toolbar.** Swapping a button's label to
  "Uploading…" widens it, and neighbouring buttons that size to their labels shrink.
  Keep the label and animate it instead.
- **A just-uploaded URL can 404 for a second or two** while the host finishes
  writing it. An `<img>` tries exactly once, so the thumbnail is blank forever. Retry
  a couple of times with a cache-busting query, then say the cell failed. This
  matters more than a blank square: the URL is in the draft either way and will be
  appended at publish, so a silently failed thumbnail is a note about to ship a link
  nobody checked.
- **Two composers drift.** If a panel and a full-tab composer share the model, put
  `composeNoteContent`, the tag builder and the drawer in a shared module and have
  both call it. Anything either one reimplements will diverge.
