'use strict';

// ONE SIGNING ACCOUNT AT A TIME, unless Settings keeps a timer for each account. Two
// accounts each able to sign without asking is how a multi-account client's slot mix-up
// goes out under the wrong account with no card, so by default switching accounts, posting
// on a site as another account, and opening a window for another account all end the
// other account's windows. With "Keep a 30-minute timer for each account" on, none of them does
// (lab cases 4.5 and 4.6). The handlers are run here, lifted from background.js.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8');

function liftBlock(from) {
  const at = src.indexOf(from);
  assert.ok(at !== -1, from + ' is gone');
  let depth = 0;
  for (let i = src.indexOf('{', at); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(at, i + 1);
  }
  throw new Error('unbalanced ' + from);
}

function relaxSpy() {
  const calls = [];
  return {
    calls,
    RELAX: {
      revokeAll: async () => { calls.push('revokeAll'); },
      revokeForHost: async (h) => { calls.push('revokeForHost:' + h); },
      revoke: async (h, pk) => { calls.push('revoke:' + h + '|' + pk); },
    },
  };
}

test('switching accounts ends every window by default, and keeps them with a timer per account', async () => {
  for (const [perAccount, want] of [[false, ['revokeAll']], [true, []]]) {
    const { calls, RELAX } = relaxSpy();
    let active = 'A';
    const ctx = {
      RELAX, syncRelaxBadge() {}, relaxPerAccount: async () => perAccount,
      KS: { getActivePubkey: async () => active, setActive: async (pk) => { active = pk; return true; } },
      message: { type: 'SIDECAR_SET_ACTIVE', pubkey: 'B' },
    };
    vm.createContext(ctx);
    const body = liftBlock("case 'SIDECAR_SET_ACTIVE': {");
    const run = () => vm.runInContext(
      '(async () => { let result; switch (message.type) { ' + body + ' } return result; })()', ctx);
    assert.equal(await run(), true);
    assert.equal(active, 'B', 'the switch did not happen');
    assert.deepEqual(calls, want, 'per account ' + perAccount);
    // Tapping the account already active ends nothing, either way.
    calls.length = 0;
    await run();
    assert.deepEqual(calls, [], 're-tapping the active account ended a window');
  }
});

test('posting on a site as another account ends its windows by default, and keeps them with a timer per account', async () => {
  for (const perAccount of [false, true]) {
    for (const [method, sharedIdentity, authorSwitched] of [
      ['signEvent', true, false],      // picked the other account on the card
      ['signEvent', false, true],      // the client posted as the other author
      ['getPublicKey', false, false],  // re-login as the other account
    ]) {
      const { calls, RELAX } = relaxSpy();
      const binds = [];
      const ctx = {
        RELAX, syncRelaxBadge() {}, relaxJustGrantedFor: null, relaxPerAccount: async () => perAccount,
        method, sharedIdentity, authorSwitched, host: 'shared.example', activePubkey: 'B',
        getSiteAccount: async () => 'A',
        setSiteAccount: async (h, pk) => { binds.push(h + '|' + pk); },
      };
      vm.createContext(ctx);
      const block = liftBlock("if (method === 'getPublicKey' || authorSwitched || sharedIdentity || !(await getSiteAccount(host))) {");
      await vm.runInContext('(async () => { ' + block + ' })()', ctx);
      assert.deepEqual(binds, ['shared.example|B'], method + ': the site was not rebound');
      assert.deepEqual(calls, perAccount ? [] : ['revokeForHost:shared.example'], method + ', per account ' + perAccount);
      // Except the window this very request just opened for the account arriving.
      if (!perAccount) {
        const again = relaxSpy();
        ctx.RELAX = again.RELAX; ctx.relaxJustGrantedFor = 'B';
        await vm.runInContext('(async () => { ' + block + ' })()', ctx);
        assert.deepEqual(again.calls, [], method + ': the window just opened was ended');
      }
    }
  }
});

test('opening a window ends other accounts’ windows by default, and not with a timer per account', async () => {
  const at = src.indexOf("if (decision.action === 'relax') {");
  const block = liftBlock(src.slice(at), "if (decision.action === 'relax') {");
  for (const perAccount of [false, true]) {
    const calls = [];
    const ctx = {
      relaxPerAccount: async () => perAccount, syncRelaxBadge() {}, host: 'site.example', activePubkey: 'B',
      decision: { action: 'relax', relaxMs: 1800000 }, relaxJustGrantedFor: null,
      RELAX: { DEFAULT_MS: 1800000, revokeOtherAccounts: async (pk) => calls.push('revokeOtherAccounts:' + pk),
        grant: async (h, pk) => calls.push('grant:' + h + '|' + pk) },
    };
    vm.createContext(ctx);
    await vm.runInContext('(async () => { ' + block + ' })()', ctx);
    assert.deepEqual(calls, perAccount ? ['grant:site.example|B'] : ['revokeOtherAccounts:B', 'grant:site.example|B'], 'per account ' + perAccount);
  }
});

test('turning the setting off leaves only the active account’s windows', async () => {
  const at = src.indexOf("case 'SIDECAR_SET_SETTINGS': {");
  const body = liftBlock(src.slice(at), "case 'SIDECAR_SET_SETTINGS': {");
  for (const [before, after, want] of [[true, false, ['revokeOtherAccounts:A']], [false, true, []], [true, true, []]]) {
    const calls = [];
    let stored = { relaxPerAccount: before };
    const ctx = {
      message: { type: 'SIDECAR_SET_SETTINGS', settings: { relaxPerAccount: after } },
      sget: async () => ({ sidecar_settings: stored }), sset: async (o) => { stored = o.sidecar_settings; },
      RELAX: { revokeOtherAccounts: async (pk) => calls.push('revokeOtherAccounts:' + pk) },
      KS: { getActivePubkey: async () => 'A' }, syncRelaxBadge() {}, pushPageSettings() {},
      AUTOZAP_ABS_MAX: 1, AUTOZAP_ABS_DAILY_MAX: 1, chrome: { alarms: { clear: async () => {} } }, bumpAutoLock() {},
      self: {}, createPayMenu() {},
    };
    vm.createContext(ctx);
    await vm.runInContext('(async () => { let result; switch (message.type) { ' + body + ' } return result; })()', ctx);
    assert.deepEqual(calls, want, before + ' -> ' + after);
  }
});

test('lock and forgetting the site still end windows', () => {
  // The two that stay, by design: a lock removes the keys, and forgetting a site removes
  // every approval it had.
  assert.match(src, /A lock ends any active relax window[\s\S]{0,300}RELAX\.revokeAll\(\)\.then\(syncRelaxBadge\);/);
  assert.match(src, /await RELAX\.revokeForHost\(message\.host\); \/\/ and a timed Auto-sign window/);
});

// ---- the bar, the badge and Restart follow the active account's window ----------------

const sp = fs.readFileSync(path.join(__dirname, '..', 'sidepanel.js'), 'utf8');
const relaxSrc = fs.readFileSync(path.join(__dirname, '..', 'relax-grants.js'), 'utf8');

function liftFn(text, decl) {
  const at = text.indexOf(decl);
  assert.ok(at !== -1, decl + ' is gone');
  let depth = 0;
  for (let i = text.indexOf('{', at); i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) return text.slice(at, i + 1);
  }
  throw new Error('unbalanced ' + decl);
}

const W = (pubkey, host, mins) => ({ host, pubkey, expiresAt: 1e12 + mins * 60000, duration: 1800000 });
const grants = [W('A', 'a.example', 5), W('B', 'b.example', 20), W('B', 'c.example', 25)]; // soonest first

test('the panel and the background pick the same window: the active account’s, else the soonest', () => {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(liftFn(sp, 'function relaxPick(') + ';globalThis.pick = relaxPick;', ctx);
  const sandbox = { chrome: {}, self: {} };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(relaxSrc, sandbox);
  const shownFor = sandbox.SidecarRelax.shownFor;
  for (const [active, want] of [['B', 'b.example'], ['A', 'a.example'], ['C', 'a.example'], [null, 'a.example']]) {
    assert.equal(ctx.pick(grants, active).host, want, 'panel, active ' + active);
    assert.equal(shownFor(grants, active).host, want, 'background, active ' + active);
  }
  assert.equal(ctx.pick([], 'A'), null);
  assert.equal(shownFor([], 'A'), null);
});

test('Restart winds back the window the bar names, not the soonest', async () => {
  const at = src.indexOf("if (message.type === 'SIDECAR_RESTART_RELAX') {");
  const block = liftFn(src.slice(at), "if (message.type === 'SIDECAR_RESTART_RELAX') {");
  const granted = [];
  const ctx = {
    RELAX: { active: async () => grants, grant: async (h, pk, d) => { granted.push(h + '|' + pk + '|' + d); } },
    syncRelaxBadge() {}, message: { type: 'SIDECAR_RESTART_RELAX', host: 'b.example', pubkey: 'B' },
  };
  vm.createContext(ctx);
  await vm.runInContext('new Promise((done) => { const sendResponse = done; (() => { ' + block + ' })(); })', ctx);
  assert.deepEqual(granted, ['b.example|B|1800000']);
  // Named nothing (an older panel), it keeps the old rule.
  granted.length = 0; ctx.message = { type: 'SIDECAR_RESTART_RELAX' };
  await vm.runInContext('new Promise((done) => { const sendResponse = done; (() => { ' + block + ' })(); })', ctx);
  assert.deepEqual(granted, ['a.example|A|1800000']);
});

test('the bar names the active account, and +N opens a row for each other window', () => {
  const els = {};
  const mk = (tag) => {
    const e = { tag, children: [], attrs: {}, dataset: {}, style: {}, textContent: '', _cls: new Set(), listeners: {},
      classList: { toggle(c, on) { (on === undefined ? !e._cls.has(c) : on) ? e._cls.add(c) : e._cls.delete(c); }, contains: (c) => e._cls.has(c), add: (c) => e._cls.add(c), remove: (c) => e._cls.delete(c) },
      setAttribute(k, v) { e.attrs[k] = v; }, addEventListener(k, f) { e.listeners[k] = f; },
      replaceChildren(...k) { e.children = k; }, append(...k) { e.children.push(...k); },
      querySelector(sel) { const c = sel.slice(1); const walk = (n) => { for (const k of n.children || []) { if (k._cls && k._cls.has(c)) return k; const f = walk(k); if (f) return f; } return null; }; return walk(e); },
    };
    Object.defineProperty(e, 'innerHTML', { set() {} });
    return e;
  };
  const $ = (id) => els[id] || (els[id] = mk(id));
  $('relax-status-list')._cls.add('hidden'); $('relax-status-more')._cls.add('hidden');
  const h = (tag, props, kids) => { const e = mk(tag); for (const [k, v] of Object.entries(props || {})) { if (k === 'className') v.split(' ').forEach((c) => e._cls.add(c)); else if (k === 'textContent') e.textContent = v; else e.attrs[k] = v; } if (kids) e.children = kids; return e; };
  const ctx = {
    $, h, t: (s) => s, tn: (one, other, n) => (n === 1 ? one : other).replace('{{count}}', n),
    I18N: { fmtNum: String }, displayName: (a) => a.name, show() {}, hide() {}, setInterval: () => 1, clearInterval() {},
    state: { activePubkey: 'B', accounts: [{ pubkey: 'A', name: 'Scrubby' }, { pubkey: 'B', name: 'Gilded' }] },
    call: async () => {}, syncRelax: async () => {}, Date: { now: () => 1e12 },
  };
  vm.createContext(ctx);
  vm.runInContext([
    'let relaxGrants = ' + JSON.stringify(grants) + ', relaxTick = null, relaxShown = null, relaxListOpen = false;',
    liftFn(sp, 'function fmtRelax('), liftFn(sp, 'function relaxPick('),
    "const relaxKey = (g) => g.host + '|' + g.pubkey;",
    liftFn(sp, 'function relaxName('), liftFn(sp, 'function renderRelaxList('), liftFn(sp, 'function renderRelaxStatus('),
    'globalThis.render = renderRelaxStatus; globalThis.open = () => { relaxListOpen = true; }; globalThis.shown = () => relaxShown;',
  ].join('\n'), ctx);
  ctx.render();
  assert.equal($('relax-status-name').textContent, 'Gilded', 'the bar did not name the active account');
  assert.equal($('relax-status-host').textContent, 'b.example');
  assert.equal(ctx.shown().host, 'b.example', 'Restart would wind back another window');
  assert.equal($('relax-status-more').textContent, '+2');
  assert.equal($('relax-status-more').attrs['aria-label'], '2 other timers running');
  assert.ok($('relax-status-list')._cls.has('hidden'), 'the list opened by itself');
  ctx.open(); ctx.render();
  assert.ok(!$('relax-status-list')._cls.has('hidden'));
  const rows = $('relax-status-list').children;
  assert.deepEqual(rows.map((r) => r.querySelector('.relax-list-name').textContent + ' · ' + r.querySelector('.relax-list-host').textContent),
    ['Scrubby · a.example', 'Gilded · c.example']);
  assert.equal(rows[0].querySelector('.relax-list-time').textContent, '05:00');
  // Closed and opened again, the rows come back.
  vm.runInContext('relaxListOpen = false;', ctx); ctx.render();
  assert.equal($('relax-status-list').children.length, 0);
  ctx.open(); ctx.render();
  assert.equal($('relax-status-list').children.length, 2, 'reopening the list showed no rows');
  // One window: no capsule, no list.
  vm.runInContext('relaxGrants = relaxGrants.slice(0, 1);', ctx); ctx.render();
  assert.ok($('relax-status-more')._cls.has('hidden'));
  assert.ok($('relax-status-list')._cls.has('hidden'));
});
