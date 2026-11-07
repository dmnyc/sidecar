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

## A quote in the strip

The strip is two blocks: the pictures and videos, in their own order, and one quoted note.
The only choice is which comes first, and the post is the words, then the first block, then
the second.

The note is one entry in `draft.media`, `{ quote: 'nostr:nevent…' }`, pinned to the front or
the back of the array. It is drawn as a block under the text field, the reply block's look
(the gold rule, the author, the text clipped at 240 characters with Show more), found
through the same lookup the preview uses and remembered for the life of the page so a redraw
never blinks back to "Loading". The preview pane reads the same cache (`findEvent` remembers a found note for the life of the page and shares a lookup already in flight), so moving the quote does not send the relays a second request. A miss is never remembered. A note that cannot be found says so and is still quoted: the
published line is the reference, not what was fetched.

Beside a quote the pictures get a label of their own ("2 attachments") with an arrow, and
the label is also the toggle for their links: a chevron opens the list of URLs, with a copy
button on each, under the last picture and inside the pictures' block, so the links travel
with the pictures when the blocks swap. (With no quote the strip is one block and the
reference drawer below it does the same job.) Either block moves the other's way: the note's
arrow takes it above or below all the pictures at once, and the pictures' arrow does the same
from the other side (`moveQuoteEntry`). Pictures step and drag among themselves only
(`movePicture`, `canMovePicture`), never past the note, and a new attachment lands on the
pictures' side of it (`addMedia`).

The note's row reads copy, remove, move. Copy puts the `nostr:` reference back on the
clipboard, since pasting it removed it from the text field. The move arrow ends the row, so
it shares a column with the pictures' arrow and does not jump when the blocks swap. Removing
the quote takes two taps (the first arms the trash, red, for three seconds): the block holds
only a reference, and pasting the note again is the only way back.

In the expanded composer the thumbnails are 128px, five across the card; the panel keeps 72px.

**One note only.** Pasting a lone note1, nevent1 or naddr reference, with or without
`nostr:`, becomes the block. Anything else pastes as the text it is: a sentence with a
reference in it, two different notes, or a second note while one is attached. The Quote
button's prefill becomes the block the same way. A quote already written into the words is
offered to the strip ("Move the quote into the attachments", in the drawer, only with
attachments on the post, only when the words end on a lone quote line and nothing else
follows); it is never moved silently, and a quote left in the words publishes exactly as it
always did.

**A pasted note must be found.** The block appears at once, and the lookup runs behind it
(`checkPastedQuote`). If no relay shows the note, the block is removed, the reference goes
back into the words after a blank line, and a toast says so; the move offer skips a
reference that was looked for and missed. This is for a paste only: a restored draft or the
Quote button's prefill names a note that exists, and keeps its block ("It will still be
quoted") when a relay is slow.

Publishing writes the words, then the strip in order, one line per entry and a blank line
wherever the kind changes (`composeNoteContent`). The q and p tags are read from the words
plus the strip's quote (`proseWithQuotes`), so the quote is tagged as one, once. The note
describes no file, so it makes no imeta tag. A poll cannot be built while the strip has
anything in it (the either-or rule), so a paste into a poll is text.

## Video details

An uploaded video's imeta tag carries its type and pixel size (`m`, `dim`), read from
the file before it goes up, while it uploads. Settings turns it off with `videoImeta`. A video
takes an ALT description like a picture, written last (`url`, `m`, `dim`, `alt`), and that
tag is published even with Video details off.
