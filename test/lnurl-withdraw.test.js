'use strict';

// CASHING AN LNURL-WITHDRAW LINK THROUGH THE CONNECTED WALLET.
//
// NIP-47 has no withdraw command, so Sidecar does what a withdrawing wallet does: reads the
// link, asks the wallet for an invoice in the service's range, hands it to the service's
// callback and waits to see it land. These run the real module against a fake wallet and a
// fake service, then drive the real Receive sheet end to end. What has to hold:
//   - the link is read right (the LUD-01 vector) and only ever leads somewhere public and https;
//   - k1 goes back exactly as received, and the amount is named before anything is sent;
//   - an invoice that went to a service is never replaced until lookup_invoice says it was
//     not paid, because the service that answered OK may be paying it right now.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { withI18n } = require('./helpers/i18n.js');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

function loadModule() {
  const ctx = { URL, URLSearchParams, TextDecoder, AbortSignal, Promise, Math, Number, String, JSON, Array, Object, Error, Set, Uint8Array, setTimeout, clearTimeout, Date };
  ctx.self = ctx;
  vm.createContext(ctx);
  vm.runInContext(read('private-host.js'), ctx);
  vm.runInContext(read('lnurl-withdraw.js'), ctx);
  return ctx;
}
const W = loadModule().SidecarLnurlWithdraw;

// ---- a bech32 encoder, only to make links to test with ------------------------------------

const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
function polymod(values) {
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= GEN[i];
  }
  return chk >>> 0;
}
function lnurl(url) {
  const bytes = [...Buffer.from(url, 'utf8')];
  const words = [];
  let acc = 0, bits = 0;
  for (const b of bytes) {
    acc = (acc << 8) | b; bits += 8;
    while (bits >= 5) { bits -= 5; words.push((acc >> bits) & 31); }
    acc &= (1 << bits) - 1;
  }
  if (bits) words.push((acc << (5 - bits)) & 31);
  const hrp = [...'lnurl'].map((c) => c.charCodeAt(0));
  const exp = hrp.map((c) => c >> 5).concat([0], hrp.map((c) => c & 31));
  const mod = polymod(exp.concat(words, [0, 0, 0, 0, 0, 0])) ^ 1;
  const sum = [0, 1, 2, 3, 4, 5].map((i) => (mod >> (5 * (5 - i))) & 31);
  return 'lnurl1' + words.concat(sum).map((w) => CHARSET[w]).join('');
}

// ---- reading the link ---------------------------------------------------------------------

test('THE LUD-01 VECTOR DECODES TO ITS URL', () => {
  const vector = 'LNURL1DP68GURN8GHJ7UM9WFMXJCM99E3K7MF0V9CXJ0M385EKVCENXC6R2C35XVUKXEFCV5MKVV34X5EKZD3EV56NYD3HXQURZEPEXEJXXEPNXSCRVWFNV9NXZCN9XQ6XYEFHVGCXXCMYXYMNSERXFQ5FNS';
  assert.equal(W.decodeLnurl(vector), 'https://service.com/api?q=3fc3645b439ce8e7f2553a69e5267081d96dcd340693afabe04be7b0ccd178df');
  assert.equal(W.decodeLnurl(vector.toLowerCase()), W.decodeLnurl(vector));
});

test('a link well past 90 characters is still read, since LUD-01 has no such limit', () => {
  const long = 'https://service.example/withdraw/' + 'a'.repeat(200) + '?k=1';
  assert.equal(W.decodeLnurl(lnurl(long)), long);
});

test('A MISTYPED, TRUNCATED OR MIXED-CASE LINK IS NOT A LINK', () => {
  const good = lnurl('https://service.example/w?k=1');
  const typo = good.slice(0, 20) + (good[20] === 'q' ? 'p' : 'q') + good.slice(21);
  assert.equal(W.decodeLnurl(typo), null, 'one wrong character fails the checksum');
  assert.equal(W.decodeLnurl(good.slice(0, -4)), null);
  assert.equal(W.decodeLnurl(good.slice(0, 8) + good.slice(8).toUpperCase()), null, 'mixed case is invalid bech32');
  assert.equal(W.decodeLnurl('lnbc1notalnurl'), null);
  assert.equal(W.decodeLnurl(''), null);
});

test('the three shapes the issue names all lead to the same place', () => {
  const url = 'https://service.example/w/abc?tag=1';
  for (const form of [lnurl(url), 'lightning:' + lnurl(url), lnurl(url).toUpperCase(), 'LIGHTNING:' + lnurl(url).toUpperCase(),
    'lnurlw://service.example/w/abc?tag=1', 'lightning:lnurlw://service.example/w/abc?tag=1']) {
    assert.equal(W.parseLink(form).toString(), url, form);
    assert.ok(W.looksLikeLink(form), form);
  }
});

test('text that is not a withdraw link is left alone', () => {
  for (const v of ['', 'hello', 'lnbc1pvjluez', 'someone@example.com', 'https://service.example/w', 'npub1abc']) {
    assert.equal(W.looksLikeLink(v), false, v);
    assert.throws(() => W.parseLink(v), (e) => e.code === 'not-link', v);
  }
});

test('A LINK NEVER LEADS SOMEWHERE PRIVATE, INSECURE OR CREDENTIALED', () => {
  const refuse = (url, code) => assert.throws(() => W.parseLink(lnurl(url)), (e) => e.code === code, url);
  refuse('http://service.example/w', 'insecure');
  for (const host of ['localhost', '127.0.0.1', '10.0.0.5', '192.168.1.1', '169.254.169.254', '[::1]', '[fe80::1]', '[::ffff:127.0.0.1]', 'printer.local', 'intranet', '0x7f.1', '2130706433']) {
    refuse('https://' + host + '/w', 'private');
  }
  refuse('https://user:pw@service.example/w', 'bad-link');
  assert.doesNotThrow(() => W.parseLink(lnurl('https://fcbarcelona.example/w')), 'a name that merely starts with fc is a name');
  assert.doesNotThrow(() => W.parseLink(lnurl('https://[2606:4700::1111]/w')));
  // lnurlw:// is https too, and gets the same checks.
  assert.throws(() => W.parseLink('lnurlw://192.168.0.1/w'), (e) => e.code === 'private');
});

// ---- the service ---------------------------------------------------------------------------

const LINK = 'https://pay.example/withdraw/abc';
const K1 = 'k1-' + 'x'.repeat(70) + '+/=&?'; // longer than 64, and not hex
const REQUEST = { tag: 'withdrawRequest', callback: 'https://pay.example/cb?session=1', k1: K1, minWithdrawable: 1000, maxWithdrawable: 5000000, defaultDescription: 'Weekly   payout\nfor you' };

// A fake fetch: routes by URL, records what was asked, answers with a JSON body.
function fakeNet(routes) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    const key = Object.keys(routes).find((k) => url.startsWith(k));
    if (!key) throw new TypeError('no route');
    const r = typeof routes[key] === 'function' ? routes[key](url) : routes[key];
    if (r instanceof Error) throw r;
    return { ok: true, status: 200, text: async () => (typeof r === 'string' ? r : JSON.stringify(r)) };
  };
  return { fetch, calls };
}

test('THE LINK IS FETCHED WITHOUT CREDENTIALS, REFERRER OR REDIRECTS, AND READ', async () => {
  const net = fakeNet({ [LINK]: REQUEST });
  const req = await W.fetchRequest(W.parseLink(lnurl(LINK)), { fetch: net.fetch });
  assert.equal(net.calls[0].init.credentials, 'omit');
  assert.equal(net.calls[0].init.referrerPolicy, 'no-referrer');
  assert.equal(net.calls[0].init.redirect, 'error', 'a redirect is an address nobody checked');
  assert.equal(req.domain, 'pay.example');
  assert.equal(req.k1, K1, 'k1 is kept exactly, never assumed to be 64 hex');
  assert.equal(req.minMsat, 1000);
  assert.equal(req.maxMsat, 5000000);
  assert.equal(req.description, 'Weekly payout for you', 'the service\'s text is one line');
});

test('A SERVICE THAT ANSWERS WRONGLY IS REPORTED, NOT TRUSTED', async () => {
  const read = (body) => W.fetchRequest(W.parseLink(lnurl(LINK)), { fetch: fakeNet({ [LINK]: body }).fetch });
  const rejects = (body, code) => assert.rejects(() => read(body), (e) => e.code === code, JSON.stringify(body).slice(0, 60));
  await rejects({ ...REQUEST, tag: 'payRequest' }, 'not-withdraw');
  await rejects({ status: 'ERROR', reason: 'Already   spent' }, 'refused');
  await rejects('<html>not json</html>', 'bad-response');
  await rejects('[1,2]', 'bad-response');
  await rejects({ ...REQUEST, k1: '' }, 'bad-response');
  await rejects({ ...REQUEST, k1: 12 }, 'bad-response');
  await rejects({ ...REQUEST, callback: undefined }, 'bad-response');
  await rejects({ ...REQUEST, callback: 'http://pay.example/cb' }, 'insecure');
  await rejects({ ...REQUEST, callback: 'https://192.168.1.9/cb' }, 'private');
  await rejects({ ...REQUEST, minWithdrawable: 5000, maxWithdrawable: 1000 }, 'bad-limits');
  await rejects({ ...REQUEST, minWithdrawable: 'lots' }, 'bad-limits');
  const reason = await read({ status: 'ERROR', reason: 'Already   spent' }).catch((e) => e.reason);
  assert.equal(reason, 'Already spent');
  await assert.rejects(() => W.fetchRequest(W.parseLink(lnurl(LINK)), { fetch: fakeNet({}).fetch }), (e) => e.code === 'unreachable' && e.domain === 'pay.example');
  await assert.rejects(() => W.fetchRequest(W.parseLink(lnurl(LINK)), { fetch: fakeNet({ [LINK]: 'x'.repeat(200000) }).fetch }), (e) => e.code === 'bad-response');
});

test('the amount on offer: a note names one, a service gives a range', () => {
  const range = W.amountRange({ minMsat: 1000, maxMsat: 5000000 });
  assert.deepEqual({ ...range }, { fixed: false, minSats: 1, maxSats: 5000, fixedMsat: 1000 });
  assert.equal(W.msatFor({ minMsat: 1000, maxMsat: 5000000 }, 250), 250000);
  assert.equal(W.msatFor({ minMsat: 1000, maxMsat: 5000000 }, 5001), null);
  assert.equal(W.msatFor({ minMsat: 1000, maxMsat: 5000000 }, 0), null);
  assert.equal(W.msatFor({ minMsat: 1000, maxMsat: 5000000 }, NaN), null);
  const note = { minMsat: 21000, maxMsat: 21000 };
  assert.equal(W.amountRange(note).fixed, true);
  assert.equal(W.msatFor(note, NaN), 21000, 'a note is cashed for exactly its value, whatever was typed');
  const odd = { minMsat: 1500, maxMsat: 1500 };
  assert.equal(W.msatFor(odd, 1), 1500, 'millisats are kept, not rounded to a different amount');
  assert.equal(W.amountRange({ minMsat: 1100, maxMsat: 1900 }).fixed, true, 'no whole sat fits: the minimum');
});

test('a wallet that leaves make_invoice out of its method list hides the option; one that said nothing does not', () => {
  assert.deepEqual([...W.parseMethods('pay_invoice, Make_Invoice get_info')], ['pay_invoice', 'make_invoice', 'get_info']);
  assert.deepEqual([...W.parseMethods(['pay_invoice'])], ['pay_invoice']);
  assert.deepEqual([...W.parseMethods(undefined)], []);
  assert.equal(W.canMakeInvoice(['pay_invoice', 'get_balance']), false);
  assert.equal(W.canMakeInvoice(['pay_invoice', 'make_invoice']), true);
  assert.equal(W.canMakeInvoice([]), true, 'unknown is not no');
});

// ---- the wallet ----------------------------------------------------------------------------

function fakeWallet({ lookups = [], makeError } = {}) {
  const w = { made: [], looked: [], n: 0 };
  w.makeInvoice = async (msat, desc) => {
    if (makeError) throw makeError;
    const n = ++w.n;
    w.made.push({ msat, desc });
    return { invoice: 'lnbc' + n + 'pinvoice' + n, payment_hash: 'hash' + n };
  };
  w.lookupInvoice = async (arg) => {
    w.looked.push(arg);
    const next = lookups.length ? lookups.shift() : { state: 'pending' };
    if (next instanceof Error) throw next;
    return next;
  };
  return w;
}
const SETTLED = { state: 'settled', settled_at: 1 };

test('CLAIMING ASKS THE WALLET FOR AN INVOICE IN RANGE AND HANDS IT TO THE CALLBACK WITH K1 INTACT', async () => {
  const net = fakeNet({ [LINK]: REQUEST, 'https://pay.example/cb': { status: 'OK' } });
  const wallet = fakeWallet();
  const req = await W.fetchRequest(W.parseLink(lnurl(LINK)), { fetch: net.fetch });
  const out = await W.claim({ req, amountMsat: 250000, client: wallet, fetch: net.fetch });
  assert.equal(out.state, 'accepted');
  assert.equal(wallet.made.length, 1);
  assert.equal(wallet.made[0].msat, 250000);
  const cb = new URL(net.calls[1].url);
  assert.equal(cb.origin + cb.pathname, 'https://pay.example/cb');
  assert.equal(cb.searchParams.get('session'), '1', 'the callback\'s own query is kept');
  assert.equal(cb.searchParams.get('k1'), K1, 'k1 comes back exactly as it was sent');
  assert.equal(cb.searchParams.get('pr'), 'lnbc1pinvoice1');
  assert.equal(net.calls[1].init.redirect, 'error');
  assert.equal(out.attempt.lookupArg.payment_hash, 'hash1');
});

test('WHEN THE SERVICE SAYS NO NOTHING IS CLAIMED, AND THE INVOICE IS REMEMBERED', async () => {
  const net = fakeNet({ [LINK]: REQUEST, 'https://pay.example/cb': { status: 'ERROR', reason: 'Withdraw is spent' } });
  const wallet = fakeWallet();
  const req = await W.fetchRequest(W.parseLink(lnurl(LINK)), { fetch: net.fetch });
  await assert.rejects(() => W.claim({ req, amountMsat: 250000, client: wallet, fetch: net.fetch }),
    (e) => e.code === 'refused' && e.reason === 'Withdraw is spent' && e.domain === 'pay.example' && e.attempt && e.attempt.invoice === 'lnbc1pinvoice1');
});

test('AN ANSWER THAT ISN\'T OK OR ERROR, OR NO ANSWER, MEANS THE CALLBACK MAY HAVE LANDED', async () => {
  const req = await W.fetchRequest(W.parseLink(lnurl(LINK)), { fetch: fakeNet({ [LINK]: REQUEST }).fetch });
  for (const cb of ['<html>gateway timeout</html>', { hello: 1 }, new TypeError('network down')]) {
    const net = fakeNet({ 'https://pay.example/cb': cb });
    const out = await W.claim({ req, amountMsat: 250000, client: fakeWallet(), fetch: net.fetch });
    assert.equal(out.state, 'unsure', String(cb).slice(0, 30));
    assert.ok(out.attempt.invoice, 'so the invoice is kept, to be watched');
  }
});

test('A RETRY ASKS WHETHER THE FIRST INVOICE WAS PAID BEFORE MAKING ANOTHER', async () => {
  const net = fakeNet({ 'https://pay.example/cb': { status: 'OK' } });
  const req = await W.fetchRequest(W.parseLink(lnurl(LINK)), { fetch: fakeNet({ [LINK]: REQUEST }).fetch });
  const first = { invoice: 'lnbc1pinvoice1', amountMsat: 250000, lookupArg: { payment_hash: 'hash1' } };

  // It was paid: nothing new is made, nothing new is sent.
  let wallet = fakeWallet({ lookups: [SETTLED] });
  let out = await W.claim({ req, amountMsat: 250000, client: wallet, fetch: net.fetch, previous: first });
  assert.equal(out.state, 'settled');
  assert.equal(wallet.made.length, 0);
  assert.equal(net.calls.length, 0);
  assert.deepEqual(wallet.looked, [{ payment_hash: 'hash1' }]);

  // It was not: a new invoice is fine.
  wallet = fakeWallet({ lookups: [{ state: 'pending' }] });
  out = await W.claim({ req, amountMsat: 250000, client: wallet, fetch: net.fetch, previous: first });
  assert.equal(out.state, 'accepted');
  assert.equal(wallet.made.length, 1);

  // The wallet could not say: the first one cannot be ruled out, so no second is made.
  wallet = fakeWallet({ lookups: [new Error('timeout')] });
  await assert.rejects(() => W.claim({ req, amountMsat: 250000, client: wallet, fetch: net.fetch, previous: first }),
    (e) => e.code === 'unconfirmed');
  assert.equal(wallet.made.length, 0, 'an unconfirmed first attempt blocks a second invoice');
});

test('a wallet that cannot make an invoice is told apart from one that did not answer', async () => {
  const net = fakeNet({});
  const req = await W.fetchRequest(W.parseLink(lnurl(LINK)), { fetch: fakeNet({ [LINK]: REQUEST }).fetch });
  const denied = (code, message) => Object.assign(new Error(message), { walletDenied: true, code });
  await assert.rejects(() => W.claim({ req, amountMsat: 1000, client: fakeWallet({ makeError: denied('RESTRICTED', 'No') }), fetch: net.fetch }), (e) => e.code === 'restricted');
  await assert.rejects(() => W.claim({ req, amountMsat: 1000, client: fakeWallet({ makeError: denied('NOT_IMPLEMENTED', 'No') }), fetch: net.fetch }), (e) => e.code === 'restricted');
  await assert.rejects(() => W.claim({ req, amountMsat: 1000, client: fakeWallet({ makeError: denied('OTHER', 'Quota exceeded.') }), fetch: net.fetch }), (e) => e.code === 'make-invoice' && e.reason === 'Quota exceeded.');
  const silent = Object.assign(new Error("Your wallet didn't respond in time."), { walletSilent: true });
  await assert.rejects(() => W.claim({ req, amountMsat: 1000, client: fakeWallet({ makeError: silent }), fetch: net.fetch }), (e) => e === silent);
  assert.equal(net.calls.length, 0, 'nothing reaches the service when the wallet made no invoice');
});

// ---- waiting -------------------------------------------------------------------------------

function clockedWatch(client, extra) {
  const c = { t: 0, slept: [] };
  const run = () => W.watch({
    client, attempt: { lookupArg: { payment_hash: 'h' } },
    sleep: async (ms) => { c.slept.push(ms); c.t += ms; },
    now: () => c.t,
    ...extra,
  });
  return { c, run };
}

test('WAITING ENDS WHEN THE WALLET SEES THE PAYMENT', async () => {
  const w = clockedWatch(fakeWallet({ lookups: [{ state: 'pending' }, new Error('blip'), SETTLED] }));
  assert.equal(await w.run(), 'settled');
  assert.deepEqual(w.c.slept, [2000, 3000, 4500], 'it eases off rather than hammering the relay');
});

test('and a payment that never arrives is "waiting", never a reason to retry', async () => {
  const w = clockedWatch(fakeWallet());
  assert.equal(await w.run(), 'waiting');
  assert.ok(w.c.t >= 5 * 60 * 1000 && w.c.t < 5 * 60 * 1000 + 15001, 'it stops at the window');
  assert.ok(Math.max(...w.c.slept) <= 15000);
});

test('an expired or failed invoice is reported, and closing the sheet stops the wait', async () => {
  assert.equal(await clockedWatch(fakeWallet({ lookups: [{ state: 'expired' }] })).run(), 'failed');
  assert.equal(await clockedWatch(fakeWallet({ lookups: [{ state: 'failed' }] })).run(), 'failed');
  const wallet = fakeWallet();
  assert.equal(await clockedWatch(wallet, { isStopped: () => true }).run(), 'stopped');
  assert.equal(wallet.looked.length, 0, 'a closed sheet does not keep asking the wallet');
});

test('every wallet\'s way of saying "paid" counts', () => {
  assert.ok(W.isSettled({ settled_at: 1 }));
  assert.ok(W.isSettled({ preimage: 'ab' }));
  assert.ok(W.isSettled({ state: 'settled' }));
  assert.ok(!W.isSettled({ state: 'pending' }));
  assert.ok(!W.isSettled(null));
});

// ---- the host guard, shared with the background ---------------------------------------------

test('THE HOST GUARD SEES AN IPv6 LITERAL THE WAY A PARSED URL SPELLS IT', () => {
  // URL.hostname keeps the brackets on "[::1]". The guard's IPv6 checks compared against the
  // bare form, so no IPv6 literal was ever refused, and its "fc" and "fd" prefix checks
  // refused ordinary names such as fcbarcelona.com.
  const { isPrivateHostname } = loadModule().SidecarPrivateHost;
  for (const u of ['https://[::1]/', 'https://[fe80::1]/', 'https://[fd00::1]/', 'https://[::ffff:10.0.0.1]/']) {
    assert.equal(isPrivateHostname(new URL(u).hostname), true, u);
  }
  for (const u of ['https://fcbarcelona.com/', 'https://fdic.gov/', 'https://example.com/', 'https://[2606:4700::1111]/']) {
    assert.equal(isPrivateHostname(new URL(u).hostname), false, u);
  }
  // Unchanged behavior: the v4 ranges and the local names the background has always refused.
  for (const h of ['localhost', 'a.localhost', 'nas.local', 'x.internal', '127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.0.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '']) {
    assert.equal(isPrivateHostname(h), true, h);
  }
});

test('the background takes its guard from the shared file, in Chrome and in Firefox', () => {
  const bg = read('background.js');
  assert.match(bg, /importScripts\('i18n\.js', 'private-host\.js', /);
  const scripts = JSON.parse(read('manifest.json')).background.scripts;
  assert.ok(scripts.indexOf('private-host.js') > -1 && scripts.indexOf('private-host.js') < scripts.indexOf('background.js'));
  assert.doesNotMatch(bg, /^function isPrivateHostname/m, 'one copy of the guard, not two');
});

// ---- the sheet, driven ----------------------------------------------------------------------

function el(tag, props) {
  const e = {
    tag, children: [], listeners: {}, value: '', disabled: false, cls: new Set(), _text: '',
    append(...c) { c.forEach((x) => { this.children.push(x); if (x && typeof x === 'object') x.parentElement = this; }); },
    insertBefore(x, ref) { const at = this.children.indexOf(ref); this.children.splice(at < 0 ? this.children.length : at, 0, x); if (x && typeof x === 'object') x.parentElement = this; return x; },
    addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); },
    async fire(t) { for (const f of this.listeners[t] || []) await f({ target: this }); },
    click() { return this.fire('click'); },
    setAttribute() {}, focus() {},
    querySelectorAll(sel) {
      const cls = sel.replace(/^\./, '');
      const out = [];
      const walk = (n) => (n.children || []).forEach((c) => { if (c && c.cls && c.cls.has(cls)) out.push(c); walk(c); });
      walk(this);
      return out;
    },
  };
  e.classList = {
    add: (...c) => c.forEach((x) => e.cls.add(x)),
    remove: (...c) => c.forEach((x) => e.cls.delete(x)),
    toggle: (c, on) => { const v = on === undefined ? !e.cls.has(c) : on; if (v) e.cls.add(c); else e.cls.delete(c); return v; },
    contains: (c) => e.cls.has(c),
  };
  Object.defineProperty(e, 'textContent', { get() { return this._text; }, set(v) { this._text = v; if (v === '') this.children = []; } });
  Object.defineProperty(e, 'innerHTML', { get() { return ''; }, set() { this.children = []; this._text = ''; } });
  Object.defineProperty(e, 'className', { get() { return [...this.cls].join(' '); }, set(v) { this.cls = new Set(String(v).split(/\s+/).filter(Boolean)); } });
  for (const [k, v] of Object.entries(props || {})) e[k] = v;
  return e;
}
const textOf = (e) => [e._text || '', ...(e.children || []).map(textOf)].join(' ').replace(/\s+/g, ' ').trim();
const findAll = (root, pred) => [pred(root) ? root : null, ...(root.children || []).flatMap((c) => (c && typeof c === 'object' ? findAll(c, pred) : []))].filter(Boolean);

const panel = read('sidepanel.js');
function liftFn(decl) {
  const at = panel.indexOf(decl);
  if (at === -1) throw new Error('Could not find ' + decl);
  const open = panel.indexOf(') {', at) + 2;
  let depth = 0;
  for (let j = open; j < panel.length; j++) {
    if (panel[j] === '{') depth++;
    else if (panel[j] === '}' && --depth === 0) return panel.slice(at, j + 1);
  }
  throw new Error('Unbalanced braces after ' + decl);
}

// The real Receive sheet, against a fake wallet and a fake service. Time is the fake's too:
// a sleep advances the clock and resolves at once, so a five-minute wait takes no time.
function openReceive({ methods, routes, lookups, makeError, opts, address, wallet: gate } = {}) {
  const net = fakeNet(routes || { [LINK]: REQUEST, 'https://pay.example/cb': { status: 'OK' } });
  const wallet = fakeWallet({ lookups, makeError });
  wallet.getInfo = async () => ({ methods: methods === undefined ? ['pay_invoice', 'make_invoice', 'lookup_invoice'] : methods });
  const clock = { ms: 0 };
  const made = [];
  const log = { closed: 0, refreshed: 0 };
  const h = (tag, props, kids) => {
    const e = el(tag, props);
    (kids || []).forEach((k) => { e.children.push(k); if (k && typeof k === 'object') k.parentElement = e; });
    made.push(e);
    return e;
  };
  const ctx = {
    console, Math, JSON, Promise, parseInt, String, Number, Object, Array, RegExp, Error, Set, Map, WeakMap, URL, URLSearchParams, TextDecoder, AbortSignal, Uint8Array,
    setTimeout: (f, ms) => { clock.ms += ms || 0; Promise.resolve().then(f); return 1; },
    clearTimeout() {},
    Date: { now: () => clock.ms },
    fetch: net.fetch,
    h, made,
    icon: () => el('svg'),
    MAX_SATS: 2100000000000000,
    fmtSats: (n) => String(n),
    window: { SidecarQR: { draw() {} } },
    closeModal: () => { log.closed++; ctx.onClose && ctx.onClose(); },
    openModal: (build, onClose) => { ctx.onClose = onClose; build(el('div')); },
    ensureNwc: async () => { if (gate) await gate; return wallet; },
    getLightningAddress: address || (async () => null),
    copyPlain: async () => {},
    renderWallet: () => { log.refreshed++; }, renderPinnedBalanceBar() {},
  };
  ctx.window.SidecarLnurlWithdraw = undefined;
  ctx.self = ctx;
  withI18n(ctx);
  vm.createContext(ctx);
  vm.runInContext(read('private-host.js'), ctx);
  vm.runInContext(read('lnurl-withdraw.js'), ctx);
  ctx.window.SidecarLnurlWithdraw = ctx.SidecarLnurlWithdraw;
  const code = [
    liftFn('function waitingRow('),
    liftFn('function satsInput('),
    'const walletMethodsCache = new WeakMap();',
    liftFn('function walletMethodsOf('),
    liftFn('function withdrawErrorText('),
    liftFn('function showReceiveSuccess('),
    liftFn('function showInvoice('),
    'const RECEIVE_PRESETS = [100, 1000, 5000, 10000];',
    liftFn('function receiveModal('),
    `receiveModal(${JSON.stringify(opts || null)});`,
  ].join('\n');
  vm.runInContext(code, ctx);
  const tabs = () => findAll(made[0] ? made.find((e) => e.cls.has('compose-tabs')) : null, (e) => e.cls && e.cls.has('compose-tab'));
  const tab = (label) => tabs().find((t) => t._text === label);
  // The body is the last plain div the sheet made, which is where the current mode renders.
  const body = () => made.find((e) => e.tag === 'div' && e.cls.size === 0 && e.children !== undefined && e.parentElement && e.parentElement.tag === 'div' && !e.parentElement.cls.size && e.parentElement.children.includes(e) && e.parentElement.children.some((c) => c.cls && c.cls.has('compose-tabs')));
  const settle = async () => { for (let i = 0; i < 40; i++) await new Promise((r) => setImmediate(r)); };
  return {
    ctx, net, wallet, log, tabs, tab, settle, made,
    text: () => textOf(body()),
    body,
    field: () => findAll(body(), (e) => e.tag === 'textarea')[0],
    button: (label) => findAll(body(), (e) => e.tag === 'button' && e._text === label)[0],
    amountField: () => findAll(body(), (e) => e.tag === 'input')[0],
    async press(label) { const b = this.button(label); assert.ok(b, 'no button "' + label + '" in: ' + this.text()); await b.click(); await settle(); },
    async openWithdraw(link) {
      await settle();
      assert.ok(tab('Withdraw'), 'the Withdraw tab is there');
      await tab('Withdraw').click();
      if (link) { this.field().value = link; await this.press('Continue'); }
    },
  };
}

test('THE WITHDRAW TAB IS THERE WHEN THE WALLET CAN MAKE AN INVOICE, AND ABSENT WHEN IT CANNOT', async () => {
  const yes = openReceive();
  await yes.settle();
  assert.deepEqual(yes.tabs().map((t) => t._text), ['Invoice', 'Withdraw']);

  const no = openReceive({ methods: ['pay_invoice', 'get_balance'] });
  await no.settle();
  assert.deepEqual(no.tabs().map((t) => t._text), ['Invoice']);

  const unknown = openReceive({ methods: [] });
  await unknown.settle();
  assert.ok(unknown.tab('Withdraw'), 'a wallet that said nothing usable gets to answer for itself');
});

test('THE TABS KEEP ONE ORDER WHICHEVER LOOKUP ANSWERS FIRST', async () => {
  const fast = async () => 'me@pay.example';
  const slow = () => new Promise((res) => setTimeout(() => res('me@pay.example'), 0));
  for (const address of [fast, slow]) {
    const s = openReceive({ address });
    await s.settle();
    assert.deepEqual(s.tabs().map((t) => t._text), ['Invoice', 'Address', 'Withdraw']);
  }
  // The wallet answers last: Address is already in, and Withdraw still lands after it.
  let release;
  const gate = new Promise((res) => { release = res; });
  const late = openReceive({ address: fast, wallet: gate });
  await late.settle();
  assert.deepEqual(late.tabs().map((t) => t._text), ['Invoice', 'Address'], 'nothing to place yet');
  release();
  await late.settle();
  assert.deepEqual(late.tabs().map((t) => t._text), ['Invoice', 'Address', 'Withdraw']);
  // And the reverse: Withdraw is in first, Address arrives after and takes the slot before it.
  let releaseAddress;
  const gated = new Promise((res) => { releaseAddress = res; });
  const early = openReceive({ address: async () => { await gated; return 'me@pay.example'; } });
  await early.settle();
  assert.deepEqual(early.tabs().map((t) => t._text), ['Invoice', 'Withdraw']);
  releaseAddress();
  await early.settle();
  assert.deepEqual(early.tabs().map((t) => t._text), ['Invoice', 'Address', 'Withdraw']);
});

test('A LINK IS CHECKED AND THE TERMS ARE SHOWN BEFORE ANYTHING IS SENT', async () => {
  const s = openReceive();
  await s.openWithdraw(lnurl(LINK));
  assert.match(s.text(), /pay\.example/);
  assert.match(s.text(), /1 to 5000 sats/);
  assert.match(s.text(), /Weekly payout for you/);
  assert.equal(s.amountField().value, '5000', 'the whole amount is the usual wish');
  assert.equal(s.button('Withdraw 5,000 sats') !== undefined, true);
  assert.equal(s.net.calls.length, 1, 'only the link was fetched');
  assert.equal(s.wallet.made.length, 0, 'no invoice yet');
});

test('CASHING IT: INVOICE, CALLBACK, WAIT, RECEIVED', async () => {
  const s = openReceive({ lookups: [{ state: 'pending' }, SETTLED] });
  await s.openWithdraw('lnurlw://pay.example/withdraw/abc');
  s.amountField().value = '250';
  await s.amountField().fire('input');
  assert.ok(s.button('Withdraw 250 sats'), 'the button names the amount');
  await s.press('Withdraw 250 sats');
  assert.equal(s.wallet.made[0].msat, 250000);
  assert.match(s.text(), /Payment received/);
  assert.match(s.text(), /\+250 sats/);
  assert.ok(s.log.refreshed > 0, 'the wallet view reads the new balance');
  const cb = new URL(s.net.calls[1].url);
  assert.equal(cb.searchParams.get('k1'), K1);
  assert.equal(cb.searchParams.get('pr'), 'lnbc1pinvoice1');
});

test('A NOTE NAMES ITS OWN VALUE AND ASKS FOR NO AMOUNT', async () => {
  const note = { ...REQUEST, minWithdrawable: 21000, maxWithdrawable: 21000 };
  const s = openReceive({ routes: { [LINK]: note, 'https://pay.example/cb': { status: 'OK' } }, lookups: [SETTLED] });
  await s.openWithdraw(lnurl(LINK));
  assert.match(s.text(), /21 sats only/);
  assert.equal(s.amountField(), undefined, 'there is nothing to choose');
  await s.press('Withdraw 21 sats');
  assert.equal(s.wallet.made[0].msat, 21000);
  assert.match(s.text(), /Payment received/);
});

test('A LINK THAT IS NOT ONE, OR NOT FOR WITHDRAWING, SAYS SO AND KEEPS WHAT WAS PASTED', async () => {
  const s = openReceive();
  await s.openWithdraw();
  s.field().value = 'hello';
  await s.press('Continue');
  assert.match(s.text(), /doesn't read as a withdraw link/);
  assert.equal(s.net.calls.length, 0, 'nothing was requested');

  const pay = openReceive({ routes: { [LINK]: { ...REQUEST, tag: 'payRequest' } } });
  await pay.openWithdraw(lnurl(LINK));
  assert.match(pay.text(), /not a withdraw link/);
  assert.equal(pay.field().value, lnurl(LINK), 'the paste is still there to correct');
});

test('A SERVICE THAT REFUSES SAYS WHY IN ITS OWN WORDS, AND A RETRY CHECKS THE FIRST INVOICE FIRST', async () => {
  const s = openReceive({
    routes: { [LINK]: REQUEST, 'https://pay.example/cb': { status: 'ERROR', reason: 'Please wait a minute' } },
    lookups: [{ state: 'pending' }],
  });
  await s.openWithdraw(lnurl(LINK));
  await s.press('Withdraw 5,000 sats');
  assert.match(s.text(), /pay\.example said: Please wait a minute/);
  assert.equal(s.wallet.made.length, 1);

  await s.press('Try again');
  await s.press('Withdraw 5,000 sats');
  assert.equal(s.wallet.looked[0].payment_hash, 'hash1', 'the first invoice was looked up before a second was made');
  assert.equal(s.wallet.made.length, 2);
});

test('A SERVICE THAT ACCEPTED, THEN NEVER PAID, DOES NOT GET A SECOND INVOICE', async () => {
  const s = openReceive(); // lookups stay pending for the whole window
  await s.openWithdraw(lnurl(LINK));
  await s.press('Withdraw 5,000 sats');
  assert.match(s.text(), /Still waiting for pay\.example/);
  assert.match(s.text(), /check your wallet before trying again/);
  assert.equal(s.wallet.made.length, 1);
  assert.ok(!s.button('Try again'), 'no retry is offered while the first invoice might still pay');
  assert.ok(s.button('Check again'));
});

test('A WALLET THAT REFUSES TO MAKE THE INVOICE IS NAMED, AND NOTHING GOES TO THE SERVICE', async () => {
  const s = openReceive({ makeError: Object.assign(new Error('Restricted.'), { walletDenied: true, code: 'RESTRICTED' }) });
  await s.openWithdraw(lnurl(LINK));
  await s.press('Withdraw 5,000 sats');
  assert.match(s.text(), /doesn't allow creating invoices/);
  assert.equal(s.net.calls.length, 1, 'only the link was ever fetched');
});

test('THE TABS ARE HELD WHILE AN INVOICE IS OUT, AND FREED AFTER', async () => {
  const s = openReceive({ routes: { [LINK]: REQUEST, 'https://pay.example/cb': { status: 'OK' } }, lookups: [SETTLED] });
  await s.openWithdraw(lnurl(LINK));
  let heldDuring = null;
  const real = s.wallet.makeInvoice;
  s.wallet.makeInvoice = async (...a) => { heldDuring = s.tabs().every((t) => t.disabled); return real(...a); };
  await s.press('Withdraw 5,000 sats');
  assert.equal(heldDuring, true);
  assert.ok(s.tabs().every((t) => !t.disabled));
});

test('CLOSING THE SHEET ENDS THE WAIT: NO MORE LOOKUPS, NOTHING DRAWN INTO A CLOSED SHEET', async () => {
  const s = openReceive();
  await s.openWithdraw(lnurl(LINK));
  const real = s.wallet.lookupInvoice;
  // The person closes the sheet while the first poll is out.
  s.wallet.lookupInvoice = async (arg) => { s.ctx.onClose(); return real(arg); };
  await s.press('Withdraw 5,000 sats');
  assert.equal(s.wallet.looked.length, 1, 'one poll, then the wait ended');
  assert.doesNotMatch(s.text(), /Still waiting|Payment received/);
});
