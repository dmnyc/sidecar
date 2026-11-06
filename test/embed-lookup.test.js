'use strict';

// A nevent or note link usually has no relay hint and no author, so the composer used to ask
// only the account's own relays and showed "nostr event (not found)" for notes that every
// other client displays. These drive the real resolveEmbeds with a fake relay pool.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { withI18n } = require('./helpers/i18n.js');

const SRC = process.env.COMPOSER_CORE_SRC || path.join(__dirname, '..', 'composer-core.js');
const source = fs.readFileSync(SRC, 'utf8');
const lift = (re, label) => {
  const m = source.match(re);
  if (!m) throw new Error('Could not find ' + label);
  return m[0];
};

const ID = '81f32bdb3451c6bba1d5b4e6261d20ee407cf35bea9cd6a6c8030fc846ad1225';
const NOTE = { id: ID, pubkey: 'ee'.repeat(32), kind: 1, created_at: 1, content: 'hello', tags: [] };

function build({ holders, own = ['wss://own.example'] }) {
  const asked = [];
  const rendered = [];
  const ctx = withI18n({
    setTimeout: (fn, ms) => globalThis.setTimeout(fn, Math.min(ms, 20)),
    renderEmbedCard: (el, ev) => rendered.push(ev),
    deps: {
      relayUrls: async () => own,
      // A relay answers only if it holds the note; a stage with no holder never answers.
      poolGet: (relays) => {
        asked.push([...relays]);
        const hit = relays.find((u) => holders.includes(u));
        return hit ? Promise.resolve(NOTE) : new Promise(() => {});
      },
    },
  });
  vm.createContext(ctx);
  vm.runInContext(
    (source.includes('const LOOKUP_FALLBACK_RELAYS') ? lift(/const LOOKUP_FALLBACK_RELAYS = [^;]+;/, 'fallbacks') + '\n' + lift(/const LOOKUP_STAGE_MS = [^;]+;/, 'stage') + '\n' + lift(/async function findEvent\(ref\) \{[\s\S]*?\n  \}\n/, 'findEvent') : '') + '\n' +
    lift(/async function resolveEmbeds\(embeds\) \{[\s\S]*?\n  \}\n/, 'resolveEmbeds') + '\nglobalThis.resolveEmbeds = resolveEmbeds;',
    ctx
  );
  return { ctx, asked, rendered };
}

const card = () => {
  const cls = new Set(['loading']);
  return { classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c), has: (c) => cls.has(c) }, textContent: '', cls };
};

test('a note on the account\'s own relays is found there and no other relay is asked', async () => {
  const { ctx, asked, rendered } = build({ holders: ['wss://own.example'] });
  const el = card();
  await ctx.resolveEmbeds([{ el, ref: { filter: { ids: [ID] }, relays: [] } }]);
  assert.equal(rendered.length, 1);
  assert.equal(asked.length, 1, 'the public relays are only for a miss');
  assert.deepEqual(asked[0], ['wss://own.example']);
});

test('a note only a public relay holds is found instead of reading "not found"', async () => {
  const { ctx, asked, rendered } = build({ holders: ['wss://nostr.wine'] });
  const el = card();
  await ctx.resolveEmbeds([{ el, ref: { filter: { ids: [ID] }, relays: [] } }]);
  assert.equal(rendered.length, 1, 'the card is drawn');
  assert.equal(el.cls.has('embed-missing'), false);
  assert.equal(asked.length, 2, 'own relays first, then the public ones');
  assert.ok(asked[1].includes('wss://nostr.wine'));
});

test('a note no relay holds still reads "not found"', async () => {
  const { ctx, rendered } = build({ holders: [] });
  const el = card();
  await ctx.resolveEmbeds([{ el, ref: { filter: { ids: [ID] }, relays: [] } }]);
  assert.equal(rendered.length, 0);
  assert.equal(el.cls.has('embed-missing'), true);
  assert.equal(el.textContent, 'nostr event (not found)');
});
