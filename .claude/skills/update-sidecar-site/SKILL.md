---
name: update-sidecar-site
description: Keep sidecar.top (the official standalone site linked from the Chrome Web Store listing) in sync with this repo's README, FEATURES.md, and PRIVACY.md, and deploy it. Use when PRIVACY.md, FEATURES.md, or the README's Features section changes, when the Chrome Web Store URL changes, when app icons/logo assets change, or when explicitly asked to update or deploy sidecar.top.
---

# Update sidecar.top

sidecar.top is Sidecar's official marketing/homepage site — the link the Chrome
Web Store listing points to. Its source lives in a **separate repo**,
`sidecar-site`, not in this `sidecar` extension repo. Assume it's checked out at
`/Users/daniel/GitHub/sidecar-site` — if it isn't there, stop and ask where it
lives instead of guessing.

(History: the site used to live in the `dmnycnet` repo under
`public_sidecar_dmnyc_net/` and was served at `sidecar.dmnyc.net`. It was split
into its own repo when the project moved to a dedicated domain. The old domain
now 301-redirects to sidecar.top, so any lingering links still resolve — but new
links should point at sidecar.top.)

No build step: plain PHP, no framework. Edit files directly.

## Where things live

```
sidecar-site/
  public/                # web root (the rsync source)
    index.php            # hero + screenshot slideshow + feature grid + testimonial
    features.php         # full feature list
    support.php          # Lightning tip: QR + copyable address (self-contained, no iframe)
    privacy.php          # privacy policy — must mirror sidecar's PRIVACY.md
    includes/header.php  # nav, <title>, canonical + OG/Twitter meta (all use https://sidecar.top)
    includes/footer.php  # "Sidecar | dmnyc.net" attribution
    assets/css/site.css  # velvet/gold palette + fonts, matched to the extension's welcome.css
    assets/fonts/        # bundled OFL webfonts (Playfair Display, Manrope)
    assets/img/          # sidecar-logo.svg, icon128/48/32/16.png, social-card.png,
                         # car-gonzalez.jpg — copied from this repo's assets/ & icons/
    assets/js/           # slideshow.js (homepage), qrious.min.js + support.js (support page)
  deploy/
    deploy.sh            # rsync public/ to the sidecar.top Dreamhost docroot (single target)
    .env.example         # copy to .env (gitignored) and fill in credentials
    askpass.sh           # feeds the SSH password to rsync non-interactively
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
`sidecar-site/public/assets/img/` under the same filenames.

## Verify before deploying

No build step, so just serve it locally and click through:

```bash
cd /Users/daniel/GitHub/sidecar-site
php -S localhost:8011 -t public
```

Check `http://localhost:8011/`, `/features.php`, `/support.php`, and
`/privacy.php` render with no PHP warnings and all images resolve.

## Deploy

```bash
cd /Users/daniel/GitHub/sidecar-site
./deploy/deploy.sh
```

This rsyncs `public/` to the sidecar.top Dreamhost docroot over SSH, using
credentials in `sidecar-site/deploy/.env` (gitignored, not part of this repo).
If that file or its `SIDECAR_TOP_*` credentials are missing, the script says so
— ask the user for them rather than guessing paths or reconstructing
credentials. (Deploy uses `rsync --delete`; a dry run — `rsync ... --dry-run` —
is a good idea before the first deploy to a fresh docroot.)

After deploying, spot-check the live site:

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://sidecar.top/
```
