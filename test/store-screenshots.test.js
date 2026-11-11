// scripts/store-screenshots: the pieces of the screenshot pipeline that can be checked without a
// browser. The browser half (the real extension, the pretend wallet answering the real panel) is
// proved by running the pipeline; these pin the parts that decide whether what it shows is right.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const DIR = path.join(ROOT, 'scripts', 'store-screenshots');
const { createWallet, createInvoice } = require(path.join(DIR, 'wallet-sim.js'));
const { personasFor, historyFor, EXPECTED_NPUB } = require(path.join(DIR, 'personas.js'));
const { slotsFor, manifest } = require(path.join(DIR, 'layout.js'));
const { runSteps } = require(path.join(DIR, 'recipes.js'));
const { pageFor } = require(path.join(DIR, 'compose.js'));
const { interfaceFiles } = require(path.join(DIR, 'needed.js'));
const { openVault, loadGlobals } = require(path.join(DIR, 'capture.js'));

const NT = loadGlobals();

// The panel's own invoice reader, lifted from the source so the test asks the code that will
// actually read the invoice.
function panelDecoder() {
  const src = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');
  const a = src.indexOf('const BECH32_CHARSET');
  const b = src.indexOf('// "Expires in');
  const s0 = src.indexOf('function bolt11Sats');
  const sats = src.slice(s0, src.indexOf('\n  }\n', s0) + 5);
  const ctx = { TextDecoder };
  vm.createContext(ctx);
  vm.runInContext(src.slice(a, b) + '\n' + sats + '\nthis.decode = decodeBolt11', ctx);
  return (inv) => JSON.parse(JSON.stringify(ctx.decode(inv)));
}

test('a generated invoice is read by the panel as the amount, description and expiry it was made with', () => {
  const decode = panelDecoder();
  const inv = createInvoice({ sats: 21, description: 'Zap', expirySeconds: 3600, now: 1800000000 });
  const d = decode(inv);
  assert.equal(d.sats, 21);
  assert.equal(d.description, 'Zap');
  assert.equal(d.expiry, 3600);
  assert.equal(d.timestamp, 1800000000);
  assert.equal(decode(createInvoice({ sats: 5000, description: 'a longer description, with “quotes”' })).sats, 5000);
});

test('an invoice altered by one character no longer reads, so the checksum is real', () => {
  const decode = panelDecoder();
  const inv = createInvoice({ sats: 21, description: 'Zap' });
  const bad = inv.slice(0, -2) + (inv.slice(-2, -1) === 'q' ? 'p' : 'q') + inv.slice(-1);
  assert.notEqual(decode(inv), null);
  assert.equal(decode(bad), null);
});

const WALLET_SK = 'a1'.repeat(32);
const CLIENT_SK = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
async function ask(wallet, method, params, { kind = 23194, to = wallet.pubkey } = {}) {
  const content = await NT.nip04.encrypt(CLIENT_SK, wallet.pubkey, JSON.stringify({ method, params }));
  const ev = NT.finalizeEvent({ kind, created_at: 1, tags: [['p', to]], content }, CLIENT_SK);
  const pushed = [];
  await wallet.handle(ev, { push: (e) => pushed.push(e) });
  if (!pushed.length) return { ev, answer: null };
  const answer = JSON.parse(await NT.nip04.decrypt(CLIENT_SK, wallet.pubkey, pushed[0].content));
  return { ev, answer, event: pushed[0] };
}

test('the pretend wallet answers the Wallet tab: balance in millisatoshis, newest-first history, wallet info', async () => {
  const txs = [
    { type: 'incoming', settled_at: 100, amount: 1000 },
    { type: 'outgoing', settled_at: 300, amount: 2000 },
    { type: 'incoming', settled_at: 200, amount: 3000 },
  ];
  const w = createWallet({ NT, secretKeyHex: WALLET_SK, balanceSats: 412905, transactions: txs });
  const bal = await ask(w, 'get_balance');
  assert.equal(bal.answer.result_type, 'get_balance');
  assert.equal(bal.answer.result.balance, 412905000);
  const list = await ask(w, 'list_transactions', { limit: 2 });
  assert.deepEqual(list.answer.result.transactions.map((t) => t.settled_at), [300, 200]);
  const info = await ask(w, 'get_info');
  assert.ok(info.answer.result.methods.includes('list_transactions') && info.answer.result.methods.includes('get_balance'));
});

test('the answer names the request it answers and is signed by the wallet', async () => {
  const w = createWallet({ NT, secretKeyHex: WALLET_SK, balanceSats: 1, transactions: [] });
  const { ev, event } = await ask(w, 'get_balance');
  assert.equal(event.kind, 23195);
  assert.equal(event.pubkey, w.pubkey);
  assert.ok(event.tags.some((t) => t[0] === 'e' && t[1] === ev.id));
  assert.ok(event.tags.some((t) => t[0] === 'p' && t[1] === ev.pubkey));
  assert.equal(NT.verifyEvent(event), true);
});

test('what the pretend wallet does not do, it says so, and it pays nothing', async () => {
  const w = createWallet({ NT, secretKeyHex: WALLET_SK, balanceSats: 5, transactions: [] });
  const r = await ask(w, 'pay_invoice', { invoice: 'lnbc1' });
  assert.equal(r.answer.error.code, 'NOT_IMPLEMENTED');
  assert.equal(r.answer.result, undefined);
});

test('it ignores events not addressed to it, and kinds that are not wallet requests', async () => {
  const w = createWallet({ NT, secretKeyHex: WALLET_SK, balanceSats: 1, transactions: [] });
  assert.equal((await ask(w, 'get_balance', {}, { to: 'f'.repeat(64) })).answer, null);
  assert.equal((await ask(w, 'get_balance', {}, { kind: 1 })).answer, null);
});

test('the connection string carries the wallet key, the relay and a client secret, as the panel parses them', () => {
  const w = createWallet({ NT, secretKeyHex: WALLET_SK, balanceSats: 1, transactions: [] });
  const s = w.connectionString('wss://wallet-relay.example', 'b2'.repeat(32));
  const u = new URL(s.replace('nostr+walletconnect://', 'https://'));
  assert.equal(u.hostname, w.pubkey);
  assert.equal(u.searchParams.get('relay'), 'wss://wallet-relay.example');
  assert.equal(u.searchParams.get('secret'), 'b2'.repeat(32));
});

test('the history: received zaps carry a signed zap request to Gatsby; sent zaps are named through the pay record', () => {
  const personas = personasFor({ NT, vaultAccounts: null });
  const now = 1800000000;
  const { rows, payMeta } = historyFor({ NT, personas, now });
  assert.deepEqual(rows.map((r) => r.settled_at), [...rows.map((r) => r.settled_at)].sort((a, b) => b - a), 'newest first');
  const received = rows.filter((r) => r.type === 'incoming' && r.description.startsWith('{'));
  assert.ok(received.length >= 2);
  for (const r of received) {
    const req = JSON.parse(r.description);
    assert.equal(req.kind, 9734);
    assert.equal(NT.verifyEvent(req), true, 'the zap request is genuinely signed by the zapper');
    assert.ok(req.tags.some((t) => t[0] === 'p' && t[1] === personas.gatsby.pubkey));
    assert.ok(req.tags.some((t) => t[0] === 'amount' && t[1] === String(r.amount)));
  }
  const sent = rows.filter((r) => r.type === 'outgoing');
  assert.ok(sent.length >= 3);
  for (const r of sent) assert.ok(payMeta[r.invoice] && /^[0-9a-f]{64}$/.test(payMeta[r.invoice].zapPubkey), 'each sent zap names its recipient');
  assert.equal(new Set(rows.map((r) => r.invoice)).size, rows.length, 'every invoice is unique');
});

test('a vault key that is not the public key a person has is noticed, and the right one is not', () => {
  const sk = Uint8Array.from({ length: 32 }, (_, i) => 200 - i);
  const hex = Buffer.from(sk).toString('hex');
  const wrong = personasFor({ NT, vaultAccounts: [{ name: 'Gatsby', nsec: NT.nip19.nsecEncode(sk) }] });
  assert.equal(wrong.gatsby.fromVault, true);
  assert.equal(wrong.gatsby.keyMatches, false, 'a different key under Gatsby’s name is flagged');
  assert.equal(wrong.gatsby.secretHex, hex);
  assert.equal(wrong.amelia.fromVault, false);
  assert.ok(EXPECTED_NPUB.gatsby.startsWith('npub1'));
});

test('the Firefox arrangement mirrors the page and the panel across the canvas and leaves the four-panel image alone', () => {
  const W = manifest.canvas.width;
  for (const image of manifest.images.filter((i) => i.layout === 'twoUp')) {
    const [cp, cs] = slotsFor(image);
    const [fp, fs_] = slotsFor(image, { firefox: true });
    assert.equal(fp.x, W - (cp.x + cp.w));
    assert.equal(fs_.x, W - (cs.x + cs.w));
    assert.deepEqual({ y: fp.y, w: fp.w, h: fp.h }, { y: cp.y, w: cp.w, h: cp.h });
    assert.ok(fs_.x + fs_.w <= fp.x, 'in Firefox the panel is to the left of the page');
    assert.ok(cp.x + cp.w <= cs.x, 'in Chrome the page is to the left of the panel');
  }
  const four = manifest.images.find((i) => i.layout === 'fourPanels');
  assert.deepEqual(slotsFor(four), slotsFor(four, { firefox: true }));
});

test('every slot sits inside the canvas, and no two slots in one image overlap', () => {
  for (const firefox of [false, true]) {
    for (const image of manifest.images) {
      const slots = slotsFor(image, { firefox });
      for (const s of slots) {
        assert.ok(s.x >= 0 && s.y >= 0 && s.x + s.w <= manifest.canvas.width && s.y + s.h <= manifest.canvas.height, image.file + ' ' + s.role);
      }
      for (let i = 0; i < slots.length; i++) {
        for (let j = i + 1; j < slots.length; j++) {
          const a = slots[i]; const b = slots[j];
          assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x, `${image.file}: ${a.role} overlaps ${b.role}`);
        }
      }
    }
  }
});

test('the page for a composite places each picture at its slot, rounded, on the plate color', () => {
  const html = pageFor({ width: 1280, height: 800, plate: '#2c1e53', items: [{ src: '/tmp/a b.png', x: 6, y: 47, w: 994, h: 707, radius: 6 }] });
  assert.match(html, /background:#2c1e53/);
  assert.match(html, /left:6px;top:47px;width:994px;height:707px;border-radius:6px/);
  assert.match(html, /file:\/\/\/tmp\/a%20b\.png/, 'a path with a space is a valid file URL');
});

// ---- the vault ----

async function makeVault(password, accounts) {
  const C = globalThis.SidecarCrypto;
  const kdf = C.newKdf(1000);
  const key = await C.deriveKey(password, kdf);
  const enc = await C.encryptString(key, JSON.stringify({ accounts }));
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vault-test-')), 'v.json');
  fs.writeFileSync(file, JSON.stringify({ version: 1, kdf, iv: enc.iv, ct: enc.ct }));
  return file;
}

test('a vault opens with its password, gives the accounts, and leaves a wallet connection behind on purpose', async () => {
  const file = await makeVault('pw-for-test', [{ name: 'Gatsby', nsec: 'nsec1xyz', picture: 'https://p.example/g.jpg', nwc: 'nostr+walletconnect://secret' }]);
  const accounts = await openVault(file, 'pw-for-test');
  assert.deepEqual(accounts, [{ name: 'Gatsby', nsec: 'nsec1xyz', picture: 'https://p.example/g.jpg' }]);
  assert.ok(!JSON.stringify(accounts).includes('walletconnect'), 'a real wallet connection is never carried into a screenshot run');
});

test('a wrong password, a non-vault file and an empty vault are each refused in plain words', async () => {
  const file = await makeVault('right', [{ name: 'A', nsec: 'x' }]);
  await assert.rejects(openVault(file, 'wrong'), /Incorrect password/);
  const junk = path.join(path.dirname(file), 'j.json');
  fs.writeFileSync(junk, '{"hello":1}');
  await assert.rejects(openVault(junk, 'x'), /not a Sidecar vault/);
  await assert.rejects(openVault(await makeVault('p', []), 'p'), /no accounts/);
});

// ---- recipes ----

function fakePage(answers = {}) {
  const log = [];
  return { log, evaluate: async (expr) => { log.push(expr); for (const [needle, value] of Object.entries(answers)) if (expr.includes(needle)) return value; return true; } };
}

test('a recipe clicks by visible text or selector, and fills a field', async () => {
  const page = fakePage();
  await runSteps(page, [{ click: 'Log in', after: 1 }, { click: 'css:#go', after: 1 }, { fill: 'css:input.name', text: 'x' }]);
  assert.equal(page.log.length, 3);
  assert.ok(page.log[0].includes('"Log in"'));
  assert.ok(page.log[1].includes('css:#go'));
  assert.ok(page.log[2].includes('input.name'));
});

test('a recipe step that finds nothing stops the run and names the step', async () => {
  await assert.rejects(runSteps(fakePage({ 'Got it': false }), [{ click: 'Got it!' }]), /nothing on the page matches Got it!/);
  await assert.rejects(runSteps(fakePage({ 'input.name': false }), [{ fill: 'css:input.name', text: 'x' }]), /no field matches/);
});

// ---- does the gallery need a pass ----

test('interface files are what the gallery can show, and nothing else triggers a pass', () => {
  const hits = interfaceFiles([
    'sidepanel.js', 'sidepanel.html', 'styles.css', 'welcome.html', 'welcome.js', 'wallets.css', 'prompt.js',
    'themes/ben-day.css', 'icons/sidecar-logo.svg', 'fonts/x.woff2',
    'CHANGELOG.md', 'help.html', 'background.js', 'test/x.test.js', 'scripts/package.sh', 'store/x.md', 'locales/de.json', 'manifest.json',
  ]);
  assert.deepEqual(hits, ['sidepanel.js', 'sidepanel.html', 'styles.css', 'welcome.html', 'welcome.js', 'wallets.css', 'prompt.js', 'themes/ben-day.css', 'icons/sidecar-logo.svg', 'fonts/x.woff2']);
  assert.deepEqual(interfaceFiles(['themes-notes.md', 'subdir/sidepanel.js', 'mysidepanel.js']), [], 'only the real files, not look-alikes');
});

// ---- the release set ----

function runner(args) {
  const { spawnSync } = require('node:child_process');
  return spawnSync(process.execPath, [path.join(DIR, 'run.js'), ...args], { encoding: 'utf8', env: { PATH: process.env.PATH } });
}

test('a release set refuses a malformed version and refuses test keys, before any browser starts', () => {
  const bad = runner(['--release', '1.17']);
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /takes a version such as 1\.17\.1/);
  const fixture = runner(['--release', '1.17.1', '--fixture-accounts']);
  assert.notEqual(fixture.status, 0);
  assert.match(fixture.stderr, /needs the real demo keys/);
  assert.ok(!fs.existsSync(path.join(ROOT, 'store', 'screenshots-1.17.1')), 'nothing was written');
});

// ---- repo rules ----

test('the screenshot pipeline names no client, person or company in its code', () => {
  const banned = /resolvr|astrolabe|apogee|yakihonne|jumble|damus|primal|nostr\.band|nsec\.app/i;
  const allowed = new Set(['personas.js']);   // personas.js holds public profile addresses as data, not names in prose
  for (const f of fs.readdirSync(DIR)) {
    if (!/\.(js|json)$/.test(f) || allowed.has(f)) continue;
    const text = fs.readFileSync(path.join(DIR, f), 'utf8')
      .replace(/DEFAULT_RELAY_HOSTS = \[[^\]]*\]/, '');   // the panel's own default relays are data about the panel
    assert.doesNotMatch(text, banned, f);
  }
});
