# Streaming prototype for 1.16

Stream playback and chat are followed by `feat/stream-directory-updates`. No version bump or release yet.

## Try it

Reload the unpacked extension from the usual Sidecar checkout. Choose the **radio-tower icon** in the toolbar and select a stream. A direct HTTPS HLS or MP4/WebM URL also works. Expand changes the existing video element's size. The X closes the player and releases its source.

For an isolated preview, serve the repository and open `/docs/streaming/preview.html`. Its signing and lock buttons simulate view transitions, not real signing or keystore locking. No account is connected in this preview.

## Architecture

The dock is a sibling of all account views. The existing lock, wallet teardown, and approval logic remain intact. The public player neither calls signing APIs nor sends activity messages to extend the unlock timer. The approval overlay starts below the dock and has a separately scrolling card. Expanded playback contracts while an approval is visible; the source is unchanged.

NIP-53 kind 30311 discovery queries three public relays (damus.io, nos.lol, relay.primal.net) only while the directory is open. Events are signature-verified by the existing nostr-tools pool. Latest addressable updates supersede older events, including ended announcements; discovery requests the last seven days (up to 1,000 events per relay). Announcements updated within one hour qualify as live immediately. Older live announcements qualify only after two HLS playlist reads confirm an advancing media sequence; checks follow a master playlist to one variant, never download video segments, run at most two concurrently, and stop when discovery closes. Verification lasts three minutes and is periodically refreshed. Ended announcements remain excluded, and identical playback URLs appear once. Discovery closes when selecting a stream, closing the list, or receiving an approval. Media traffic continues for the selected stream.

Profile links and event-linked zaps use the existing profile and wallet flows. No NIP-71 recordings, follow-list filtering, custom relay settings, or cross-window playback coordination is included. Viewer counts currently reflect selection time. Zap history is scanned per relay in 250-receipt pages, with boundary-second draining (up to 1,000 receipts) and an 80-page per-relay safety bound. Saturated boundaries, timeouts, or exhausted scan budgets are marked incomplete. Receipt scans additionally query nostr.wine and relay.snort.social. Live subscriptions are renewed and gaps are scanned every minute; verified totals are retained in memory across recovery and stream revisits. The display uses an ellipsis while loading and a plus sign for observed totals, with exact amounts and coverage status in the tooltip. Closing/reloading the extension document stops playback. Failed streams show an error and can be selected again. Browsers and stream hosts vary in codec/CORS support.

## Directory views

Live, Upcoming, and Past share the stream directory. Upcoming is ordered by scheduled start time; Past is ordered newest first and plays the NIP-53 recording URL only when one is supplied. Entries without playable media open details, and upcoming entries can be bookmarked before they have a media URL.

Page capacity follows the available panel height and measured row height. Navigation stays above Hide streams. Next browses loaded results and, at the end of Upcoming or Past, requests more history, with per-relay cursors and bounded scanning of duplicate-only batches. Timeouts remain retryable. The directory holds at most 2,000 events.

Details use the same bookmark icon as list rows. Encrypted account backup uses compact upload/download controls with tooltips and inline status. Stream UI labels use the existing translation API; production language catalogs are a separate change.

## Dependency and size

HLS.js 1.7.3 full build is copied unminified from the verified official npm tarball. It is 1,688,873 bytes raw. No application minification or new manifest permissions. Provenance, reproduction and licensing are in VENDOR.md, REVIEWERS.md, NOTICE and scripts/update-vendor.sh. The player uses MediaSource where supported, with native HLS fallback.

## Verification

- Live relay discovery returned current streams.
- Real HLS playback tested in Chrome, Firefox, and the in-app browser.
- Preview approval, expand/collapse and lock transitions preserved the video source and playback progress.
- Runtime tests cover ended/stale events, unsafe URLs, address deduplication, playback continuity through approval/expansion, and stop cleanup.
- Full suite: 2,554 tests pass after the draft PR checks; all vendored hashes and JavaScript syntax checks pass. Installed-extension checks below remain required.
- Still required before release: actual Chrome and Firefox extension signing/auto-lock smoke tests, multiple windows, very short sidebars, and final privacy/store disclosures for public relay discovery and media hosts.

### Disable live video

Settings → Appearance → Live video contains **Enable live video**. The prototype
starts enabled. Turning it off saves `liveVideoEnabled: false` in Sidecar settings,
hides the entire dock, restores its reserved space, stops playback, and disconnects
stream discovery. Other open panels follow storage changes. Re-enabling shows the
toolbar entry without resuming playback or discovery. The standalone review page
exercises the toggle for its current session; persistence uses extension storage
and is covered by the player runtime tests.

The full unminified HLS build supports separate audio renditions. The player links
to the declared host's Primal profile (falling back to the announcement author);
that link hides while locked. Thumbnail priority is stream artwork, the host's banner, an undimmed profile
picture, then the radio-tower icon. Independently loaded layers let lower-priority
images appear while a preferred host is slow; failed layers remain hidden.

### Saved streams

Bookmark icons on directory rows save streams locally in `sidecar_saved_streams`.
The Saved button filters the directory to those entries, still paginated at six.
Bookmarks are shared by accounts in this browser profile. In the Saved view, **Save to account** explicitly publishes a NIP-44 encrypted-to-self NIP-78 record (`30078`, `d=sidecar:stream-bookmarks`) to the active account's write relays. **Restore from account** verifies and decrypts that account's record, then merges it with local saves. Saving is explicit, not automatic background sync; removals reach the relay backup on the next save. Preview backups are in memory only and never publish.
Nostr entries retain the addressable event key and relay hints; selecting one
queries for its latest live announcement before playback rather than trusting a
saved media URL. If it is ended or unreachable, the directory reports that state.
The URL form supports an optional name and Save stream checkbox for direct HTTPS
media URLs. Removing a bookmark does not stop current playback. The standalone
preview uses localStorage; the extension uses chrome.storage.local.

Zap-history fix verification: NoGood Radio resolved to 223,474 sats across 865 validated receipts in the local browser, matching the independent relay audit on October 7, 2026. This does not assert equality with another client’s validation policy or complete global history.


### Stream chat (draft)

While a Nostr stream is playing, press the chat bubble beside the zap controls. Chat replaces navigation and account content below the player, reserving room for active auto-sign and mining status
bars. The composer stays at the bottom; only messages scroll. Press the bubble again or Escape to restore the app. Direct media URLs do not have a Nostr chat address.

Messages use NIP-53 kind 1311, the stream's `a` address, and an `e` parent for
replies. Reads use the stream's declared relays plus discovery relays. Older
messages load in pages with timestamp-boundary draining, capped at 1,000 messages
in memory. Signatures and stream scope are checked. Messages are rendered as text.
Chat is available only with an unlocked active account and closes on lock,
approval, stop, or opening the account menu. Account changes clear the draft and
switch the displayed posting identity and existing mute filters. Sends pin the
expected account through the existing owner-signing API. A participant's bolt
opens the existing zap flow for that author and their kind 1311 message, separate
from stream-host zaps.

The layout preview reads real public chat with fictional posting identities;
it cannot publish or pay. Use its account menu and Toggle timer control to review
identity and available-height behavior. Real-account send/receive, signer support,
and wallet payment smoke tests remain manual checks before shipping.

Chat verification: 2,573 tests passed. Browser review covered real incoming chat, preview account switching, lock cleanup, and timer clearance at 360 × 800 and 360 × 600. No chat messages or payments were sent during verification.


Chat and zap feed recovery: chat history also queries nostr.wine and relay.snort.social,
retains messages across reopening, and distinguishes failed subscriptions from
empty end-of-history responses. Partial loads retry with backoff up to one minute.
Verified stream zaps share the existing receipt validation/cache with the total;
the timeline shows sender, sats, and the signed zap-request comment. Invalid or
duplicate payments are not promoted to activity. Up to 1,000 recent zap rows are
retained per cached stream, separately from the complete observed total.


### Stream details and top zappers

The title spends 12 seconds showing the stream name, then 4 seconds showing
elapsed runtime from the announcement's `starts` tag. Long durations use days.
The transitions.dev text swap moves upward without changing toolbar height.
Hover/focus pauses rotation; reduced-motion settings keep the title static.
Unknown or future starts omit runtime. Click the title to open About stream below
the player, showing the full title, description, start date, and categories. Back
returns to chat when that was open. Lock and approval close About; active timers
retain their space at the bottom.

Chat has a compact horizontally scrollable strip showing the top 10 zappers with profile pictures and amounts, ranked from highest to lowest. The stream total still includes every verified zap. Touch/trackpad scrolling reveals more participants; keyboard users can focus the strip and use the arrow keys. Profile lookups are limited to visible entries.
Exact amounts and names appear in tooltips; selecting one opens the profile.
Rankings use the full validated payment accumulator, not the 1,000-row timeline
cache. No receipts means no strip. Totals reflect available verified receipts,
not a guarantee of global completeness.

Latest verification: all 2,611 automated tests passed on October 7, 2026. Each implementation commit also passed its focused stream and client-preference checks independently. Coverage includes metadata/runtime,
verified zapper aggregation, encrypted bookmark payloads, account-switch guards,
and local chat-send rendering. The 360px leaderboard was checked across all 21
themes. Firefox's localhost review played the real HLS stream with progressing
time and showed chat, top zappers, and About. This is browser verification, not a
claim that the installed Firefox extension's signer/payment flows were tested.

Chat reactions use NIP-25 kind 7 with the comment's event ID, author, and kind
1311. The existing emoji picker opens over chat. Visible comments subscribe to
reaction history and live updates; counts deduplicate the same author's repeated
reaction, honor mute filters, and highlight the active account's reactions.
Reaction publishing pins the account before and after signing. The preview can
show the controls and read public reactions but cannot publish them.

Comment zap actions are labeled “Zap comment” and the payment sheet includes a
three-line comment excerpt with the full text in its tooltip. Connected-wallet
zaps retain the comment event reference; the QR handoff explicitly explains that
an external-wallet address payment is not a comment zap.

The title's runtime uses whole days for day-long streams, hours and minutes for
shorter streams, and a readable minute count below one hour. The exact start
remains in About. Backup tests exercise real NIP-44 encryption and signatures
with disposable local keys; the final installed-extension account round trip
still requires manual verification.

Relay-completion regression: the vendored pool emits `oneose` before `onclose`
when a relay connection fails or a subscription is refused. History reads now
use direct relay subscriptions with an independent deadline that expires before
the library's synthetic EOSE timer. Only a genuine EOSE completes a page;
failed pages retain received receipts, remain incomplete, and retry without
advancing past missing history. Chat history uses the same reader. Incomplete
zap totals keep an ellipsis. Transport-level tests exercise the actual vendored
library with simulated connection failures, CLOSED, silent sockets, and archive
recovery. A fresh NoGood load recovered 223,495 sats from 866 verified receipts;
all 2,604 regression tests passed on October 7, 2026.

Chat profile hydration uses cached identities immediately, prioritizes visible
participants, and applies verified metadata as each relay delivers it. Bounded
parallel batches and cancellation prevent old lookups from updating a closed
chat. Avatar nodes are reused, unchanged zapper rankings are retained, and zap
history counter updates are batched.

Stream hashtag clicks resolve the active account's preferred client at click
time and honor the existing tab-reuse setting. Jumble uses its native hashtag
feed; Primal keeps its search route. Clients without a declared hashtag route
retain the Primal fallback.

The stream directory has a centered, full-width Hide streams footer outside its
scrolling content. Closing clears the app takeover immediately; resize callbacks
during the closing animation cannot reapply it. A regression test reproduces
that callback ordering and fails against the old behavior.
