#!/usr/bin/env node
// relay-doctor — audit a pubkey's NIP-65 relay list for liveness and write viability,
// then print a recommended replacement list.
//
// Why this exists: a NIP-65 write set is the single point of failure for posting in
// any outbox-model client (Jumble, Coracle, noStrudel). A relay that has gone dark,
// started charging, or begun gating writes behind a subscription looks identical to a
// working one in every client's relay editor — you only find out when a note silently
// fails to land. This measures each relay instead of trusting the list.
//
// KEY SAFETY: this tool never asks for, reads, or handles a private key. It only
// reads from relays. To publish a corrected list it prints a `nak event` command for
// you to run yourself, so your key stays in whatever you already trust with it.
//
// Usage:
//   node scripts/relay-doctor.mjs <npub-or-hex>            audit the current list
//   node scripts/relay-doctor.mjs <npub> --candidates      also probe the candidate pool
//   node scripts/relay-doctor.mjs <npub> --json            machine-readable
//
// Dev-only: scripts/ is stripped from the packaged extension by scripts/package.sh.

const CONNECT_TIMEOUT = 6000;
const READ_TIMEOUT = 7000;
const NIP11_TIMEOUT = 6000;
const CONCURRENCY = 8;

// Bootstrap relays used only to FIND the kind:10002. Broad on purpose: if the list
// itself is unreachable we still need to read it from somewhere.
const BOOTSTRAP = [
  'wss://purplepag.es',
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://nostr21.com',
  'wss://relay.primal.net',
];

// Reach tiers. Latency is a terrible sole ranking for a WRITE relay: what matters is
// how many people's clients read from it. A 55ms fediverse bridge is a worse write
// target than a 330ms relay half of Nostr subscribes to. Tier 1 = broad general-purpose
// reach, tier 2 = solid but narrower, tier 3 = niche/special-purpose (bridges, AI,
// single-community). Latency only breaks ties within a tier.
const REACH = new Map([
  ['wss://nos.lol', 1],
  ['wss://relay.damus.io', 1],
  ['wss://relay.primal.net', 1],
  ['wss://relay.snort.social', 1],
  ['wss://purplepag.es', 1],
  ['wss://relay.nostr.band', 1],
  ['wss://nostr.mom', 2],
  ['wss://relay.noswhere.com', 2],
  ['wss://nostr.bitcoiner.social', 2],
  ['wss://relay.nostrplebs.com', 2],
  ['wss://nostr.oxtr.dev', 2],
  ['wss://relay.nostr.bg', 2],
  ['wss://offchain.pub', 2],
  ['wss://relay.mostr.pub', 3],
  ['wss://relay.poster.place', 3],
]);
const tierOf = (url) => REACH.get(url) ?? 2;

// Widely-used open relays worth considering as write targets. Probed, never assumed —
// the point of this tool is that any of these can be down on any given day.
const CANDIDATES = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://nostr.mom',
  'wss://relay.primal.net',
  'wss://relay.snort.social',
  'wss://purplepag.es',
  'wss://nostr21.com',
  'wss://relay.nostr.band',
  'wss://relay.noswhere.com',
  'wss://offchain.pub',
  'wss://relay.mostr.pub',
  'wss://nostr.bitcoiner.social',
  'wss://relay.nostr.bg',
  'wss://nostr.oxtr.dev',
  'wss://relay.nostrplebs.com',
];

// ---------- bech32 (npub decode only; no deps) ----------
const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
function bech32Decode(str) {
  const pos = str.lastIndexOf('1');
  if (pos < 1) throw new Error('not bech32');
  const data = [];
  for (const ch of str.slice(pos + 1).toLowerCase()) {
    const v = CHARSET.indexOf(ch);
    if (v === -1) throw new Error('bad bech32 char');
    data.push(v);
  }
  // drop the 6-symbol checksum, convert 5-bit groups to bytes
  let acc = 0, bits = 0;
  const out = [];
  for (const v of data.slice(0, -6)) {
    acc = (acc << 5) | v;
    bits += 5;
    while (bits >= 8) { bits -= 8; out.push((acc >> bits) & 0xff); }
  }
  return Buffer.from(out).toString('hex');
}
function toHexPubkey(input) {
  const s = String(input || '').trim();
  if (/^[0-9a-f]{64}$/i.test(s)) return s.toLowerCase();
  if (/^npub1/i.test(s)) return bech32Decode(s);
  throw new Error(`Not an npub or 64-char hex pubkey: ${s}`);
}

// ---------- relay primitives ----------
function httpFromWss(url) {
  return url.replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://').replace(/\/+$/, '');
}

// NIP-11 relay information document. Tells us payment/auth/write gating BEFORE we
// misread a subscriber-only relay as simply healthy.
async function nip11(url) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), NIP11_TIMEOUT);
  try {
    const res = await fetch(httpFromWss(url), {
      headers: { Accept: 'application/nostr+json' },
      signal: ctl.signal,
    });
    const body = await res.text();
    if (!res.ok) return { ok: false, status: res.status, note: body.slice(0, 120).trim() };
    try {
      const j = JSON.parse(body);
      const lim = j.limitation || {};
      return {
        ok: true,
        status: res.status,
        name: j.name || '',
        paymentRequired: lim.payment_required === true,
        authRequired: lim.auth_required === true,
        restrictedWrites: lim.restricted_writes === true,
      };
    } catch (_) {
      return { ok: false, status: res.status, note: body.slice(0, 120).trim() };
    }
  } catch (e) {
    return { ok: false, status: 0, note: e.name === 'AbortError' ? 'timeout' : String(e.message || e) };
  } finally {
    clearTimeout(t);
  }
}

// Open a socket, ask for one event, and time how long until EOSE. Proves the relay
// both accepts a connection and actually serves queries — a relay can complete the
// handshake and then never answer, which reads as "up" to a naive connect check.
function probe(url, authorHex) {
  return new Promise((resolve) => {
    const started = Date.now();
    let ws, settled = false, sawEvent = false, opened = 0;
    const done = (r) => {
      if (settled) return;
      settled = true;
      clearTimeout(connTimer);
      clearTimeout(readTimer);
      try { if (ws) ws.close(); } catch (_) {}
      resolve(r);
    };
    const connTimer = setTimeout(() => done({ up: false, reason: 'connect timeout' }), CONNECT_TIMEOUT);
    let readTimer;
    try {
      ws = new WebSocket(url);
    } catch (e) {
      return done({ up: false, reason: `bad url (${e.message || e})` });
    }
    ws.onopen = () => {
      opened = Date.now();
      clearTimeout(connTimer);
      readTimer = setTimeout(
        () => done({ up: true, served: false, connectMs: opened - started, reason: 'no EOSE' }),
        READ_TIMEOUT
      );
      const filter = authorHex ? { kinds: [1], authors: [authorHex], limit: 1 } : { kinds: [1], limit: 1 };
      try { ws.send(JSON.stringify(['REQ', 'rd', filter])); } catch (_) {}
    };
    ws.onmessage = (m) => {
      let msg;
      try { msg = JSON.parse(String(m.data)); } catch (_) { return; }
      if (msg[0] === 'EVENT') sawEvent = true;
      // Some relays demand NIP-42 AUTH before serving; that's a write blocker too.
      if (msg[0] === 'AUTH') {
        return done({ up: true, served: false, authChallenge: true, connectMs: opened - started, reason: 'demands AUTH' });
      }
      if (msg[0] === 'CLOSED') {
        return done({ up: true, served: false, connectMs: opened - started, reason: `CLOSED: ${msg[2] || ''}`.trim() });
      }
      if (msg[0] === 'EOSE') {
        return done({ up: true, served: true, hasAuthorData: sawEvent, connectMs: opened - started, readMs: Date.now() - opened });
      }
    };
    ws.onerror = () => done({ up: false, reason: `handshake refused (${httpFromWss(url)} may 403 or be offline)` });
    ws.onclose = () => done({ up: false, reason: 'closed before serving' });
  });
}

async function mapLimited(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx], idx);
      }
    })
  );
  return out;
}

// Fetch the newest kind:10002 across the bootstrap set (newest created_at wins).
function fetchRelayList(authorHex) {
  return new Promise((resolve) => {
    let best = null, pending = BOOTSTRAP.length;
    const finish = () => resolve(best);
    const overall = setTimeout(finish, READ_TIMEOUT + 2000);
    for (const url of BOOTSTRAP) {
      let ws, closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        try { if (ws) ws.close(); } catch (_) {}
        if (--pending === 0) { clearTimeout(overall); finish(); }
      };
      const t = setTimeout(close, READ_TIMEOUT);
      try { ws = new WebSocket(url); } catch (_) { clearTimeout(t); close(); continue; }
      ws.onopen = () => {
        try { ws.send(JSON.stringify(['REQ', 'rl', { kinds: [10002], authors: [authorHex], limit: 1 }])); } catch (_) {}
      };
      ws.onmessage = (m) => {
        let msg;
        try { msg = JSON.parse(String(m.data)); } catch (_) { return; }
        if (msg[0] === 'EVENT' && msg[2]) {
          const ev = msg[2];
          if (!best || ev.created_at > best.created_at) best = ev;
        } else if (msg[0] === 'EOSE') { clearTimeout(t); close(); }
      };
      ws.onerror = () => { clearTimeout(t); close(); };
      ws.onclose = () => { clearTimeout(t); close(); };
    }
  });
}

function parseRelayTags(ev) {
  const out = [];
  for (const t of (ev && ev.tags) || []) {
    if (t[0] !== 'r' || !t[1]) continue;
    const marker = (t[2] || '').toLowerCase();
    out.push({
      url: t[1].replace(/\/+$/, ''),
      read: marker === '' || marker === 'read',
      write: marker === '' || marker === 'write',
    });
  }
  return out;
}

// A relay is a viable WRITE target only if it serves queries AND doesn't gate writes.
// Paid / restricted-write / AUTH-demanding relays may still work for the subscriber,
// so they're flagged rather than condemned — the tool can't verify a subscription.
function classify(p, n11) {
  if (!p.up) return { verdict: 'down', writeSafe: false, why: p.reason };
  if (p.authChallenge) return { verdict: 'auth-gated', writeSafe: false, why: 'demands NIP-42 AUTH' };
  if (!p.served) return { verdict: 'not-serving', writeSafe: false, why: p.reason || 'connected but never answered' };
  const gates = [];
  if (n11.ok) {
    if (n11.paymentRequired) gates.push('payment required');
    if (n11.restrictedWrites) gates.push('restricted writes');
    if (n11.authRequired) gates.push('auth required');
  }
  if (gates.length) return { verdict: 'gated', writeSafe: false, why: gates.join(', ') };
  return { verdict: 'healthy', writeSafe: true, why: '' };
}

async function audit(urls, authorHex) {
  return mapLimited(urls, CONCURRENCY, async (url) => {
    const [p, n11] = await Promise.all([probe(url, authorHex), nip11(url)]);
    return { url, probe: p, nip11: n11, ...classify(p, n11) };
  });
}

const ICON = { healthy: '✓', gated: '$', 'auth-gated': 'A', 'not-serving': '~', down: '✗' };
function line(r) {
  const ms = r.probe.up && r.probe.served ? `${r.probe.connectMs}ms/${r.probe.readMs}ms` : '—';
  const extra = r.why ? `  ${r.why}` : '';
  const name = r.nip11.ok && r.nip11.name ? `  (${r.nip11.name})` : '';
  return `  ${ICON[r.verdict] || '?'} ${r.url.padEnd(34)} ${String(r.verdict).padEnd(12)} ${ms.padEnd(14)}${extra}${name}`;
}

// NIP-65: "Clients SHOULD guide users to keep kind:10002 lists small (2-4 relays of
// each category)." Read relays matter most here — every client publishing a note that
// tags you is told to send it to ALL of them, so an oversized read list taxes everyone
// who mentions you and gives you more places to poll for the same mentions.
function sizeAdvice(writeCount, readCount) {
  const out = [];
  const judge = (n, kind, why) => {
    if (n < 2) out.push(`  ⚠ ${n} ${kind} relay${n === 1 ? '' : 's'} — below NIP-65's 2-4. ${why}`);
    else if (n > 4) out.push(`  ⚠ ${n} ${kind} relays — above NIP-65's 2-4. ${why}`);
    else out.push(`  ✓ ${n} ${kind} relays — within NIP-65's 2-4.`);
  };
  judge(writeCount, 'write', 'One bad day and posts silently fail.');
  judge(readCount, 'read', 'Every client that mentions you fans out to all of them.');
  return out.join('\n');
}

// --check "wss://a,wss://b=write,wss://c=read" — audit a set you're considering,
// instead of the one currently published. No marker means read+write.
function parseCheckSpec(spec) {
  return String(spec)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const m = /^(.*?)(?:=(read|write))?$/i.exec(s);
      const url = m[1].replace(/\/+$/, '');
      const marker = (m[2] || '').toLowerCase();
      return { url, read: marker === '' || marker === 'read', write: marker === '' || marker === 'write' };
    });
}

async function main() {
  const args = process.argv.slice(2);
  const wantCandidates = args.includes('--candidates');
  const asJson = args.includes('--json');
  const checkIdx = args.indexOf('--check');
  const checkSpec = checkIdx !== -1 ? args[checkIdx + 1] : null;
  // Skip --check's value when looking for the pubkey, or it gets taken as the npub.
  // The checkIdx !== -1 guard matters: without --check, checkIdx is -1, so `checkIdx + 1`
  // is 0 — which is exactly where a bare pubkey sits. The tool then found no pubkey at
  // all and printed usage unless a flag happened to come first.
  const who = args.find((a, i) => !a.startsWith('--') && !(checkIdx !== -1 && i === checkIdx + 1));
  if (!who && !checkSpec) {
    console.error('Usage: node scripts/relay-doctor.mjs <npub-or-hex> [--candidates] [--json]');
    console.error('       node scripts/relay-doctor.mjs --check "wss://a,wss://b=write,wss://c=read" [<npub>]');
    process.exit(1);
  }
  const hex = who ? toHexPubkey(who) : null;

  if (!asJson) console.log(`\nrelay-doctor — ${checkSpec ? 'proposed set' : who}\n`);

  let ev = null;
  let declared;
  if (checkSpec) {
    declared = parseCheckSpec(checkSpec);
  } else {
    ev = await fetchRelayList(hex);
    if (!ev) {
      console.error('Could not find a kind:10002 relay list for that pubkey on the bootstrap relays.');
      process.exit(2);
    }
    declared = parseRelayTags(ev);
  }
  const declaredUrls = declared.map((d) => d.url);
  const results = await audit(declaredUrls, hex);
  const byUrl = new Map(results.map((r) => [r.url, r]));

  const writeDeclared = declared.filter((d) => d.write);
  const readDeclared = declared.filter((d) => d.read);
  const writeHealthy = writeDeclared.filter((d) => byUrl.get(d.url)?.writeSafe);
  const readHealthy = readDeclared.filter((d) => byUrl.get(d.url)?.writeSafe);

  let candidates = [];
  if (wantCandidates) {
    const fresh = CANDIDATES.filter((c) => !declaredUrls.includes(c));
    candidates = (await audit(fresh, hex)).filter((r) => r.writeSafe);
  }

  if (asJson) {
    console.log(JSON.stringify({
      pubkey: hex,
      listCreatedAt: ev ? ev.created_at : null,
      declared,
      results,
      candidates,
      summary: {
        writeDeclared: writeDeclared.length,
        writeHealthy: writeHealthy.length,
        readDeclared: readDeclared.length,
        readHealthy: readHealthy.length,
      },
    }, null, 2));
    return;
  }

  if (ev) {
    const age = Math.floor((Date.now() / 1000 - ev.created_at) / 86400);
    console.log(`Current list: kind:10002 from ${new Date(ev.created_at * 1000).toISOString().slice(0, 16)}Z (${age}d ago)\n`);
  }
  console.log(`WRITE relays (${writeHealthy.length}/${writeDeclared.length} usable) — these decide whether your posts land:`);
  for (const d of writeDeclared) console.log(line(byUrl.get(d.url)));
  console.log(`\nREAD relays (${readHealthy.length}/${readDeclared.length} usable):`);
  for (const d of readDeclared) console.log(line(byUrl.get(d.url)));

  console.log('\n  ✓ healthy   $ gated (paid/restricted — may work for a subscriber)   A auth-gated   ~ connected but not serving   ✗ down');
  console.log('\n  Probed WITHOUT your key, so a relay you subscribe to can look ✗/A here and still');
  console.log('  work in your signed-in client. That cuts both ways: it is also exactly what a');
  console.log('  lapsed subscription looks like. Verdicts are firm only for OPEN relays.');

  console.log('\nList size (NIP-65 guidance: 2-4 of each category):');
  console.log(sizeAdvice(writeDeclared.length, readDeclared.length));

  // The subtlest failure in a NIP-65 list. A read relay is a MAILBOX: per NIP-65,
  // other people's clients are told to publish notes that tag you to all of your read
  // relays. If a read relay charges, restricts writes, or demands AUTH, those senders
  // are not subscribers and cannot deliver — so mentions addressed to you never arrive.
  // A paid relay is a fine WRITE target (you're the one authenticating) and a poor READ
  // target for exactly the same reason.
  const undeliverable = readDeclared
    .map((d) => byUrl.get(d.url))
    .filter((r) => r && (r.verdict === 'gated' || r.verdict === 'auth-gated'));
  if (undeliverable.length) {
    console.log(`\n⚠  ${undeliverable.length} of your ${readDeclared.length} READ relays can't accept mail from strangers:`);
    for (const r of undeliverable) console.log(`     ${r.url.padEnd(32)} ${r.why}`);
    console.log('   NIP-65 tells other clients to deliver your mentions to every read relay.');
    console.log("   Those senders aren't subscribers, so mentions routed here are dropped.");
    console.log('   Read relays should be OPEN. Keep paid relays as write-only.');
    console.log('   (Relays you merely browse are a client setting, not a NIP-65 read relay.)');
  }

  if (writeHealthy.length < 3) {
    console.log(`\n⚠  Only ${writeHealthy.length} unGated write relay${writeHealthy.length === 1 ? '' : 's'}. Outbox-model clients publish here` +
      '\n   and nowhere else, so a single bad day means posts silently fail.');
  }

  if (wantCandidates) {
    // Reach tier first, latency only as a tiebreak — see REACH.
    candidates.sort((a, b) => tierOf(a.url) - tierOf(b.url) || a.probe.readMs - b.probe.readMs);
    console.log(`\nHealthy candidates to add (${candidates.length} of ${CANDIDATES.filter((c) => !declaredUrls.includes(c)).length} probed):`);
    for (const r of candidates) console.log(`${line(r)}  [tier ${tierOf(r.url)}]`);

    // Recommend: keep every healthy relay already declared, then top up with the
    // highest-reach healthy candidates until there are 4 write targets.
    const keep = writeDeclared.filter((d) => byUrl.get(d.url)?.writeSafe).map((d) => d.url);
    const add = candidates.map((r) => r.url).slice(0, Math.max(0, 4 - keep.length));
    const recommended = [...keep, ...add];
    const gated = writeDeclared.filter((d) => byUrl.get(d.url)?.verdict === 'gated').map((d) => d.url);

    console.log('\n── Recommended write set ──');
    for (const u of recommended) console.log(`  ${u}`);
    if (gated.length) {
      console.log('\n  Keep these too if your subscription is current (this tool cannot check that):');
      for (const u of gated) console.log(`  ${u}`);
    }

    // Emit tags for the user to sign THEMSELVES. No key ever touches this tool.
    const tags = [
      ...recommended.map((u) => ['r', u]),
      ...readHealthy.filter((d) => !recommended.includes(d.url)).map((d) => ['r', d.url, 'read']),
    ];
    console.log('\n── Publish it yourself (your key never enters this tool) ──');
    console.log('  nak event -k 10002 \\');
    for (const t of tags) console.log(`    -t ${t[0]}="${t.slice(1).join(';')}" \\`);
    console.log(`    --sec <your-key-source> ${recommended.join(' ')}`);
    console.log('\n  Or paste these tags into any NIP-65 editor (Sidecar: Profile → relay list).');
    console.log('  ' + JSON.stringify(tags));
  } else {
    console.log('\nRe-run with --candidates to probe replacements and get a recommended set.');
  }
  console.log('');
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
