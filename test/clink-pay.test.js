'use strict';

// Paying a CLINK offer from the profile sheet.
//
// The exchange is LIFTED AND RUN against fakes, because the ordering inside it is the
// whole correctness argument and no source assertion can see ordering. Kind 21001 is
// ephemeral: relays are not expected to hold the reply, so a subscription opened after
// the request went out would miss a service fast enough to answer immediately, and the
// only symptom would be a timeout that reads as the service being down.
//
// The button and its wiring are checked against the panel's source, which is all that
// layer needs: what matters there is which collaborators it hands in and that a failed
// decode cannot put a payment affordance on a stranger's profile.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const panel = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'sidepanel.html'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
const bare = panel.replace(/^\s*\/\/.*$/gm, '');

function loadClink() {
  const ctx = {
    window: {}, console, TextDecoder, TextEncoder, setTimeout, clearTimeout,
    Date, Promise, JSON, Math, Array, Uint8Array, Error, String,
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'clink.js'), 'utf8'), ctx);
  return ctx.window.SidecarCLINK;
}

const OFFER = {
  pubkey: 'ee6ea13ab9fe5c4a68eaf9b1a34fe014a66b40117c50ee2a614f4cda959b6e74',
  relay: 'wss://relay.shockwallet.app',
  offerId: 'tip-jar',
  pricingType: 'spontaneous',
};
// Where a code-3 reply says the offer went. Built as a real string because the decoder
// is the gate the retry walks through.
const FRESH = {
  pubkey: 'ab'.repeat(32),
  relay: 'wss://relay.example.com',
  offerId: 'fresh-jar',
};
const ME = '1111111111111111111111111111111111111111111111111111111111111111';

// bech32 encode, test-side. clink.js only decodes, so a noffer for the moved-offer reply
// has to be built here: plain bech32, checksum constant 1, the TLVs in the spec's order.
const B32 = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
function bech32Polymod(values) {
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const top = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >> i) & 1) chk ^= GEN[i];
  }
  return chk;
}
function toWords(bytes) {
  const words = [];
  let acc = 0;
  let bits = 0;
  for (const b of bytes) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 5) { bits -= 5; words.push((acc >> bits) & 31); }
  }
  if (bits > 0) words.push((acc << (5 - bits)) & 31);
  return words;
}
const hexToBytes = (h) => new Uint8Array(h.match(/../g).map((b) => parseInt(b, 16)));
const utf8Bytes = (s) => new TextEncoder().encode(s);
function encodeNoffer({ pubkey, relay, offerId }) {
  const bytes = [];
  for (const [type, value] of [[0, hexToBytes(pubkey)], [1, utf8Bytes(relay)], [2, utf8Bytes(offerId)]]) {
    bytes.push(type, value.length, ...value);
  }
  const hrp = 'noffer';
  const data = toWords(Uint8Array.from(bytes));
  const hrpExp = [];
  for (const ch of hrp) hrpExp.push(ch.charCodeAt(0) >> 5);
  hrpExp.push(0);
  for (const ch of hrp) hrpExp.push(ch.charCodeAt(0) & 31);
  const chk = bech32Polymod(hrpExp.concat(data, [0, 0, 0, 0, 0, 0])) ^ 1;
  const cs = [0, 1, 2, 3, 4, 5].map((i) => (chk >> 5 * (5 - i)) & 31);
  return hrp + '1' + data.concat(cs).map((w) => B32[w]).join('');
}
const FRESH_STRING = encodeNoffer(FRESH);

// A service that answers however the test tells it to, recording what it was asked.
function harness(reply, opts) {
  const options = opts || {};
  const log = { published: [], filters: [], relays: [], encrypted: [], closed: 0, order: [] };
  const CLINK = loadClink();
  let deliver = null;
  const api = CLINK.install({
    mePubkey: async () => ME,
    sign: async (t) => Object.assign({ id: 'evt', pubkey: ME, sig: 'x' }, t),
    encrypt: async (peer, plaintext) => { log.encrypted.push({ peer, plaintext }); return 'sealed:' + plaintext; },
    decrypt: async (peer, ciphertext) => String(ciphertext).replace(/^sealed:/, ''),
    subscribe: (relay, filter, onevent) => {
      log.order.push('subscribe');
      log.relays.push(relay);
      log.filters.push(filter);
      deliver = onevent;
      return { close: () => { log.closed++; } };
    },
    publish: async (relay, event) => {
      log.order.push('publish');
      log.published.push({ relay, event });
      if (options.publishThrows) throw new Error('relay refused');
      if (options.replyFor) {
        const ev = options.replyFor(log.published.length);
        if (ev) setTimeout(() => deliver && deliver(ev), 0);
        return;
      }
      if (reply === undefined) return;
      // The service answers on the next turn, the way a real one would.
      // An array delivers several, in order, the way a busy relay would.
      for (const [i, ev] of [].concat(reply).entries()) {
        setTimeout(() => deliver && deliver(ev), i);
      }
    },
  });
  return { api, log, CLINK };
}

test('SUBSCRIBE BEFORE PUBLISH, BECAUSE 21001 IS EPHEMERAL', async () => {
  // A relay is not expected to store an ephemeral event, so a service that answers the
  // instant the request lands answers into nothing if we were not already listening. The
  // failure would look exactly like a wallet that is offline, which is the wrong thing to
  // tell somebody about their own payment.
  const { api, log } = harness({ pubkey: OFFER.pubkey, content: 'sealed:{"bolt11":"lnbc1"}' });
  const res = await api.requestInvoice(OFFER, { amountSats: 21 });
  assert.equal(res.bolt11, 'lnbc1');
  assert.deepEqual(log.order, ['subscribe', 'publish']);
  // And the subscription is torn down once it has its answer.
  assert.equal(log.closed, 1);
});

test('the request goes to the offer’s own relay, not the account’s', async () => {
  // The service is listening on the relay named in the offer's TLV 1 and nowhere else.
  const { api, log } = harness({ pubkey: OFFER.pubkey, content: 'sealed:{"bolt11":"lnbc1"}' });
  await api.requestInvoice(OFFER, { amountSats: 21 });
  assert.deepEqual(log.relays, [OFFER.relay]);
  assert.equal(log.published[0].relay, OFFER.relay);

  // Tagged for the service, versioned, and on the kind the spec names.
  const ev = log.published[0].event;
  assert.equal(ev.kind, 21001);
  // Compared as text: these arrays were built inside the vm realm clink.js runs in, so a
  // strict structural compare fails on prototype identity alone rather than on content.
  assert.equal(JSON.stringify(ev.tags),
    JSON.stringify([['p', OFFER.pubkey], ['clink_version', '1']]));

  // The payload is sealed to the service, and carries the offer id and the amount.
  assert.equal(log.encrypted[0].peer, OFFER.pubkey);
  assert.deepEqual(JSON.parse(log.encrypted[0].plaintext), { offer: 'tip-jar', amount_sats: 21 });

  // We listen for the service's reply addressed to us, from that service only.
  assert.equal(JSON.stringify(log.filters[0].authors), JSON.stringify([OFFER.pubkey]));
  assert.equal(JSON.stringify(log.filters[0]['#p']), JSON.stringify([ME]));
  assert.equal(log.filters[0].kinds[0], 21001);
});

test('AN EVENT FROM ANYONE ELSE IS NOT AN INVOICE', async () => {
  // The filter already says so, but a relay is not obliged to honor a filter and this is
  // the value that decides what gets paid. A stranger's bolt11 accepted here is sats sent
  // to a stranger.
  const { api } = harness({ pubkey: 'ff'.repeat(32), content: 'sealed:{"bolt11":"lnbc-attacker"}' },
    { });
  await assert.rejects(api.requestInvoice(OFFER, { amountSats: 21, timeoutMs: 60 }),
    /did not answer/, 'an event from the wrong author was accepted');
});

test('a typed refusal comes back as a sentence, not a timeout', async () => {
  const { api } = harness({
    pubkey: OFFER.pubkey,
    content: 'sealed:{"error":"Amount below the minimum","code":4,"range":{"min":100}}',
  });
  await assert.rejects(
    api.requestInvoice(OFFER, { amountSats: 1 }),
    (e) => e.message === 'Amount below the minimum' && e.clinkCode === 4 && e.clinkRange.min === 100
  );
});

test('A ZAP REQUEST RIDES IN THE PAYLOAD WHEN THE PAYER HAS ONE', async () => {
  // The bolt opened the panel, so the payment is a zap: the stringified kind 9734 goes
  // to the service, which commits it to the invoice and settles it with a 9735 receipt
  // on Nostr. Without it the spec says the request is treated as a spontaneous payment —
  // sats arrive and nothing is ever published.
  const zap = JSON.stringify({ kind: 9734, tags: [['p', 'a'.repeat(64)], ['relays', 'wss://r.example.com']] });
  const { api, log } = harness({ pubkey: OFFER.pubkey, content: 'sealed:{"bolt11":"lnbc1"}' });
  await api.requestInvoice(OFFER, { amountSats: 21, zap, payerData: { pubkey: ME } });
  assert.equal(log.encrypted[0].peer, OFFER.pubkey);
  assert.deepEqual(JSON.parse(log.encrypted[0].plaintext),
    { offer: 'tip-jar', amount_sats: 21, zap, payer_data: { pubkey: ME } });

  // And an ordinary ask stays ordinary: no zap, no payer block, no empty fields.
  const { api: plain, log: plainLog } = harness({ pubkey: OFFER.pubkey, content: 'sealed:{"bolt11":"lnbc1"}' });
  await plain.requestInvoice(OFFER, { amountSats: 21 });
  assert.deepEqual(JSON.parse(plainLog.encrypted[0].plaintext), { offer: 'tip-jar', amount_sats: 21 });
});

test('CODE 3 WITH A SUCCESSOR RETRIES ONCE AGAINST THE FRESH OFFER', async () => {
  // An expired or moved offer may carry `latest` — a fresh noffer string. Follow it once,
  // in memory: the stranger's profile is theirs, and nothing rewrites what it carries.
  const moved = { pubkey: OFFER.pubkey, content: 'sealed:{"error":"Offer has been replaced or moved.","code":3,"latest":"' + FRESH_STRING + '"}' };
  const paid = { pubkey: FRESH.pubkey, content: 'sealed:{"bolt11":"lnbc-fresh"}' };
  const { api, log } = harness(undefined, { replyFor: (n) => (n === 1 ? moved : paid) });
  const res = await api.requestInvoice(OFFER, { amountSats: 21, timeoutMs: 500 });
  assert.equal(res.bolt11, 'lnbc-fresh');
  // The follow is the fresh offer's own exchange: its relay, its id, addressed to its
  // service, under a fresh signature — the first request is not replayed.
  assert.deepEqual(log.relays, [OFFER.relay, FRESH.relay]);
  assert.deepEqual(JSON.parse(log.encrypted[1].plaintext), { offer: 'fresh-jar', amount_sats: 21 });
  assert.equal(JSON.stringify(log.published[1].event.tags),
    JSON.stringify([['p', FRESH.pubkey], ['clink_version', '1']]));
  // Each attempt holds its own subscription, and neither outlives its answer.
  assert.equal(log.closed, 2);
});

test('CODE 3 WITHOUT A SUCCESSOR IS A DEAD END, NOT A RETRY', async () => {
  // Without `latest` the spec says the offer is permanently expired. There is nowhere to
  // go, so asking twice would only wait out a second timeout to land on the same answer.
  const expired = { pubkey: OFFER.pubkey, content: 'sealed:{"error":"Offer has expired.","code":3}' };
  const { api, log } = harness(expired);
  await assert.rejects(api.requestInvoice(OFFER, { amountSats: 21 }),
    (e) => e.clinkCode === 3 && /expired/.test(e.message));
  assert.equal(log.published.length, 1);
});

test('A SUCCESSOR THAT DOES NOT DECODE IS THE EXPIRY IT RODE IN ON', async () => {
  // `latest` comes from the answering service and is a string somebody else chose. It
  // gets decoded like any other noffer or not followed at all.
  const junk = { pubkey: OFFER.pubkey, content: 'sealed:{"error":"Moved.","code":3,"latest":"noffer1notreal"}' };
  const { api, log } = harness(junk);
  await assert.rejects(api.requestInvoice(OFFER, { amountSats: 21 }), (e) => e.clinkCode === 3);
  assert.equal(log.published.length, 1);
});

test('THE FOLLOW HAPPENS ONCE: A CHAIN OF SUCCESSORS IS NOT A PATH TO WALK', async () => {
  // Every answer in the chain names another successor. Two asks is the whole budget:
  // a service that keeps saying "moved" does not get to keep the payer walking.
  const movedFrom = (from) => ({
    pubkey: from,
    content: 'sealed:{"error":"Moved.","code":3,"latest":"' + FRESH_STRING + '"}',
  });
  const { api, log } = harness(undefined, {
    replyFor: (n) => (n === 1 ? movedFrom(OFFER.pubkey) : movedFrom(FRESH.pubkey)),
  });
  await assert.rejects(api.requestInvoice(OFFER, { amountSats: 21, timeoutMs: 500 }),
    (e) => e.clinkCode === 3);
  assert.equal(log.published.length, 2);
});

test('a service that never answers gives up, and says which end was quiet', async () => {
  const { api, log } = harness(undefined);
  await assert.rejects(api.requestInvoice(OFFER, { amountSats: 21, timeoutMs: 40 }),
    /did not answer/);
  assert.equal(log.closed, 1, 'the subscription outlived the attempt');
});

test('a relay that will not take the request fails now rather than in thirty seconds', async () => {
  const { api } = harness(undefined, { publishThrows: true });
  await assert.rejects(api.requestInvoice(OFFER, { amountSats: 21, timeoutMs: 5000 }),
    /relay refused/);
});

test('UNREADABLE EVENTS ARE STEPPED OVER, NOT FATAL', async () => {
  // A relay can carry other traffic on this kind. Anything that does not decrypt or parse
  // is somebody else's business, and giving up on the first one would turn a stray event
  // into a failed payment. So: garbage, then the real invoice, and the invoice still wins.
  const junk = { pubkey: OFFER.pubkey, content: 'sealed:not json at all' };
  const real = { pubkey: OFFER.pubkey, content: 'sealed:{"bolt11":"lnbc-real"}' };
  const { api } = harness([junk, real]);
  const res = await api.requestInvoice(OFFER, { amountSats: 21, timeoutMs: 400 });
  assert.equal(res.bolt11, 'lnbc-real');
});

test('BUT NOTHING READABLE AT ALL IS A DIFFERENT SENTENCE FROM NOTHING AT ALL', async () => {
  // Both used to time out with "its wallet may be offline", which sends somebody to ask
  // the payee about a wallet that is answering fine. The two cases point at opposite
  // ends: silence is theirs, gibberish is ours. Telling them apart is what a swallowed
  // catch costs, and this exchange has already paid it once.
  const junk = { pubkey: OFFER.pubkey, content: 'sealed:not json at all' };
  const { api } = harness([junk]);
  await assert.rejects(api.requestInvoice(OFFER, { amountSats: 21, timeoutMs: 60 }),
    /could not be read/, 'an unreadable reply still reports the wallet as offline');

  // And silence keeps the sentence that fits it.
  const { api: quiet } = harness(undefined);
  await assert.rejects(quiet.requestInvoice(OFFER, { amountSats: 21, timeoutMs: 40 }),
    /may be offline/);
});

// ---- the panel side --------------------------------------------------------------

test('THE PANEL LENDS ITS OWN SIGNER AND POOL, AND CLINK HOLDS NEITHER', () => {
  // clink.js opens no socket and holds no key: the panel hands in signing, NIP-44 and the
  // pool it already owns, the same shape composer-core uses. A protocol client that
  // reached for either would be a second route to the keystore.
  const clinkSrc = fs.readFileSync(path.join(ROOT, 'clink.js'), 'utf8');
  assert.ok(!/chrome\./.test(clinkSrc), 'clink.js talks to the worker directly');
  assert.ok(!/SimplePool|WebSocket/.test(clinkSrc), 'clink.js opens its own sockets');
  assert.ok(!/nsec|getPrivkey/.test(clinkSrc));

  assert.match(bare, /window\.SidecarCLINK\.install\(\{/);
  assert.match(bare, /type: 'SIDECAR_OWNER_ENCRYPT', nip: 44, peer, plaintext/);
  assert.match(bare, /type: 'SIDECAR_OWNER_DECRYPT', nip: 44, peer, ciphertext/);
  assert.match(bare, /type: 'SIDECAR_OWNER_SIGN', event: template, expectedPubkey: state\.activePubkey/);
  // Both halves name the offer's relay explicitly rather than using the account's.
  assert.match(bare, /subscribe: \(relay, filter, onevent\) => poolSubscribeMany\(\[relay\], filter, \{ onevent \}\)/);
  assert.match(bare, /poolPublish\(\[relay\], event\)/);
  // AND THE FILTER IS NOT PRE-WRAPPED. This assertion used to pin the bug rather than
  // catch it: it matched `[filter]`, which is what shipped, and what made every offer
  // report itself offline. Stated as a refusal so the shape cannot come back.
  assert.doesNotMatch(bare, /poolSubscribeMany\(\[relay\], \[filter\]/,
    'the filter is wrapped in an array again, which sends a REQ no relay will match');

  // Loaded before the panel that installs it, or that install throws on the way up and
  // takes the whole side panel with it.
  const at = html.indexOf('clink.js');
  assert.ok(at > -1, 'sidepanel.html does not load clink.js');
  assert.ok(at < html.indexOf('sidepanel.js"'), 'clink.js has to come first');
});

test('A BROKEN OFFER IS NO OFFER, NOT AN ERROR ON SOMEBODY ELSE’S PROFILE', () => {
  // This is a stranger's kind 0. There is nothing the reader can do about a malformed
  // offer on it, so a notice would be noise about someone else's mistake, and a button
  // that cannot work is worse than no button.
  const fn = bare.slice(bare.indexOf('function profileOffer(content)'));
  const body = fn.slice(0, fn.indexOf('\n  }'));
  assert.match(body, /catch \(_\) \{ return null; \}/);
  assert.match(body, /if \(!window\.SidecarCLINK\.isNofferString\(raw\)\) return null;/);
  // Tolerant about the key, like the editor that writes one: noffer is what Sidecar and
  // bxrd.app write, and offer and clink_offer are both in the wild.
  assert.match(body, /content\.noffer \|\| content\.offer \|\| content\.clink_offer/);

  // And the button only exists when an offer decoded.
  assert.match(bare, /if \(offerShown \|\| !offer \|\| !modal\.isConnected\) return;/);
  assert.match(bare, /revealOffer\(profileOffer\(c\)\)/);
});

test('the wallet is checked before a stranger is asked for an invoice', () => {
  // No point asking somebody's service to mint an invoice we would then have nothing to
  // pay it with, and the ask is a signed event published to their relay either way.
  const fn = bare.slice(bare.indexOf("offerPay.addEventListener('click'"));
  const body = fn.slice(0, fn.indexOf('\n      });'));
  assert.ok(body.indexOf('ensureNwc()') < body.indexOf('clink.requestInvoice'),
    'the invoice is requested before the wallet is known to exist');
  assert.ok(body.indexOf('clink.requestInvoice') < body.indexOf('client.payInvoice'));
  // Two labels, because asking and paying fail differently and one spinner for both
  // cannot tell a wallet that is offline from a relay that is.
  assert.match(body, /offerPay\.textContent = 'Asking…'/);
  assert.match(body, /offerPay\.textContent = 'Paying…'/);
});

test('paying an offer is a zap: the signed 9734 rides in the request', () => {
  // The bolt opened this panel, so the payment carries the same signed kind 9734 the
  // lightning-address path sends. Without it the offer payment is spontaneous only:
  // sats land and no receipt is ever published, so no client shows a zap.
  const fn = bare.slice(bare.indexOf("offerPay.addEventListener('click'"));
  const body = fn.slice(0, fn.indexOf('\n      });'));
  assert.ok(body.indexOf('makeZapRequest') < body.indexOf('clink.requestInvoice'),
    'the zap request is built before the invoice is asked for');
  assert.match(body, /type: 'SIDECAR_OWNER_SIGN', event: zapTemplate, expectedPubkey: state\.activePubkey/,
    'the 9734 is signed through the guarded owner path');
  assert.match(body, /zap: JSON\.stringify\(signed\)/);
  assert.match(body, /payerData: \{ pubkey: state\.activePubkey \}/);
  // The receipt goes where the service can publish it: the offer's own relay first,
  // then the recipient's, theirs and not ours — the same rule as the address path.
  assert.match(body, /\[offerData\.relay\]\.concat\(await readRelayUrls\(pubkey\)\)/);
});

test('the offer handoff carries the comment disclosure the zap handoff has', () => {
  // On a comment sheet the QR hands a stranger's wallet the raw offer: it pays the
  // author, and only this panel's own payment is a zap on the comment. Same sentence,
  // same place, because it is the same nuance.
  assert.match(bare, /if \(options\?\.chatEvent\) offerFormHandoff\.append\(h\('p', \{ className: 'hint zap-pay-note', textContent: t\('Scan or copy sends a payment to the author, not a zap on this comment\.'\) \}\)\)/);
  const open = bare.slice(bare.indexOf('async function openOfferPanel(offer)'));
  const body = open.slice(0, open.indexOf('\n      }'));
  assert.match(body, /options\?\.chatEvent \? \{ note: t\('Scan or copy sends a payment to the author, not a zap on this comment\.'\) \} : undefined/);
});

test('a fixed offer is not asked for an amount it already knows', () => {
  const fn = bare.slice(bare.indexOf('function openOfferPanel(offer)'));
  const body = fn.slice(0, fn.indexOf('\n      }'));
  assert.match(body, /window\.SidecarCLINK\.amountRequired\(offer\)/);
  assert.match(body, /offerPresets\.classList\.toggle\('hidden', !needsAmount\)/);
  assert.match(body, /offerAmount\.classList\.toggle\('hidden', !needsAmount\)/);
  // And the button says the number, so the confirm is a confirm rather than a leap.
  assert.match(body, /'Pay ' \+ fmtSats\(offer\.price\) \+ ' sats'/);
});

test('THE PANEL SAYS NOTHING IT DOES NOT HAVE TO', () => {
  // This used to carry a line explaining that asking an offer publishes an event signed
  // by your key to a relay the payee chose, on the grounds that it is a different
  // exposure from a zap over HTTPS. It sat under the Pay button, wrapped to two lines
  // because a relay URL is long, and it told somebody about to pay 21 sats a thing they
  // could do nothing with. Removed deliberately, so pinned as absent rather than left to
  // creep back in the next time the sheet is edited.
  assert.doesNotMatch(bare, /Asks their wallet over/, 'the relay note is back under the Pay button');
  assert.doesNotMatch(bare, /offerNote/, 'the note element outlived its text');
});

test('the offer sits inside the payment area the bolt opens, neither the other’s fallback', () => {
  // A lightning address is a server answering for them; an offer is their own wallet
  // answering for itself. Plenty of profiles carry exactly one of the two, so the row
  // holds whichever apply and gives them equal width.
  assert.match(css, /\.peek-pay-row \{ display: flex; flex-wrap: wrap; gap: 8px; \}/);
  assert.match(css, /\.peek-pay-row > \.peek-zap-open \{ flex: 1 1 0; \}/);
  // NO min-width. A flex item's default `min-width: auto` is already its own content, so
  // these refuse to squash their labels and wrap only when two truly will not fit. A
  // hand-picked 132px came to 272px for the pair, which is wider than the row in a panel
  // dragged narrow: they stacked at widths where they would have fitted side by side.
  const row = css.slice(css.indexOf('.peek-pay-row > .peek-zap-open'), css.indexOf('.peek-zap-open {'));
  assert.ok(!/min-width/.test(row), 'a hand-picked floor wraps the row before the labels need it');
  // The Zap button is an icon in the row under the name now, so the row holds only Pay
  // offer, inside the payment area, and only when there is a zap panel for it to sit
  // beside. A profile with an offer and no address is opened by the bolt itself.
  assert.match(bare, /payRow\.append\(offerBtn\)/);
  assert.doesNotMatch(bare, /payRow\.prepend\(zapBtn\)/, 'the Zap button went back into the pay row');
  assert.match(bare, /payRow\.classList\.toggle\('hidden', !\(\(zapPanel \|\| zapSheet\) && offerShown\)\);/);
  assert.match(bare, /if \(!zapPanel\) \{\s*if \(offerFound\) openOfferPanel\(offerFound\);\s*return;/);
});

test('ONE PAYMENT PANEL AT A TIME, AND NEITHER BUTTON DOES THE OTHER’S JOB', () => {
  // zapPanel is the Zap button's own reference to whichever panel that button opens.
  // Pointing it at the offer made Zap toggle the offer instead of the zap, and two panels
  // open at once is two amount fields and two Pay buttons on a 358px sheet with no way to
  // tell which one a number was typed into.
  const open = bare.slice(bare.indexOf('function openOfferPanel(offer)'));
  const body = open.slice(0, open.indexOf('\n      }'));
  assert.ok(!/zapPanel = offerPanel/.test(body), 'the offer hijacked the zap button');
  assert.match(body, /if \(zapPanel\) zapPanel\.classList\.add\('hidden'\);/);
  // Toggled rather than forced open: pressing Pay offer twice shuts it again, the same way
  // pressing Zap twice does, and a button that only ever opens is a button that lies about
  // being a toggle.
  assert.match(body, /offerPanel\.classList\.toggle\('hidden', offerPanel\.isConnected && !offerPanel\.classList\.contains\('hidden'\)\);/);

  const zapClick = bare.slice(bare.indexOf("zapBtn.addEventListener('click'"));
  assert.match(zapClick.slice(0, 400), /offerPanel\.classList\.add\('hidden'\);/);
});

test('NO WALLET IS NOT NO WAY TO PAY', () => {
  // The lesson the zap branch beside it already learned: picking an amount and pressing
  // Pay only to be told at the end that there is no wallet is a dead end, and the offer
  // had exactly that shape until now. Same block, same QR, same copy button.
  const open = bare.slice(bare.indexOf('async function openOfferPanel(offer)'));
  const body = open.slice(0, open.indexOf('\n      }'));
  // Widened to `|| isSelf`: your own profile takes this same branch whatever your wallet
  // says, because the row exists there to hand somebody the QR rather than to pay
  // yourself. The property under test is unchanged, which is that no-wallet reaches the
  // handoff rather than a dead end.
  assert.match(body, /if \(!zapHasWallet \|\| isSelf\) \{/);
  assert.match(body, /offerHandoff = offerPayBlock\(offer, isSelf/);
  // Asked at click rather than gated at reveal, because the offer button appears off the
  // profile paint and the wallet answer lands on its own schedule.
  assert.match(body, /if \(zapHasWallet === null\) \{/);
  assert.match(body, /catch \(_\) \{ zapHasWallet = false; \}/, 'an unreachable wallet must read as none');

  // One block for both errands rather than a second one written from scratch.
  assert.match(bare, /function offerPayBlock\(offer, extra\)/);
  assert.match(bare, /return zapPayBlock\(raw, Object\.assign\(\{/);
  // The offer goes into the same lightning: URI that ShockWallet and Zeus read, and the
  // whole string is copied even though the label is ellipsized.
  assert.match(bare, /window\.SidecarCLINK\.stripNostrPrefix\(offer\.raw \|\| ''\)/);
  assert.match(bare, /raw\.slice\(0, 18\) \+ '…' \+ raw\.slice\(-6\)/);
  assert.match(bare, /qrSize: 240/, 'a longer payload packs more modules into the same square');
  // profileOffer carries the raw string for exactly this: a wallet that is not this one
  // wants the offer as its owner wrote it.
  assert.match(bare, /Object\.assign\(window\.SidecarCLINK\.decodeNoffer\(raw\), \{ raw \}\)/);
});

test('A CONNECTED WALLET DOES NOT MEAN PAYING FROM THIS MACHINE', () => {
  // The phone in your pocket is often the wallet. Before this the QR existed only for
  // people who had connected nothing, which made the better route the one you got for
  // being worse off.
  assert.match(bare, /const zapQrBtn = h\('button', \{ className: 'mini ghost peek-qr-toggle'/);
  assert.match(bare, /const offerQrBtn = h\('button', \{ className: 'mini ghost peek-qr-toggle'/);
  assert.match(bare, /zapHandoff = zapPayBlock\(zapAddr, \{ hideConnect: true \}\)/);
  assert.match(bare, /offerFormHandoff = offerPayBlock\(offerData, \{ hideConnect: true \}\)/);
  // hideConnect, because there IS a wallet here and a line offering to connect one would
  // be answering a question nobody asked.
  assert.match(bare, /\.\.\.\(options\.hideConnect \? \[\] : \[connect\]\)/);

  // Icon only: the row already carries a value, and a control sharing a row with content
  // carries no words. Both forms put it beside the amount, not under it.
  assert.match(bare, /\[amount, zapQrBtn, send\]/);
  assert.match(bare, /\[offerAmount, offerQrBtn, offerPay\]/);
  assert.ok(!/peek-qr-toggle'[^)]*textContent/.test(bare), 'the toggle grew a label');
  assert.match(css, /\.peek-qr-toggle \{ flex-shrink: 0;/);

  // Built the first time it is wanted, not on every sheet: it draws a QR.
  assert.match(bare, /if \(!zapHandoff\) \{/);
  assert.match(bare, /if \(!offerFormHandoff\) \{/);
});

test('THE BUTTON SAYS WHICH PANEL IS OPEN', () => {
  // Both buttons are identical and both toggle a panel, so without this the only thing
  // saying which one you pressed is the panel itself, which is off the top of a scrolled
  // sheet the moment it has a QR in it.
  const fn = bare.slice(bare.indexOf('function paintPayState()'));
  const body = fn.slice(0, fn.indexOf('\n      }'));
  // Read off the DOM, not a flag: three things open and close these panels, and a flag
  // would be a fourth to keep in step with them.
  assert.match(body, /const lit = \(el\) => !!el && el\.isConnected && !el\.classList\.contains\('hidden'\);/);
  assert.match(body, /const offerOn = lit\(offerPanel\) \|\| lit\(offerHandoff\);/);
  // With no zap panel the bolt is what opens the offer, so it carries that state.
  assert.match(body, /const boltOn = zapOn \|\| \(!zapPanel && offerOn\);/);
  assert.match(body, /zapBtn\.classList\.toggle\('peek-pay-on', boltOn\)/);
  assert.match(body, /offerBtn\.classList\.toggle\('peek-pay-on', offerOn\)/);
  // A disclosure, so it says so to anything not looking at the color.
  assert.match(body, /aria-expanded/);

  // Every route that opens or closes one repaints. Miss one and the tint outlives the
  // panel it was describing, which is worse than never having had it.
  assert.equal((bare.match(/paintPayState\(\);/g) || []).length, 5);

  // Color and a wash, no metrics. A border weight or a size change here would move the
  // row every time somebody opened one, directly above a form people type into.
  const rule = css.slice(css.indexOf('.peek-pay-row > .peek-pay-on {'), css.indexOf('.peek-pay-row > .peek-pay-on svg'));
  assert.match(rule, /color: var\(--lav\)/);
  assert.ok(!/padding|font-size|font-weight|border-width/.test(rule), 'the row would move when a panel opens');

  // ONE HUE, AND IT IS THE THEME'S. Border and wash both come off currentColor, so the
  // lit state is --lav brightened rather than --lav wearing a second palette's edge.
  // Naming --gold-soft and --accent-rgb here is what put a yellow border on Speakeasy's
  // purple button: four themes repoint one of that pair and not the other.
  assert.match(rule, /border-color: color-mix\(in srgb, currentColor \d+%, transparent\)/);
  assert.match(rule, /background: color-mix\(in srgb, currentColor \d+%, transparent\)/);
  assert.ok(!/--gold|--accent-rgb/.test(rule), 'the lit state names a palette the label does not use');
});

test('it ships', () => {
  // scripts/package.sh stages from the tree, so a new top-level file is included as soon
  // as it is committed. What is worth pinning is that nothing excludes it.
  const ignore = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
  assert.ok(!/^clink\.js$/m.test(ignore), 'clink.js is gitignored and would never ship');
});
