'use strict';

// A sign card names what it signs in the line under the host, on both approval surfaces.
// Every sign card used to read "wants to sign an event with your key", so a run of them
// from one site looked like one card that would not go away. These run the real functions.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const panel = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');
const prompt = fs.readFileSync(path.join(ROOT, 'prompt.js'), 'utf8');

function lift(src, decl) {
  const at = src.indexOf(decl);
  assert.notEqual(at, -1, decl + ' is gone');
  let depth = 0;
  for (let i = src.indexOf('{', at); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(at, i + 1);
  }
  throw new Error('unbalanced ' + decl);
}
// tSec as English: fill {{params}} into the key.
const tSec = (s, p) => s.replace(/\{\{(\w+)\}\}/g, (_, k) => (p && p[k] != null ? String(p[k]) : ''));

const surfaces = {
  'side panel': (() => {
    const ctx = vm.createContext({ tSec });
    vm.runInContext(['function approvalKindLabels(', 'function approvalMethodAsk(', 'function approvalAsk(']
      .map((d) => lift(panel, d)).join('\n') + '\nthis.ask = approvalAsk;', ctx);
    return ctx.ask;
  })(),
  popup: (() => {
    const ctx = vm.createContext({ tSec });
    vm.runInContext(['function kindLabels(', 'function methodAsk(', 'function signAsk(']
      .map((d) => lift(prompt, d)).join('\n') + '\nthis.ask = signAsk;', ctx);
    return ctx.ask;
  })(),
};
const sign = (kind, wrapped = true) => ({ method: 'signEvent', params: wrapped ? { event: { kind } } : { kind } });

for (const [name, ask] of Object.entries(surfaces)) {
  test(name + ': a sign card names its kind', () => {
    assert.equal(ask(sign(7)), 'wants to sign: Reaction');
    assert.equal(ask(sign(1)), 'wants to sign: Note');
    assert.equal(ask(sign(30078)), 'wants to sign: App data');
    assert.equal(ask(sign(1, false)), 'wants to sign: Note', 'an event passed bare, without the { event } wrapper');
  });

  test(name + ': cards in a run read differently', () => {
    const run = [30078, 7, 1, 30078].map((k) => ask(sign(k)));
    assert.notEqual(run[0], run[1]);
    assert.notEqual(run[1], run[2]);
  });

  test(name + ': an unrecognized or missing kind keeps the general line', () => {
    assert.equal(ask(sign(48151)), 'wants to sign an event with your key');
    assert.equal(ask({ method: 'signEvent', params: {} }), 'wants to sign an event with your key');
    assert.equal(ask({ method: 'signEvent' }), 'wants to sign an event with your key');
  });

  test(name + ': other requests are unchanged', () => {
    assert.equal(ask({ method: 'getPublicKey' }), 'wants to see your public key (npub)');
    assert.equal(ask({ method: 'nip44.decrypt' }), 'wants to decrypt a message (NIP-44)');
  });
}

test('both surfaces put it in the line under the host', () => {
  assert.match(panel, /: approvalAsk\(data\);/);
  assert.match(prompt, /: signAsk\(data\);/);
});
