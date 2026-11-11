# Threads and long-form in the expanded composer

A design for two writing modes the expanded composer does not have yet: a **thread** (several
notes posted as one chain) and an **article** (a long-form post, kind 30023). Both come from the
author’s Ghostr app, where they are small and they work, and both belong in Sidecar.

**Status: proposed, nothing built, for after 1.17.1.** Asked for 2026-09-20, deferred on 2026-09-21
until the expanded composer was working well, and confirmed as features Sidecar should have on
2026-11-11. This document is the spec to build from. It names the decisions already made, the one
still open, and the order to build in.

## Where they live

Only in the expanded composer (`compose.html`). The panel is a 360px strip, which is the wrong
place to write more than a note, and it already has an **Expand** link for the rest. The panel
composer does not change.

The expanded composer gets a mode switch above the editor: **Note | Thread | Article**. Note is
what it is today. The rules that keep the modes from colliding:

- A **poll** exists only in Note mode, as now.
- An **article** is never a reply: a kind 30023 is not a threaded kind, so the Article mode is
  unavailable while a reply target is set, and says why.
- A **thread** can be a reply: its first post answers the target and every later post answers the
  post before it.
- Changing mode on a draft that has content **asks first**. Thread to Note with more than one post
  offers to join them or keep only the first. Note to Article asks whether the text becomes the body.

## What they share with a note

None of this is rebuilt. Each mode uses what the composer already does for a note, so a setting
that governs a note governs these:

- the editor, with its mention autocomplete and pills, and the Write | Preview tabs;
- the attachment strip: uploads, reorder, and the alt text that becomes NIP-92 `imeta` tags;
- tagging from the text: a `p` tag for every person mentioned or quoted and a `q` tag for every
  note quoted (`noteBodyTags`);
- the **client tag**, which Settings can turn off;
- proof of work, the review countdown and the post-countdown length;
- the relay set the panel worked out at Expand time (`expandRelays`), through `targetRelays()`;
- one draft slot per account in the encrypted store, so expanding mid-sentence carries the sentence;
- the receipt after posting, and the `notePublished` message that tells the panel an own note
  exists, so replies to it reach the notification bell.

## Threads

### The model

A thread is an ordered list of posts, each with its own text and its own attachments. In the draft
that is `mode: 'thread'` and `posts: [{ text, media }]`. A draft with no `mode` is a note, so every
existing draft keeps working.

A thread is **stacked boxes, not one field with separators.** Each box has a “Post N” label, its
own attachment strip, and an X to remove it when there is more than one. A dashed “Add next post”
sits at the foot. Pasting text that has a line of three or more hyphens on its own splits it into
posts at those lines, so a thread written elsewhere comes in whole. The delimiter is only how a
paste is read. It is never stored.

**Numbering.** The Preview always shows each post’s place, as `1/5`, `2/5` and so on. A **Number the
posts** switch, off by default, decides whether those numbers are also written into the published
posts: on, `n/N` is appended to the end of each post when it goes out; off, the numbers are a
Preview aid and nothing is added to what is published.

A thread needs **at least two non-empty posts**, and the Post button says why when it does not have
them. A ceiling of 25 posts keeps a mistake from becoming a flood.

### What goes on the wire

Every post is an ordinary kind 1 built the way a note is built today: the client tag, the `p` and
`q` tags from its own text, its own `imeta` tags.

- **Post 1** is a plain note. If the thread answers a target, post 1 carries that target’s reply
  tags, and the thread’s root is the target’s root.
- **Posts 2 to N** carry NIP-10 markers: `["e", <root id>, <relay>, "root"]` first, then
  `["e", <previous post id>, <relay>, "reply"]`, then a `p` tag for the author of the post they
  answer. Threading tags lead, because readers take the first marked `e` as the root.
- Each `created_at` is at least one second after the post before it, so no reader orders them
  wrongly.

### Publishing

Strictly in order, one at a time. Each post is built, mined if proof of work is on, signed with
`SIDECAR_OWNER_SIGN`, published, and **counted as published only when at least one relay accepts
it**, before the next is built, because the next one names its id.

- **One review countdown** covers the whole thread, at the start: “Posting 5 posts in 10 s”. It does
  not run again per post.
- **Proof of work** runs per post at the level chosen. The progress line says “Post 2 of 5” so a
  long mine does not look like a hang.
- **When a post fails, stop.** Posts already out stay out. The status names what went out and what
  did not, in words (“Posts 1 and 2 are live. Post 3 did not go out: no relay accepted it”).
- The draft keeps only the unpublished posts, and remembers the root, the last published id and how
  many went out. The Post button becomes **Continue thread**, which resumes by answering the last
  published post. A **Start over** control discards the progress and keeps the text. Nothing already
  published is ever sent again: each post has the fingerprint check a note has.
- Each published id is sent through `notePublished`, so a reply to post 4 notifies.

### The receipt

“Your thread is live”, with the count, the root’s link in the chosen reader, and each post’s id.

## Articles

### The model

An article is kind 30023 under NIP-23. In the draft: `mode: 'article'` with a title, a summary, a
cover image, the topics, the markdown body, and, when it is an edit, the `d` identifier and the
original `published_at` it came from.

The article form has:

- **Title**, required.
- **Summary**, optional, with a counter at 200 characters as a hint, not a wall.
- **Cover image**, uploaded through the same Blossom-then-fallback uploader as any attachment, or
  pasted as a URL.
- **Topics**, optional, as chips that become `t` tags.
- **Body**, markdown, in the editor with Write | Preview and a formatting toolbar (below). Mention
  autocomplete works and writes `nostr:` references, tagged from the text as a note’s are. Images in
  the body upload through the same path and insert `![alt](url)`.

### The formatting toolbar

A row of buttons above the body: bold, italic, heading, link, quote, bulleted list, numbered list,
code and image. Each acts on the selection by wrapping or prefixing it with the markdown, so the
text stays plain markdown and the Preview is what shows the result. With nothing selected a button
inserts its markers with the caret between them.

- Keyboard: Cmd/Ctrl+B, I and K for bold, italic and link; Tab moves through the buttons.
- Every button has a translated label and an accessible name, since it is an icon.
- It is shown in Write only, and it keeps the editor’s own undo, so one undo reverses one action.
- The image button is the same upload as the attachment strip and inserts `![alt](url)` at the caret.

### The body renders without HTML

The Preview needs a markdown renderer, and Sidecar has no markdown library and should not vendor
one for this. The Preview is a small purpose-built renderer in the shape of the existing note
renderer: it builds elements with `h()` and never assigns `innerHTML`. It covers headings,
emphasis, links, lists, block quotes, code and images. Raw HTML in the body shows as text, and a
link renders only if it is `http`, `https` or `nostr:`. This is both the safe choice and the one
that keeps the vendored set unchanged.

The body is published **exactly as written.** No line-break rewriting: single newlines are
markdown’s soft breaks, and changing them would make the Preview and the published article differ.

### What goes on the wire

```
kind 30023
tags: ["d", <identifier>], ["title", ...], ["published_at", <unix>],
      ["summary", ...]?, ["image", <url>]?, ["t", <topic>]*,
      then the client tag and the p tags from the body's mentions
content: the markdown
```

- **The `d` identifier** is the title lowercased with every run of characters that are not letters
  or digits turned into one hyphen and the ends trimmed. An empty result becomes `post-<unix time>`.
- Because 30023 is addressable, publishing a `d` that already exists **replaces** that article. So
  before a new article goes out, Sidecar looks for the account’s own article with that `d` on the
  target relays. If one exists and this draft is not an edit of it, it asks: replace it, or publish
  under a new identifier (`-2`, `-3`). It never replaces silently.
- **`published_at` is the first publication time**, so an edit keeps the original value and only
  `created_at` moves. (Resetting it on every edit is the mistake to avoid.)
- Relays commonly refuse events above about 64 KB. The editor shows the size beside Post once it
  passes 50 KB, and a refusal reads “A relay refused this article as too large” instead of the
  generic failure.

### Publishing

The same path a note takes: proof of work if on, the review countdown, sign, publish to
`targetRelays()`, count the relays that accepted. The draft is cleared only once at least one has.
The receipt links the article by its `naddr`, with relay hints, in a reader the person picks. The
reader list needs a per-client article address pattern, which the note readers do not have today.

### Edit and delete

Part of the first Article release. Editing needs a list of the account’s own 30023 events (read
from the person’s own relays), loading one into the form with its `d` and `published_at` kept, and
publishing it as a replacement. Deleting is a kind 5 with an `a` tag, which Sidecar’s delete flow
already does for other addressable kinds, and it asks first, in words, as every delete here does.
They are built after publishing works, as their own pull request, and ship in the same release.

## Build order

All of it is for after 1.17.1. Each step is its own pull request, in this order, and none starts
without a go-ahead:

1. **Threads.** The mode switch, stacked boxes, paste split, numbering, sequential publish with the
   failure and resume behavior, the receipt.
2. **Article, publish.** The form, the formatting toolbar, the markdown Preview, the `d` rules and
   the collision check, the size hint, the receipt with `naddr`.
3. **Article, edit and delete.** Shipped in the same release as step 2, since both are the first
   Article release.

## Tests

Pure functions are tested directly: the paste split, the `d` slug, the thread tag builder (markers,
order, `created_at` spacing, a reply target’s root), the markdown renderer (no `innerHTML`, raw HTML
as text, the link allow-list). The behavior is tested in the real extension (see
`test/helpers/real-extension.js`) against the local relay:

- a three-post thread: three events, root and reply markers right, ids chained, order by `created_at`;
- a relay that refuses post 2: one event published, the draft holding the rest, Continue thread
  answering post 1, and no event sent twice;
- an article: tags exactly as above, a second publish of the same title offering replace or rename,
  an edit keeping `d` and `published_at`;
- every new string through `t()`, with drafts in all 21 catalogs and a look in the pseudo-locale.

## Decisions

Settled on 2026-11-11:

1. **Numbering** is always shown in the Preview, and a **Number the posts** switch decides whether
   it is also written into the published posts (off by default).
2. **25 posts** is the ceiling for a thread.
3. The article body has a **formatting toolbar**.
4. **Edit and delete** are in the first Article release.

Still open:

5. Which **readers** the article receipt offers. It needs a per-client article address, which the
   note readers do not have today, so this is decided when step 2 is built.
