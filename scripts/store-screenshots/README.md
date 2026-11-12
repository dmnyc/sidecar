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
  `personas.js`), the people's profile events, and the invoice when the client does not make one.
  Nothing is ever paid: the payment card is always answered with Reject.
- **Signed in or not:** by default every card is answered with Reject, so no key leaves the machine and
  the client receives nothing. A recipe with `"signedIn": true` approves the login card with Allow once,
  so the client sees the demo account's public key and shows its signed-in view. Its steps may then
  answer the cards a payment raises, each only when named: `{ "answer": [ { "approve": "Sign", "when":
  "zap request" }, ... ], "until": "lightning payment" }` presses the matching button on each card in
  whatever order they arrive and stops at the payment card. A card no rule names stops the run and is
  named in the error, so a recipe can never sign an event it did not list. Sharing the pretend wallet's
  balance and signing a zap request are the usual two; the request goes to the note author's Lightning
  provider, which hands back a real invoice that the capture never pays. Choose a source and a note
  whose author expects it, such as your own.
- **Window size:** a recipe is driven in the capture browser's own window, which is narrow, and only
  photographed at 1280 × 910. A client that picks a phone layout by width needs `"viewport": true`, which
  sets the photographed size from the start. Leave it out for a recipe tuned at the default window.
  A client that shows Sidecar's own "Request to pay" card needs a press on it:
  `{ "shadowClick": "button.pay" }`, then another `answer` for the payment card that follows.
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
  (see `recipes.js`): the steps click by text or selector (retrying while a live page draws its dialogs),
  send a real mouse click when a button needs a user gesture, wait for text, answer cards in the panel,
  and press a control inside one of Sidecar's own in-page cards (closed shadow roots, reached through the
  DevTools protocol). When a step fails, the page and the panel are saved beside the other captures.
  Without a recipe the page is asked directly. The recipe for the client in use lives with your other
  capture inputs, not in the repo, because the client's buttons change.

## Layout

`manifest.json` holds the plate color and the position, size and corner radius of every picture.
Change the background there. `layout.js` mirrors the two-up images for Firefox.

## Not automated yet

Uploading to the stores and the site is by hand. `scripts/publish-images.mjs` publishes a file to a
Blossom server and records its URL, for when that step is built.
