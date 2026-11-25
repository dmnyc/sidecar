'use strict';

// WHAT A SCREEN READER IS TOLD, read from the browser's own accessibility tree in the real
// extension: the panel's tabs are a tab list the arrow keys move through (mirrored in a
// right-to-left language), toasts and errors are announced, fields and the settings' pickers
// have names, the setting names sit a level under their section, the footer logo is a
// button, the composer's editor is a named text box, and the help pages have a main region
// (help with a link to skip to it). Asked of the tree, not of the markup, so an attribute
// that never reaches the page fails here.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startExtension, CHROME, sleep } = require('./helpers/real-extension');

const opts = { skip: CHROME ? false : 'no browser found', timeout: 240000 };

// The page's whole tree, with each node's role, name, properties and children's ids.
async function axTree(tab) {
  const { nodes } = await tab.cdp('Accessibility.getFullAXTree');
  const byId = new Map(nodes.map((n) => [n.nodeId, n]));
  const prop = (n, k) => { const p = (n.properties || []).find((x) => x.name === k); return p ? p.value.value : undefined; };
  const view = (n) => ({ role: n.role && n.role.value, name: (n.name && n.name.value) || '', n });
  const all = nodes.filter((n) => !n.ignored).map(view);
  const text = (n) => { let s = n.name && n.name.value ? n.name.value : ''; for (const c of n.childIds || []) { const k = byId.get(c); if (k) s += ' ' + text(k); } return s; };
  return {
    all,
    find: (role, name) => all.find((x) => x.role === role && (name === undefined || (name instanceof RegExp ? name.test(x.name) : x.name === name))),
    prop,
    text,
  };
}

async function waitFor(tab, expr, ms = 8000) {
  for (let i = 0; i < ms / 100; i++) { if (await tab.evaluate(expr)) return true; await sleep(100); }
  return false;
}

async function start(t) {
  try { return await startExtension(); } catch (e) { if (e.skip) { t.skip(e.message); return null; } throw e; }
}

test('the panel: its tabs are a tab list the arrow keys move through, mirrored right to left', opts, async (t) => {
  const x = await start(t);
  if (!x) return;
  try {
    const tab = await x.openPage(`chrome-extension://${x.extId}/sidepanel.html`);
    await tab.viewport({ width: 380, height: 820, scale: 1 });
    assert.ok(await waitFor(tab, `!!document.getElementById('view-main') && !document.getElementById('view-main').classList.contains('hidden')`, 15000), 'the panel did not open');
    await sleep(800);

    let ax = await axTree(tab);
    assert.ok(ax.find('tablist'), 'no tab list');
    const tabs = ax.all.filter((n) => n.role === 'tab').map((n) => n.name);
    assert.deepEqual(tabs, ['Accounts', 'Activity', 'Profile', 'Wallet']);
    assert.equal(ax.prop(ax.find('tab', 'Accounts').n, 'selected'), true, 'Accounts is not the selected tab');
    assert.ok(ax.find('tabpanel', 'Accounts'), 'the Accounts view is not its tab panel');

    const selected = () => tab.evaluate(`[...document.querySelectorAll('.tab')].filter((b) => b.getAttribute('aria-selected') === 'true').map((b) => b.dataset.tab).join()`);
    const focused = () => tab.evaluate(`document.activeElement && document.activeElement.dataset.tab`);
    const shown = () => tab.evaluate(`[...document.querySelectorAll('.tabview')].filter((v) => !v.classList.contains('hidden')).map((v) => v.id).join()`);

    // Only the selected tab is a Tab stop.
    assert.deepEqual(await tab.evaluate(`[...document.querySelectorAll('.tab')].map((b) => b.tabIndex)`), [0, -1, -1, -1]);

    await tab.evaluate(`document.querySelector('.tab[data-tab="accounts"]').focus()`);
    await tab.press('ArrowRight'); await sleep(400);
    assert.equal(await selected(), 'activity');
    assert.equal(await focused(), 'activity', 'the focus did not go with the selection');
    assert.equal(await shown(), 'tab-activity', 'the arrow key selected a tab without opening it');
    await tab.press('End'); await sleep(400);
    assert.equal(await selected(), 'wallet');
    await tab.press('Home'); await sleep(400);
    assert.equal(await selected(), 'accounts');
    await tab.press('ArrowLeft'); await sleep(400);
    assert.equal(await selected(), 'wallet', 'Left from the first tab does not wrap to the last');

    // The Profile view opens on a heading, for a screen reader if not on screen.
    await tab.evaluate(`document.querySelector('.tab[data-tab="profile"]').click()`); await sleep(800);
    ax = await axTree(tab);
    const ph = ax.find('heading', 'Profile');
    assert.ok(ph, 'the Profile tab has no heading');
    assert.equal(ax.prop(ph.n, 'level'), 2);

    // Right to left, the first tab is on the right, so Left moves on to the next.
    await tab.evaluate(`document.querySelector('.tab[data-tab="accounts"]').click(); document.documentElement.dir = 'rtl'`); await sleep(300);
    await tab.evaluate(`document.querySelector('.tab[data-tab="accounts"]').focus()`);
    await tab.press('ArrowLeft'); await sleep(400);
    assert.equal(await selected(), 'activity', 'Left does not move forward in a right-to-left language');
    await tab.press('ArrowRight'); await sleep(400);
    assert.equal(await selected(), 'accounts');
    assert.deepEqual(x.errors, []);
  } finally { x.close(); }
});

test('the panel: a toast and an error are announced, and fields, pickers and the footer logo have names', opts, async (t) => {
  const x = await start(t);
  if (!x) return;
  try {
    const tab = await x.openPage(`chrome-extension://${x.extId}/sidepanel.html`);
    await tab.viewport({ width: 380, height: 820, scale: 1 });
    assert.ok(await waitFor(tab, `!!document.getElementById('view-main') && !document.getElementById('view-main').classList.contains('hidden')`, 15000));
    await sleep(800);

    // A toast lands in a polite live region.
    await tab.evaluate(`document.getElementById('add-generate').click()`);
    assert.ok(await waitFor(tab, `!!document.querySelector('#toasts .toast')`), 'no toast');
    let ax = await axTree(tab);
    const live = ax.all.filter((n) => ax.prop(n.n, 'live') === 'polite' && /Account created/.test(ax.text(n.n)));
    assert.ok(live.length, 'the toast is not in a live region');
    await tab.evaluate(`document.getElementById('modal-overlay') && document.querySelectorAll('.modal .modal-x, .modal [data-close]').forEach((b) => b.click())`);
    await sleep(500);

    // The footer logo is the way to About: a named button the keyboard reaches.
    ax = await axTree(tab);
    assert.ok(ax.find('button', 'About Sidecar'), 'the footer logo is not a button named About Sidecar');
    assert.equal(await tab.evaluate(`document.querySelector('#view-main .brand-foot').tabIndex`), 0, 'the footer logo is not in the Tab order');

    // Settings: the pickers are named by the setting they sit under; the setting names are a
    // level under their section; the relay field is named, and its error is an alert.
    await tab.evaluate(`document.getElementById('settings-btn').click()`); await sleep(800);
    await tab.evaluate(`document.querySelectorAll('#view-settings .settings-section').forEach((s) => s.classList.add('open'))`); await sleep(500);
    ax = await axTree(tab);
    for (const name of ['Open notes in', 'Local currency', 'Auto-lock']) {
      assert.ok(ax.all.find((n) => /combobox|select/i.test(n.role) && n.name === name), `the ${name} picker has no name`);
    }
    const autolock = ax.find('heading', 'Auto-lock');
    assert.ok(autolock, 'no Auto-lock heading');
    assert.equal(ax.prop(autolock.n, 'level'), 4, 'a setting name is not under its section');
    assert.equal(ax.prop(ax.find('heading', /Security/).n, 'level'), 3);
    assert.ok(ax.find('textbox', 'Relay address'), 'the relay field has no name');

    await tab.evaluate(`(() => { const i = document.getElementById('relay-input'); i.value = 'not a relay'; document.getElementById('relay-add').click(); })()`);
    assert.ok(await waitFor(tab, `!!document.getElementById('relay-add-error').textContent`), 'no error for a bad relay');
    // On screen, too: it was written into a box that stayed hidden, so nobody saw it.
    assert.ok(await tab.evaluate(`document.getElementById('relay-add-error').getBoundingClientRect().height > 0`), 'the relay error is written but not shown');
    ax = await axTree(tab);
    const alert = ax.all.find((n) => n.role === 'alert' && /relay URL/.test(ax.text(n.n)));
    assert.ok(alert, 'the relay error is not an alert');
    assert.deepEqual(x.errors, []);
  } finally { x.close(); }
});

test('the composer: the editor is a named text box, and the recipe’s fields and grips are named', opts, async (t) => {
  const x = await start(t);
  if (!x) return;
  try {
    const tab = await x.openPage(`chrome-extension://${x.extId}/compose.html`);
    await tab.viewport({ width: 1280, height: 900, scale: 1 });
    assert.ok(await waitFor(tab, `!!window.SidecarLongform && !document.documentElement.classList.contains('compose-booting')`, 15000));
    await sleep(600);
    let ax = await axTree(tab);
    const ed = ax.all.find((n) => n.role === 'textbox' && ax.prop(n.n, 'multiline') === true);
    assert.ok(ed, 'the editor is not a multi-line text box');
    assert.ok(ed.name, 'the editor has no name');
    assert.equal(ed.name, await tab.evaluate(`document.querySelector('.compose-editor').dataset.placeholder`));
    assert.ok(ax.find('alert') || await tab.evaluate(`document.getElementById('compose-err').getAttribute('role') === 'alert'`), 'the composer’s error line is not an alert');

    await tab.evaluate(`[...document.querySelectorAll('.compose-mode')].find((b) => b.textContent.trim() === 'Recipe').click()`);
    await tab.evaluate(`(() => { const L = window.SidecarLongform.state.recipe; L.ingredients.splice(0, L.ingredients.length, 'apples', 'butter'); window.SidecarLongform.refresh(); })()`);
    await sleep(500);
    ax = await axTree(tab);
    assert.ok(ax.find('textbox', 'Recipe name'), 'the recipe name field has no name');
    assert.ok(ax.find('textbox', 'Ingredients'), 'the ingredient box is named by its placeholder, not its list');
    assert.ok(ax.find('textbox', 'Directions'));
    const grip = ax.find('button', 'Move apples');
    assert.ok(grip, 'each grip is not named for its item');
    assert.match((grip.n.description && grip.n.description.value) || '', /arrow keys/, 'the grip does not say the arrow keys move it');
    // An aria-* given to the shared element builder reaches the page (it once did not).
    const disclose = ax.find('button', /Add image by link/);
    assert.ok(disclose, 'no Add image by link');
    assert.equal(ax.prop(disclose.n, 'expanded'), false, 'the disclosure does not say it is closed');
    assert.deepEqual(x.errors, []);
  } finally { x.close(); }
});

test('help, welcome and wallets have a main region, and help a link to skip to it', opts, async (t) => {
  const x = await start(t);
  if (!x) return;
  try {
    for (const page of ['help.html', 'welcome.html', 'wallets.html']) {
      const tab = await x.openPage(`chrome-extension://${x.extId}/${page}`);
      await tab.viewport({ width: 1280, height: 900, scale: 1 });
      await sleep(2000);
      const ax = await axTree(tab);
      assert.ok(ax.find('main'), `${page} has no main region`);
      if (page !== 'help.html') assert.ok(ax.find('checkbox', 'Menu'), `${page}: the menu switch has no name`);
      if (page === 'help.html') {
        const skip = () => tab.evaluate(`(() => { const a = document.activeElement; const r = a.getBoundingClientRect(); return { text: a.textContent.trim(), href: a.getAttribute('href'), seen: r.bottom > 0 && r.top >= 0 && r.width > 0 }; })()`);
        const before = await tab.evaluate(`(() => { const r = document.querySelector('.skip-link').getBoundingClientRect(); return r.bottom <= 0; })()`);
        assert.equal(before, true, 'the skip link shows before it is focused');
        await tab.press('Tab'); await sleep(300);
        assert.deepEqual(await skip(), { text: 'Skip to the guide', href: '#top', seen: true }, 'the first Tab is not a visible skip link');
      }
      await tab.close();
    }
    assert.deepEqual(x.errors, []);
  } finally { x.close(); }
});
