# Wallet backends — what Sidecar uses, and what it ruled out

Sidecar's Lightning wallet talks **NWC (NIP-47)** to a wallet you already control.
Sidecar never holds funds and never runs a node. For users who don't have a wallet
yet, the Rizful quick start (below) obtains an NWC connection without a paste.

This file records the alternatives that were evaluated and rejected, and why. It
exists so the question doesn't get re-opened from scratch every few months — and so
that anyone proposing a change knows which walls are already mapped.

Each rejection carries the date it was assessed. A reason can expire: package sizes
move, APIs ship, and a constraint that decided something in July may not hold by
autumn. Check the dates before quoting a verdict, and correct the entry rather than
arguing with it.

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
| Ark (bark/captaind) | no | **no** — a static `ark1…` address instead |

You can have "no API key" or "a built-in Lightning address," but not both, unless you
run the server yourself. An API key is largely what you pay for someone else running
that infrastructure.

Ark is the one entry that bends the constraint without breaking it: an Ark address
*is* static and *does* receive while you are asleep, because the server holds the
incoming coin in a mailbox until you come back. But it is an `ark1…` address, not a
`lud16`, so it buys a real receive identity everywhere except the place Sidecar needs
one. Ruled out for now, with the reasons dated and the reopen conditions kept —
see the Ark section under **Evaluated and rejected**.

## Evaluated and rejected

### Breez SDK Spark: rejected on size and on a commercial dependency

*Assessed 2026-07-28. Re-checked 2026-09-18: one of the four reasons below has
substantially weakened, and the size figure has moved. Both corrected here.*

[`@breeztech/breez-sdk-spark`](https://www.npmjs.com/package/@breeztech/breez-sdk-spark)
is a genuinely capable embedded wallet, and the architecture is well understood: the
SDK has to live in an **offscreen document** that owns the WASM and IndexedDB, with
the service worker relaying RPC to the side panel.

In order of how much they still weigh:

1. **11 MB of WASM.** Sidecar's signed package is 4.4 MB as of 1.13.0, so this is
   roughly a 3.5x increase for one optional feature. The original note said 6.5x,
   which was accurate against the 1.86 MB package of 1.6.0 and is no longer.
2. **A required API key, which is a commercial dependency.** The key is a Breez
   *partner* credential: it cannot spend and it cannot read balances, so a leak is a
   quota and ToS problem rather than a theft one. Concealment is not the question,
   since you cannot keep a secret in code running on someone else's machine. The
   question is that a credential which can be revoked would sit under a feature
   users' money depends on. Baking it at package time on the same seam that already
   generates the gitignored `version.js` is the workable answer; proxying is not,
   because the JWT rides the SDK's internal Spark Operator requests rather than one
   call we control, so it would mean proxying the whole network layer and routing
   wallet metadata through a server.
3. **It requires `'wasm-unsafe-eval'` in the extension CSP**, on a signer whose
   listing says everything runs locally with no remote code. Still true, but it
   invites a review conversation on every submission.
4. **Firefox has no `chrome.offscreen` API.** This was the most severe reason when
   the entry was written, and it is now the weakest. It assumed shipping Chrome and
   Firefox from one codebase was a live commitment. Since then Firefox has been deprioritized, the AMO listing is
   dormant at 1.8.0, and 1.13.0 went out on the unlisted channel unannounced. A
   Chrome-only wallet backend is no longer the fork of the product it would have been
   in July.

**Two questions were never put to Breez, and either could change the answer:**

- Is there a key class for distributed clients, scoped per install or per domain
  rather than a shared partner quota? Every non-server-backed wallet app hits this,
  so they will have a stance.
- Does mainnet work with no key at all? It is typed optional and treated as required
  by every implementation we looked at. If keyless mainnet works with reduced
  service, that is the cleanest outcome and costs nothing to confirm.

Note what Spark would and would not buy: self-custody and easy onboarding, never a
built-in Lightning address. The constraint at the top of this file is not something
an embedded SDK can lift.

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

### Ark (bark/captaind): the strongest candidate so far, and still ruled out for now

*Assessed 2026-09-20, against the `src/ark` client in `dmnyc/coinosv3`.*

Every technical reason that killed Breez SDK Spark is answered by this implementation.
The reason that remains is the one at the top of this file, plus a product question
Sidecar has never had to answer: **is Sidecar willing to hold funds at all?**

**What CoinosV3 actually built.** A native-JS client for
[bark/captaind](https://github.com/ark-bitcoin/bark) — Second's Ark implementation —
speaking gRPC-web with a hand-rolled protobuf codec and doing MuSig2 with the server
directly. No WASM, no SDK. It is 3,704 lines / 167 KB across nine modules
(`proto`, `send`, `board`, `lightning`, `refresh`, `offboard`, `exit`, `validate`,
`manager`), plus a further 2,120 lines of wallet UI on top. Its entire external
surface is four packages: `@scure/base`, `@noble/hashes`, `@noble/curves`, and
`@scure/btc-signer/musig2`.

**Costed against Sidecar's actual constraints:**

| Breez Spark's blocker | Ark's answer |
|---|---|
| 11 MB of WASM (3.5x the package) | **194 KB** of vendored crypto + ~170 KB of protocol code — about 10% on a 4.4 MB package |
| A required Breez partner API key | **No key.** Two public mainnet servers today — `ark.coinos.io` and `ark.second.tech` — picked from a list, or point it at your own `captaind` |
| Needs `'wasm-unsafe-eval'` in the CSP | **Nothing.** Plain JS, no CSP change, nothing to explain at review |
| Needs `chrome.offscreen`, so Chrome-only | **Nothing.** No offscreen document, so Firefox behaves identically |

The 194 KB figure is measured, not estimated: `esbuild --bundle --format=iife` over
`@scure/btc-signer@1.8.1/musig2`, `@scure/base@1.2.6`, `@noble/curves@1.9.0`
(`secp256k1`, `schnorr`) and `@noble/hashes@1.8.0` (`sha256`, `ripemd160`) gives
198,921 bytes unminified, 92 KB minified, 34 KB gzipped. That is the same
pinned-npm-through-esbuild recipe `scripts/update-vendor.sh` already uses to build
`nip49.js`, so it meets `VENDOR.md`'s provenance bar without inventing a new one.
Sidecar's bundled `nostr-tools` carries these same primitives internally but exports
none of them, so they cannot simply be borrowed.

**Two things fit Sidecar's architecture better than they have any right to.**

- `ArkManager` checkpoints to storage before and after every server-effectful RPC,
  because the server marks an input spent the instant it cosigns. That discipline was
  written against a PWA that Android can freeze mid-ceremony — and it is exactly the
  discipline an MV3 service worker that dies after 30 seconds of idle requires. The
  hard part of putting a multi-round protocol in an extension is already done.
- Round refresh is **delegated and poll-based** (`submitRoundParticipation` then
  `roundParticipationStatus`), not a stream held open for the round's duration. The
  mainnet coinos server runs 1-hour rounds; an extension cannot hold a gRPC-web stream
  for an hour, and with this design it does not have to.

**And one thing is genuinely new.** An Ark address is static, reusable, and **receives
while the wallet is offline** — the sender pushes the coin to the recipient's mailbox
at the server, and the wallet collects it whenever it next opens. No backend evaluated
in this file has offered that before. It is the first credible answer to "what is
Sidecar's receive identity," and it does not need anything awake at a domain.

#### Why it is still "not yet"

In order of how much they weigh:

1. **Sidecar would hold funds.** The second sentence of this file is "Sidecar never
   holds funds and never runs a node," and it is a claim on the store listing, not
   just a design note. An Ark wallet puts vtxo secret keys and signed vtxo bytes in
   extension storage: lose the browser profile, lose the money. That is a different
   product with a different threat model, shipped inside a signer whose entire pitch
   is that it protects one secret well. This is a decision for the project, not a
   trade-off to be engineered around.

2. **It still does not produce a `lud16`, so there is still no zap button.** The
   mailbox trick works for Ark-native sends. Receiving over *Lightning* goes through
   the server's HTLC-in flow, which needs the wallet online to request the invoice and
   online **again** to claim it by revealing its preimage. A stranger cannot pay a
   sleeping Ark wallet over Lightning, so the constraint at the top of this file is
   unchanged and NIP-57 zaps stay impossible. This is the same wall NIP-60 hit.

   CoinosV3's own answer is worth knowing: a **BIP-353** payment name
   (`₿name@domain`, a DNSSEC-signed TXT carrying a BIP-21 URI with an `ark=`
   instruction). That is a genuinely static, genuinely offline receive identity — but
   it needs a registrar to publish and maintain the record (coinos runs one), and no
   Nostr client resolves it to decide whether to draw a zap button. It solves the
   problem for a wallet, not for a wallet living inside a Nostr client.

3. **Sidecar has no seed to derive from, and the obvious fix is the one already
   rejected.** CoinosV3 derives Ark keys at account chain 3 of a BIP39 seed and
   derives its Nostr key from that same seed — money first, identity second. Sidecar
   is the inverse: the `nsec` is the root and there is nothing above it. Deriving Ark
   keys from the `nsec` makes the `nsec` a bearer instrument for money, which is
   verbatim the objection recorded against NIP-60 two sections up. Carrying a second
   independent secret instead means a second backup story, in a product whose backup
   story (`nip49`, the PDF backup, the whole welcome flow) is built around there being
   exactly one secret.

4. **No unilateral exit without an on-chain wallet.** Exit is the trustless backstop —
   publish the vtxo's pre-signed transaction chain yourself and claim after the
   timelock. Those are zero-fee v3 transactions with P2A anchors, so every hop needs a
   CPFP child funded by **an on-chain coin the wallet already holds**, one confirmed
   hop at a time. Sidecar has no on-chain wallet, and building one is a larger project
   than the Ark client itself. Without it, the only way out is the collaborative
   offboard, which works only if the server cooperates — which downgrades the honest
   description from "the server cannot take your money" to "the server cannot take
   your money but can strand it."

5. **Unattended balances decay.** A vtxo has an expiry height; past it the server can
   sweep it. Staying alive means periodically refreshing through a round, which costs
   a fee and requires the wallet to be *opened*. A browser extension is exactly the
   thing that sits untouched for four months. An NWC balance left alone for a year is
   still a balance; an Ark balance left alone is a loss mode, and no amount of UI
   copy makes that not true.

6. **Small zaps are expensive on the native path.** CoinosV3's notes put the server's
   Lightning *send* floor at 20 sat on mainnet — 80% of a 25 sat zap — while the
   receive direction is free. Their fix was to build a third-party swap bridge at
   max(2 sat, 2000 ppm), which requires `VtxoPolicy::Htlc` support that is an
   unmerged upstream proposal (`ark-bitcoin/bark` work item 1388, draft MR in a fork).
   Sidecar would either eat the floor on the exact payment size Nostr uses most, or
   take a dependency on coinos's bridge.

7. **bark is young and the wire format is mirrored by hand.** Second shipped bark on
   mainnet in June 2026 and the project's own docs still carry experimental warnings.
   CoinosV3's client re-implements bark's `ProtocolEncoding` v2 from the Rust source
   by reading it. That is careful work, and it is also a standing obligation to chase
   upstream format changes with user funds sitting behind the old one. NWC carries no
   such obligation: NIP-47 is stable and someone else's node is the thing that has to
   keep up.

8. **Provenance splits in two.** The crypto bundle can be byte-exact from pinned npm
   packages, as `VENDOR.md` requires. The 3,700-line protocol client cannot be — it is
   first-party code with no upstream artifact to diff against, and it has to be
   correct about MuSig2 nonces, taproot sighashes and forfeit construction in a
   repository that ships a signer. It would be the largest piece of consequential
   cryptographic code in Sidecar by a wide margin, and the only one no one can check
   by running `sha256sum -c`.

#### What would change the answer

Any one of these is worth reopening the file for:

- **Nostr clients learn to resolve something Ark-shaped for zaps** — a BIP-353 name or
  an `ark1…` address on a profile, honoured the way `lud16` is today. Right now that
  number is zero, and it is the only thing that turns points 1 and 2 from a blocker
  into a cost.
- **Third-party HTLC lands upstream.** It is currently the bridge's dependency, but
  the shape it enables is bigger: something always-on could run an LNURL endpoint and
  lock an HTLC *on behalf of* an offline Ark wallet. That is the mechanism by which an
  Ark wallet could eventually have a Lightning address, and it is the single upstream
  change most worth watching.
- **Sidecar decides it is willing to hold funds.** If that ever becomes true for any
  reason, this is the implementation to hold them with — and the question becomes
  whether it also ships an on-chain wallet, because point 4 says that is what "self
  custody" costs.

#### The adjacent, much cheaper thing

BIP-353 *sending* is separable from all of the above and needs no Ark client. Resolving
a pasted `₿name@domain` to its `lightning=` instruction and paying it with the NWC
wallet that is already connected is a contained feature that makes Sidecar a better
payer, in the same shape as the CLINK note below. The honest price is that doing it
*properly* means client-side DNSSEC validation — CoinosV3 treats the DoH resolver as
untrusted transport and validates the chain from the ICANN root down, which is another
355 lines — and doing it improperly means trusting a DNS resolver about where money
goes. That is a real decision, not a detail, and it is the reason this is a separate
piece of work rather than a footnote.

## Still open

### CLINK: worth watching, and cheaper than this file used to claim

*Assessed 2026-07-28. Corrected 2026-09-18 after reading a working implementation.*

[CLINK](https://clinkme.dev/) (Common Lightning Interface for Nostr Keys, by ShockNet)
defines Nostr-native Lightning offers (`noffer`) and debits (`ndebit`), with
NIP-05 to offer discovery. It addresses discovery and connection over Nostr rather
than over HTTPS.

**How paying a `noffer` actually works.** The bech32 blob carries a service pubkey, a
relay, an offer id, and optionally a price. The payer NIP-44 encrypts `{offer, amount}`
to the service pubkey, publishes it as an ephemeral **kind 21001** event on the relay
named in the noffer, subscribes for the encrypted reply on the same relay, and gets a
bolt11 back. Paying that invoice is then whatever the wallet already does. It is
LNURL-pay with Nostr as the transport instead of HTTPS.

**The cost is not an SDK.** This entry used to price it at
[`@shocknet/clink-sdk`](https://www.npmjs.com/package/@shocknet/clink-sdk), 85 KB. A
shipping implementation in `zapcooking` does not use the SDK at all: it is about 400
lines of first-party code plus 150 of tests, over NDK and its own NIP-44. Sidecar has
every primitive that needs already, so the realistic cost is translating those 400
lines from NDK to `nostr-tools`, not taking a dependency.

**What it would and would not buy.** It does **not** remove the always-on requirement.
Something still has to be awake to answer a kind 21001 with a fresh invoice, and an
extension asleep in a side panel cannot be that. So CLINK makes Sidecar a better
*payer* and never a payee: a `noffer` on someone's profile becomes payable with the
wallet that is already connected. Nobody should expect it to deliver the built-in
Lightning address that the constraint at the top of this file rules out.

**The shape worth adopting, if it is adopted.** Recognize a `noffer` on the profile
sheet and pay it through the existing wallet path, which is contained and reuses what
is there. `zapcooking` also parses noffers out of note content and bios and renders pay
buttons inline; that is the part to leave alone, because rendering payment affordances
inside note text is client work and Sidecar hands off.

**Still held, for reasons that have not changed.** The specification is an
[open PR](https://github.com/nostr-protocol/nips/pull/1529) rather than a merged NIP,
and wallet-side support is thin enough that a user could go months without meeting a
noffer. Cheap to add alongside NWC once that changes. The point of this correction is
that when it does change, the work is smaller than it looked.

## Bitcoin Connect — nothing to add, on either side

[`@getalby/bitcoin-connect`](https://www.npmjs.com/package/@getalby/bitcoin-connect)
is a connect-a-wallet UI for web apps, not a wallet backend. It comes up anyway, so
both directions are recorded here.

**As something pages use to reach Sidecar: already works, nothing to do.** Bitcoin
Connect registers its extension connector as `extension.generic`, labeled "Browser
Extensions" — generic, not Alby-specific — and it picks up any `window.webln`, which
Sidecar provides. Sidecar also already carries a settlement bridge for it
(`nostr-provider.js`, the "Bitcoin Connect settlement bridge" block): a zap paid from
Sidecar's own card would otherwise leave the page's modal spinning on an invoice that
had already settled.

One thing worth knowing for support: users on a Bitcoin Connect page click **"Browser
Extensions"**, not "Sidecar." That is Bitcoin Connect's copy, not something this side
can change.

**As a connect option inside Sidecar: no case for it.** Its connector list is Alby
Hub, Browser Extensions, NWC, Coinos, LNbits, LNbits NWC Plugin, Cashu.me. Against
that:

- The connectors largely duplicate what exists. "NWC" is paste-a-connection-string.
  Alby Hub, Coinos and LNbits are provider flows that all terminate in an NWC string —
  which is exactly what the Rizful quick start below does, at no dependency cost.
- "Browser Extensions" is incoherent here. It means consuming another extension's
  `window.webln`. Sidecar *is* a WebLN provider, and the side panel has no page
  `window.webln` to consume in any case.
- 263 KB for the UMD bundle — about 14% on top of the entire shipped package — plus
  five transitive dependencies including `@getalby/sdk` and `@lightninglabs/lnc-web`.
  Sidecar's NWC client is ~150 hand-rolled lines with zero dependencies; this would
  import an SDK to redo it.
- It is a Lit web-component UI with its own theming, and would match none of the five
  themes.
- `VENDOR.md` promises byte-exact provenance with CI-pinned hashes so that "no trust
  in this repo is required." A 263 KB third-party UI bundle with five dependencies is
  a large surface to stand behind in a signer, for a connect dialog.

**The one case that would justify it** is breadth of connectors without writing each
flow — particularly LND-direct over LNC, which Bitcoin Connect supports and Sidecar
would otherwise never build. That is a question about who the users are, not about
architecture.

## What shipped instead: the Rizful quick start

The problem was never that NWC is bad — it's that a user with **no** Lightning wallet
has a hard first five minutes. That is now solved without a backend change at all.

Rizful publishes a token exchange (the same one Jumble uses): the user creates an
account, gets a one-time code, and Sidecar trades it for a standard NWC connection
string, which then goes through the same `SIDECAR_SET_NWC` path as a hand-pasted one
and is validated by the same `getInfo` round-trip first.

Why this beats every embedded-wallet option evaluated above:

- **No API key, no WASM, no offscreen document**, so it works identically on Firefox —
  which is where Breez Spark failed outright.
- **No new dependency.** One `fetch` and a text field.
- **It completes the loop.** The exchange returns a lightning address (or one rides in
  the NWC string's `lud16`), which the Profile screen's existing `maybeSuggestLud16`
  prompt offers to publish. That is what makes a brand-new wallet reachable by zaps,
  and it was already built — the gap was only ever *acquiring the string*.
- **The pattern generalizes.** A second provider is a few dozen lines against the same
  UI, so this is not a single-vendor lock-in.

The trade-off is stated in the UI rather than hidden: Rizful is custodial, run by
[Megalith](https://megalithic.me/), and the modal says they hold the funds and that a
self-custodial wallet can replace it later. Sidecar still holds nothing.

A fully app-initiated handshake — Sidecar generates a keypair, the user approves in
their wallet, no copy-paste at all — remains the ideal, and is what Damus appears to
have with Coinos. It needs provider-side support that isn't in Coinos's public API
([open feature request](https://github.com/coinos/coinos-server/issues/74)), so the
code exchange is the best available today.
