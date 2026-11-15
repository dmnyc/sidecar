'use strict';

// The composer's emoji picker kept its search after it closed. Search "heart", pick one, and
// the next open showed the same word in the field and the same hits in the grid, so a person
// who wanted a different emoji had to delete the old search first. A test that reads the
// source cannot see that, so this one builds the real picker (i18n.js, emoji-data.js and
// composer-core.js, unchanged) in a real Chrome, searches, picks, closes and reopens.
//
// Needs a Chrome or Chromium binary (CHROME_PATH, or one of the usual places); without one
// it skips, like the other browser tests.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = process.env.EMOJI_PICKER_ROOT || path.join(__dirname, '..');
const candidates = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].filter(Boolean);
const CHROME = candidates.find((p) => fs.existsSync(p)) || null;

function page() {
  return `<!doctype html><html data-theme="speakeasy"><head><meta charset="utf-8">
<link rel="stylesheet" href="file://${ROOT}/styles.css"></head><body style="width:360px;margin:0">
<script src="file://${ROOT}/i18n.js"></script><script src="file://${ROOT}/emoji-data.js"></script><script src="file://${ROOT}/composer-core.js"></script>
<script>
(async () => {
  const out = {};
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const picked = [];
  const picker = window.SidecarCore.buildEmojiPicker({ onPick: (ch) => picked.push(ch) });
  document.body.append(picker.addBtn, picker.wrap);
  const input = picker.wrap.querySelector('.emoji-picker-search');
  const cells = () => [...picker.wrap.querySelectorAll('.emoji-cell')];
  const tabs = () => [...picker.wrap.querySelectorAll('.emoji-tab')];
  const look = () => ({
    open: picker.isOpen(),
    query: input.value,
    cells: cells().length,
    activeTabs: tabs().map((t, i) => (t.classList.contains('active') ? i : -1)).filter((i) => i >= 0),
    none: !!picker.wrap.querySelector('.emoji-none'),
  });
  const search = async (q) => { input.value = q; input.dispatchEvent(new Event('input')); await wait(300); };

  picker.open();
  out.first = look();

  // Search, pick the first hit: the picker closes itself.
  await search('heart');
  out.searched = look();
  cells()[0].click();
  out.picked = picked.length;
  out.afterPick = look();
  picker.open();
  out.reopenedAfterPick = look();

  // Search, then close with the picker's own X.
  await search('star');
  picker.wrap.querySelector('.emoji-picker-x').click();
  picker.open();
  out.reopenedAfterX = look();

  // Search, then close from the toolbar button (it toggles).
  await search('moon');
  picker.addBtn.click();
  picker.addBtn.click();
  out.reopenedAfterToggle = look();

  // Search, then Escape.
  await search('sun');
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  picker.open();
  out.reopenedAfterEscape = look();

  // A search with no match, then close: the "no match" line goes with it.
  await search('zzzzqqq');
  out.noMatch = look();
  picker.close();
  picker.open();
  out.reopenedAfterNoMatch = look();

  // No search at all: the group you were on is still the group you see.
  tabs()[3].click();
  out.onGroup3 = look();
  picker.close();
  picker.open();
  out.reopenedOnGroup3 = look();

  const pre = document.createElement('pre'); pre.id = 'result'; pre.textContent = JSON.stringify(out); document.body.append(pre);
})().catch((e) => { const pre = document.createElement('pre'); pre.id = 'result'; pre.textContent = JSON.stringify({ error: String(e && e.stack || e) }); document.body.append(pre); });
</script></body></html>`;
}

function measure() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-emoji-'));
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

test('THE SEARCH IS GONE THE NEXT TIME THE EMOJI PICKER OPENS', opts, () => {
  const r = measure();

  // The setup does what it says: a first open shows a group, a search narrows the grid.
  assert.equal(r.first.query, '');
  assert.deepEqual(r.first.activeTabs, [0]);
  assert.ok(r.first.cells > 0);
  assert.equal(r.searched.query, 'heart');
  assert.deepEqual(r.searched.activeTabs, [], 'a search shows no group as active');
  assert.ok(r.searched.cells > 0, 'the search found something');
  assert.equal(r.picked, 1, 'the click picked an emoji');
  assert.equal(r.afterPick.open, false, 'a pick closes the picker');

  // The bug: each way of closing left the query and its hits behind.
  for (const way of ['reopenedAfterPick', 'reopenedAfterX', 'reopenedAfterToggle', 'reopenedAfterEscape', 'reopenedAfterNoMatch']) {
    assert.equal(r[way].open, true, way + ': open');
    assert.equal(r[way].query, '', way + ': the field is empty');
    assert.equal(r[way].none, false, way + ': no stale "no match" line');
    assert.deepEqual(r[way].activeTabs, [0], way + ': back on the group you were on');
    assert.equal(r[way].cells, r.first.cells, way + ': the whole group is showing again, not the last hits');
  }

  // Unchanged: with no search, the picker reopens on the group you left it on.
  assert.deepEqual(r.reopenedOnGroup3.activeTabs, [3]);
  assert.equal(r.reopenedOnGroup3.cells, r.onGroup3.cells);
});
