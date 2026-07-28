# Wallet backends — what Sidecar uses, and what it ruled out

Sidecar's Lightning wallet talks **NWC (NIP-47)** to a wallet you already control.
Sidecar never holds funds and never runs a node.

This file records the alternatives that were evaluated and rejected, and why. It
exists so the question doesn't get re-opened from scratch every few months — and so
that anyone proposing a change knows which walls are already mapped.

## The constraint that decides most of it

**A Lightning address is a hosted service.** Receiving `you@example.com` requires
something awake at a domain, serving `/.well-known/lnurlp/you` and answering a
callback with a fresh invoice whenever a stranger decides to pay you
([LUD-16](https://github.com/lnurl/luds/blob/luds/16.md)).

A browser extension is not reachable at a domain and is not running when the browser
is closed. It therefore cannot be its own Lightning address, no matter which SDK is
embedded in it.

That matters more on Nostr than elsewhere, because
[NIP-57](https://github.com/nostr-protocol/nips/blob/master/57.md) zaps resolve
through the `lud16` field on your profile. **No `lud16`, no zap button** — not a
failed zap, but no button at all, in every major client.

Which produces the trade-off table:

| Backend | Needs an API key | Provides a Lightning address |
|---|---|---|
| **NWC (current)** | no | yes — inherited from your wallet |
| Breez SDK Spark | **yes** | yes, via Breez infrastructure |
| Cashu / NIP-60 | no | **no, and cannot** |

You can have "no API key" or "a built-in Lightning address," but not both, unless you
run the server yourself. An API key is largely what you pay for someone else running
that infrastructure.

## Evaluated and rejected

### Breez SDK Spark — rejected on size, keys, and Firefox

[`@breeztech/breez-sdk-spark`](https://www.npmjs.com/package/@breeztech/breez-sdk-spark)
is a genuinely capable embedded wallet, and the architecture is well understood: the
SDK has to live in an **offscreen document** that owns the WASM and IndexedDB, with
the service worker relaying RPC to the side panel. It is not viable here for four
reasons, in order of severity:

1. **Firefox has no `chrome.offscreen` API.** Sidecar ships Chrome and Firefox from
   one codebase (see `BROWSER_PARITY.md`). A Chrome-only wallet backend is a fork of
   the product, not a feature of it.
2. **11 MB of WASM.** Sidecar's entire signed package is under 2 MB. This is roughly a
   6.5× increase for one optional feature.
3. **A required API key.** The key is a Breez *partner* credential — it cannot spend
   or read balances, so a leak is a quota/ToS problem rather than a theft one. But
   this repo is public and the extension runs entirely on the user's machine, so the
   key would have to be injected at package time and would still be extractable from
   any install. That is a commercial dependency that can be revoked, on a feature
   users' money depends on.
4. **It requires `'wasm-unsafe-eval'` in the extension CSP**, on a signer whose
   listing says everything runs locally with no remote code. Still true, but it
   invites a review conversation on every submission.

### Cashu / NIP-60 — rejected because it cannot receive zaps

[NIP-60](https://github.com/nostr-protocol/nips/blob/master/60.md) (Cashu wallets with
state on relays) is an excellent fit on paper: no API key, no WASM, no server, and its
stated purpose is that "new users immediately are able to receive funds without
creating accounts with other services." Wallet state follows the user across apps.

It was rejected because **a NIP-60 wallet has no `lud16`, so it cannot receive
ordinary zaps** — see the constraint above. Inbound payments would work only via
[NIP-61](https://github.com/nostr-protocol/nips/blob/master/61.md) nutzaps, which are
supported by a small minority of clients. For a wallet that lives inside a Nostr
signer, being unable to participate in the main way money moves on Nostr is
disqualifying.

Two secondary findings, recorded because they are easy to miss:

- **`nsec` becomes a bearer instrument for the wallet.** NIP-60 keeps the wallet's
  spending key separate from the Nostr key, but stores it encrypted *to* the Nostr
  key so wallet state can follow the user. Anyone holding the `nsec` can therefore
  decrypt it and spend. This is inherent to the design, not a flaw in it — but it
  sits badly with a signer whose purpose is protecting that key.
- **`@cashu/cashu-ts` ships no browser bundle** (no `browser`, `unpkg` or `main`
  field; four dependencies; ~1.5 MB unpacked). Vendoring it would require a local
  build rather than a byte-exact copy of a published artifact, which is a weaker
  provenance guarantee than every other bundle in `VENDOR.md`.

## Still open

### CLINK — worth watching, too early to adopt

[CLINK](https://clinkme.dev/) (Common Lightning Interface for Nostr Keys, by ShockNet)
defines Nostr-native Lightning offers (`noffer`) and debits (`ndebit`), with
NIP-05 → offer discovery. It is the most interesting alternative found, because it
addresses discovery and connection over Nostr rather than over HTTPS, and
[`@shocknet/clink-sdk`](https://www.npmjs.com/package/@shocknet/clink-sdk) is 85 KB
with dependencies Sidecar already vendors (`nostr-tools`, `@scure/base`,
`@noble/hashes`).

It does **not** remove the always-on requirement — something still has to answer a
`noffer` request with a fresh invoice — so it is an alternative to *NWC*, not a way
for the extension to become its own wallet. Its appeal is onboarding: connecting by
Nostr identity rather than by pasting a connection string.

Held for now because the specification is an
[open PR](https://github.com/nostr-protocol/nips/pull/1529) rather than a merged NIP,
and wallet-side support is limited. Cheap to add alongside NWC if it gains traction;
expensive to have shipped early if it doesn't.

### Making NWC connection easier

The problem worth solving is not that NWC is bad — it's that a user with no Lightning
wallet at all has a hard first five minutes. An app-initiated connection handshake
(Sidecar generates a keypair, the user approves in their wallet, the connection string
returns without copy-paste) would be a large onboarding win for a fraction of the cost
of embedding a wallet, and costs neither an API key nor Firefox support.
