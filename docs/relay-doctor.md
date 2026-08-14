# relay-doctor

Audits a pubkey's NIP-65 relay list for liveness and write viability, then
recommends a replacement set.

`scripts/relay-doctor.mjs` — dev-only. `scripts/` is stripped from the packaged
extension by `scripts/package.sh`, so this never ships to users.

## Why it exists

A NIP-65 **write** set is the single point of failure for posting in any
outbox-model client (Jumble, Coracle, noStrudel). A relay that has gone dark,
started charging, or begun gating writes behind a subscription looks identical
to a healthy one in every client's relay editor — you find out when a note
silently fails to land. This measures each relay instead of trusting the list.

## Requirements

Node 22+ (uses the built-in global `WebSocket`). **No `npm install`.** `nak` is
only needed if you run the publish command it prints.

## Usage

```bash
# Audit the list you have published
node scripts/relay-doctor.mjs <npub-or-hex>

# Also probe a candidate pool and print a recommended set
node scripts/relay-doctor.mjs <npub-or-hex> --candidates

# Audit a set you are considering, before publishing it
node scripts/relay-doctor.mjs --check "wss://a,wss://b=write,wss://c=read"

# Machine-readable (raw measurements only — no advisories)
node scripts/relay-doctor.mjs <npub-or-hex> --json
```

In `--check`, `=write` / `=read` set the marker. No suffix means read **and**
write, matching NIP-65's "marker omitted" rule.

## What it measures

Per relay, concurrently (8 at a time):

| Check | Why |
|---|---|
| WebSocket connect | Baseline reachability, and the connect latency. |
| Serves a query (REQ → EOSE) | A relay can complete the handshake and then never answer. A naive connect check calls that "up". |
| NIP-42 AUTH challenge | An AUTH demand blocks third-party writes. |
| NIP-11 `limitation` | `payment_required`, `auth_required`, `restricted_writes`. |
| Read latency | Time from open to EOSE. Tiebreak only — never the primary ranking. |

### Verdicts

| | Meaning |
|---|---|
| `✓ healthy` | Connects, serves, no gating. Safe for read **and** write. |
| `$ gated` | Paid / restricted writes. Fine **write-only** if you subscribe. Broken as a read relay. |
| `A auth-gated` | Demands NIP-42 AUTH. Same story. |
| `~ not-serving` | Handshake completed, then nothing. |
| `✗ down` | Refused or timed out. |

## The two advisories

**List size.** NIP-65: *"Clients SHOULD guide users to keep `kind:10002` lists
small (2-4 relays of each category)."* Checked per category.

**Mailbox deliverability** — the one no client UI surfaces. NIP-65 tells other
clients to publish notes that mention you to **every one of your read relays**.
Those senders are not your subscribers, so a read relay that charges or demands
AUTH drops your mentions on the floor. A paid relay is a fine **write** target —
you are the one authenticating — and a poor **read** target for exactly the same
reason.

The corollary is worth stating plainly: a NIP-65 read relay is your **mailbox**,
not your reading list. Relays you merely browse belong in your client's settings.

## Reach tiers, not latency

Write relays are ranked by reach tier first, latency only as a tiebreak. A 55ms
fediverse bridge is a worse write target than a 330ms relay half of Nostr reads
from. See the `REACH` map in the script; adjust it as the network moves.

## Key safety

**The script never reads, asks for, or handles a private key.** It only reads
from relays. To publish a corrected list it prints a `nak event -k 10002 …`
command for you to run yourself, so the key stays in whatever you already trust
with it. It also prints the raw tag JSON for pasting into any NIP-65 editor,
including Sidecar's own (Profile → relay list).

## Two caveats

**Probes are unauthenticated.** A relay you subscribe to can read `✗` or `A` and
still work in your signed-in client — but that is also exactly what a lapsed
subscription looks like. Verdicts are firm only for open relays.

**It is chatty.** Every run opens a socket and fires a query at each relay. Run
it repeatedly and you will trip rate limits and start seeing false
`~ not-serving` results (`nostrelites.org` and `wot.utxo.one` did this during
development). Space runs out, and re-check anything newly broken before acting.

## Worked example

Auditing a list whose write set had drifted to paid relays only:

```
WRITE relays (1/4 usable)
  ✗ wss://filter.nostr.wine    down     handshake refused
  $ wss://relay.azzamo.net     gated    payment required, restricted writes
  ✗ wss://nostr.wine           down     handshake refused
  ✓ wss://relay.poster.place   healthy  246ms/104ms

⚠  3 of 7 READ relays can't accept mail from strangers
⚠  Only 1 unGated write relay
```

The fix was 4 write / 3 read, mixing paid relays (write-only, where the user
authenticates) with open high-reach relays (read **and** write, so mentions can
actually be delivered).
