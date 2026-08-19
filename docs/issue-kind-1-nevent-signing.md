# Signing A Kind-1 Note Showed An Unreadable Event Kind

## Report

When posting a normal kind `1` note whose body included a NIP-19 `nevent`
reference, Sidecar showed the signing request as an unrecognized event kind
instead of a normal note. The post had to be sent with another client.

The reference supplied with the report:

```text
nevent1qvzqqqqqqypzpmnw5yatnljuff5w47d35d87q99xddqpzlzsac4xzn6vm22ekmn5qyt8wumn8ghj7mn0wd68yetvd96x2uewdaexwtcpzamhxue69uhhyetvv9ujuct60fsk6mewdejhgtcqyqqqpewddujmzj23fcfpaeygep2xl763u6r6n86ktwmcksalm0n4wxy2yhr
```

## The `nevent` Was Not The Cause

Ruled out by reading the paths rather than by failing to reproduce it:

- Nothing in either approval surface derives the kind from the body. Both read
  `ev.kind` off the request params and nothing else (`sidepanel.js`
  `renderApprovalPreview`, `prompt.js` `renderPreview`). The only decoded NIP-19
  kind anywhere is in `embedRef`, where an `naddr`'s kind goes into a relay
  filter for the embed card.
- The two surfaces keep separate kind tables, and the tables are identical — same
  97 keys, same strings, both with `1: 'Note'`. A well-formed kind `1` cannot
  render as unrecognized on either one. `test/approval-kind-isolation.test.js`
  now pins the tables to each other.
- The reference itself decodes to `kind: 1`, so the first cut of that test
  ("a kind:1 event labels as a note") could not have failed either way. Its
  fixtures now carry a referenced kind that differs from the outer kind.

## What Actually Produced It

Sidecar accepted `params.event || params` with no shape validation at any layer.
Every plausible malformed shape ended exactly the way the report ends — an
approval card that describes nothing, then a post that fails:

| The page sends | The prompt showed | Then |
| --- | --- | --- |
| `signEvent(JSON.stringify(event))` | `Kind —`, no tag count, no content preview | `signer.js` threw `signEvent: missing event`, *after* approval |
| `signEvent([event])`, or no argument | the same blank card | nostr-tools threw `can't serialize event with wrong or missing properties` |
| `kind` as the string `"1"` | labeled correctly, but the Formatted view silently disappeared (`noteLike` tests `=== 1`) | the same serializer throw |

A user who saw a blank kind, approved anyway, and got an opaque failure would
describe it as Sidecar not recognizing the event, and would then go and post from
another client.

A string kind also mis-tiered the background's own checks, all of which are
identity or `Set` comparisons: `COALESCE_KINDS.has`, `RELAX.neverRelaxes`, the
`9734` zap test, `isNip42AuthEvent`'s `22242`, and `BASELINE`'s `TRACKED.has`.
That last one is the destructive-overwrite guard, so a `kind: "3"` follow-list
wipe skipped its warning entirely — defense in depth rather than an exploitable
hole, since nostr-tools then refused to sign it, but it was the wrong branch on
the one check that exists to prevent data loss.

## The Fix

1. `normalizeSignEventParams` in `background.js` settles the shape before
   anything is queued, prompted, or signed. Liberal where the intent is
   unambiguous (a JSON-string event, a numeric-string kind, absent
   `tags`/`content`/`created_at`, non-string tag values); throws a
   `signEvent: …` error the page can show its user where it isn't. The
   normalized event is what gets queued, previewed, and signed, so the approval
   card and the signature can never describe different events.
2. Both approval surfaces now label an unreadable event `Unreadable`, carry an
   explicit warning, and open the JSON view, instead of showing a bare `—` with
   Allow looking as ordinary as ever. Unreachable after (1), kept because the
   thing it replaces was a blind approval.
3. The composer's missing `q` tag — see below.

## Also Found: The Composer Could Not Quote

`doPublish` tagged only the client tag and `p` tags from `npub` mentions, so a
`nostr:nevent…` pasted into Sidecar's composer went out as plain text. Clients
key quote rendering off NIP-18's `q` tag, the quoted author was never notified,
and Sidecar's own notification list does the same (`notificationKind`'s `hasQ`) —
so a quote composed in Sidecar did not read as a quote in Sidecar.

`quoteTags` now derives `q` tags from body references (`note`/`nevent` by event
id, `naddr` by `kind:pubkey:d` coordinate) and offers the quoted authors for `p`
tags. Still out of scope: replies (the panel composer has no reply path at all,
by design — Sidecar hands threads off to a web client) and page comments
(`buildWebComment`, which quotes nothing today).

## Regression Coverage

- `test/sign-event-shape.test.js` — the accepted and rejected shapes, that every
  accepted one produces an event the vendored nostr-tools actually signs, and
  that a coerced kind reaches `COALESCE_KINDS`, the baseline guard, and
  `isNip42AuthEvent` as a number.
- `test/approval-kind-isolation.test.js` — a body reference cannot change the
  signed event's kind (with fixtures whose referenced kind differs from the outer
  kind), unreadable events are called out on both surfaces, and the two surfaces
  know exactly the same kinds.
- `test/quote-tags.test.js` — `q` tags per reference type, relay hints, dedupe,
  malformed refs skipped, and no overlap with `mentionPTags`.

## Not Reproducible On Request

Confirmed with the reporter: the failure will not reproduce now. That is what the
analysis above predicts — the `nevent` is not the trigger, so repeating the same
action in the same client proves nothing, and a client update (or a different code
path that day: a retry, a restored draft, a quote built by another component) would
make the payload shape that caused it disappear for good.

So the shape gate closes a class of real defects, but which one your reporter hit
is not established. Recorded as a hypothesis, not a confirmed root cause. The `q`
tag gap below is independent of the report and was confirmed by reading the code.

## If It Recurs

A refusal now documents itself. `handleNostrRpc` writes a `rejected` entry to
Activity before rethrowing, so Activity → Log shows "Refused an unreadable signing
request", the host, the reason, and (on hover) a shape fingerprint —
`params`/`event`/`kind`/`tags`/`content`/`created_at` as types, plus the kind value.
Types and structure only: no content, no tag values, no pubkeys from a request
Sidecar declined to sign. Before this, a refusal left no trace on a store build at
all (`dlog` is dev-builds only), which is exactly why the first report arrived with
nothing to look at.

Still worth asking for: whether the approval appeared in the side panel or the
popup window, and which client and version.

## Open, Reviewed But Not Changed

Found while reading these paths. None of it is implicated in the report; all of it
is adjacent enough to want a second look if a similar one arrives.

- **Batched approvals preview only the head.** `pendingView` groups the showing
  request with every queued entry sharing host + account + kind, and "Allow all (N)"
  signs the group. The comment reasons that same-kind means a site can't slip a
  different event type into a batch — true, but two *different notes* are the same
  kind, so a site can have a second kind-1 signed off a card that describes the
  first.
- **`batchKeyOf` groups on a null kind.** Encrypt methods are batchable and carry
  `kind: null`, so a `nip04.encrypt` and a `nip44.encrypt` from one host and account
  share a batch key despite being different methods.
- **The panel's approval preview touches the network.** `renderNotePreview` resolves
  embeds from relays and fetches OG metadata for every https link in the content,
  from the signing screen, before the user has approved anything. Deliberate — the
  popup (`prompt.js`) documents the opposite choice for exactly this reason — but it
  means a request being *reviewed* has already reached out.
- **`noteLike` and the unreadable check assume a normalized kind.** Both surfaces
  test `ev.kind === 1` / `Number.isInteger(ev.kind)`, which is now safe only because
  `handleNostrRpc` guarantees it. Any future path that builds prompt data elsewhere
  reopens the string-kind hole.
- **Page comments can't quote.** `buildWebComment` emits no `q` tags, so the
  composer fix does not cover kind-1111 comments.
- **User rejections aren't logged.** `rejected` entries cover shape refusals only.
  A user who rejects a prompt leaves no record either, so "I said no and it still
  happened" would arrive with as little evidence as this report did.
