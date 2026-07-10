# Sidecar Privacy Policy

_Last updated: 2026-07-09_

Sidecar is a browser extension that acts as a Nostr signer (NIP-07) and a
Lightning wallet client (Nostr Wallet Connect / NIP-47). It is designed so that
your secrets stay on your own device. This policy explains what Sidecar stores,
what it sends, and what it does not do.

## The short version

- Sidecar has **no backend servers**. The developer does not operate any service
  that receives your data.
- Your **private keys (nsecs) never leave your device**. They are encrypted at
  rest and used only locally to produce signatures.
- Sidecar collects **no analytics, no telemetry, and no tracking** of any kind.
- The only servers Sidecar contacts are ones tied to an action you take: the
  **Nostr relays you configure**, **your own Lightning wallet** (via the Nostr
  Wallet Connect string you provide), and a few services described below (link
  previews, media uploads, and @-mention search). Nothing is sent to the
  developer.

## What is stored, and where

All data is stored **locally on your device** using the browser's extension
storage. None of it is transmitted to the developer.

- **Accounts / private keys** — encrypted at rest (PBKDF2 key derivation →
  AES-GCM encryption, via the Web Crypto API) and unlocked with your PIN or
  passphrase. Decrypted keys exist only in memory while unlocked and are cleared
  when the extension locks.
- **Wallet connection** — your Nostr Wallet Connect string is stored encrypted
  with the same protection as your keys.
- **Settings and preferences** — auto-lock timer, relay list, per-site
  permissions, per-site spending budgets, default web client, and similar.
- **Local activity log** — a capped, on-device history of signing/permission
  events, shown in the Activity tab. It never leaves your device and can be
  cleared at any time.

There is **no account recovery**: if you forget your PIN/passphrase, your data
cannot be recovered. Back up your nsecs.

## What is sent over the network, and to whom

Sidecar only talks to services **you choose**:

- **Nostr relays** — to read your profile/metadata and to publish events you
  sign (e.g. your kind 0 profile, or backups you choose to store). You control
  the relay list.
- **Your Lightning wallet** — payments and invoices go to the wallet you connect
  via Nostr Wallet Connect. Sidecar never holds your funds.
- **Web pages you use** — when you sign in to a Nostr web app, Sidecar provides a
  signature or a public key to that page, with your approval. Pages receive
  signatures and your public key — **never your private key**.
- **Link previews** — when a note you compose or view contains a URL, Sidecar
  fetches that page through the extension to read its preview (title,
  description, image) tags. This contacts the linked site directly; no
  third-party preview service is involved, and requests to private or local
  network addresses are blocked.
- **Media uploads** — when you attach an image or video to a note, it is
  uploaded so it can be included. Uploads go to your own Blossom media
  server(s) (from your kind:10063 list) when you have them configured, and
  otherwise fall back to **nostr.build**. Only the media you choose to attach is
  sent.
- **@-mention search** — when you type `@` in the composer to mention someone,
  Sidecar searches your follows locally and also queries the **Nostr Archives**
  search API so you can find any Nostr user by name. Only the text you type in
  the mention search is sent.

Sidecar does not send any of this data to the developer. The services above are
the only ones it contacts — those you configure (relays, wallet) or invoke by a
specific action (a link preview, a media upload, an @-mention search) — and there
is no analytics or tracking of any kind.

## Permissions

Sidecar requests only the permissions it needs to function:

- **Storage** — to keep your encrypted keystore, settings, and local activity.
- **Side panel** — to show the Sidecar interface.
- **Alarms** — to auto-lock the keystore after a period of inactivity.
- **Context menus** — for the right-click "Pay with Sidecar" option.
- **Notifications** — to confirm payment results.
- **Host access (all sites)** — to provide the Nostr signer
  (`window.nostr`/`window.webln`) to whatever Nostr web client you visit. Sidecar
  only acts when a page requests signing/payment and you approve; it does not
  read or collect page content.

## Remote code

Sidecar does not load or execute remote code. All code, including the Nostr
cryptography library, is bundled in the extension package.

## Changes

If this policy changes, the updated version will be posted here with a new
"last updated" date.

## Contact

Questions about this policy can be directed to the project maintainer via the
project's repository.
