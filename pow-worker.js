// Sidecar: NIP-13 proof of work, off the panel's main thread.
//
// Mining is a tight loop over sha256 until the event id has N leading zero bits, which
// is 2^N hashes on average and unbounded in the worst case. On the panel's own thread
// that would freeze every countdown, button and animation for as long as it ran; at 22
// bits that is routinely tens of seconds. Same reasoning as nip49-worker.js,
// and the same shape: importScripts the SAME vendored bundle so nothing forks.
//
// IT HASHES THROUGH getEventHash RATHER THAN ROLLING ITS OWN. The id this produces has
// to match the one finalizeEvent recomputes at signing time, byte for byte, or the
// zeros are lost and the work was wasted. Reimplementing the NIP-01 serialization here
// to save its per-call validateEvent was measured at 1.2x, which is not worth owning a
// second copy of the one thing that must never disagree.
importScripts('nostr-tools.js');

// NIP-13's own reference implementation, which is the definition of difficulty: the
// count of leading zero BITS, not zero hex characters. A hex digit of 7 or less carries
// leading zeroes of its own, which is the part that is easy to get wrong.
function leadingZeroBits(hex) {
  let count = 0;
  for (let i = 0; i < hex.length; i++) {
    const nibble = parseInt(hex[i], 16);
    if (nibble === 0) {
      count += 4;
    } else {
      count += Math.clz32(nibble) - 28;
      break;
    }
  }
  return count;
}

// How often the loop reports back. Frequent enough that the panel's elapsed counter
// moves like a clock rather than a slideshow, rare enough that postMessage is not
// itself a measurable share of the work.
const REPORT_EVERY = 20000;

// How often the clock is re-read. NIP-13 recommends updating created_at while mining,
// and a 22-bit mine can outlast a minute, so an event that started before the
// user's last coffee should not publish carrying that timestamp. Re-stamping also
// reshuffles the whole search space for free, which costs nothing and avoids grinding
// one serialization forever.
const RESTAMP_EVERY = 400000;

// The loop itself, separated from the message plumbing so it can be lifted and run for
// real in a test rather than only grepped. `report` is called with progress; returning
// the mined event is what the caller posts back.
function minePowEvent(ev, bits, report) {
  const target = Math.max(0, Math.min(40, Number(bits) || 0));
  ev.tags = (ev.tags || []).filter((t) => !Array.isArray(t) || t[0] !== 'nonce');
  // The third entry is the TARGET, which NIP-13 says a miner SHOULD commit to. It is what
  // lets a reader reject a bulk-mined note that got lucky at a difficulty it never aimed
  // for, so a thread demanding 40 bits cannot be answered by spam aiming at 8.
  const nonce = ['nonce', '0', String(target)];
  ev.tags.push(nonce);

  let attempts = 0;
  let best = 0;
  for (;;) {
    nonce[1] = String(attempts++);
    const zeros = leadingZeroBits(NostrTools.getEventHash(ev));
    if (zeros > best) best = zeros;
    if (zeros >= target) return { event: ev, attempts, difficulty: zeros };
    if (attempts % REPORT_EVERY === 0 && report) report({ attempts, best });
    if (attempts % RESTAMP_EVERY === 0) ev.created_at = Math.floor(Date.now() / 1000);
  }
}

onmessage = (e) => {
  const { id, event, bits } = e.data || {};
  try {
    // The event arrived through structured clone, so this is already a private copy:
    // mutating it here cannot reach the composer's draft.
    const out = minePowEvent(event, bits, (p) => postMessage({ id, progress: true, ...p }));
    postMessage({ id, ok: true, event: out.event, attempts: out.attempts, difficulty: out.difficulty });
  } catch (err) {
    postMessage({ id, ok: false, error: String((err && err.message) || err) });
  }
};
