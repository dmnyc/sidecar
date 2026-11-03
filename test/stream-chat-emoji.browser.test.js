'use strict';

// The stream chat's input had no emoji picker, where the composer has one. This builds the real
// chat (stream-chat.js, with the real composer-core.js editor and picker and the real styles) in
// a real Chrome, opens it, and uses the picker the way a person does: open it, pick one at the
// caret, search, press Escape. A test that reads the source cannot see that the button is
// reachable, that the pick lands in the editor, or that Escape closes the picker and not the chat.
//
// Needs a Chrome or Chromium binary (CHROME_PATH, or one of the usual places); without one
// it skips, like the other browser tests.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = process.env.STREAM_CHAT_EMOJI_ROOT || path.join(__dirname, '..');
const candidates = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].filter(Boolean);
const CHROME = candidates.find((p) => fs.existsSync(p)) || null;

function page() {
  return `<!doctype html><html data-theme="speakeasy"><head><meta charset="utf-8">
<link rel="stylesheet" href="file://${ROOT}/styles.css"><link rel="stylesheet" href="file://${ROOT}/streams.css"></head>
<body style="width:360px;height:700px;margin:0">
<div id="stream-dock" style="height:40px"></div><div id="stream-info"></div>
<script src="file://${ROOT}/i18n.js"></script><script src="file://${ROOT}/nostr-tools.js"></script>
<script src="file://${ROOT}/emoji-data.js"></script><script src="file://${ROOT}/composer-core.js"></script>
<script src="file://${ROOT}/stream-core.js"></script><script src="file://${ROOT}/stream-chat.js"></script>
<script>
(async () => {
  const out = {};
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const author = 'a'.repeat(64);
  let signedIn = true;
  // The editor's collaborators belong to the panel; this test hands it ones that do nothing.
  const core = window.SidecarCore.installComposer(new Proxy({}, { get: () => () => {} }));
  window.SidecarStreamChatAccount = {
    identity: () => (signedIn ? { pubkey: 'b'.repeat(64), name: 'Dani' } : null),
    prepare: async () => {}, muted: () => false, cachedProfiles: () => new Map(),
    createMentionEditor: (o) => core.createMentionEditor(o),
    send: async (t) => t,
  };
  const item = { key: '30311:' + author + ':show', relays: [], host: author };
  const view = window.SidecarStreamChat.mount(null, () => item, () => true, () => {});
  const pane = () => document.getElementById('stream-chat-panel');
  const btn = () => pane().querySelector('.stream-chat-emoji');
  const picker = () => pane().querySelector('.emoji-picker');
  const editor = () => pane().querySelector('.compose-editor');
  const cells = () => [...picker().querySelectorAll('.emoji-cell')];
  const search = picker => picker.querySelector('.emoji-picker-search');

  view.open();
  await wait(50);
  out.chatOpen = !pane().hidden;
  out.hasButton = !!btn();
  out.buttonInIdentityRow = !!btn() && btn().parentElement.classList.contains('stream-chat-identity-row');
  out.pickerBeforeOpen = picker() && !picker().classList.contains('hidden');
  const form = pane().querySelector('.stream-chat-form');
  out.pickerIsFormChild = picker().parentElement === form;
  out.editorHeightBefore = editor().getBoundingClientRect().height;

  // Type, put the caret between the words, open the picker, pick the first emoji.
  editor().focus();
  editor().textContent = 'hello world';
  const range = document.createRange();
  range.setStart(editor().firstChild, 5); range.collapse(true);
  const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);
  editor().dispatchEvent(new Event('keyup', { bubbles: true }));
  btn().click();
  await wait(50);
  out.opened = !picker().classList.contains('hidden');
  out.expanded = btn().getAttribute('aria-expanded');
  out.cellsOnOpen = cells().length;
  const pw = picker().getBoundingClientRect(), fw = form.getBoundingClientRect();
  out.pickerFits = pw.left >= fw.left - 1 && pw.right <= fw.right + 1;
  const first = cells()[0].textContent;
  cells()[0].click();
  await wait(50);
  out.pickedChar = first;
  out.text = editor().textContent;
  out.closedAfterPick = picker().classList.contains('hidden');
  out.focusInEditor = document.activeElement === editor();
  out.editorHeightAfter = editor().getBoundingClientRect().height;

  // Search, then Escape: the picker closes and the chat stays.
  btn().click();
  await wait(50);
  const q = search(picker());
  q.value = 'heart'; q.dispatchEvent(new Event('input'));
  await wait(300);
  out.searchHits = cells().length;
  q.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await wait(50);
  out.escapeClosedPicker = picker().classList.contains('hidden');
  out.escapeKeptChat = !pane().hidden;

  // Hide chat is an icon button: it keeps its name for a screen reader and still hides the chat.
  const hide = pane().querySelector('.stream-chat-hide');
  out.hideIsIcon = !!hide && !!hide.querySelector('svg') && hide.textContent.trim() === '';
  out.hideName = hide && hide.getAttribute('aria-label');
  out.hideTall = !!hide && hide.getBoundingClientRect().height >= 44 && hide.getBoundingClientRect().width >= 44;
  hide.click();
  await wait(50);
  out.hideHidesChat = pane().hidden;
  document.getElementById('stream-chat-toggle').click();
  await wait(100);

  // Locked: the button is disabled and the picker is shut.
  btn().click();
  await wait(50);
  signedIn = false;
  window.dispatchEvent(new CustomEvent('sidecar-chat-account'));
  await wait(50);
  out.lockedDisabled = btn().disabled;
  out.lockedPickerClosed = picker().classList.contains('hidden');
  const pre = document.createElement('pre'); pre.id = 'result'; pre.textContent = JSON.stringify(out); document.body.append(pre);
})().catch((e) => { const pre = document.createElement('pre'); pre.id = 'result'; pre.textContent = JSON.stringify({ error: String(e && e.stack || e) }); document.body.append(pre); });
</script></body></html>`;
}

function measure() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-chat-emoji-'));
  const file = path.join(dir, 'page.html');
  fs.writeFileSync(file, page());
  try {
    const r = spawnSync(CHROME, [
      '--headless=new', '--disable-gpu', '--no-sandbox', '--allow-file-access-from-files',
      `--user-data-dir=${path.join(dir, 'profile')}`, '--virtual-time-budget=15000', '--window-size=420,900',
      '--dump-dom', `file://${file}`,
    ], { encoding: 'utf8', timeout: 60000 });
    const m = /<pre id="result">([\s\S]*?)<\/pre>/.exec(r.stdout || '');
    assert.ok(m, 'Chrome did not report: ' + (r.stderr || '').slice(0, 300));
    const out = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'));
    assert.ok(!out.error, out.error);
    return out;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const opts = { skip: CHROME ? false : 'no Chrome found', timeout: 90000 };

test('THE STREAM CHAT INPUT HAS THE COMPOSER’S EMOJI PICKER', opts, () => {
  const r = measure();
  assert.equal(r.chatOpen, true);
  assert.equal(r.hasButton, true, 'the chat has an emoji button');
  assert.equal(r.buttonInIdentityRow, true, 'the button sits in the identity row, beside Hide chat');
  assert.equal(r.pickerBeforeOpen, false, 'the picker starts shut');
  assert.equal(r.pickerIsFormChild, true, 'the picker opens inside the form, above the editor');

  assert.equal(r.opened, true, 'the button opens the picker');
  assert.equal(r.expanded, 'true');
  assert.ok(r.cellsOnOpen > 0, 'the first group is showing');
  assert.equal(r.pickerFits, true, 'the picker fits the form width');

  assert.ok(r.pickedChar, 'there was an emoji to pick');
  assert.equal(r.text, 'hello' + r.pickedChar + ' world', 'the emoji goes in at the caret, not the end');
  assert.equal(r.closedAfterPick, true, 'a pick closes the picker');
  assert.equal(r.focusInEditor, true, 'and the caret is back in the editor');
  assert.equal(r.editorHeightAfter, r.editorHeightBefore, 'the editor keeps its size');

  assert.ok(r.searchHits > 0, 'search finds emoji');
  assert.equal(r.escapeClosedPicker, true, 'Escape closes the picker');
  assert.equal(r.escapeKeptChat, true, 'and leaves the chat open');
  assert.equal(r.hideIsIcon, true, 'Hide chat is an icon with no visible text');
  assert.equal(r.hideName, 'Hide chat', 'and keeps its accessible name');
  assert.equal(r.hideTall, true, 'with a 44px tap target');
  assert.equal(r.hideHidesChat, true, 'and still hides the chat');

  assert.equal(r.lockedDisabled, true, 'a locked account cannot use the picker');
  assert.equal(r.lockedPickerClosed, true);
});
