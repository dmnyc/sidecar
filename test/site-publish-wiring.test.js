'use strict';

// The wiring around the publish session: what loads it, what mints and checks
// sessions in the background, and the two approval surfaces' agreement about the
// card. The session module itself is exercised as code in test/site-publish.test.js;
// this file pins the glue around it, the way test/kind-grant.test.js does for its
// module — source assertions, because the background's switch is not liftable whole.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const manifest = JSON.parse(read('manifest.json'));
const background = read('background.js');
const composer = read('compose.js');
const panel = read('sidepanel.js');
const promptPage = read('prompt.js');

test('site-publish.js loads where the worker does', () => {
  assert.ok(manifest.background.scripts.includes('site-publish.js'),
    'the worker never loads the module, so SITEPUB is undefined and every publish fails');
  assert.match(background, /importScripts\([^)]*'site-publish\.js'/);
  assert.match(background, /const SITEPUB = self\.SidecarSitePublish;/);
});

test('the sign handler checks the session BEFORE the key is used', () => {
  const at = background.indexOf("case 'SIDECAR_SITE_SIGN':");
  assert.ok(at > -1, 'the sign handler is gone');
  const body = background.slice(at, background.indexOf("case 'SIDECAR_SITE_PUBLISH_END'", at));
  const checkAt = body.indexOf('SITEPUB.check(');
  const signAt = body.indexOf('KS.ownerSign(');
  assert.ok(checkAt > -1 && signAt > -1, 'the handler no longer names both gates');
  assert.ok(checkAt < signAt, 'the session is consulted after signing — the check decorates nothing');
  // The keystore lock is refused before anything else, like every owner path.
  assert.ok(body.indexOf('KS.isLocked()') < checkAt, 'a locked keystore must refuse before the session is read');
});

test('the approval mints the session only after the card answers once', () => {
  const at = background.indexOf("case 'SIDECAR_SITE_PUBLISH':");
  assert.ok(at > -1, 'the approval handler is gone');
  const body = background.slice(at, background.indexOf("case 'SIDECAR_SITE_SIGN'", at));
  const planAt = body.indexOf('SITEPUB.validatePlan(');
  const promptAt = body.indexOf('openPrompt(');
  const beginAt = body.indexOf('SITEPUB.begin(');
  assert.ok(planAt > -1 && promptAt > -1 && beginAt > -1, 'the handler no longer names its three steps');
  assert.ok(planAt < promptAt, 'a broken plan never reaches a card');
  assert.ok(promptAt < beginAt, 'the session is minted before the card answers');
  // The mint is behind the once-decision, not before openPrompt.
  assert.ok(body.indexOf("decision.action !== 'once'") < beginAt);
  // And the account is pinned: expectedPubkey mismatch refuses before anything else.
  assert.ok(body.indexOf('Account changed') < planAt);
});

test('a publish card lives longer than a note review, and says why', () => {
  assert.match(background, /SITE_PUBLISH_TTL/);
  assert.match(background, /data\.method === 'sitePublish' \? SITE_PUBLISH_TTL : REQUEST_TTL/);
  // The composer's side waits just as long — a caller budget under the queue's.
  assert.match(composer, /SITE_PUBLISH_WAIT_MS/);
});

test('the session ends with the lock and with the account', () => {
  const lock = background.slice(background.indexOf('async function lockKeystore'), background.indexOf('function bumpAutoLock'));
  assert.match(lock, /SITEPUB\.endAll\(\)/, 'a locked keystore leaves live signing sessions behind');
  const removal = background.slice(background.indexOf("case 'SIDECAR_REMOVE_ACCOUNT':"), background.indexOf("case 'SIDECAR_RENAME_ACCOUNT':"));
  assert.match(removal, /SITEPUB\.endForAccount\(message\.pubkey\)/);
});

test('the composer never signs a publish through the owner signer', () => {
  // The one rule the issue is about: the editor's publishes ride the session signer,
  // so the one approval scopes every signature. SIDECAR_OWNER_SIGN stays what it was —
  // the note path and the media uploader's auth events.
  assert.match(composer, /SIDECAR_SITE_SIGN/);
  assert.ok(!/siteSign[\s\S]{0,200}SIDECAR_OWNER_SIGN/.test(composer),
    'the site publisher reaches the owner signer');
});

test('both approval surfaces render the publish card, and hide Trust on it', () => {
  for (const [name, src] of [['prompt.js', promptPage], ['sidepanel.js', panel]]) {
    assert.ok(src.includes("data.method === 'sitePublish'"), name + ' has no publish card');
    // The card's rows must agree word for word — the two surfaces describe one click.
    for (const phrase of ['Your root site', 'files · {{size}}', 'the manifest already on your relays',
      'Unpublishing is not deletion. Relays and caches may keep copies of the site.']) {
      assert.ok(src.includes(phrase), name + ' is missing the card phrase: ' + phrase);
    }
  }
  // Trust is a sentence with no meaning on a card Sidecar asks for itself.
  assert.match(promptPage, /sitePublish'[\s\S]{0,200}els\.trust\.classList\.add\('hidden'\)/);
  assert.match(panel, /sitePublish'[\s\S]{0,120}hide\(trust\)/);
});

test('the card never batches, never relaxes, never carries a standing grant', () => {
  // isBatchableEntry whitelists methods; sitePublish is not in it.
  const batchable = background.slice(background.indexOf('function isBatchableEntry'), background.indexOf('function batchKeyOf'));
  assert.ok(!batchable.includes('sitePublish'));
  // The relax offer requires a content-sign method; the kind-grant offer rides
  // canKindGrant, which the background never sets on this card.
  const relax = panel.slice(panel.indexOf('const offerRelax'), panel.indexOf('if (offerRelax)'));
  assert.ok(!relax.includes('sitePublish'));
});
