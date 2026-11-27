'use strict';

// nostr.build's plans, through a referral link that credits Sidecar's creator. Offered where it answers something:
// an upload that nostr.build turned away for being over its free limit says so and links the
// plans, labeled as a referral link. Any other failure, a rate limit included, says only that
// the upload failed. The same address is used by the help guide and the app directory.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const ROOT = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'composer-core.js'), 'utf8');
const PLANS = 'https://getnb.me/4851-DF1E-A47B';
const FALLBACK = 'https://nostr.build/api/v2/upload/files';
const file = () => new Blob(['test image'], { type: 'image/gif' });

function harness(respond) {
  const document = { createElement: (tag) => ({ tagName: tag.toUpperCase(), append() {} }) };
  const ctx = {
    window: { SidecarI18n: { t: (key, values = {}) => key.replace(/\{\{(\w+)\}\}/g, (_, k) => values[k]), tn: (x) => x } },
    document, URL, TextEncoder, crypto: webcrypto, Uint8Array, AbortController, setTimeout, clearTimeout, btoa, FormData, Date,
    console: { warn() {} },
    fetch: async (url) => {
      if (url === FALLBACK) return respond();
      throw new Error('unexpected request ' + url);
    },
  };
  vm.createContext(ctx);
  vm.runInContext(source, ctx);
  const core = ctx.window.SidecarCore;
  const uploader = core.installComposer({
    activePubkey: () => 'a'.repeat(64),
    relayUrls: async () => ['wss://relay.example'],
    poolGet: async () => null, // no Blossom list: straight to nostr.build
    call: async (message) => (message.type === 'SIDECAR_GET_ACCOUNT_RELAYS' ? {} : message.event),
  });
  return { core, uploader };
}
const refusal = (status, body = '') => () => ({ ok: false, status, text: async () => body, json: async () => ({}) });

async function failure(respond) {
  const { core, uploader } = harness(respond);
  try { await uploader.uploadMedia(file()); } catch (e) { return { e, parts: core.uploadErrorParts(e) }; }
  assert.fail('the upload did not fail');
}

test('a 413 from nostr.build says the file is over the free limit and links the plans', async () => {
  const { e, parts } = await failure(refusal(413));
  assert.equal(e.message, 'This file is over nostr.build’s free upload limit.');
  assert.equal(parts.length, 2);
  assert.equal(parts[0], 'This file is over nostr.build’s free upload limit. ');
  assert.equal(parts[1].tagName, 'A');
  assert.equal(parts[1].href, PLANS);
  assert.equal(parts[1].textContent, 'nostr.build plans (referral link)', 'the link says it is a referral link');
  assert.equal(parts[1].rel, 'noopener noreferrer');
});

test('a refusal that says the file is too big counts too, whatever its status', async () => {
  for (const body of ['{"message":"File too large"}', 'maximum file size exceeded', 'Size limit reached for free accounts']) {
    const { e } = await failure(refusal(400, body));
    assert.equal(e.nbPlans, true, body);
  }
});

test('a rate limit, or any other failure, says only that the upload failed, with no link', async () => {
  for (const [status, body] of [[429, 'rate limit exceeded: too large a burst'], [500, ''], [401, 'unauthorized']]) {
    const { e, parts } = await failure(refusal(status, body));
    assert.equal(e.message, `Upload failed (${status})`);
    assert.deepEqual([...parts], [`Upload failed (${status})`]);
  }
});

test('the composers draw an upload error through uploadErrorParts, so the link is clickable', () => {
  const panel = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');
  const tab = fs.readFileSync(path.join(ROOT, 'compose.js'), 'utf8');
  assert.equal((panel.match(/err\.replaceChildren\(\.\.\.window\.SidecarCore\.uploadErrorParts\(e\)\)/g) || []).length, 2);
  assert.equal((tab.match(/err\.replaceChildren\(\.\.\.SC\.uploadErrorParts\(e\)\)/g) || []).length, 1);
});

test('the help guide and the app directory use the same plans address, and say it is a referral link', () => {
  const { core } = harness(refusal(500));
  assert.equal(core.NB_PLANS_URL, PLANS);
  const help = fs.readFileSync(path.join(ROOT, 'help.html'), 'utf8');
  const section = help.slice(help.indexOf('id="uploads"'), help.indexOf('</section>', help.indexOf('id="uploads"')));
  assert.ok(section.includes(`href="${PLANS}"`), 'the help guide links the plans');
  assert.match(section, /referral link/);
  const welcome = fs.readFileSync(path.join(ROOT, 'welcome.js'), 'utf8');
  assert.match(welcome, new RegExp(`extra: \\{ url: '${PLANS.replace(/[.]/g, '\\.')}', label: t\\('Plans \\(referral link\\)'\\) \\}`));
});
