# Store screenshots

The five images in the Chrome Web Store gallery, the AMO listing and the sidecar.top slideshow,
generated from the real extension so they show the product as it is. The set is Chrome's, plus a
Firefox set with the panel on the left where Firefox puts its sidebar.

## Every release: does the gallery need a pass?

```sh
node scripts/store-screenshots/needed.js
```

It lists the interface files that changed since the last release and exits 1 when there are any
(the panel, its styles and themes, the pages that sit beside it, the approval card, icons, fonts).
A hit means "regenerate and look", not "the gallery is wrong". If nothing changed, the live set
stands. This is a step in the release checklist (`BROWSER_PARITY.md`).

## Making the final set

On the release commit, with `version.js` stamped for it (`scripts/stamp-version.sh`) and a clean tree:

```sh
node scripts/store-screenshots/run.js --release 1.17.1 \
  --client-url https://CLIENT/ --recipe RECIPE.json
```

It asks once for the demo vault's export password, at a hidden prompt. It writes
`store/screenshots-1.17.1/chrome/` and `/firefox/`, each a complete set of five, and
`capture-info.json` (version, commit, which client, whose keys). `store/` is gitignored, so the set
stays local until you upload it. Look at every image before you do.

A release set refuses test keys, a vault key that is not the person's, and a set with an image
missing.

## What is real and what is not

- **Real:** the extension, its panel, its default relays, its pages, and the approval cards. The cards
  come from a real page at the client's address asking through `window.nostr` and `window.webln`.
- **Pretend:** the wallet (a NIP-47 service on the local relay that answers the balance and history in
  `personas.js`), the people's profile events, and the invoice. Nothing is paid, and every card is
  answered with Reject, so no key leaves the machine and no client receives anything.
- **The network:** only the client's live page uses it. Chrome sends the panel's default relay hostnames
  and the picture hosts to a local TLS server, so the panel runs with its own settings and its own
  addresses and nothing else is fetched.

## Inputs

- **The demo vault** (`--vault`, default `~/Sidecar Backups/demo-accounts-vault-2026-11-07.json`): gives
  Gatsby his real key, so the panel shows his real public key.
- **Fixtures** in `~/.local/share/sidecar-images/fixtures/` (override with `SIDECAR_STORE_FIXTURES`):
  `gatsby-avatar.jpg`, `gatsby-banner.jpg`, and `<name>-avatar.jpg|png` for Amelia, Kandinsky and Holden.
  A missing one is drawn as a colored initial.
- **The client and a recipe:** which client to feature is chosen at capture time. A recipe is a small
  JSON file of clicks that takes the client's page to the moment that asks Sidecar for something
  (see `recipes.js`). Without one the page is asked directly.

## Layout

`manifest.json` holds the plate color and the position, size and corner radius of every picture.
Change the background there. `layout.js` mirrors the two-up images for Firefox.

## Not automated yet

Uploading to the stores and the site is by hand. `scripts/publish-images.mjs` publishes a file to a
Blossom server and records its URL, for when that step is built.
