---
name: update-sidecar-site
description: Keep sidecar.dmnyc.net (the official standalone site linked from the Chrome Web Store listing) in sync with this repo's README, FEATURES.md, and PRIVACY.md, and deploy it. Use when PRIVACY.md, FEATURES.md, or the README's Features section changes, when the Chrome Web Store URL changes, when app icons/logo assets change, or when explicitly asked to update or deploy sidecar.dmnyc.net.
---

# Update sidecar.dmnyc.net

sidecar.dmnyc.net is Sidecar's official marketing/homepage site — the link the
Chrome Web Store listing points to. Its source lives in a **separate repo**,
`dmnycnet` (the dmnyc.net project showcase + this subdomain), not in this
`sidecar` repo. Assume it's checked out at `/Users/daniel/GitHub/dmnycnet` — if
it isn't there, stop and ask where it lives instead of guessing.

No build step: plain PHP, no framework. Edit files directly.

## Where things live

```
dmnycnet/public_sidecar_dmnyc_net/
  index.php        # hero + feature highlights + Chrome Web Store CTA
  features.php      # full feature list
  privacy.php        # privacy policy — must mirror sidecar's PRIVACY.md
  includes/header.php  # nav, <title>, Chrome Web Store link lives in each page that needs it
  includes/footer.php
  assets/css/site.css  # accent color #FFA01B (from the martini glass icon), not dmnyc.net's yellow
  assets/img/           # sidecar-logo.svg, icon128/48/32/16.png, social-card.png — copied from
                        # this repo's assets/ and icons/ dirs, not generated
```

## Keeping content in sync

**privacy.php must match PRIVACY.md.** This is a legal document referenced by
the Chrome Web Store, not marketing copy — when `PRIVACY.md` in this repo
changes, transcribe the changes into `privacy.php` verbatim (convert Markdown
to the existing HTML structure, don't paraphrase), and update the "Last
updated" date to match.

**features.php is written from README.md's "Features" section, not
FEATURES.md.** `FEATURES.md` in this repo is internal tester/beta notes
("Please test & report", "early tester build" caveats) — not public-facing
copy. When the feature set changes, pull the polished description from
`README.md`'s Features section and adapt it into `features.php`'s existing
category structure (Accounts & keys, Signing, Lightning wallet, Profile &
backups, Note composer, Settings & safety), not from FEATURES.md.

**Chrome Web Store URL** lives in `index.php` (`$chromeStoreUrl`) — currently
`https://chromewebstore.google.com/detail/sidecar-a-classy-nostr-si/moimlikilhheabdafocpmneehpblhiln`.
Update if the listing URL ever changes (e.g. a new extension ID).

**Assets** (`sidecar-logo.svg`, `icon128.png`, etc.) are copied byte-for-byte
from this repo's `assets/` and `icons/` directories — if those are
regenerated/redesigned here, re-copy the updated files into
`dmnycnet/public_sidecar_dmnyc_net/assets/img/` under the same filenames.

## Verify before deploying

No build step, so just serve it locally and click through:

```bash
cd /Users/daniel/GitHub/dmnycnet
php -S localhost:8011 -t public_sidecar_dmnyc_net
```

Check `http://localhost:8011/`, `/features.php`, and `/privacy.php` render
with no PHP warnings and all images resolve.

## Deploy

```bash
cd /Users/daniel/GitHub/dmnycnet
./deploy/deploy.sh sidecar
```

This rsyncs `public_sidecar_dmnyc_net/` to the `sidecar.dmnyc.net` Dreamhost
docroot over SSH, using credentials in `dmnycnet/deploy/.env` (gitignored,
not part of this repo). If that file or its `SIDECAR_*` credentials are
missing, the script will say so — ask the user for them rather than guessing
paths or reconstructing credentials.

After deploying, spot-check the live site:

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://sidecar.dmnyc.net/
```
