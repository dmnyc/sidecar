#!/usr/bin/env node
'use strict';
// Builds the store screenshots from the real extension.
//
//   node scripts/store-screenshots/run.js [--vault FILE | --fixture-accounts] [--out DIR | --release X.Y.Z]
//                                          [--client HOST | --client-url URL [--recipe FILE]]
//                                          [--backdrop-login FILE] [--backdrop-pay FILE]
//
// --vault FILE        decrypt the demo vault (asks for its export password, hidden) so Gatsby and
//                     Amelia have their real keys. Defaults to the file named in
//                     SIDECAR_DEMO_VAULT, else ~/Sidecar Backups/demo-accounts-vault-2026-11-07.json.
// --fixture-accounts  no vault: fixed test keys, enough to check a layout. Never for a release.
// --client HOST       the client site the two approval cards name (default client.example). Which
//                     client to feature is decided at capture time.
// --client-url URL    make the client window a live page: the client's real site, loaded over the network,
//                     asking Sidecar for real. --recipe FILE says what to click (see recipes.js).
// --backdrop-login FILE, --backdrop-pay FILE
//                     a screenshot of the client's page to sit beside a card instead of the live page.
// --out DIR           where the PNGs go (default ~/.local/share/sidecar-images/captures/<time>).
// --release X.Y.Z     the final set, ready to upload: store/screenshots-X.Y.Z/chrome and /firefox, each a
//                     complete set of five, with capture-info.json beside them. It refuses test keys, a
//                     vault key that is not the person's, and a set with an image missing.
//
// Dev-only: scripts/ is stripped from the packaged extension by scripts/package.sh.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { capturePanels, openVault, loadGlobals } = require('./capture.js');
const { compose } = require('./compose.js');
const imageCore = require('../image-publish-core.js');
const { manifest, slotsFor } = require('./layout.js');

const ROOT = path.resolve(__dirname, '..', '..');

function gitHead() {
  try { return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(); } catch (_) { return 'unknown'; }
}
function treeDirty() {
  try { return execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: ROOT, encoding: 'utf8' }).trim() !== ''; } catch (_) { return true; }
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
  const release = opt('--release');
  if (release && !/^\d+\.\d+\.\d+$/.test(release)) throw new Error('--release takes a version such as 1.17.1');
  if (release && args.includes('--fixture-accounts')) throw new Error('A release set needs the real demo keys: leave out --fixture-accounts and open the vault');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const out = release
    ? path.join(ROOT, 'store', 'screenshots-' + release)
    : path.resolve(opt('--out') || path.join(os.homedir(), '.local', 'share', 'sidecar-images', 'captures', stamp));

  loadGlobals();
  let live = null;
  if (opt('--client-url')) {
    const recipeFile = opt('--recipe');
    const recipe = recipeFile ? JSON.parse(fs.readFileSync(path.resolve(recipeFile), 'utf8')) : {};
    live = { url: opt('--client-url'), recipe };
  }
  let vaultAccounts = null;
  if (!args.includes('--fixture-accounts')) {
    const file = opt('--vault') || process.env.SIDECAR_DEMO_VAULT || path.join(os.homedir(), 'Sidecar Backups', 'demo-accounts-vault-2026-11-07.json');
    const password = await imageCore.promptPassword('Demo vault password: ');
    vaultAccounts = await openVault(file, password);
    console.log('Vault opened: ' + vaultAccounts.map((a) => a.name).join(', '));
  }

  const work = release ? fs.mkdtempSync(path.join(os.tmpdir(), 'store-shots-run-')) : out;
  const { shots, usedVault, fromVault, fixtureKeys, mismatched } = await capturePanels({
    outDir: path.join(work, 'panels'), vaultAccounts, client: opt('--client') || undefined, live, log: (m) => console.log('  ' + m),
  });

  if (mismatched.length) {
    console.log('WARNING: the vault\'s key for ' + mismatched.join(', ') + ' is not the public key that person has. Check you opened the right vault.');
    if (release) throw new Error('A release set cannot use a key that is not the person\'s');
  }
  if (release && !usedVault) throw new Error('Gatsby\'s real key did not come from the vault, so the public key in the images would be a test key');

  // One set per browser: Chrome's, and Firefox's with the panel on the left where Firefox puts its
  // sidebar. The four-panel image has no side, so it is the same in both and is drawn into both.
  const files = [];
  const skipped = [];
  for (const firefox of [false, true]) {
    for (const image of manifest.images) {
      const sources = { ...shots };
      // A supplied screenshot of the client's page wins over the live one.
      if (image.backdropFlag && opt(image.backdropFlag)) sources[image.page] = path.resolve(opt(image.backdropFlag));
      const slots = slotsFor(image, { firefox });
      const missing = slots.filter((sl) => !sources[sl.role]);
      if (missing.length) { skipped.push(image.file); continue; }
      const dir = release ? path.join(out, firefox ? 'firefox' : 'chrome') : (firefox ? path.join(out, 'firefox') : out);
      fs.mkdirSync(dir, { recursive: true });
      files.push(compose({ out: path.join(dir, image.file), plate: manifest.plate, items: slots.map((sl) => ({ src: sources[sl.role], x: sl.x, y: sl.y, w: sl.w, h: sl.h, radius: sl.radius })) }));
    }
  }
  const skippedNames = [...new Set(skipped)];
  if (skippedNames.length) {
    const msg = 'No client page for ' + skippedNames.join(', ') + ' (use --client-url, or --backdrop-login and --backdrop-pay)';
    if (release) throw new Error(msg + '. A release set has all five.');
    console.log('  (' + msg + ', so they were skipped)');
  }

  if (release) {
    const build = (() => { try { return fs.readFileSync(path.join(ROOT, 'version.js'), 'utf8'); } catch (_) { return ''; } })();
    const shown = (build.match(/version: '([^']+)', commit: '([^']+)'/) || []).slice(1);
    const info = {
      version: release, capturedAt: new Date().toISOString(), commit: gitHead(), treeDirty: treeDirty(),
      versionShownOnLockScreen: shown.length ? shown[0] + ' (' + shown[1] + ')' : 'unknown',
      client: live ? live.url : (opt('--client') || 'client.example'), clientWindow: live ? 'live page' : 'supplied screenshots',
      keysFromVault: fromVault, testKeys: fixtureKeys,
      images: files.map((f) => path.relative(out, f)),
    };
    fs.writeFileSync(path.join(out, 'capture-info.json'), JSON.stringify(info, null, 2) + '\n');
    if (shown.length && shown[0] !== release) console.log('WARNING: the lock screen shows version ' + shown[0] + ', not ' + release + '. Run scripts/stamp-version.sh on the release commit and capture again.');
    if (info.treeDirty) console.log('WARNING: the working tree has uncommitted changes, so these images may show something that is not in the release.');
    fs.rmSync(work, { recursive: true, force: true });
  }

  console.log('Keys from the vault: ' + (fromVault.join(', ') || 'none') + (fixtureKeys.length ? '  |  test keys: ' + fixtureKeys.join(', ') : ''));
  if (!usedVault) console.log('Test keys were used, so the public key shown is not the real demo account\'s.');
  console.log('Wrote:\n  ' + files.join('\n  '));
}

main().catch((e) => { console.error('Error: ' + e.message); process.exitCode = 1; });
