'use strict';

// A website payment pays from the account the site is bound to. The payment card used to
// offer no way to change that, so paying from the account you had just switched to meant
// rejecting, finding the site in Settings and starting again. The card can now offer the
// other accounts that have a wallet, pay this one payment from one of them, and, if asked,
// keep the site on it. These run the real payInvoiceLocked and the real choice validator
// with the wallet, the prompt and the storage faked.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8');

function lift(decl) {
  const at = src.indexOf(decl);
  assert.ok(at !== -1, decl + ' is gone');
  let depth = 0;
  for (let i = src.indexOf('{', at); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(at, i + 1);
  }
  throw new Error('unbalanced ' + decl);
}

const A = 'a'.repeat(64); // the account the site is bound to
const B = 'b'.repeat(64); // the account the person switched to, with a wallet
const C = 'c'.repeat(64); // an account with no wallet
const INVOICE = 'lnbc10n1pjtest';

// Everything payInvoiceLocked touches, recorded.
function harness(decide, wallet) {
  const calls = { wallets: [], prompts: [], bound: [], budgets: [], relax: [], logged: [], binding: A, order: [] };
  const accounts = [{ pubkey: A, name: 'Alice' }, { pubkey: B, name: 'Bob' }, { pubkey: C, name: 'Cara' }];
  const wallets = new Set([A, B]);
  const ctx = vm.createContext({
    Promise, Date, Error, String, RegExp, Array, Object, JSON, setTimeout,
    self: { NostrTools: { nip19: { npubEncode: (pk) => 'npub-' + pk.slice(0, 4) } } },
    chrome: { runtime: { sendMessage: () => Promise.resolve() } },
    LARGE_SEND_SATS: 100000, AUTOZAP_DEFAULT_MAX: 1000, AUTOZAP_DAILY_MULTIPLE: 5,
    invoiceSats: () => 21,
    sget: async () => ({ sidecar_settings: {} }),
    sset: async () => {}, pushPageSettings() {},
    autoZapLimits: () => ({ perZap: 0, daily: 0 }), autoZapWindow: async () => ({ spent: 0 }), recordAutoZap: async () => {},
    ZAPREQ: { labelFor: async () => null, claim: async () => false },
    BUDGETS: { covers: async () => false, setBudget: async (pk, host, b) => { calls.budgets.push(['set', pk, host, b.budgetSats]); }, consume: async (pk, host, n) => { calls.budgets.push(['consume', pk, host, n]); } },
    KS: {
      isLocked: () => false,
      getState: async () => ({ accounts }),
      hasNwc: async (pk) => wallets.has(pk),
    },
    openPrompt: async (data) => { calls.prompts.push(data); return decide(data); },
    getSwNwc: async (pk) => {
      if (!wallets.has(pk)) return null;
      calls.wallets.push(pk); calls.order.push('wallet');
      return { payInvoice: async () => { if (wallet && wallet.refuses) { const e = new Error('The transaction requested was not found.'); e.walletDenied = true; throw e; } return { preimage: 'ff' }; } };
    },
    payAndConfirm: async (c, o) => { const r = await o.send(); return r; },
    bolt11PaymentHash: () => '', notifyTabAuthorized() {}, notifyTabsPaidByHost: async () => {}, bumpAutoLock() {},
    settleTail: (fn) => fn(), savePayMetaEntry: async () => {},
    getSiteAccount: async () => calls.binding,
    setSiteAccount: async (host, pk) => { calls.order.push('bind'); calls.bound.push([host, pk]); calls.binding = pk; },
    RELAX: { revokeForHost: async (h) => { calls.relax.push(h); } }, syncRelaxBadge() {},
    logActivity: (e) => calls.logged.push(e),
    tellPanelPayment() {}, // the payment bar's broadcast (#495), once that exists
    explainRefusal: async (e) => e, // the refusal wording (separate change), once that exists
  });
  vm.runInContext(lift('function payFromChoice(') + '\n' + lift('async function payInvoiceLocked(') + '\nthis.pay = payInvoiceLocked; this.payFromChoice = payFromChoice;', ctx);
  return { ctx, calls, pay: (opts) => ctx.pay(INVOICE, 'shop.example', A, undefined, undefined, false, opts) };
}
const settle = () => new Promise((r) => setTimeout(r, 5));

test('the card offers the other accounts that have a wallet, and only those', async () => {
  const h = harness(() => ({ action: 'once' }));
  await h.pay();
  const offered = JSON.parse(JSON.stringify(h.calls.prompts[0].payFromOptions));
  assert.deepEqual(offered.map((a) => a.pubkey), [B], 'Cara has no wallet and must not be offered; Alice already pays');
  assert.equal(h.calls.prompts[0].payFromOptions[0].name, 'Bob');
});

test('no pick: the site\'s own account pays and stays bound, as before', async () => {
  const h = harness(() => ({ action: 'once' }));
  await h.pay(); await settle();
  assert.deepEqual(h.calls.wallets, [A]);
  assert.deepEqual(h.calls.bound, [['shop.example', A]]);
  assert.equal(h.calls.logged[0].pubkey, A);
});

test('a one-time pick pays from that account and leaves the site bound to the old one', async () => {
  const h = harness(() => ({ action: 'once', payFromPubkey: B }));
  await h.pay(); await settle();
  assert.deepEqual(h.calls.wallets, [B], 'the wallet of the account picked must be the one that pays');
  assert.deepEqual(h.calls.bound, [], 'a one-time pick must not re-pair the site');
  assert.equal(h.calls.logged[0].pubkey, B, 'the activity log names the account that paid');
  assert.deepEqual(h.calls.budgets.filter((b) => b[0] === 'consume').map((b) => b[1]), [B]);
});

test('"all further payments" pairs the site with the account picked and ends the old Auto-sign window', async () => {
  const h = harness(() => ({ action: 'once', payFromPubkey: B, bindPayer: true }));
  await h.pay(); await settle();
  assert.deepEqual(h.calls.wallets, [B]);
  assert.deepEqual(h.calls.bound, [['shop.example', B]]);
  assert.deepEqual(h.calls.relax, ['shop.example'], 'the old pairing\'s timed Auto-sign window must not carry over');
});

test('"all further payments" stands even when the wallet then refuses the payment', async () => {
  const h = harness(() => ({ action: 'once', payFromPubkey: B, bindPayer: true }), { refuses: true });
  await assert.rejects(() => h.pay(), /not found/);
  await settle();
  assert.deepEqual(h.calls.bound, [['shop.example', B]], 'an already-paid invoice threw away the person\'s choice of account');
  assert.deepEqual(h.calls.relax, ['shop.example']);
});

test('the choice is applied when the card is approved, before the wallet is called', async () => {
  const h = harness(() => ({ action: 'once', payFromPubkey: B, bindPayer: true }));
  await h.pay(); await settle();
  assert.deepEqual(h.calls.order, ['bind', 'wallet']);
});

test('a one-time pick whose payment fails changes nothing about the site', async () => {
  const h = harness(() => ({ action: 'once', payFromPubkey: B }), { refuses: true });
  await assert.rejects(() => h.pay(), /not found/);
  await settle();
  assert.deepEqual(h.calls.bound, []);
});

test('rejecting never keeps the pick, ticked or not', async () => {
  const h = harness(() => ({ action: 'reject', payFromPubkey: B, bindPayer: true }));
  await assert.rejects(() => h.pay(), /rejected/);
  await settle();
  assert.deepEqual(h.calls.bound, []);
});

test('a pick the card did not offer pays as the site\'s own account', async () => {
  for (const bad of [C, 'd'.repeat(64), 'not-a-key', undefined, null, 42, A]) {
    const h = harness(() => ({ action: 'once', payFromPubkey: bad, bindPayer: true }));
    await h.pay(); await settle();
    assert.deepEqual(h.calls.wallets, [A], 'a decision naming ' + String(bad) + ' must not change who pays');
    assert.deepEqual(h.calls.bound, [['shop.example', A]], 'and must not bind to it');
  }
});

test('a budget chosen after a pick belongs to the account that pays', async () => {
  const h = harness(() => ({ action: 'budget', budgetSats: 500, perPaymentSats: 100, payFromPubkey: B }));
  await h.pay(); await settle();
  assert.deepEqual(h.calls.budgets.filter((b) => b[0] === 'set'), [['set', B, 'shop.example', 500]]);
});

test('rejecting still rejects, whatever was picked', async () => {
  const h = harness(() => ({ action: 'reject', payFromPubkey: B }));
  await assert.rejects(() => h.pay(), /rejected/);
  assert.deepEqual(h.calls.wallets, []);
});

// ---- the cards ---------------------------------------------------------------------------
//
// The panel's card and the popup window each draw the account, the way to pick another, and
// the keep-this-account box. These run the real panel renderer and menu, and both surfaces'
// decision flags.

const panelSrc = fs.readFileSync(path.join(__dirname, '..', 'sidepanel.js'), 'utf8');
const popupSrc = fs.readFileSync(path.join(__dirname, '..', 'prompt.js'), 'utf8');
function liftFrom(source, decl) {
  const at = source.indexOf(decl);
  assert.ok(at !== -1, decl + ' is gone');
  let depth = 0;
  for (let i = source.indexOf('{', at); i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(at, i + 1);
  }
  throw new Error('unbalanced ' + decl);
}

const PAY_DATA = {
  scope: 'webln', method: 'sendPayment', host: 'shop.example', amountSats: 21,
  payerPubkey: A, npub: 'npub-A', accountName: 'Alice', accountPicture: '',
  payFromOptions: [{ pubkey: B, npub: 'npub-B', name: 'Bob', picture: '' }],
};

function fakeEl() {
  const el = { children: [], classes: new Set(['hidden']), textContent: '', checked: false, handlers: {}, dataset: {} };
  el.classList = { add: (c) => el.classes.add(c), remove: (c) => el.classes.delete(c), contains: (c) => el.classes.has(c) };
  el.append = (...k) => { el.children.push(...k); };
  el.addEventListener = (t, f) => { el.handlers[t] = f; };
  Object.defineProperty(el, 'innerHTML', { get: () => '', set: () => { el.children = []; } });
  return el;
}
function panelCard(data) {
  const els = {};
  const $ = (id) => (els[id] || (els[id] = fakeEl()));
  const pendingApproval = { id: 'x', data, chosenPubkey: null };
  const ctx = vm.createContext({
    $, pendingApproval, data,
    h: (tag, props, kids) => { const e = fakeEl(); Object.assign(e, props || {}); if (kids) e.append(...kids); return e; },
    avatarEl: () => fakeEl(), applyAvatar() {}, icon: () => fakeEl(),
    t: (s, v) => (v ? s.replace(/\{\{(\w+)\}\}/g, (_, k) => v[k]) : s), tSec: (s) => s,
    shortNpub: (n) => String(n).slice(0, 8), show: (e) => e.classList.remove('hidden'), hide: (e) => e.classList.add('hidden'),
    document: { createElement: () => fakeEl() },
  });
  vm.runInContext([
    'const isPaymentApproval = ' + panelSrc.match(/const isPaymentApproval = (\(data\) =>\s*[^;]*);/)[1] + ';',
    liftFrom(panelSrc, 'function approvalAccountList('), liftFrom(panelSrc, 'function approvalPayList('),
    liftFrom(panelSrc, 'function renderApprovalAccountCapsule('), liftFrom(panelSrc, 'function buildApprovalSwitchMenu('),
    liftFrom(panelSrc, 'function payFromExtra('),
    'this.render = renderApprovalAccountCapsule; this.menu = buildApprovalSwitchMenu; this.extra = payFromExtra; this.list = approvalPayList;',
  ].join('\n'), ctx);
  return { ctx, $, pendingApproval };
}

test('panel: the payment card offers a way to pick another account, worded for paying', () => {
  const c = panelCard(PAY_DATA);
  c.ctx.render(PAY_DATA);
  const toggle = c.$('approval-switch-toggle');
  assert.equal(toggle.classes.has('hidden'), false, 'no way to pick another account on a payment card');
  assert.equal(toggle.textContent, 'Pay from a different account');
  assert.equal(c.$('approval-bind-payer').classes.has('hidden'), true, 'the keep-it box appears only after a pick');
});

test('panel: picking an account shows who pays, offers the keep-it box worded "all further payments", unticked', () => {
  const c = panelCard(PAY_DATA);
  c.ctx.render(PAY_DATA);
  c.ctx.menu(PAY_DATA, c.ctx.list(PAY_DATA), A);
  const rows = c.$('approval-switch-menu').children;
  assert.equal(rows.length, 2, 'the card\'s own account and the one offered');
  c.$('approval-bind-payer-box').checked = true; // a leftover tick must not survive a new pick
  rows[1].handlers.click();
  assert.equal(c.pendingApproval.payFrom, B);
  assert.equal(c.$('approval-bind-payer').classes.has('hidden'), false);
  assert.equal(c.$('approval-bind-payer-label').textContent, 'Use Bob for all further payments on this site');
  assert.equal(c.$('approval-bind-payer-box').checked, false, 'a leftover tick carried into a new pick');
  // Back to the card's own account: no pick, no box.
  c.ctx.menu(PAY_DATA, c.ctx.list(PAY_DATA), B);
  c.$('approval-switch-menu').children[0].handlers.click();
  assert.equal(c.pendingApproval.payFrom, null);
  assert.equal(c.$('approval-bind-payer').classes.has('hidden'), true);
});

test('panel: a card with no other account that has a wallet offers nothing', () => {
  const noOptions = Object.assign({}, PAY_DATA, { payFromOptions: [] });
  const c = panelCard(noOptions);
  c.ctx.render(noOptions);
  assert.equal(c.$('approval-switch-toggle').classes.has('hidden'), true);
});

test('panel and popup: the decision carries the pick and the keep-it choice, never on reject', () => {
  const c = panelCard(PAY_DATA);
  const pick = { payFrom: B };
  assert.deepEqual(JSON.parse(JSON.stringify(c.ctx.extra(PAY_DATA, pick, 'once', false))), { payFromPubkey: B, bindPayer: false });
  assert.deepEqual(JSON.parse(JSON.stringify(c.ctx.extra(PAY_DATA, pick, 'once', true))), { payFromPubkey: B, bindPayer: true });
  assert.equal(c.ctx.extra(PAY_DATA, pick, 'reject', true), null);
  assert.equal(c.ctx.extra(PAY_DATA, { payFrom: null }, 'once', true), null, 'no pick, nothing sent');
  assert.equal(c.ctx.extra({ scope: 'nostr', method: 'signEvent', payerPubkey: A }, pick, 'once', true), null, 'only payment cards send it');

  // The popup's own copy.
  let state = { isPayment: true, data: PAY_DATA, payFrom: B, els: { bindPayerBox: { checked: true } } };
  const pctx = vm.createContext(state);
  vm.runInContext(liftFrom(popupSrc, 'function payFromExtra(') + '\nthis.f = payFromExtra;', pctx);
  assert.deepEqual(JSON.parse(JSON.stringify(pctx.f('once'))), { payFromPubkey: B, bindPayer: true });
  assert.equal(pctx.f('reject'), null);
  pctx.payFrom = null;
  assert.equal(pctx.f('once'), null);
});

test('both surfaces send the flags through, and the worker still never takes one from a page', () => {
  const strip = (s) => s.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  assert.match(strip(panelSrc), /const payFromFlags = payFromExtra\(data, pendingApproval, action, \$\('approval-bind-payer-box'\)\.checked\);\s*if \(payFromFlags\) extra = Object\.assign\(\{\}, extra, payFromFlags\);/);
  assert.match(strip(popupSrc), /const payFromFlags = payFromExtra\(action\);\s*if \(payFromFlags\) extra = Object\.assign\(\{\}, extra, payFromFlags\);/);
  // The decision only ever comes from the card; the content-script allow-list must not carry it.
  const allow = src.match(/const CONTENT_OK = new Set\(\[[\s\S]*?\]\);/);
  assert.ok(allow && !/payFrom|SIDECAR_PROMPT_RESULT/.test(allow[0]), 'a page could now name the account that pays');
});

// The keep-this-account line wraps to two lines. Under the card's centered text, its words
// centered in the space the checkbox leaves and sat well away from it.
test('the keep-this-account line is left-aligned beside its box, on the panel and the popup', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
  const popup = fs.readFileSync(path.join(__dirname, '..', 'prompt.html'), 'utf8');
  for (const [name, source, selector] of [['styles.css', css, /#approval-bind-payer \.check\s*\{[^}]*\}/], ['prompt.html', popup, /#bind-payer \.check\s*\{[^}]*\}/]]) {
    const rule = source.match(selector);
    assert.ok(rule, name + ': the rule is gone');
    assert.match(rule[0], /text-align:\s*left/, name + ': the words are not left-aligned');
    assert.match(rule[0], /align-items:\s*flex-start/, name + ': the box is not on the first line');
  }
});
