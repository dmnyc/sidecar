'use strict';

// "Bitcoin only (no local currency)": a switch in Settings and on the wallet screen that
// takes local currency out of the panel. With it on, tapping the balance cycles sats and
// BTC, no exchange rate is fetched, and the chart button, whose chart is priced in that
// currency, answers in the card instead for a few seconds: "Bitcoin only" over
// "1 BTC = 1 BTC" over "∞/21M", at the card's own height. The chosen currency is kept, so switching back restores it.
//
// "No rate is fetched" is the claim worth running rather than reading: the three things
// that fetch one are the balance cycle landing on fiat, a currency change while fiat is
// showing, and the chart. The cycle is executed below with a counting getBtcPrice.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { withI18n } = require('./helpers/i18n.js');

const ROOT = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'sidepanel.html'), 'utf8');

function liftFn(decl) {
  const at = source.indexOf(decl);
  if (at === -1) throw new Error('Could not find ' + decl + ' in sidepanel.js');
  const open = source.indexOf('{', source.indexOf(')', at));
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(at, i + 1);
  }
  throw new Error('Unbalanced braces after ' + decl);
}

function cycler(fiatOff) {
  const ctx = withI18n({ fetched: 0, painted: 0, fiatOff, fiatCurrency: 'EUR' });
  vm.createContext(ctx);
  vm.runInContext([
    source.match(/const DENOM_ORDER = \[[^\]]*\];/)[0],
    'var denom = "sats";',
    'async function getBtcPrice() { fetched++; return 50000; }',
    'function repaintBalances() { painted++; }',
    'function toast() {}',
    'function endBtcJoke() {}',
    liftFn('async function cycleDenom('),
    'globalThis.cycleDenom = cycleDenom; globalThis.denomNow = () => denom;',
  ].join('\n'), ctx);
  return ctx;
}

test('BITCOIN ONLY CYCLES SATS AND BTC, AND NEVER ASKS FOR A RATE', async () => {
  const ctx = cycler(true);
  const seen = [];
  for (let i = 0; i < 6; i++) { await ctx.cycleDenom(); seen.push(ctx.denomNow()); }
  assert.deepEqual(seen, ['btc', 'sats', 'btc', 'sats', 'btc', 'sats']);
  assert.equal(ctx.fetched, 0, 'a rate was fetched with local currency off');
});

test('with local currency on, the cycle still reaches it and fetches its rate', async () => {
  const ctx = cycler(false);
  const seen = [];
  for (let i = 0; i < 3; i++) { await ctx.cycleDenom(); seen.push(ctx.denomNow()); }
  assert.deepEqual(seen, ['btc', 'fiat', 'sats']);
  assert.equal(ctx.fetched, 1);
});

test('both copies of the switch exist and write the same setting', () => {
  assert.match(html, /<input type="checkbox" id="fiat-off-toggle" \/> <span data-i18n="Bitcoin only \(no local currency\)">/);
  const picker = liftFn('function renderFiatPicker(');
  assert.match(picker, /id: 'wallet-fiat-off-toggle'/);
  assert.match(picker, /addEventListener\('change', \(e\) => setFiatOff\(e\.target\.checked\)\)/);
  assert.match(source, /\$\('fiat-off-toggle'\)\.addEventListener\('change', \(e\) => setFiatOff\(e\.target\.checked\)\)/);
  assert.match(liftFn('async function setFiatOff('), /settings: \{ fiatDisabled: fiatOff \}/);
  assert.match(source, /fiatOff = !!\(settings && settings\.fiatDisabled === true\);/, 'the stored setting is not read back');
});

test('AN OPEN CHART CLOSES, AND A FIAT BALANCE FALLS BACK TO SATS', () => {
  const sync = liftFn('function syncFiatControls(');
  assert.match(sync, /card\.classList\.remove\('chart-open'\)/);
  assert.match(sync, /if \(fiatOff && denom === 'fiat'\) \{\s*denom = 'sats';\s*repaintBalances\(\);/);
  assert.match(sync, /if \(!fiatOff\) endBtcJoke\(true\);/, 'switching local currency back on leaves the joke up');
});

test('the chart button stays, and in Bitcoin-only mode it tells the joke instead of fetching', () => {
  assert.match(source, /className: 'wallet-chart-btn', title: chartBtnTitle\(\) \}/);
  assert.match(source, /if \(fiatOff\) \{ showBtcJoke\(card\); return; \}/,
    'the button fetches a fiat chart with local currency off');
  assert.doesNotMatch(source, /wallet-chart-btn' \+ \(fiatOff \? ' hidden'/, 'the button is hidden again');
});

// ---- the joke, run ---------------------------------------------------------------

function jokeRig() {
  const el = (cls, text) => {
    const classes = new Set(cls ? [cls] : []);
    const o = {
      _text: text, children: [], isConnected: true,
      classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c) },
      dataset: {}, style: {},
      getBoundingClientRect: () => ({ height: 38.5 }),
      append(c) { o.children.push(c); },
      get textContent() { return o.children.length ? o.children.map((c) => c.textContent).join('') : o._text; },
      set textContent(v) { o._text = v; o.children = []; },
    };
    return o;
  };
  const bal = el('wallet-balance', '21,000');
  const unit = el('wallet-unit', 'sats');
  const label = el('wallet-bal-label', 'Balance');
  const pick = (q) => (q === '.wallet-balance' ? bal : q === '.wallet-unit' ? unit : q === '.wallet-bal-label' ? label : null);
  const card = { querySelector: pick };
  const timers = [];
  const ctx = withI18n({
    bal, unit, label, card, fiatOff: true, repaints: 0,
    h: (tag, props) => el(props && props.className, ''),
    setTimeout: (fn, ms) => { timers.push({ fn, ms, live: true }); return timers.length - 1; },
    clearTimeout: (id) => { if (timers[id]) timers[id].live = false; },
    splitGlyphs: (target, text) => { target.textContent = text; },
    document: { querySelector: pick },
    $: () => null,
  });
  vm.createContext(ctx);
  vm.runInContext([
    source.match(/const paintedSats = new Map\(\);/)[0],
    liftFn('function balanceSlot('),
    liftFn('function forgetBalancePaint('),
    source.match(/const isBalanceErrorUnit = [^\n]+/)[0],
    source.match(/const BTC_JOKE_MS = \d+;/)[0],
    'let btcJoke = null;',
    source.match(/const btcJokeShowing = [^\n]+/)[0],
    liftFn('function showBtcJoke('),
    liftFn('function endBtcJoke('),
    // The real repaint's guard, with the painting itself counted rather than done.
    'function repaintBalances() { if (btcJokeShowing(document.querySelector(".wallet-balance"))) return; repaints++; bal.textContent = "21,000"; unit.textContent = "sats"; }',
    'paintedSats.set("wallet", { pubkey: "pk", key: "21000" });',
    'globalThis.api = { showBtcJoke, endBtcJoke, repaintBalances, rec: () => paintedSats.get("wallet") };',
  ].join('\n'), ctx);
  return { ctx, bal, unit, label, card, timers };
}

test('THE CHART BUTTON SAYS BITCOIN ONLY, 1 BTC = 1 BTC, ∞/21M, THEN THE CARD COMES BACK UNSTRUCK', () => {
  const { ctx, bal, unit, label, card, timers } = jokeRig();
  ctx.api.showBtcJoke(card);
  assert.equal(label.textContent, 'Bitcoin only');
  assert.equal(bal.textContent, '1 BTC = 1 BTC');
  assert.equal(unit.textContent, '∞/21M');
  assert.ok(bal.classList.contains('btc-joke'));
  assert.ok(bal.children[0].classList.contains('btc-joke-text'), 'the figure is not in its own span, so the line resizes');
  // Held at the height it had, so the card cannot move in any face.
  assert.equal(bal.style.height, '38.5px', 'the figure is not held at its height');
  assert.equal(timers[0].ms, 3000);

  // A refresh landing mid-joke waits for it. The rig's repaint copies the real one's
  // guard, so the real one is held to having it.
  assert.match(liftFn('function repaintBalances('),
    /const cardBal = document\.querySelector\('\.wallet-balance'\);\s*if \(btcJokeShowing\(cardBal\)\) return;/,
    'the real repaint no longer waits for the joke');
  ctx.api.repaintBalances();
  assert.equal(ctx.repaints, 0, 'a repaint cut the joke short');
  assert.equal(bal.textContent, '1 BTC = 1 BTC');

  timers[0].fn();
  assert.equal(ctx.repaints, 1);
  assert.equal(bal.textContent, '21,000');
  assert.equal(unit.textContent, 'sats');
  assert.equal(label.textContent, 'Balance');
  assert.ok(!bal.classList.contains('btc-joke'));
  assert.equal(bal.style.height, '', 'the balance stays pinned at the joke\'s height');
  // The record from before the joke is back, so the figure does not strike as if the
  // balance had changed.
  assert.deepEqual({ ...ctx.api.rec() }, { pubkey: 'pk', key: '21000' });
});

test('a second tap on the chart button brings the balance back at once', () => {
  const { ctx, bal, card, timers } = jokeRig();
  ctx.api.showBtcJoke(card);
  ctx.api.showBtcJoke(card);
  assert.equal(bal.textContent, '21,000');
  assert.equal(ctx.repaints, 1);
  assert.equal(timers[0].live, false, 'the timer would repaint a second time');
});

test('the joke is translated whole, and shows through Hide balances', () => {
  const fn = liftFn('function showBtcJoke(');
  assert.match(fn, /t\('\{\{amount\}\} BTC = \{\{amount\}\} BTC', \{ amount: I18N\.fmtNum\(1\) \}\)/);
  assert.match(fn, /t\('Bitcoin only'\)/);
  assert.match(fn, /t\('∞\/\{\{supply\}\}', \{ supply: I18N\.fmtNum\(21000000, \{ notation: 'compact' \}\) \}\)/);
  const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
  // Smaller on the inner span only: the balance element keeps its size, so its line
  // keeps its height and the card does not move.
  assert.match(css, /html \.wallet-balance\.btc-joke \.btc-joke-text \{ font-size: 0\.8em; \}/);
  assert.doesNotMatch(css, /\.wallet-balance\.btc-joke \{[^}]*font-size/, 'the balance element itself shrinks, and the card with it');
  // Smaller text on the full-size line's baseline rides low; centered in the held box.
  assert.match(css, /html \.wallet-balance\.btc-joke \{[^}]*display: flex; align-items: center; justify-content: center;/,
    'the joke sits on the baseline instead of centered');
  assert.match(css, /html \.balances-hidden \.wallet-balance\.btc-joke::after \{ content: none; \}/);
  assert.match(css, /html \.balances-hidden \.wallet-balance\.btc-joke \{ visibility: visible; \}/);
});

test('the currency choice is hidden, not cleared, so switching back restores it', () => {
  const sync = liftFn('function syncFiatControls(');
  assert.match(sync, /\['fiat-select', 'wallet-fiat-select'\]\.forEach[\s\S]*?classList\.toggle\('hidden', fiatOff\)/);
  assert.doesNotMatch(liftFn('async function setFiatOff('), /fiatCurrency\s*=/, 'turning local currency off overwrote the chosen currency');
});

test('each hint is its own translated sentence, shown or hidden rather than rewritten', () => {
  // Rewriting one element's text from script would lose to data-i18n, which the page
  // applies after load. Two elements, each translated, one visible.
  assert.match(html, /class="hint fiat-off-hint hidden" data-i18n="Tap your balance to switch between sats and BTC\. No exchange rate is fetched\."/);
  assert.match(html, /class="hint fiat-on-hint" data-i18n=/);
  const picker = liftFn('function renderFiatPicker(');
  assert.match(picker, /className: 'hint fiat-off-hint hidden',\s*textContent: t\('Tap your balance to switch between sats and BTC\. No exchange rate is fetched\.'\)/);
});
