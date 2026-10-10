# NIP-17 DMs in Sidecar — plan and fit review

Status: target release 1.17 at the earliest. UI direction set by Daniel
(2026-10-10): DMs are initiated from the composer and read in the notification
bell. No Chats tab, no thread list surface. Product decisions are recorded in
§3 and are settled unless Daniel reopens them.

Reference implementation reviewed: coinos v3 at `095caad` (2026-10-09),
`https://git.coinos.io/coinosv3.git`, shallow clone in `/tmp/coinosv3`.

---

## 1. What coinos v3 actually built

Coinos v3 is a self-custodial wallet and full Nostr client (PWA + Android).
Its DM feature is NIP-17 private messages: kind 14 rumor, kind 13 seal, kind
1059 gift wrap. It interops with 0xchat and Amethyst. The DM-specific code is
surprisingly small; most of `src/features/messages.js` (14k lines) is their
Concord community chat and White Noise group work, out of scope here.

### Core crypto — `src/dm.js` (128 lines)

- `makeDMRumor()` builds the unsigned kind 14 rumor synchronously, id
  included, so the message is on screen before any signing or encryption has
  run. Wrapping the same rumor later yields the same id, so the sent-copy echo
  dedupes by id.
- `wrapDM()` seals the rumor (kind 13, NIP-44 encrypted to the receiver) and
  wraps the seal (kind 1059, NIP-44 encrypted to a fresh single-use ephemeral
  key). Outer timestamps are tweaked into the past two days per NIP-59.
- One pragmatic deviation: for remote signers (bunkers, FROST operators) the
  seal is signed at `now()` because some signers refuse to sign anything dated
  in the past. A local key keeps the spec's letter. Sidecar always holds its
  keys locally when unlocked, so we keep the spec's letter everywhere.
- `unwrapDM()` validates the whole chain: seal kind, seal signature, rumor
  hash, rumor author equals seal author. Distinguishes "not ours" (drop) from
  "signer went silent" (retry later, `SIGNER_SILENT` regex).
- Reactions ride the same envelope as a kind 7 rumor (the 0xchat shape), with
  one reaction per author, latest timestamp wins.
- File messages are kind 15, and their cache rows keep the kind and tags: the
  url alone is an encrypted blob and goes dark without the key and nonce.

### The sent-copy pattern — the single best idea in their implementation

Every DM is gift wrapped twice: once to the peer, once to yourself. Your own
copy lands in your own inbox, so your other devices fold your sent message
into the thread from the relay, not from local-only state. Threading rule:
a sent-copy threads under the RECIPIENT (the rumor's p-tag), never under your
own key. They shipped a bug where welcome DMs landed in self-threads before
this rule was explicit, and they sweep cached self-threads at boot to this day.

### Relay plumbing

- Kind 10050 (DM inbox relay list). They publish one if none exists, default
  `relay.coinos.io` + `nos.lol`, and never touch a login identity's list
  because the user's other clients own that.
- Sending: publish the peer wrap to your own relays immediately, then chase
  the peer's declared inbox (10050, falling back to their NIP-65 read relays)
  off the critical path, since that lookup can take seconds. Publishing the
  same wrap twice is harmless; relays dedupe on id.
- Reading: subscribe `kinds: [1059], '#p': [own keys], limit: 400` on your
  DM relays, and ALSO subscribe the relays your own kind 10050 advertises,
  up to 8 extras, because a compliant sender may deliver to a relay you
  didn't subscribe. They got burned: a reply went only to damus/primal and
  no device ever showed it, and a 3-relay read cap cut off the 4th.

### Inbox robustness — the parts that came from real breakage

- `pendingWraps` retry queue: a wrap that nothing could open is NOT consumed.
  The usual reason is a remote signer losing the race with relay backfill on a
  fresh load. Retries are uncounted while the decryptor set is incomplete, and
  a full-strength attempt budget of 3 before giving up. Dropping wraps early
  was how whole stretches of DM history quietly went missing, differently on
  every device; they kept 9 of 186 messages on one phone before the fix.
- Chunked decryption: each unwrap is real secp256k1 work. A backlog decrypted
  in one tight loop blocked their main thread for the whole burst. They cap
  each synchronous run to an 8ms frame budget and yield. Raw-key unwraps run
  off the main thread in a crypto worker entirely.
- Cache persistence: rows merged by id with what's stored, the fuller row
  wins. A tab left asleep since yesterday used to rewrite the cache from its
  own memory and erase what another tab had received.

### Notification filtering — `src/dm-inbox.js` + `src/sw-nwc.js`

A NIP-17 wrap is signed by a throwaway key and the sender's identity sits
under two layers of NIP-44, so no server can filter DMs by sender. Their push
notifier ships the wrap inside the push payload and classification happens on
device: try every held identity key, then decide. Own sent-copy never buzzes,
muted senders never buzz, followed or already-known senders buzz, and if the
account publishes no contact list at all, everything buzzes ("silence would
be worse than noise"). Anything that can't be opened falls back to a generic
notification rather than a silent drop.

The cost, stated plainly in their own threat model comment: the on-device
filter holds a SECOND COPY of the identity secret in IndexedDB, purely so a
service worker can classify pushes. Remote-signer wallets skip this and get
generic notifications.

### What they have that Sidecar should not import

- Concord community chat (CORD-01..05) and White Noise group routing: separate
  protocols, big scope, not DMs.
- The push notifier (`nwcpush.coinos.io`) and wrap-in-push-payload: Sidecar is
  fully local, no server, and that is a feature.
- The IndexedDB key copy: directly against Sidecar's keystore design.

---

## 2. What Sidecar already has

- **The crypto is already vendored and unused.** `nostr-tools.js` ships
  `nip17` (`wrapEvent`, `unwrapEvent`, `wrapManyEvents`, `unwrapManyEvents`)
  and `nip59` (`createRumor`, `createSeal`, `createWrap`). No new dependency.
- **Relay infrastructure**: a SimplePool in the panel with auth handling, NIP-65
  (kind 10002) read/publish/health-check per account, relay doctor.
- **Notification surfaces**: the bell with `_notifCache` per pubkey and live
  subs, mute list (kind 10000) read and write, per-account isolation. The bell
  is already per-account, which matches the (account, peer) thread model.
- **Background discipline that maps one to one**: seal-text TTL memory with a
  sweep alarm (the same shape a wrap log needs), decrypt-burst coalescing
  (built because clients load DM inboxes through us — our users are already
  DM users), alarms infra, queue keepalive.
- **Workers**: `pow-worker.js` and `nip49-worker.js` prove the offthread
  unwrap pattern fits.
- **Tests**: ~90 `node --test` files. DM core is pure logic and tests well.
- **Composer**: drafts autosave per account, @mention autocomplete over
  follows plus global search, send countdown with review and cancel. The DM
  recipient picker reuses the mention autocomplete rather than new UI.

---

## 3. Product decisions for 1.17 (settled 2026-10-10)

1. **Replies live inside the bell row.** A DM bell row expands to the full
   thread with a reply box. No hand-off to client apps, no mini-composer
   per message. (Recorded as implied by decision 2; Daniel can veto.)
2. **Full conversation view in the bell.** Bubbles, day separators,
   optimistic send with pending state. The bell becomes an inbox you never
   have to leave.
3. **Full multi-account from day one.** Subscribe all unlocked accounts.
   Thread keys are (account pubkey, peer pubkey). Wrong-account guards follow
   the same discipline as our signing prompts. Retrofitting multi-account
   later was judged more expensive than building it in.
4. **Strangers never notify — stricter than coinos.** Followed or
   already-known senders notify; muted senders never do. A sender we have no
   relationship with is held under a "from someone new" section: visible when
   the bell opens, silent until the user follows them. Rationale: Sidecar
   shows no public feed, so an unknown sender has less context and carries
   more risk here than inside a full client. This deliberately differs from
   coinos's "everything buzzes with no contact list".
5. **Live sub + backfill.** While the panel is open, a live subscription
   delivers wraps. When the bell opens, a backfill query fills whatever
   arrived while MV3 had us asleep, so threads are complete. No push server;
   no promises while the panel is closed beyond an alarms-driven sealed-count
   badge.

Derived consequence, stated honestly: subscriptions and decryption exist only
while the keystore is unlocked. Locked means a sealed-messages badge and an
unlock prompt, never silent decryption and never a key copy outside the
keystore.

---

## 4. Architecture

New modules, keeping `sidepanel.js` from growing another thousand lines:

- `dm-core.js` (pure, fully unit-tested): rumor/seal/wrap over the vendored
  nip17/nip59; `unwrapWrap` with the full validation chain and the
  not-ours vs retry-later split (simpler than theirs: the key is local or
  absent, never a flaky network peer); reaction rumors; thread keys
  (account, peer); echo dedupe by id.
- `dm-inbox.js` (panel-side state): subscription lifecycle on the panel pool
  for all unlocked accounts, own-10050 read plus extra relay subs,
  backfill-on-open, pending-wrap retry queue with uncounted retries,
  per-thread capped cache (their cap of 50 is reasonable) persisted
  merged-by-id to `chrome.storage.local` under per-account keys.
- `dm-worker.js`: offthread unwrap bursts, the `pow-worker` pattern.
- **Composer DM mode**: the existing composer gains a direct-message mode.
  Recipient via the @mention autocomplete (follows + global search). On send:
  rumor built synchronously and shown immediately, wraps to peer and self,
  publish to own relays, peer inbox chased off the critical path. Drafts
  autosave per (account, recipient).
- **Bell inbox**: DM rows in the notification bell. Row expansion opens the
  conversation view (bubbles, day separators, pending state, reply box).
  Unread counts per thread. "From someone new" section per decision 4.
  A kind-10050 editor is NOT in 1.17; the list is read, published once if
  absent, and surfaced through the existing relay health UI when it names
  unreachable relays.
- **Background**: a wrap log with TTL sweep (the `sealedText` pattern) and an
  alarms-driven sealed-count badge while the panel is closed. Metadata only
  while locked; no decryption outside the unlocked keystore.

## 5. Phases

1. **dm-core + tests.** Pure logic: rumor ids stable under rewrap, unwrap
   validation, sent-copy threading under recipient, reaction folding,
   multi-account thread keys. No UI, no relays.
2. **Relay plumbing.** 10050 read/publish-if-absent etiquette, peer inbox
   lookup with 10002 fallback, live subscription across unlocked accounts,
   backfill query, pending-wrap retries, worker unwrap. Testable against
   relays with a second key, including a third-party sender (a coinos or
   0xchat account) to prove interop before any Sidecar send path exists.
3. **Bell inbox.** DM row type, conversation view, optimistic send from the
   reply box, unread state, "from someone new" section.
4. **Composer DM mode.** Recipient picker, drafts per thread, send path with
   peer-inbox chase.
5. **Notifications and background.** Mute-list integration, the decision-4
   notify table, sealed-state badge and unlock prompt, alarms wrap counting.
6. **Later / open questions.** Kind 15 media, in-chat zaps (Sidecar has a
   wallet; NIP-17 does not define this; needs design), delete requests,
   per-conversation mute.

## 6. Remaining open questions

1. Default kind 10050 content on a fresh publish: mirror the account's NIP-65
   read relays, or a small fixed default set? Recommendation: mirror NIP-65.
   One relay list to reason about, and it is how Sidecar already thinks about
   relays. Coinos publishes its own app defaults because it operates a relay;
   we do not.
2. Kind 15 media: recommendation is text and reactions only in 1.17. If a
   kind 15 arrives, render a placeholder ("file or image message") rather
   than a bare link; unwrap it and keep the row so it never goes dark.
   Sending media waits for a later release. Revisit receive-rendering of
   images if it turns out to be trivial (we hold the key and nonce after
   unwrap), but it does not block 1.17.

## 7. Verdict

Good fit. Coinos proved the protocol and, more valuably, documented every way
it breaks under real users. Their crypto core is 128 lines and the heavy
primitives are already in our vendor bundle. The two parts of their design we
reject (IndexedDB key copy, push server) are rejections of their constraints,
not their ideas. With the §3 decisions, 1.17 is a coherent slice: start in
the composer, read and reply in the bell, nothing while locked, complete
threads on open. Estimated size holds at roughly 1,500 to 2,500 lines across
phases 1 through 5.
