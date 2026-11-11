'use strict';
// Captures the panel scenes for the store screenshots from the real extension.
//
// What runs: the unpacked extension in a throwaway Chrome profile, its real service worker,
// its real side panel page. Chrome is told to send the panel's default relay hostnames, a
// pretend wallet's relay and the hosts Gatsby's pictures live on to one local TLS server, so
// the panel runs with its own default settings and the profile keeps its real picture
// addresses, and nothing leaves the machine. The server holds the people's profile events,
// answers as a wallet, and serves the pictures from a fixtures folder.
//
// KEYS. With --vault, the demo vault's export password is asked for once at a hidden prompt;
// the vault is decrypted in memory, its accounts go into the throwaway profile, and nothing is
// written to disk. Without it, Gatsby and Amelia get fixed test keys: fine for a layout, but
// the panel will show a different public key than the real demo account has.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const { startExtension } = require(path.join(ROOT, 'test', 'helpers', 'real-extension.js'));
const imageCore = require(path.join(ROOT, 'scripts', 'image-publish-core.js'));
const { createWallet, createInvoice } = require('./wallet-sim.js');
const { personasFor, historyFor, avatarSvg, AVATAR_HOST } = require('./personas.js');
const { runSteps } = require('./recipes.js');

const PIN = 'demo2026';
const PANEL = { width: 360, height: 913 };   // the proportions of the panel in the store images
// The page beside the panel is drawn in a wider window than it is shown at: 1280 wide, shown 994 wide,
// which is how the pages in the store images show four columns of apps at a readable size.
const PAGE = { width: 1280, height: 910 };
const DEFAULT_RELAY_HOSTS = ['nos.lol', 'relay.snort.social', 'nostr.mom', 'offchain.pub', 'relay.primal.net'];
const WALLET_HOST = 'wallet-relay.example';
const fixturesDir = () => process.env.SIDECAR_STORE_FIXTURES || path.join(os.homedir(), '.local', 'share', 'sidecar-images', 'fixtures');

function loadGlobals() {
  imageCore.loadCrypto();   // NostrTools
  if (!globalThis.SidecarCrypto) {
    globalThis.self = globalThis.self || globalThis;
    vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'crypto.js'), 'utf8'), { filename: 'crypto.js' });
  }
  return globalThis.NostrTools;
}

// The vault's accounts, or throws with the reason in plain words.
async function openVault(file, password) {
  const v = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!v.kdf || !v.iv || !v.ct) throw new Error('That is not a Sidecar vault file');
  const key = await globalThis.SidecarCrypto.deriveKey(password, v.kdf);
  let payload;
  try { payload = await globalThis.SidecarCrypto.decryptString(key, { iv: v.iv, ct: v.ct }); }
  catch (_) { throw new Error('Incorrect password, or a corrupted vault'); }
  const accounts = (JSON.parse(payload).accounts || []).map((a) => ({ name: a.name, nsec: a.nsec, picture: a.picture }));   // a wallet connection in the vault is left behind on purpose
  if (!accounts.length) throw new Error('That vault has no accounts');
  return accounts;
}

function makeCert(dir) {
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(dir, 'k.pem'), '-out', path.join(dir, 'c.pem'), '-days', '2', '-subj', '/CN=localhost'], { stdio: 'ignore' });
  return { key: fs.readFileSync(path.join(dir, 'k.pem')), cert: fs.readFileSync(path.join(dir, 'c.pem')) };
}

function fixtureFile(name) {
  for (const ext of ['jpg', 'jpeg', 'png', 'webp']) {
    const f = path.join(fixturesDir(), `${name}.${ext}`);
    if (fs.existsSync(f)) return f;
  }
  return null;
}
const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml' };

// Pictures: a fixture file when there is one, else a colored initial.
function pictureServer(personas) {
  const hostOf = (u) => { try { return new URL(u).hostname; } catch (_) { return null; } };
  const keyOf = (u) => { try { const x = new URL(u); return x.hostname + x.pathname; } catch (_) { return null; } };
  // Several pictures can live on one host (every profile picture here is on the same one), so a
  // picture is found by host and path, and only then by host alone.
  const byUrl = {};
  const byHost = {};
  const seeds = {};
  const hosts = new Set([AVATAR_HOST]);
  byUrl[keyOf(personas.gatsby.banner)] = () => fixtureFile('gatsby-banner');
  hosts.add(hostOf(personas.gatsby.banner));
  Object.values(personas).forEach((p, i) => {
    seeds[p.id] = i;
    const h = hostOf(p.picture);
    if (!h) return;
    hosts.add(h);
    if (h !== AVATAR_HOST) byUrl[keyOf(p.picture)] = () => fixtureFile(p.id + '-avatar');
  });
  const handler = (req, res) => {
    const host = (req.headers.host || '').split(':')[0];
    const cors = { 'access-control-allow-origin': '*', 'cache-control': 'no-store' };
    let file = byUrl[host + req.url.split('?')[0]] && byUrl[host + req.url.split('?')[0]]();
    if (!file && host === AVATAR_HOST) {
      const id = path.basename(req.url, '.svg');
      file = fixtureFile(id + '-avatar');
      if (!file && personas[id]) { res.writeHead(200, { 'content-type': 'image/svg+xml', ...cors }); return res.end(avatarSvg(personas[id].name, seeds[id])); }
    }
    if (!file) {
      // Only a person's picture host answers with a picture (a placeholder when its fixture is
      // missing). Anything else, such as a relay being asked for its info document, gets a plain
      // 404 so the panel draws what it draws for a relay that has no icon.
      const who = Object.values(personas).find((p) => keyOf(p.picture) === host + req.url.split('?')[0]);
      if (!who) { res.writeHead(404, cors); return res.end(); }
      res.writeHead(200, { 'content-type': 'image/svg+xml', ...cors });
      return res.end(avatarSvg(who.name, 0));
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', ...cors });
    res.end(fs.readFileSync(file));
  };
  return { handler, hosts: [...hosts].filter(Boolean) };
}

// Types into the first-run form the way a person does, so the fields show their dots.
async function fillOnboarding(x, pin) {
  await x.waitFor(`!document.getElementById('view-onboarding').classList.contains('hidden')`, 15000);
  await x.evaluate(`(() => {
    const set = (id, v) => { const e = document.getElementById(id); e.focus(); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); };
    set('ob-pin', ${JSON.stringify(pin)}); set('ob-pin2', ${JSON.stringify(pin)});
  })()`);
}

// One of the extension's own pages, shown in the panel's tab at the size it has in the image, then
// the panel again. It is the same Chrome, the same profile and the same hostnames.
async function pageShot(x, file, relPath) {
  await x.evaluate(`location.href = 'chrome-extension://${x.extId}/${relPath}'`);
  await x.sleep(2500);
  // A coach mark that asks to pin Sidecar: said once, and nothing the page is about.
  await x.evaluate(`[...document.querySelectorAll('button')].filter((b) => /^[×x]$/i.test(b.textContent.trim()) || /close|dismiss/i.test(b.getAttribute('aria-label') || '')).forEach((b) => b.click())`);
  await x.sleep(500);
  await x.screenshot(file, PAGE);
  await x.evaluate(`location.href = 'chrome-extension://${x.extId}/sidepanel.html'`);
  await x.sleep(2500);
}

async function tab(x, name) {
  await x.evaluate(`[...document.querySelectorAll('[data-tab]')].find((e) => e.dataset.tab === ${JSON.stringify(name)}).click()`);
  await x.sleep(2500);
}

// Runs every panel scene and returns { name: file }.
// `live` ({ url, recipe }) makes the client window a real page: the client's own site, loaded over the network in
// the capture browser, asking Sidecar for real. Without it the client is a stub page at `client`, and the images
// that show the client's page are left for a supplied screenshot.
async function capturePanels({ outDir, vaultAccounts, client = 'client.example', live = null, log = () => {} }) {
  if (live) client = new URL(live.url).hostname.replace(/^www\./, '');
  const NT = loadGlobals();
  fs.mkdirSync(outDir, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'store-shots-'));
  const personas = personasFor({ NT, vaultAccounts });
  const now = Math.floor(Date.now() / 1000);
  const { rows, payMeta } = historyFor({ NT, personas, now });
  const wallet = createWallet({ NT, secretKeyHex: 'a1'.repeat(32), balanceSats: 412905, transactions: rows });
  const pics = pictureServer(personas);
  const hosts = [...DEFAULT_RELAY_HOSTS, WALLET_HOST, ...(live ? [] : [client]), ...pics.hosts];
  const shots = {};
  const x = await startExtension({
    bare: true,
    settings: { devIndicator: false, seasonalOffers: false, literaryQuotes: true },
    relayOptions: { tls: makeCert(tmp), http: (req, res) => { if ((req.headers.host || '').split(':')[0] === client) { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<!doctype html><meta charset="utf-8"><title>' + client + '</title><body style="background:#111">'); } return pics.handler(req, res); }, onEvent: (ev, api) => wallet.handle(ev, api) },
    chromeArgsFor: (relay) => ['--ignore-certificate-errors', '--host-resolver-rules=' + hosts.map((h) => `MAP ${h} 127.0.0.1:${relay.port}`).join(', ')],
  });
  const hideBalloon = () => x.evaluate(`(() => { const b = document.getElementById('first-post-balloon'); if (b) b.classList.add('hidden'); })()`);
  const shot = async (name, { balloon = false } = {}) => { if (!balloon) await hideBalloon(); const f = path.join(outDir, name + '.png'); await x.screenshot(f, PANEL); shots[name] = f; log('captured ' + name); };
  try {
    // 1. First run: a PIN typed into both fields. Reloaded first, so the settings written
    // before the keystore existed (no dev badge) are the ones the screen was drawn with.
    await x.evaluate('location.reload()');
    await x.sleep(2500);
    await fillOnboarding(x, PIN);
    await shot('lock');
    // 2. The keystore made, and the welcome screen with its toast.
    await x.evaluate(`document.getElementById('ob-submit').click()`);
    // The PIN reminder holds the welcome screen until it is dismissed, as it does for a person.
    await x.waitFor(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'OK, got it')`, 15000);
    await x.evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'OK, got it').click()`);
    await x.waitFor(`document.body.innerText.includes('Keystore created')`, 15000);
    await shot('welcome');
    // The same screen once the toast has gone, for the image that sits beside a directory page.
    await x.waitFor(`!document.body.innerText.includes('Keystore created')`, 15000);
    await shot('welcome-clean');
    shots.apps = path.join(outDir, 'apps.png');
    await pageShot(x, shots.apps, 'welcome.html');
    log('captured apps');

    // 3. The demo accounts, with Gatsby active, and everyone's profiles on the relay.
    for (const p of [personas.amelia, personas.gatsby]) {
      const r = await x.message({ type: 'SIDECAR_ADD_ACCOUNT', secret: p.secretHex, name: p.name });
      if (!r || !r.ok) throw new Error('adding ' + p.name + ' failed: ' + JSON.stringify(r));
    }
    await x.message({ type: 'SIDECAR_SET_ACTIVE', pubkey: personas.gatsby.pubkey });
    const put = (template, who) => { const e = NT.finalizeEvent(template, who.sk); x.relay.events.push(e); return e; };
    for (const p of Object.values(personas)) {
      put({ kind: 0, created_at: now - 5000, tags: [], content: JSON.stringify({ name: p.name, display_name: p.name, about: p.about || '', picture: p.picture, ...(p.banner ? { banner: p.banner } : {}), ...(p.lud16 ? { lud16: p.lud16 } : {}) }) }, p);
    }
    put({ kind: 3, created_at: now - 4000, tags: Array.from({ length: 101 }, (_, i) => ['p', (i + 1).toString(16).padStart(64, '0')]), content: '' }, personas.gatsby);
    x.relay.events.push(wallet.infoEvent());

    // Gatsby with no wallet yet: the setup screen, and the directory page that sends people to one.
    await x.reload();
    await tab(x, 'wallet');
    await shot('wallet-setup');
    shots.wallets = path.join(outDir, 'wallets.png');
    await pageShot(x, shots.wallets, 'wallets.html');
    log('captured wallets');

    // 4. The pretend wallet, connected to Gatsby, and the record of whom his zaps went to.
    const walletRelay = 'wss://' + WALLET_HOST;
    await x.message({ type: 'SIDECAR_SET_NWC', pubkey: personas.gatsby.pubkey, connection: wallet.connectionString(walletRelay, 'b2'.repeat(32)) });
    await x.message({ type: 'SIDECAR_SECRET_SET', store: 'paymeta', value: payMeta });

    await x.reload();
    await tab(x, 'profile');
    await shot('profile', { balloon: true });
    await tab(x, 'wallet');
    await x.waitFor(`document.body.innerText.includes('412,905')`, 20000);
    await x.sleep(1500);
    // Two real pieces of the screen that say nothing about the product here: the nag that this
    // wallet has no backup (dismissed as a person would, with its ×) and the first-post hint,
    // which the profile shot already shows once.
    await x.evaluate(`(() => { const n = document.querySelector('.wallet-nudge-x'); if (n) n.click(); const b = document.getElementById('first-post-balloon'); if (b) b.classList.add('hidden'); })()`);
    await x.sleep(600);
    await shot('wallet');

    // 5. A client asking, through the same window.nostr and window.webln any site uses: the page is a
    // real tab at the client's hostname with the extension's content scripts in it, and the cards
    // are the panel's own. Each is answered with Reject afterward so the next starts clean.
    const recipe = (live && live.recipe) || {};
    const clientPage = await x.openPage(live ? live.url : 'https://' + client + '/');
    await x.sleep(live ? 5000 : 1500);   // a real site takes a while to settle
    const answerNo = async () => {
      await x.evaluate(`[...document.querySelectorAll('#view-approval button')].find((b) => /^reject$/i.test(b.textContent.trim())).click()`);
      await x.waitFor(`document.getElementById('view-approval').classList.contains('hidden')`, 10000);
    };
    const cardUp = (ms) => x.waitFor(`!document.getElementById('view-approval').classList.contains('hidden') && document.getElementById('approval-host').textContent.includes(${JSON.stringify(client)})`, ms);
    const clientShot = async (name) => { const f = path.join(outDir, name + '.png'); await clientPage.screenshot(f, PAGE); shots[name] = f; log('captured ' + name); };
    await tab(x, 'activity');
    // The extension puts window.nostr into a page as it loads. Wait for it, and say what the page was doing if it never comes.
    const provided = await clientPage.evaluate('new Promise((r) => { let n = 0; const t = setInterval(() => { if (window.nostr || ++n > 100) { clearInterval(t); r(!!window.nostr); } }, 100); })');
    if (!provided) {
      const state = await clientPage.evaluate('({ href: location.href, title: document.title, text: (document.body && document.body.innerText || "").slice(0, 120) })');
      throw new Error('window.nostr never appeared on the client page: ' + JSON.stringify(state));
    }

    // Sign-in: the recipe clicks through the client's own login, which asks for the public key. With
    // no recipe the page is asked directly.
    if (recipe.login) await runSteps(clientPage, recipe.login);
    else await clientPage.evaluate('window.__ask = window.nostr.getPublicKey().catch(() => null); 1', { wait: false });
    try { await cardUp(20000); } catch (_) {
      throw new Error('The client never asked Sidecar for the public key' + (recipe.login ? '; check the "login" steps in the recipe' : ''));
    }
    await x.sleep(900);
    await shot('approve-login');
    if (live) await clientShot('client-login');
    await answerNo();

    // Payment: the recipe takes the client to something payable; if that does not raise the card on its
    // own, the page asks for a 21-sat payment directly, so the card is the same either way.
    const invoice = createInvoice({ sats: 21, description: 'Zap', seed: 3 });
    const ask = () => clientPage.evaluate(`window.__pay = (async () => { await window.webln.enable(); return window.webln.sendPayment(${JSON.stringify(invoice)}); })().catch(() => null); 1`, { wait: false });
    if (live && recipe.pay) {
      if (recipe.pay.url) { await clientPage.evaluate(`location.href = ${JSON.stringify(recipe.pay.url)}`, { wait: false }); await x.sleep(5000); }
      await runSteps(clientPage, recipe.pay.steps || []);
    }
    let raised = false;
    if (live && recipe.pay && (recipe.pay.steps || []).length) { try { await cardUp(8000); raised = true; } catch (_) { /* ask directly below */ } }
    if (!raised) { await ask(); await cardUp(20000); }
    await x.sleep(900);
    await shot('approve-pay');
    if (live) await clientShot('client-pay');
    await answerNo();
    await clientPage.close();
    if (x.errors.length) log('panel errors: ' + JSON.stringify(x.errors));
  } finally {
    x.close();
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* best effort */ }
  }
  return { shots, usedVault: personas.gatsby.fromVault, fromVault: Object.values(personas).filter((p) => p.fromVault).map((p) => p.name), fixtureKeys: Object.values(personas).filter((p) => !p.fromVault).map((p) => p.name), mismatched: Object.values(personas).filter((p) => !p.keyMatches).map((p) => p.name) };
}

module.exports = { capturePanels, openVault, loadGlobals, PANEL, PIN };
