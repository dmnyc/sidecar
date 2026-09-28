'use strict';

// A PASTED INVOICE IS SHOWN BEFORE IT IS PAID.
//
// Send paid a pasted BOLT11 the moment Pay was pressed, with nothing on the sheet about
// what it was paying: the amount first appeared in the toast, after the sheet had closed
// and the money was moving. An address got a card with its limits; an invoice got nothing.
//
// Now a pasted invoice gets a card with its amount, description and expiry, an expired or
// unreadable one cannot be paid, and an amountless one asks for the amount and passes it
// to the wallet. The decoder is checked against the BOLT11 specification's own vectors,
// and the sheet is driven end to end: paste, read the card, press Pay, see what the
// wallet was asked to do.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'sidepanel.js'), 'utf8');
function liftFn(decl) {
  const at = source.indexOf(decl);
  if (at === -1) throw new Error('Could not find ' + decl);
  // The body's brace, not the first one: largeSendGate destructures its options.
  const open = source.indexOf(') {', at) + 2;
  let depth = 0;
  for (let j = open; j < source.length; j++) {
    if (source[j] === '{') depth++;
    else if (source[j] === '}' && --depth === 0) return source.slice(at, j + 1);
  }
  throw new Error('Unbalanced braces after ' + decl);
}
const DECODER = [
  source.match(/const BECH32_CHARSET = '[^']*';/)[0],
  liftFn('function bolt11Sats('),
  liftFn('function decodeBolt11('),
  liftFn('function bech32WordsToText('),
  liftFn('function fmtExpiresIn('),
].join('\n');

// The BOLT11 specification's test vectors (bolts/11-payment-encoding.md, "Examples").
// All signed at 1496314658, so all long expired.
const DONATION = 'lnbc1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdpl2pkx2ctnv5sxxmmwwd5kgetjypeh2ursdae8g6twvus8g6rfwvs8qun0dfjkxaq8rkx3yf5tcsyz3d73gafnh3cax9rn449d9p5uxz9ezhhypd0elx87sjle52x86fux2ypatgddc6k63n7erqz25le42c4u4ecky03ylcqca784w';
const COFFEE = 'lnbc2500u1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdq5xysxxatsyp3k7enxv4jsxqzpuaztrnwngzn3kdzw5hydlzf03qdgm2hdq27cqv3agm2awhz5se903vruatfhq77w3ls4evs3ch9zw97j25emudupq63nyw24cg27h2rspfj9srp';
const HASH_ONLY = 'lnbc20m1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqhp58yjmdan79s6qqdhdzgynm4zwqd5d7xmw5fk98klysy043l2ahrqscc6gd6ql3jrc5yzme8v4ntcewwz5cnw92tz0pc8qcuufvq7khhr8wpald05e92xw006sq94mg8v2ndf4sefvf9sygkshp5zfem29trqq2yxxz7';
const SIGNED_AT = 1496314658;

const decode = new Function(`${DECODER}\nreturn { decodeBolt11, fmtExpiresIn };`)();
const GATE = [
  source.match(/const LARGE_SEND_SATS = \d+;/)[0],
  source.match(/const LARGE_SEND_WINDOW_MS = \d+;/)[0],
  liftFn('function largeSendGate('),
].join('\n');

// ---- the decoder ------------------------------------------------------------------------

test('THE SPEC\'S INVOICES DECODE AS THE SPEC SAYS', () => {
  assert.deepEqual(decode.decodeBolt11(COFFEE), {
    sats: 250000, timestamp: SIGNED_AT, expiry: 60, expiresAt: SIGNED_AT + 60,
    description: '1 cup coffee', descriptionHash: false,
  });
  assert.deepEqual(decode.decodeBolt11(DONATION), {
    sats: null, timestamp: SIGNED_AT, expiry: 3600, expiresAt: SIGNED_AT + 3600,
    description: 'Please consider supporting this project', descriptionHash: false,
  }, 'amountless, and no x field means the default hour');
  const h = decode.decodeBolt11(HASH_ONLY);
  assert.equal(h.sats, 2000000);
  assert.equal(h.description, null);
  assert.equal(h.descriptionHash, true, 'only a hash of the description is carried');
});

test('a lightning: prefix and upper case are the same invoice', () => {
  assert.equal(decode.decodeBolt11('lightning:' + COFFEE.toUpperCase()).description, '1 cup coffee');
});

test('A MISTYPED OR TRUNCATED PASTE IS NOT AN INVOICE', () => {
  const typo = COFFEE.slice(0, 40) + (COFFEE[40] === 'q' ? 'p' : 'q') + COFFEE.slice(41);
  assert.equal(decode.decodeBolt11(typo), null, 'one wrong character fails the checksum');
  assert.equal(decode.decodeBolt11(COFFEE.slice(0, -10)), null);
  assert.equal(decode.decodeBolt11('lnbc1notaninvoice'), null);
  assert.equal(decode.decodeBolt11('someone@example.com'), null);
  assert.equal(decode.decodeBolt11(''), null);
});

test('expiry reads coarsely', () => {
  assert.equal(decode.fmtExpiresIn(30), 'under a minute');
  assert.equal(decode.fmtExpiresIn(42 * 60), '42 min');
  assert.equal(decode.fmtExpiresIn(5 * 3600), '5 h');
  assert.equal(decode.fmtExpiresIn(3 * 86400), '3 days');
});

// ---- the sheet, driven --------------------------------------------------------------------

// Elements that remember classes, children, text and listeners, enough to paste into the
// sheet, read its card and press Pay.
function el(tag, props) {
  const e = {
    tag, children: [], listeners: {}, value: '', disabled: false, textContent: '',
    cls: new Set(),
    append(...c) { c.forEach((x) => { this.children.push(x); if (x && typeof x === 'object') x.parentElement = this; }); },
    appendChild(c) { this.append(c); return c; },
    addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); },
    fire(t) { return Promise.all((this.listeners[t] || []).map((f) => f({ target: this }))); },
    setAttribute() {}, focus() {},
    // Enough of insertion for the large-send line, which goes after its button's row.
    after(x) { const p = this.parentElement; if (p) p.children.splice(p.children.indexOf(this) + 1, 0, x); x.parentElement = p; },
    remove() { const p = this.parentElement; if (p) p.children = p.children.filter((c) => c !== this); this.parentElement = null; },
  };
  e.classList = {
    add: (...c) => c.forEach((x) => e.cls.add(x)),
    remove: (...c) => c.forEach((x) => e.cls.delete(x)),
    toggle: (c, on) => { const v = on === undefined ? !e.cls.has(c) : on; if (v) e.cls.add(c); else e.cls.delete(c); return v; },
    contains: (c) => e.cls.has(c),
  };
  Object.defineProperty(e, 'textContent', {
    get() { return this._text || ''; },
    set(v) { this._text = v; if (v === '') this.children = []; },
  });
  Object.defineProperty(e, 'className', {
    get() { return [...this.cls].join(' '); },
    set(v) { this.cls = new Set(String(v).split(/\s+/).filter(Boolean)); },
  });
  for (const [k, v] of Object.entries(props || {})) e[k] = v;
  return e;
}
const textOf = (e) => [e.textContent || e.text || '', ...(e.children || []).map(textOf)].join(' ').replace(/\s+/g, ' ').trim();

function openSheet({ now = SIGNED_AT + 10, payStore = {} } = {}) {
  const clock = { now };
  const timers = [];
  const made = [];
  const paid = [];
  const h = (tag, props, kids) => {
    const e = el(tag, props);
    (kids || []).forEach((k) => { e.children.push(k); if (k && typeof k === 'object') k.parentElement = e; });
    made.push(e);
    return e;
  };
  const RealDate = Date;
  const ctx = {
    console, Math, JSON, Promise, parseInt, String, Number, Object,
    setTimeout: (f) => { timers.push(f); return timers.length; },
    clearTimeout() {},
    Array, RegExp, Error, Set, Map, TextDecoder, Uint8Array,
    Date: Object.assign(function () { return new RealDate(clock.now * 1000); }, { now: () => clock.now * 1000 }),
    h,
    MAX_SATS: 2100000000000000,
    icon: () => el('svg'),
    openModal: (build) => build(el('div')),
    closeModal() {},
    toast: () => ({ close() {} }),
    fmtSats: (n) => String(n),
    fmtFeeMsat: () => '',
    isLnInvoice: (v) => /^ln(bc|tb)[0-9]/i.test(v),
    isLnAddress: (v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v),
    ensureNwc: async () => ({ payInvoice: async (inv, msat) => { paid.push({ inv, msat }); return {}; } }),
    lnAddressParams: async () => { throw new Error('not in these tests'); },
    lnAddressToInvoice: async () => { throw new Error('not in these tests'); },
    getPayMeta: async () => payStore,
    savePayMeta: async (inv, meta) => { payStore[inv] = Object.assign({ ts: clock.now * 1000 }, meta); },
    lightningStrike() {}, renderWallet() {}, renderPinnedBalanceBar() {},
  };
  vm.createContext(ctx);
  vm.runInContext(
    `${DECODER}\n${GATE}\n${liftFn('async function paidHere(')}\n${liftFn('function satsInput(')}\n${liftFn('function sendModal(')}\nsendModal();`,
    ctx
  );
  const find = (pred) => made.find(pred);
  return {
    input: find((e) => e.tag === 'textarea'),
    amount: find((e) => e.tag === 'input' && e.placeholder === 'Amount in sats'),
    card: find((e) => e.cls.has('ln-recipient')),
    err: find((e) => e.cls.has('error')),
    pay: find((e) => e.tag === 'button' && e.textContent === 'Pay'),
    comment: find((e) => e.cls.has('send-comment')),
    paid,
    clock,
    payStore,
    fireTimers() { const t = timers.splice(0); t.forEach((f) => f()); },
    async paste(v) { this.input.value = v; await this.input.fire('input'); },
  };
}

test('PASTING AN INVOICE SHOWS WHAT IT WILL PAY, BEFORE PAY', async () => {
  const s = openSheet();
  await s.paste(COFFEE);
  assert.ok(!s.card.cls.has('hidden'), 'the card is shown');
  assert.match(textOf(s.card), /250000 sats/);
  assert.match(textOf(s.card), /1 cup coffee/);
  assert.match(textOf(s.card), /Expires in under a minute/);
  assert.ok(s.amount.cls.has('hidden'), 'the invoice carries its own amount');
  assert.equal(s.pay.textContent, 'Confirm amount above', '250,000 sats is over the line');
  const find = (e, pred) => (pred(e) ? e : (e.children || []).map((c) => find(c, pred)).find(Boolean));
  const amountEl = find(s.card, (e) => e.cls && e.cls.has('ln-invoice-amount'));
  assert.equal(amountEl && amountEl.textContent, '250000 sats', 'the amount is set in its own, larger style');
});

test('an amountless invoice\'s prompt is not set as a figure', async () => {
  const s = openSheet();
  await s.paste(DONATION);
  const find = (e, pred) => (pred(e) ? e : (e.children || []).map((c) => find(c, pred)).find(Boolean));
  assert.equal(find(s.card, (e) => e.cls && e.cls.has('ln-invoice-amount')), undefined);
});

test('ON AN INVOICE THE FIELD IS A NOTE FOR THIS DEVICE, NOT A COMMENT TO THE PAYEE', async () => {
  // An invoice cannot carry anything added after it was made: what is typed is saved
  // beside the payment in your own history, and the field must not suggest otherwise.
  const s = openSheet();
  const comment = s.comment;
  assert.equal(comment.placeholder, 'Comment (optional)');
  await s.paste(COFFEE);
  assert.equal(comment.placeholder, 'Note (on this device)');
  await s.paste('someone@example.com');
  assert.equal(comment.placeholder, 'Comment (optional)', 'an address really does send it');
});

test('and Pay then pays that invoice, for its own amount, after the button has asked', async () => {
  const s = openSheet();
  await s.paste(COFFEE);
  await s.pay.fire('click');
  assert.deepEqual(s.paid, [], 'the first press confirms, it does not pay');
  assert.equal(s.pay.textContent, 'Pay 250000 sats');
  assert.ok(s.pay.cls.has('primary'));
  await s.pay.fire('click');
  assert.deepEqual(s.paid, [{ inv: COFFEE, msat: undefined }]);
});

// ---- a large payment takes a second press --------------------------------------------------

async function amountless(s, sats) {
  await s.paste(DONATION);
  s.amount.value = String(sats);
  await s.amount.fire('input');
}

test('UNDER 10,000 SATS THE BUTTON IS THE PAYMENT, AND ONE PRESS SENDS', async () => {
  const s = openSheet();
  await amountless(s, 9999);
  assert.equal(s.pay.textContent, 'Pay 9999 sats');
  assert.ok(s.pay.cls.has('primary') && !s.pay.cls.has('secondary'));
  await s.pay.fire('click');
  assert.deepEqual(s.paid, [{ inv: DONATION, msat: 9999000 }]);
});

test('AT 10,000 SATS THE BUTTON ASKS FIRST, IN ANOTHER STYLE, AND THEN BECOMES THE PAYMENT', async () => {
  const s = openSheet();
  await amountless(s, 10000);
  assert.equal(s.pay.textContent, 'Confirm amount above');
  assert.ok(s.pay.cls.has('secondary') && !s.pay.cls.has('primary'), 'styled apart from the payment');
  await s.pay.fire('click');
  assert.deepEqual(s.paid, []);
  assert.equal(s.pay.textContent, 'Pay 10000 sats');
  assert.ok(s.pay.cls.has('primary') && !s.pay.cls.has('secondary'));
  await s.pay.fire('click');
  assert.deepEqual(s.paid, [{ inv: DONATION, msat: 10000000 }]);
});

test('THE PAY BUTTON CARRIES THE AMOUNT IT WILL SEND', async () => {
  const s = openSheet();
  assert.equal(s.pay.textContent, 'Pay', 'nothing to show before anything is pasted');
  await s.paste(DONATION);
  assert.equal(s.pay.textContent, 'Pay', 'an amountless invoice has none until one is typed');
  s.amount.value = '1';
  await s.amount.fire('input');
  assert.equal(s.pay.textContent, 'Pay 1 sat');
  s.amount.value = '21';
  await s.amount.fire('input');
  assert.equal(s.pay.textContent, 'Pay 21 sats');
});

test('an expired or unreadable invoice puts no amount on the button', async () => {
  const late = openSheet({ now: SIGNED_AT + 3600 });
  await late.paste(COFFEE);
  assert.equal(late.pay.textContent, 'Pay');
  const bad = openSheet();
  await bad.paste(COFFEE.slice(0, -10));
  assert.equal(bad.pay.textContent, 'Pay');
});

test('changing the amount asks again', async () => {
  const s = openSheet();
  await amountless(s, 10000);
  await s.pay.fire('click');
  assert.equal(s.pay.textContent, 'Pay 10000 sats');
  s.amount.value = '100000';
  await s.amount.fire('input');
  assert.equal(s.pay.textContent, 'Confirm amount above', 'a confirmation for one amount is not one for another');
  await s.pay.fire('click');
  assert.deepEqual(s.paid, []);
  await s.pay.fire('click');
  assert.deepEqual(s.paid, [{ inv: DONATION, msat: 100000000 }]);
});

test('leaving it asks again', async () => {
  const s = openSheet();
  await amountless(s, 50000);
  await s.pay.fire('click');
  assert.equal(s.pay.textContent, 'Pay 50000 sats');
  s.fireTimers(); // the window lapses
  assert.equal(s.pay.textContent, 'Confirm amount above');
  await s.pay.fire('click');
  assert.deepEqual(s.paid, []);
});

test('BESIDE AN AMOUNT FIELD THE BUTTON ASKS WITH A SHORT WORD, AND KEEPS ITS OWN LABEL AFTER', () => {
  // The four zap and offer buttons share a row with the amount field, where "Confirm
  // amount above" would squeeze them: they ask with "Confirm" and pay under their label.
  const ctx = { Date, setTimeout: () => 0, clearTimeout() {} };
  vm.createContext(ctx);
  const largeSendGate = vm.runInContext(`${GATE}\nlargeSendGate`, ctx);
  const send = el('button', { textContent: 'Send zap', className: 'primary' });
  let sats = 20000;
  const gate = largeSendGate(send, { sats: () => sats, label: () => 'Send zap', confirmLabel: 'Confirm' });
  gate.paint();
  assert.equal(send.textContent, 'Confirm');
  assert.ok(send.cls.has('secondary'));
  assert.equal(gate.pass(20000), false);
  assert.equal(send.textContent, 'Send zap');
  assert.ok(send.cls.has('primary'));
  assert.equal(gate.pass(20000), true);
  sats = 21;
  gate.paint();
  assert.equal(send.textContent, 'Send zap', 'a small zap never asks');
  assert.equal(gate.pass(21), true);
});

test('EVERY SEND THE PANEL MAKES GOES THROUGH A GATE, BEFORE ANYTHING IS SPENT', () => {
  const bare = source.replace(/^\s*\/\/.*$/gm, '');
  const gates = (bare.match(/const (\w+) = largeSendGate\((\w+),/g) || []).map((g) => g.match(/largeSendGate\((\w+)/)[1]).sort();
  // The Send sheet, the CLINK offer, the profile zap, the notification zap, the creator zap.
  assert.deepEqual(gates, ['offerPay', 'pay', 'send', 'send', 'send']);
  // Each gate is repainted when its amount changes, or it could not ask before a press.
  assert.equal((bare.match(/\.addEventListener\('input', (refreshPay|\w+Gate\.paint)\)/g) || []).length, 5);
  // And every payInvoice in the panel sits after a pass() in its handler.
  const handlers = bare.split(/addEventListener\('click'/).slice(1);
  let checked = 0;
  for (const hnd of handlers) {
    const body = hnd.slice(0, hnd.indexOf('\n      });'));
    const payAt = body.indexOf('.payInvoice(');
    if (payAt === -1) continue;
    checked++;
    const passAt = body.search(/\w+Gate\.pass\(/);
    assert.ok(passAt !== -1 && passAt < payAt, 'a payInvoice with no large-send gate before it:\n' + body.slice(0, 200));
  }
  assert.ok(checked >= 4, 'found ' + checked + ' paying handlers');
});

test('a preset chip tells the amount field, the way typing does', () => {
  // Setting .value fires nothing, so without this a chip could put 21,000 in the field
  // beside a button still reading "Send zap".
  assert.match(liftFn('function zapPresetRow('), /amountEl\.value = String\(n\);[\s\S]{0,300}amountEl\.dispatchEvent\(new Event\('input'\)\);/);
});

test('AN EXPIRED INVOICE IS SAID TO BE EXPIRED, AND IS NOT PAID', async () => {
  const s = openSheet({ now: SIGNED_AT + 61 });
  await s.paste(COFFEE);
  assert.ok(s.card.cls.has('failed'));
  assert.match(textOf(s.card), /This invoice has expired/);
  await s.pay.fire('click');
  assert.deepEqual(s.paid, [], 'nothing reached the wallet');
  assert.match(s.err.textContent, /expired/);
});

test('an invoice that expires while the sheet sits open is refused at Pay', async () => {
  // Pay reads the clock again rather than trusting the card, so an invoice that lapsed
  // after it was pasted is still refused: here the value is set without a paste event.
  const late = openSheet({ now: SIGNED_AT + 3600 });
  late.input.value = COFFEE;
  await late.pay.fire('click');
  assert.deepEqual(late.paid, []);
});

test('AN UNREADABLE PASTE SAYS SO AND IS NOT PAID', async () => {
  const s = openSheet();
  await s.paste(COFFEE.slice(0, -10));
  assert.ok(s.card.cls.has('failed'));
  assert.match(textOf(s.card), /doesn't read correctly/);
  await s.pay.fire('click');
  assert.deepEqual(s.paid, []);
  // Said in words at Pay too, not left to fall through to whatever a null decode throws.
  assert.match(s.err.textContent, /doesn't read correctly/);
});

test('AN AMOUNTLESS INVOICE ASKS FOR THE AMOUNT, AND PASSES IT TO THE WALLET', async () => {
  const s = openSheet({ now: SIGNED_AT + 10 });
  await s.paste(DONATION);
  assert.ok(!s.amount.cls.has('hidden'), 'the amount field appears');
  assert.match(textOf(s.card), /No amount set/);
  await s.pay.fire('click');
  assert.deepEqual(s.paid, [], 'not paid without an amount');
  assert.match(s.err.textContent, /no amount/i);
  s.amount.value = '21';
  await s.pay.fire('click');
  assert.deepEqual(s.paid, [{ inv: DONATION, msat: 21000 }]);
});

// ---- an invoice this Sidecar has already paid ---------------------------------------------

const settle = () => new Promise((r) => setImmediate(r));

test('AN INVOICE THIS SIDECAR ALREADY PAID SAYS SO, AND IS NOT PAID AGAIN', async () => {
  const s = openSheet({ payStore: { [COFFEE]: { ts: 1, paid: true } } });
  await s.paste(COFFEE);
  await settle(); // the record is looked up after the card is drawn
  assert.ok(s.card.cls.has('failed'));
  assert.match(textOf(s.card), /This invoice has already been paid/);
  assert.equal(s.pay.textContent, 'Pay', 'and no amount is offered on the button');
  await s.pay.fire('click');
  await s.pay.fire('click');
  assert.deepEqual(s.paid, [], 'nothing reached the wallet');
  assert.match(s.err.textContent, /already been paid/);
});

test('a payment made here is recorded, so pasting it again is caught', async () => {
  const s = openSheet();
  await amountless(s, 21);
  await s.pay.fire('click');
  assert.equal(s.paid.length, 1);
  assert.ok(s.payStore[DONATION] && s.payStore[DONATION].paid, 'recorded even with no note and no fee');
  const again = openSheet({ payStore: s.payStore });
  await again.paste(DONATION.toUpperCase()); // the same invoice, whatever its case
  await settle();
  assert.match(textOf(again.card), /already been paid/);
});

test('an invoice never paid here is not flagged', async () => {
  const s = openSheet({ payStore: { [DONATION]: { ts: 1 } } });
  await s.paste(COFFEE);
  await settle();
  assert.doesNotMatch(textOf(s.card), /already been paid/);
});

// ---- the wallet's own refusals ------------------------------------------------------------

test('A WALLET\'S ERROR READS AS A SENTENCE', () => {
  // Wallets word their errors for logs, and the text goes straight to a toast.
  const nwc = fs.readFileSync(path.join(__dirname, '..', 'nwc-client.js'), 'utf8');
  const at = nwc.indexOf('function asSentence(');
  const body = nwc.slice(at, nwc.indexOf('\n    }\n', at) + 6);
  // eslint-disable-next-line no-new-func
  const asSentence = new Function(`${body}\nreturn asSentence;`)();
  assert.equal(asSentence('this invoice has already been paid'), 'This invoice has already been paid.');
  assert.equal(asSentence('Insufficient balance!'), 'Insufficient balance!', 'already a sentence');
  assert.equal(asSentence('  route not found  '), 'Route not found.');
  assert.match(nwc, /new Error\(res\.error\.message \? asSentence\(res\.error\.message\) : res\.error\.code \|\| 'Wallet error'\)/,
    'applied where every wallet error is made, and not to a bare code');
});
