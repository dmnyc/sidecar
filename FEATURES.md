# Sidecar — Tester Build

Sidecar is a Nostr signer and Lightning wallet that lives in your browser's side
panel. Your keys stay on your device, encrypted behind a PIN, and Sidecar provides
`window.nostr` to the web apps you use — so you sign in and sign events across
clients without ever pasting your nsec into a website.

## Accounts & keys

- **Multiple accounts** — store as many nsecs as you like, drag to reorder, switch
  the active one in a click.
- **Generate or import** — make a fresh key, or import an existing `nsec`/hex. On
  import you get a live preview of the account (name + avatar from its profile)
  before saving, so you know it's the right one.
- **PIN-protected** — every private key is encrypted at rest (PBKDF2 → AES-GCM).
  Nothing is stored in plaintext, and the keystore auto-locks.
- **nsec paste guard** — pasting a secret key is blocked everywhere except the
  import field, so it can't leak into the wrong box.

## Signing (NIP-07)

- Full NIP-07 surface: `getPublicKey`, `signEvent`, `nip04`/`nip44` encrypt &
  decrypt, `getRelays`.
- **Per-site permissions** — approve or reject each site, with a prompt that
  previews what you're signing. Relay auth (NIP-42) signs automatically so clients
  stay connected.
- **Per-site account binding** — each site stays pinned to the account it logged in
  with (no identity desync). Move a site to another account from Connected Sites.
- **Port-aware sites** — `localhost:3000` and `localhost:5173` are treated as
  separate sites.

## Lightning wallet (NWC)

- Connect any Nostr Wallet Connect wallet (Alby Hub, Coinos, Primal, …). Sidecar
  never holds your funds.
- **Send** (BOLT11 or Lightning address), **Receive** (invoice or your
  Lightning-address QR), and paginated **history** with expandable details —
  counterparty, fee, payment hash, preimage.
- **WebLN** — web apps can pay and make invoices through your wallet, gated by
  approval with an optional per-site daily budget you can edit or revoke any time.
- **Pay from any page** — when a site shows a Lightning invoice, a "Pay with
  Sidecar" card appears (only on apps you're signed into). You can also right-click
  a `lightning:` link, a selected invoice, or a QR.
- **Auto-approve zaps** (optional, off by default) — pay zaps without a prompt up to
  a limit you set (default 100 sats). Verified real zaps only; bigger zaps, non-zaps,
  and a locked wallet still ask.

## Profile & backups

- View and edit your profile; publish kind 0.
- **Backups** — encrypt your profile, follows, and mute list to your own key on your
  relays (NIP-78), or export a signed JSON bundle.

## Settings & safety

- Auto-lock timer, relay list, default web client for opening notes, balance privacy
  toggle.
- **Reset Sidecar** (Danger zone) — wipe everything on the device (type-to-confirm).

## Please test & report

- Signing in and signing on your usual clients, and the approval prompts.
- Connecting an NWC wallet; sending, receiving, and zapping.
- The "Pay with Sidecar" card on different clients.
- Multi-account switching and per-site bindings.

## Heads-up

- Self-custodial: there is no recovery if you forget your PIN — back up your nsecs.
- Bring your own NWC wallet; Sidecar holds no funds.
- For zap testing use a small mainnet balance (testnet has no zap infrastructure).
- This is an early tester build — expect rough edges, and please file what you hit.
