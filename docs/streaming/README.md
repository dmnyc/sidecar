# Streaming prototype for 1.16

Local branch: `feat/streaming-video`, based on main. No version bump or release yet.

## Try it

Reload the unpacked extension from the usual Sidecar checkout. Choose **LIVE** in the new top dock and select a stream. A direct HTTPS HLS or MP4/WebM URL also works. Expand changes the existing video element's size. Stop releases the player and its source.

For an isolated preview, serve the repository and open `/docs/streaming/preview.html`. Its signing and lock buttons simulate view transitions, not real signing or keystore locking. No account is connected in this preview.

## Architecture

The dock is a sibling of all account views. The existing lock, wallet teardown, and approval logic remain intact. The public player neither calls signing APIs nor sends activity messages to extend the unlock timer. The approval overlay starts below the dock and has a separately scrolling card. Expanded playback contracts while an approval is visible; the source is unchanged.

NIP-53 kind 30311 discovery queries three public relays (damus.io, nos.lol, relay.primal.net) only while the directory is open. Events are signature-verified by the existing nostr-tools pool. Latest addressable updates supersede older events, including ended announcements; live listings expire after one hour without updates. Discovery closes when selecting a stream, closing the list, or receiving an approval. Media traffic continues for the selected stream.

This prototype is read-only. No chat, zaps, NIP-71 recordings, follow-list filtering, host-profile resolution, custom relay settings, detached player, or cross-window playback coordination is included. Closing/reloading the extension document stops playback. Failed streams show an error and can be selected again. Browsers and stream hosts vary in codec/CORS support.

## Dependency and size

HLS.js 1.7.3 light build is copied unminified from the verified official npm tarball. It is 1,071,835 bytes raw and approximately 240 KB deflated. No application minification or new manifest permissions. Provenance, reproduction and licensing are in VENDOR.md, REVIEWERS.md, NOTICE and scripts/update-vendor.sh. The player uses MediaSource where supported, with native HLS fallback.

## Verification

- Live relay discovery returned current streams.
- Real HLS playback tested in Chrome and the in-app browser.
- Preview approval, expand/collapse and lock transitions preserved the video source and playback progress.
- Runtime tests cover ended/stale events, unsafe URLs, address deduplication, playback continuity through approval/expansion, and stop cleanup.
- Full suite: 2,532 passing tests before the final small playback/discovery adjustments; targeted tests rerun afterward.
- Still required before release: actual Chrome and Firefox extension signing/auto-lock smoke tests, Firefox HLS playback, multiple windows, very short sidebars, and final privacy/store disclosures for public relay discovery and media hosts.

### Disable live video

Settings → Appearance → Live video contains **Enable live video**. The prototype
starts enabled. Turning it off saves `liveVideoEnabled: false` in Sidecar settings,
hides the entire dock, restores its reserved space, stops playback, and disconnects
stream discovery. Other open panels follow storage changes. Re-enabling shows the
LIVE entry without resuming playback or discovery. The standalone review page
exercises the toggle for its current session; persistence uses extension storage
and is covered by the player runtime tests.

The full unminified HLS build supports separate audio renditions. The player links
to the declared host's Primal profile (falling back to the announcement author);
that link hides while locked. Broken advertised thumbnails try the host's public
profile picture, then retain the neutral placeholder if artwork is unavailable.
