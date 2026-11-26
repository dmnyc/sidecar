# Articles and recipes after they are published: design

Status: part 3 (article routes and relay hints) is on `fix/article-links`; part 4 (Reads) on `feat/longform-library`, stacked on it. Parts 1 and 2 as proposed.

Sidecar writes kind 30023 (articles, and recipes marked with `t zapcooking`) but reads almost
none of it back. The Library has no list of your own pieces, the bell never asks relays about
them, the thread page opens only kind 1111, and Reply to any event refuses an `naddr`. This is
the plan for all four, in the order I'd build them.

## The one idea that runs through everything: the address, not the id

An article is addressable: `30023:<pubkey>:<d>`. Every edit makes a new event id, so anything
keyed on the id (the bell's `ownIdList`, the thread page's `?id=`, a reaction's `e`) loses the
piece the first time it is edited. Each part below keys on the coordinate and treats the id as
"the revision this was about".

A shared `ownLongform` store holds the account's own pieces, newest copy per `d`:
`{ coord, id, d, title, summary, image, recipe: bool, published_at, created_at }`.
It is filled by `{kinds:[30023], authors:[me]}` on the user's write relays, refreshed after
`notePublished` with kind 30023 (compose.js already broadcasts it), and pruned by kind 5
deletions that name the `a`. The bell, the Library and the client chooser all read from it.

## 1. Reply to any event (Developer): smallest, do first

- `parseEventRef` (composer-core.js:2991) accepts `naddr1…` and returns
  `{ kind, pubkey, d, relays }`; `fetchEventRef` gets the newest copy with
  `{kinds:[kind], authors:[pubkey], '#d':[d]}`, the same shape `embedRef` already uses.
- Automatic and kind 1111 already tag an addressable root correctly (`A, E, K, P, a, e, k`).
- Two fixes in `devReplyTags`:
  - a forced kind 1 reply to an article adds `['a', coord, relay, 'root']` beside the `e`, so it
    follows the article past its next edit;
  - a forced 1111 inside a kind 1 thread under an article keeps the article's `A`/`K` instead
    of assuming `K = 1`.
- Tests: naddr parse and fetch, the two tag shapes, and an naddr that resolves to nothing.

## 2. The bell: comments, replies, quotes, zaps and highlights on your pieces

New filters in `buildFilters` (sidepanel.js:8315), keyed on `ownLongform` coordinates:

| What | Filter | Label |
|---|---|---|
| Comment on the piece (NIP-22) | `{kinds:[1111], '#A': coords}` | commented on your article / recipe |
| Reply to one of those comments | already caught by `#p`, label fixed | replied to your comment on {{title}} |
| Kind 1 reply that tags the address | `{kinds:[1], '#a': coords}` | replied to your article |
| Quote | `{kinds:[1], '#q': coords}` | quoted your article |
| Reaction, repost, zap | `{kinds:[7, 16, 9735], '#a': coords}` | reacted to / reposted / zapped your article |
| Highlight | `{kinds:[9802], '#a': coords}` | highlighted your article (the passage is the snippet) |

- `notifLabel` (sidepanel.js:6732) gains a `K`/`k = 30023` branch; it says "recipe" when the
  piece is in `ownLongform` as one, and names the title. Plurals and word order through `t()`.
- `notifTargetId` resolves an `a`-only target through `ownLongform`, so a row can expand.
- Replying from the row needs nothing new: `replyTags` already handles addressable roots.
- Opening a comment row goes to `thread.html`; any other row opens the piece through the
  chooser (part 3).
- Today a comment on your article that `P`-tags you shows as "mentioned you in a comment";
  that is a bug to fix here.
- Hostile input: titles and highlight text come from the event, go into `textContent`, and are
  clipped like any snippet.

## 3. Reading a piece: hand off to a client that can

Decided: Sidecar does not build its own article reader now. A piece opens in a web client
that draws long-form: Jumble, YakiHonne and Primal were named, and Zap Cooking for recipes.

- **Measured 2026-11-24 (logged out, headless Chrome, a real article and a real recipe):**
  all 15 clients in `VIEW_CLIENTS` render an article, title and markdown both, but five
  need a different route for an article than for a note, so today's note link is a dead end
  in those five:

  | Client | Article route | Note route works for an naddr? |
  |---|---|---|
  | Jumble | `jumble.social/notes/{naddr}` | yes |
  | Primal | `primal.net/a/{naddr}` | yes (`/e/`), but `/a/` is its own |
  | YakiHonne | `yakihonne.com/article/{naddr}` | **no** |
  | noStrudel | `nostrudel.ninja/#/articles/{naddr}` | **no** |
  | Zap Cooking | `zap.cooking/r/{naddr}` | **no** |
  | NoorNote | `noornote.app/article/{naddr}` | **no** |
  | Razr | `razr.social/a/{naddr}` | **no** |
  | Iris, Snort, JANK, Nostr Vault, Ditto, Grimoire, Coracle, njump | the note route | yes |

  Only Zap Cooking lays a recipe out as a recipe; the rest show it as a plain article.
- So each `VIEW_CLIENTS` entry gets an `article(naddr)` route (the note route where it works),
  and the chooser is:
  - a recipe goes to Zap Cooking;
  - an article goes to the account's preferred client;
  - a custom client is never assumed to render long-form: it falls back to Jumble.
- **Relay hints matter.** With a stale first hint, Jumble, Snort and JANK showed "not found"
  for a piece that was on other relays. Every naddr we build carries the author's own write
  relays as hints; today's `naddrEncode` calls pass `relays: []`.
- Every place that opens a piece uses this one chooser: bell rows, Library rows, bookmarks,
  highlights, reactions, and the composer's "published" confirmation.
- `thread.html` stays a comment page (decided: no separate page). A comment on an article
  opens there with the article as its context card (title, summary, cover) and an
  "Open in {{client}}" link from the chooser; the comments under the article load by
  `'#A'` as well as `'#E'`.
- Our own reader, with a shared `markdown.js` lifted from longform.js, stays a later option.

## 4. The Library: a Reads tab

Decided name: Reads. A fifth icon tab beside Bookmarks, Highlights, Comments and Reactions.

- Rows from the account's own kind 30023 on its relays, newest first by `published_at`: cover
  thumbnail, title, a recipe or article mark, the date, and a comment count when there are any
  (a capsule, per the house rule; kind 1111 by `#A`).
- A row opens the piece in a client that renders it (part 3). Its ⋮ leads with Copy link (that
  client's page) and Copy article address / Copy recipe address (the naddr, which every edit
  keeps), then the event ID and JSON, and ends with Delete article / Delete recipe: two taps, then a kind 5 with
  the `a`, the listed copy's `e` and `k 30023`. No empty replacement is published.
- **No Edit, and no drafts here, for now.** Editing a published piece is deferred: until we
  find Sidecar needs its own editor, other clients handle it. Unpublished drafts stay in the
  composer's own drafts.
- The live sub (`startLibraryLive`, sidepanel.js:18543) adds 30023 so a piece published from
  the full-size tab shows up without a reload.

Fixes to the existing tabs that fall out of the same work:

- Bookmarks: `BM_KIND_LABEL` says "recipe" for a `t zapcooking` piece; article rows show the
  summary and a thumbnail; opening an `a` bookmark uses the chooser.
- Highlights: a highlight from an article opens the article (through the chooser), not the bare 9802.
- Comments: keep comments on Nostr events, not only on web pages (today the `I`-is-http filter
  drops comments on articles); they open in the thread page.
- Reactions: read the `a` tag as well as the last `e`.
- `addBookmark` writes `['a', coord]` for an addressable event instead of the revision's `e`.

## Downstream

- editor-matrix `recipes/README.md`: rows for reading a recipe back, comments on it, and the
  bell, with Zap Cooking's columns.
- Translation: every new label through `t()`/`tn()`, the title as a parameter; check en-XA and
  a right-to-left locale, and `dir="auto"` on titles, summaries and bodies.
- Themes: the article context card at 1280 and the narrow panel rows, in every theme (the contrast sweep
  harness can run on the new views).
- Help and What's New, at release time.

## Decided (2026-11-24)

1. No separate page: comments stay in `thread.html`.
2. No reader of our own for now: pieces open in clients that render them (part 3).
3. The Library tab is called Reads.
4. The bell counts reactions, reposts and zaps on pieces too.
5. (2026-11-26) Editing a published piece is deferred, and added later only if we find it is
   needed; for now other clients handle it. Reads has no Edit and no drafts. Delete stays.
