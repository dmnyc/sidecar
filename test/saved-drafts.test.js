'use strict';

// Saved drafts: which drafts are listed, in what order, and that the trash asks before
// it deletes. The list is composer-core's, shared by the panel's folder and the tab's
// Saved drafts tab, so it is lifted and run here against a small fake DOM rather than
// asserted from source.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { withI18n } = require('./helpers/i18n');

const ROOT = path.join(__dirname, '..');
const core = fs.readFileSync(path.join(ROOT, 'composer-core.js'), 'utf8');
const panel = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');

function lift(name) {
  const at = core.indexOf('  function ' + name + '(');
  assert.ok(at > -1, name + ' is gone from composer-core.js');
  return core.slice(at, core.indexOf('\n  }\n', at) + 4);
}

// Just enough of an element for the list: classes, children, text, listeners.
function fakeEl(tag) {
  const classes = new Set();
  const el = {
    tag, children: [], listeners: {}, isConnected: true, disabled: false, textContent: '',
    classList: {
      add: (c) => classes.add(c), remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c),
    },
    append(...kids) { el.children.push(...kids); },
    addEventListener(type, fn) { el.listeners[type] = fn; },
    click() { return el.listeners.click && el.listeners.click(); },
  };
  Object.defineProperty(el, 'className', {
    set(v) { v.split(/\s+/).filter(Boolean).forEach((c) => classes.add(c)); },
  });
  return el;
}
function find(el, cls) {
  if (el.classList && el.classList.contains(cls)) return el;
  for (const k of el.children || []) { const f = find(k, cls); if (f) return f; }
  return null;
}

function load() {
  const ctx = withI18n({
    console,
    Date,
    h: (tag, props, kids) => {
      const el = fakeEl(tag);
      Object.assign(el, props || {});
      (kids || []).forEach((k) => el.append(k));
      return el;
    },
    icon: () => fakeEl('svg'),
    relTime: () => '5m ago',
    stripDraftMediaUrls: (text) => text || '',
    setTimeout, clearTimeout,
  });
  vm.createContext(ctx);
  vm.runInContext(
    ['draftHasContent', 'otherDraftEntries', 'draftSnippet', 'buildSavedDraftList'].map(lift).join('\n') +
      '\nthis.draftHasContent = draftHasContent; this.otherDraftEntries = otherDraftEntries;' +
      ' this.buildSavedDraftList = buildSavedDraftList;',
    ctx
  );
  return ctx;
}
// Arrays made in the vm context have its Array prototype, which deepStrictEqual rejects.
const plain = (v) => JSON.parse(JSON.stringify(v));

const PK = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);
const N1 = '1'.repeat(64);
const N2 = '2'.repeat(64);

test('only this account\'s drafts with something in them, never the one on screen', () => {
  const { otherDraftEntries } = load();
  const all = {
    [PK]: { text: 'my note', savedAt: 1 },
    [PK + '|r:' + N1]: { text: '', media: [], replyTo: { id: N1 }, savedAt: 5 },   // empty reply slot
    [PK + '|r:' + N2]: { text: 'a reply', replyTo: { id: N2 }, savedAt: 3 },
    [OTHER]: { text: 'another account', savedAt: 9 },
  };
  const fromReply = otherDraftEntries(all, PK, PK + '|r:' + N2);
  assert.deepEqual(plain(fromReply.map((e) => e.key)), [PK], 'the empty reply and the other account are left out');
  const fromNote = otherDraftEntries(all, PK, PK);
  assert.deepEqual(plain(fromNote.map((e) => e.replyId)), [N2]);
});

test('the note first, then replies newest first', () => {
  const { otherDraftEntries } = load();
  const all = {
    [PK + '|r:' + N1]: { text: 'older', savedAt: 1 },
    [PK + '|r:' + N2]: { text: 'newer', savedAt: 9 },
    [PK]: { text: 'note', savedAt: 0 },
  };
  assert.deepEqual(plain(otherDraftEntries(all, PK, 'none').map((e) => e.key)),
    [PK, PK + '|r:' + N2, PK + '|r:' + N1]);
});

test('a poll with an option typed, or media alone, counts as something', () => {
  const { draftHasContent } = load();
  assert.equal(draftHasContent({ text: ' ', poll: { options: ['', 'yes'] } }), true);
  assert.equal(draftHasContent({ text: '', media: [{ url: 'x' }] }), true);
  assert.equal(draftHasContent({ text: '  ', media: [], poll: { options: ['', ''] } }), false);
});

test('a row opens its draft; the trash asks first, and the second tap deletes', async () => {
  const { otherDraftEntries, buildSavedDraftList } = load();
  const entries = otherDraftEntries({ [PK]: { text: 'my note', savedAt: 1 } }, PK, 'none');
  const picked = [];
  const deleted = [];
  const list = buildSavedDraftList({
    entries,
    onPick: (e) => picked.push(e.key),
    onDelete: async (e) => { deleted.push(e.key); },
  });
  const row = find(list, 'saved-draft');
  const open = find(row, 'saved-draft-open');
  const trash = find(row, 'saved-draft-x');
  const label = find(row, 'saved-draft-label');

  open.click();
  assert.deepEqual(picked, [PK], 'tapping the row opens the draft');

  trash.click();
  assert.equal(row.classList.contains('confirming'), true);
  assert.equal(label.textContent, 'Delete this draft?');
  assert.deepEqual(deleted, [], 'one tap does not delete');

  // While it asks, the row's own tap is the second tap, not an open.
  await open.click();
  assert.deepEqual(deleted, [PK]);
  assert.deepEqual(picked, [PK], 'the confirming tap did not also open the draft');
});

test('the panel lists them behind the folder, beside the close box', () => {
  assert.match(panel, /const \{ otherDraftEntries, buildSavedDraftList \} = window\.SidecarCore;/);
  assert.match(panel, /className: 'modal-x compose-drafts-btn hidden'/);
  // A pick opens that draft directly rather than asking "Resume your draft?" again.
  assert.match(panel, /openComposer\('', \{ replyTo: entry\.draft\.replyTo \|\| null, resumeSaved: true \}\)/);
  assert.match(panel, /if \(hasSaved && opts && opts\.resumeSaved\) resumeFrom\(saved\);/);
  // And leaving does not save over, or bounce back to, the draft being left.
  assert.match(panel, /switchingDraft = true;\s*closeModal\(\);/);
  assert.match(panel, /if \(!switchingDraft && opts && typeof opts\.returnTo === 'function'\)/);
});
