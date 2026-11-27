'use strict';

// THE REAL EXTENSION IN FIREFOX: the same handle real-extension.js gives a test, driven
// over WebDriver BiDi instead of the Chrome DevTools pipe, so a browser test written for
// Chrome runs in Firefox unchanged:
//
//     SIDECAR_BROWSER=firefox node --test test/mention-pill-editing.browser.test.js
//
// The extension is installed from a scratch copy with the Firefox manifest (what
// scripts/package.sh writes into the Firefox zip), as a temporary add-on in a fresh
// profile. Its pages are opened as tabs, chrome-extension:// URLs in a test are read as
// moz-extension://, and keys are real WebDriver key actions, so Firefox's own editor
// decides what each one does. `commands` (Chrome's way to name a Mac editing command) is
// ignored here: Firefox maps the modifier keys itself.

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');

const ROOT = process.env.EXTENSION_ROOT || path.join(__dirname, '..', '..');
const FIREFOX = [
  process.env.FIREFOX_PATH,
  '/Applications/Firefox.app/Contents/MacOS/firefox',
  '/Applications/Firefox Nightly.app/Contents/MacOS/firefox',
  '/usr/bin/firefox',
].filter(Boolean).find((p) => fs.existsSync(p)) || null;

const chromeSide = require('./real-extension.js');
const { sleep } = chromeSide;
const { startRelay, nostrTools, SK, PIN } = chromeSide._internals;

const ADDON_ID = 'sidecar@sidecar.top';
const UUID = '5c1dec4a-0000-4000-8000-000000000001';

function freePort() {
  return new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
}

// A copy of the extension with the manifest the Firefox zip carries.
function stageExtension(dir) {
  const out = path.join(dir, 'ext');
  fs.cpSync(ROOT, out, { recursive: true, filter: (src) => !/(^|\/)(\.git|node_modules|test|dist|store|docs|assets|scripts)(\/|$)/.test(path.relative(ROOT, src)) || src === ROOT });
  const file = path.join(out, 'manifest.json');
  const m = JSON.parse(fs.readFileSync(file, 'utf8'));
  delete m.side_panel; delete m.minimum_chrome_version; delete m.externally_connectable;
  if (Array.isArray(m.permissions)) m.permissions = m.permissions.filter((p) => p !== 'sidePanel');
  if (m.background) delete m.background.service_worker;
  // WebDriver may not navigate a tab to an extension page, so the extension opens its own
  // first one (the panel), and the tests open the rest from there with chrome.tabs.
  fs.writeFileSync(path.join(out, '__test_open_panel.js'), "chrome.tabs.create({ url: chrome.runtime.getURL('sidepanel.html') });\n");
  m.background.scripts = [...(m.background.scripts || []), '__test_open_panel.js'];
  fs.writeFileSync(file, JSON.stringify(m, null, 2));
  return out;
}

function bidi(url) {
  const ws = new WebSocket(url);
  let n = 0;
  const pending = new Map();
  const listeners = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.type === 'error') rej(new Error(msg.error + ': ' + msg.message)); else res(msg.result);
    } else listeners.forEach((f) => f(msg));
  };
  const open = new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  const send = (method, params = {}) => new Promise((res, rej) => {
    const id = ++n;
    pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params }));
  });
  return { open, send, on: (f) => listeners.push(f), close: () => { try { ws.close(); } catch (_) { /* gone */ } } };
}

// WebDriver's key values for the keys the tests press.
const KEY = {
  Backspace: '', Delete: '', ArrowLeft: '', ArrowRight: '', ArrowUp: '', ArrowDown: '',
  Home: '', End: '', Enter: '', Tab: '', Escape: '',
};
const MOD = { shift: '', ctrl: '', alt: '', meta: '' };

async function startExtension({ relayDelayMs = 0, settings = {}, bare = false, relayOptions = {} } = {}) {
  if (!FIREFOX) { const e = new Error('no Firefox found'); e.skip = true; throw e; }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-ff-'));
  // Firefox's default extension CSP upgrades ws:// to wss://, so the relay speaks TLS, with a
  // certificate made for this run that the session is told to accept.
  require('node:child_process').execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=127.0.0.1',
    '-addext', 'subjectAltName=IP:127.0.0.1', '-keyout', path.join(dir, 'key.pem'), '-out', path.join(dir, 'cert.pem')], { stdio: 'ignore' });
  const relay = await startRelay({ delayMs: relayDelayMs, tls: { key: fs.readFileSync(path.join(dir, 'key.pem')), cert: fs.readFileSync(path.join(dir, 'cert.pem')) }, ...relayOptions });
  const profile = path.join(dir, 'profile');
  fs.mkdirSync(profile);
  fs.writeFileSync(path.join(profile, 'user.js'), [
    `user_pref("extensions.webextensions.uuids", ${JSON.stringify(JSON.stringify({ [ADDON_ID]: UUID }))});`,
    'user_pref("browser.shell.checkDefaultBrowser", false);',
    'user_pref("datareporting.policy.dataSubmissionEnabled", false);',
    'user_pref("toolkit.telemetry.reportingpolicy.firstRun", false);',
    'user_pref("browser.aboutwelcome.enabled", false);',
    'user_pref("extensions.autoDisableScopes", 0);',
    'user_pref("dom.events.testing.asyncClipboard", true);',
  ].join('\n'));
  const ext = stageExtension(dir);
  const port = await freePort();
  const proc = spawn(FIREFOX, ['--headless', '--no-remote', '--profile', profile, `--remote-debugging-port=${port}`, 'about:blank'], { stdio: 'ignore', env: { ...process.env, MOZ_REMOTE_ALLOW_SYSTEM_ACCESS: '1' } });
  let bd = null;
  const cleanup = () => { if (bd) bd.close(); try { proc.kill('SIGKILL'); } catch (_) { /* gone */ } relay.close(); try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* best effort */ } };
  try {
    for (let i = 0; i < 60; i++) {
      await sleep(250);
      try { bd = bidi(`ws://127.0.0.1:${port}/session`); await bd.open; break; } catch (_) { bd = null; }
    }
    if (!bd) throw new Error('Firefox did not open its WebDriver BiDi port');
    await bd.send('session.new', { capabilities: { alwaysMatch: { acceptInsecureCerts: true, unhandledPromptBehavior: { default: 'ignore' } } } });
    await bd.send('webExtension.install', { extensionData: { type: 'path', path: ext } });
    const base = `moz-extension://${UUID}`;
    const fix = (url) => url.replace(/^chrome-extension:\/\/[^/]+/, base);

    const errors = [];
    const contexts = new Set();
    bd.on((m) => {
      if (m.method === 'log.entryAdded' && m.params.type === 'javascript' && m.params.level === 'error' && contexts.has(m.params.source && m.params.source.context)) {
        errors.push(String(m.params.text).split('\n')[0]);
      }
    });
    await bd.send('session.subscribe', { events: ['log.entryAdded'] });

    const known = new Set();
    const findNew = async (url) => {
      for (let i = 0; i < 80; i++) {
        const { contexts: tree } = await bd.send('browsingContext.getTree', { maxDepth: 0 });
        const hit = tree.find((c) => !known.has(c.context) && c.url.startsWith(url));
        if (hit) { known.add(hit.context); return hit.context; }
        await sleep(100);
      }
      throw new Error('no tab opened at ' + url);
    };
    const evalIn = (context) => async (expression, { wait = true } = {}) => {
      const wrapped = wait
        ? `(async () => { const v = await (${expression}); return v === undefined ? '__undef__' : JSON.stringify(v); })()`
        : `(() => { const v = (${expression}); return v instanceof Promise ? '__undef__' : (v === undefined ? '__undef__' : JSON.stringify(v)); })()`;
      const r = await bd.send('script.evaluate', { expression: wrapped, target: { context }, awaitPromise: true, resultOwnership: 'none' });
      if (r.type === 'exception') throw new Error('page threw: ' + (r.exceptionDetails && r.exceptionDetails.text));
      const s = r.result && r.result.value;
      return s === '__undef__' || s === undefined ? undefined : JSON.parse(s);
    };

    // The browser window itself (system access): selecting a tab and sizing the window are
    // done there, since WebDriver will not do either for an extension page.
    let chromeCtx = null;
    const chromeEval = async (expression) => {
      if (!chromeCtx) {
        const { contexts: tree } = await bd.send('browsingContext.getTree', { maxDepth: 0, 'moz:scope': 'chrome' });
        chromeCtx = (tree.find((c) => /browser\.xhtml$/.test(c.url)) || {}).context;
      }
      const r = await bd.send('script.evaluate', { expression: `(() => JSON.stringify(${expression}))()`, target: { context: chromeCtx }, awaitPromise: true, resultOwnership: 'none' });
      if (r.type === 'exception') throw new Error('browser window threw: ' + (r.exceptionDetails && r.exceptionDetails.text));
      const v = r.result && r.result.value;
      return v === undefined ? undefined : JSON.parse(v);
    };
    // A tab is found in the window by a title it is given for a moment, and is selected from
    // then on by its browser's id: Firefox applies Cmd+arrows, Up and Down only in the
    // selected tab, and two tabs can show the same page.
    const browserIdOf = async (context) => {
      const marker = '__ff' + Math.random().toString(36).slice(2);
      const title = await evalIn(context)(`(() => { const t = document.title; document.title = ${JSON.stringify(marker)}; return t; })()`);
      let id = null;
      for (let i = 0; i < 30 && !id; i++) { await sleep(50); id = await chromeEval(`(gBrowser.tabs.find((t) => t.label === ${JSON.stringify(marker)}) || {}).linkedBrowser?.browserId || null`); }
      await evalIn(context)(`void (document.title = ${JSON.stringify(title)})`);
      return id;
    };
    const selectTab = (browserId) => chromeEval(`(() => { const t = gBrowser.tabs.find((t) => t.linkedBrowser.browserId === ${browserId}); if (t && gBrowser.selectedTab !== t) gBrowser.selectedTab = t; return !!t; })()`);

    const panel = await findNew(`${base}/sidepanel.html`);
    contexts.add(panel);
    const evaluate = evalIn(panel);
    const attach = async (url) => {
      await evaluate(`chrome.tabs.create({ url: ${JSON.stringify(fix(url))} }).then(() => 1)`);
      const context = await findNew(fix(url).split('#')[0]);
      for (let i = 0; i < 50 && (await evalIn(context)('document.readyState')) !== 'complete'; i++) await sleep(100);
      return context;
    };
    await sleep(300);
    for (let i = 0; i < 50; i++) { try { if ((await evaluate('document.readyState')) === 'complete') break; } catch (_) { /* loading */ } await sleep(100); }
    const message = (m) => evaluate(`new Promise((res) => chrome.runtime.sendMessage(${JSON.stringify(m)}, (r) => res(r)))`);
    const waitFor = async (expression, ms = 8000) => {
      const end = Date.now() + ms;
      let last;
      while (Date.now() < end) {
        try { last = await evaluate(expression); } catch (e) { last = undefined; }
        if (last) return last;
        await sleep(100);
      }
      throw new Error('timed out waiting for: ' + expression + ' (last: ' + JSON.stringify(last) + ')');
    };
    await sleep(1000);

    const nt = nostrTools();
    const handle = {
      extId: UUID, relay, errors, nt, me: nt.pubkey('me'), bea: nt.pubkey('bea'), cal: nt.pubkey('cal'), browser: 'firefox',
      sleep, evaluate, message, waitFor,
      sign: (template, who) => nt.sign(template, who),
      put: (template, who) => { const e = nt.sign(template, who); relay.events.push(e); return e; },
      push: (template, who) => { const e = nt.sign(template, who); relay.push(e); return e; },
      openPage: async (url) => {
        const context = await attach(url);
        const at = await browserIdOf(context);
        const actions = async (list) => { await selectTab(at); await bd.send('input.performActions', { context, actions: list }); await bd.send('input.releaseActions', { context }); };
        return {
          context,
          evaluate: evalIn(context),
          clickAt: (x, y) => actions([{ type: 'pointer', id: 'mouse', parameters: { pointerType: 'mouse' }, actions: [
            { type: 'pointerMove', x: Math.round(x), y: Math.round(y), origin: 'viewport' }, { type: 'pointerDown', button: 0 }, { type: 'pointerUp', button: 0 }] }]),
          press: async (key, { shift = false, alt = false, ctrl = false, meta = false } = {}) => {
            const mods = [shift && MOD.shift, alt && MOD.alt, ctrl && MOD.ctrl, meta && MOD.meta].filter(Boolean);
            const v = KEY[key] || key;
            await actions([{ type: 'key', id: 'kbd', actions: [
              ...mods.map((m) => ({ type: 'keyDown', value: m })), { type: 'keyDown', value: v }, { type: 'keyUp', value: v },
              ...mods.reverse().map((m) => ({ type: 'keyUp', value: m }))] }]);
          },
          type: (text) => actions([{ type: 'key', id: 'kbd', actions: [...text].flatMap((c) => [{ type: 'keyDown', value: c }, { type: 'keyUp', value: c }]) }]),
          viewport: async ({ width = 1280, height = 800 } = {}) => {
            await selectTab(at);
            await chromeEval(`(() => { const b = gBrowser.selectedBrowser; window.resizeTo(window.outerWidth - b.clientWidth + ${width}, window.outerHeight - b.clientHeight + ${height}); })()`);
            await sleep(400);
          },
          screenshot: async (file, { width = 1280, height = 800, scale = 2 } = {}) => {
            await bd.send('browsingContext.setViewport', { context, viewport: { width, height }, devicePixelRatio: scale });
            await sleep(1200);
            const shot = await bd.send('browsingContext.captureScreenshot', { context });
            fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
          },
          // The browser window itself (system access), for what WebDriver does not reach: the clipboard.
          browserEval: chromeEval,
          close: () => bd.send('browsingContext.close', { context }),
        };
      },
      reload: async () => { await evaluate('void location.reload()'); await sleep(2500); await waitFor(`!document.getElementById('view-main').classList.contains('hidden')`, 15000); },
      close: cleanup,
    };
    await message({ type: 'SIDECAR_SET_SETTINGS', settings: { autoLockMinutes: 0, autoLockNoticeShown: true, ...(bare ? settings : {}) } });
    if (bare) return handle;
    const init = await message({ type: 'SIDECAR_INIT', pin: PIN });
    if (!init || !init.ok) throw new Error('keystore init failed: ' + JSON.stringify(init));
    let add = await message({ type: 'SIDECAR_ADD_ACCOUNT', secret: SK.me, name: 'Tester' });
    if (add && !add.ok && /locked/i.test(add.error || '')) {
      await message({ type: 'SIDECAR_UNLOCK', pin: PIN });
      add = await message({ type: 'SIDECAR_ADD_ACCOUNT', secret: SK.me, name: 'Tester' });
    }
    if (!add || !add.ok) throw new Error('adding the account failed: ' + JSON.stringify(add));
    await message({ type: 'SIDECAR_SET_RELAYS', relays: { [relay.url]: { read: true, write: true } } });
    await message({ type: 'SIDECAR_SET_SETTINGS', settings: { seasonalOffers: false, literaryQuotes: true, ...settings } });
    return handle;
  } catch (e) {
    cleanup();
    throw e;
  }
}

module.exports = { startExtension, CHROME: FIREFOX, FIREFOX, sleep };
