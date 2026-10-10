'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../sidepanel.js'), 'utf8');
function lift(name) {
  const start = source.indexOf('function ' + name + '(');
  assert.ok(start >= 0);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw Error('Unclosed function');
}
function fixture(draft, fail = false) {
  const notices = [];
  let finish;
  const write = new Promise(resolve => { finish = resolve; });
  const ctx = {
    draft, notices, dkey: 'account', saveTimer: null, published: false,
    handedToTab: false, switchingDraft: false, enteredEditor: true, powMinimizing: false,
    stopCountdown() {}, powCancel() {}, pruneReplyDrafts() {},
    chrome: { storage: { session: { remove: async () => {} } } },
    opts: { returnTo() { throw Error('Should not reopen a modal during approval'); } },
    t: s => s, toast: (...args) => notices.push(args),
    call: async msg => {
      if (msg.type === 'SIDECAR_SECRET_GET') return {};
      await write;
      if (fail) throw Error('Storage unavailable');
    },
  };
  vm.createContext(ctx);
  vm.runInContext([lift('saveComposeDraft'), lift('persistDraft'), lift('closeComposer')].join('\n'), ctx);
  return { ctx, notices, finish };
}
const settle = () => new Promise(resolve => setImmediate(resolve));
test('approval interruption announces a draft only after storage succeeds', async () => {
  const f = fixture({ text: 'Keep this note', media: [] });
  f.ctx.closeComposer('approval');
  await settle();
  assert.equal(f.notices.length, 0);
  f.finish();
  await settle();
  assert.deepEqual(f.notices, [['Draft saved', 'success']]);
});
for (const [label, draft, fail] of [
  ['empty draft', { text: '  ', media: [] }, false],
  ['failed save', { text: 'Keep this', media: [] }, true],
]) test(label + ' does not produce a saved confirmation', async () => {
  const f = fixture(draft, fail);
  f.ctx.closeComposer('approval');
  f.finish();
  await settle();
  assert.equal(f.notices.length, 0);
});
test('media-only draft gets a saved confirmation', async () => {
  const f = fixture({ text: '', media: [{ url: 'https://example.com/photo.jpg' }] });
  f.ctx.closeComposer('approval'); f.finish(); await settle();
  assert.equal(f.notices.length, 1);
});
test('ordinary close and unopened draft chooser do not announce interruption', async () => {
  for (const entered of [true, false]) {
    const f = fixture({ text: 'Draft', media: [] });
    f.ctx.opts = null;
    f.ctx.enteredEditor = entered;
    f.ctx.closeComposer(entered ? undefined : 'approval');
    f.finish(); await settle();
    assert.equal(f.notices.length, 0);
  }
});

test('queue arrival preserves the approval reason through modal cleanup', async () => {
  const f = fixture({ text: 'Interrupted draft', media: [] });
  const visible = new Set();
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      classList: { remove() {}, add() {} }, innerHTML: '',
    });
    return elements.get(id);
  };
  Object.assign(f.ctx, {
    pendingApproval: null, modalCleanup: f.ctx.closeComposer, modalGeneration: 1,
    document: { documentElement: { classList: { contains: () => true, remove() {} } } },
    $: element, modalCloseMs: () => 150, setTimeout() {},
    bg: async msg => msg.type === 'SIDECAR_GET_PENDING'
      ? { ok: true, result: { head: { id: 'request', data: { activePubkey: 'account' } } } }
      : { ok: true },
    renderInterrupted() {}, renderBacklog() {}, closeAcctMenu() {},
    show: el => visible.add(el), hide: el => visible.delete(el), flushDeferredMainRender() {},
  });
  // Run the real queue entry, modal teardown, and approval takeover. Only the
  // unrelated rendering of the payment/signing card below the takeover is omitted.
  const takeover = lift('showApproval').split('    const payment =')[0] + '\n}';
  vm.runInContext([lift('closeModal'), takeover, 'async ' + lift('syncApprovalOverlay')].join('\n'), f.ctx);
  await f.ctx.syncApprovalOverlay();
  assert.ok(visible.has(element('view-approval')));
  assert.equal(f.notices.length, 0, 'must await persistence');
  f.finish();
  await settle();
  assert.deepEqual(f.notices, [['Draft saved', 'success']]);
  await f.ctx.syncApprovalOverlay();
  assert.equal(f.notices.length, 1, 'queue refresh must not announce the same draft again');
});
