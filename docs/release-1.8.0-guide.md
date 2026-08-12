# Sidecar 1.8.0 Release Guide

**Tag:** `v1.8.0` — commit `8861f96`
**Date:** 2026-08-12
**Zips:**
- Chrome: `dist/sidecar-1.8.0.zip` — sha256 `7dbd82d5bc08bcce143d5bdf698f6eab744dd83ff929cd1a5f756e687bcf63aa`
- Firefox: `dist/sidecar-1.8.0-firefox.zip` — sha256 `952d67df2578addd54adf5749df703cd12c0b42e6fdb51684b5988060cdb5445`

## What shipped

### New
- Bauhaus theme (sixth theme, third light theme)
- Per-theme display fonts (six typefaces across six themes)
- "Wrong account?" escape on the signing prompt (#169)
- Distinct activity icons per event kind (#164)

### Fixed
- **Follow count and @-mention list now read NIP-65 relays** (#172) — was showing 0 when a configured relay held a stale kind:3; also fixes baseline seeding from zero-follow events
- Signing approval no longer hidden behind a modal (#168)
- Signing request retried after SW eviction (#167)
- Relay connection leak (#166)
- One NWC pool per client (#162)
- Copied secrets cleared after 60s (#163)
- Panel repaint behind overlay (#165)
- Drag-to-reorder at list boundaries (#160)
- Relax exclusion loosened for replaceable kinds (#160)

### Changed
- Art Deco gold text → deep bronze (1.67:1 → 5.23:1) (#170)
- Film Noir venetian-blind stripes replace filigree (#170)
- Relax countdown dots visible on light themes (#170)

## Store submissions

### Chrome Web Store
1. Go to the [developer dashboard](https://chrome.google.com/webstore/devconsole)
2. Edit "Sidecar — a classy Nostr signer"
3. Upload `dist/sidecar-1.8.0.zip`
4. No new permissions — skip the permissions re-approval flow
5. Release notes: copy from the CHANGELOG.md `[1.8.0]` section
6. Submit for review (~1 week)

### Firefox AMO
1. Go to [AMO developer hub](https://addons.mozilla.org/developers/)
2. Edit "Sidecar — a classy Nostr signer"
3. Upload `dist/sidecar-1.8.0-firefox.zip`
4. Release notes: same as Chrome
5. Submit — AMO auto-approves in minutes

## Post-release checklist
- [ ] GitHub release published (non-draft)
- [ ] Chrome Web Store submitted
- [ ] AMO submitted
- [ ] Verify Chrome listing shows 1.8.0 after review
- [ ] Verify AMO listing shows 1.8.0
- [ ] Update [release status memory](sidecar-release-status.md) with verified store versions
