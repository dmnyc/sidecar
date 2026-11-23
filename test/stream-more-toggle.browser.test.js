'use strict';

// THE MORE BUTTON HAS TO SAY WHETHER IT IS OPEN.
//
// Open and shut differed by a faint background shift, which nobody could read. It now says More
// while the list behind it is shut and Less while it is open, with a chevron that turns over, and
// the open state is tinted. This loads the real button markup from sidepanel.html, the real
// styles, and the real paintMoreToggle from streams.js into a real Chrome, and reads what the
// browser computes for each state.
//
// Needs a Chrome or Chromium binary (CHROME_PATH, or one of the usual places); without one
// it skips, like the other browser tests.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = process.env.STREAM_MORE_TOGGLE_ROOT || path.join(__dirname, '..');
const CHROME = require('./helpers/chrome-path').findChrome(); // never the Chrome you browse with: see helpers/chrome-path.js

function between(text, from, to) {
  const a = text.indexOf(from);
  const b = text.indexOf(to, a);
  if (a === -1 || b === -1) throw new Error('markers not found: ' + from);
  return text.slice(a, b);
}

function page() {
  const html = fs.readFileSync(path.join(ROOT, 'sidepanel.html'), 'utf8');
  const actions = between(html, '<div class="stream-directory-actions">', '<div id="stream-more-list"');
  const js = fs.readFileSync(path.join(ROOT, 'streams.js'), 'utf8');
  const paint = between(js, 'function paintMoreToggle()', 'paintMoreToggle();\n  document.getElementById(\'stream-more-toggle\')');
  return `<!doctype html><html data-theme="speakeasy"><head><meta charset="utf-8">
<link rel="stylesheet" href="file://${ROOT}/styles.css"><link rel="stylesheet" href="file://${ROOT}/streams.css"></head>
<body style="width:360px;margin:0"><div id="stream-directory">${actions}</div>
<script src="file://${ROOT}/i18n.js"></script>
<script>
(async () => {
  const out = {};
  const { t } = SidecarI18n;
  let moreOpen = false;
  ${paint}
  const toggle = document.getElementById('stream-more-toggle');
  toggle.hidden = false;
  const read = () => {
    const chevron = toggle.querySelector('.stream-more-chevron');
    const box = toggle.getBoundingClientRect(), text = toggle.querySelector('.stream-more-label').getBoundingClientRect(), mark = chevron.getBoundingClientRect();
    return {
      // The label and chevron, taken together, sit in the middle of the button: the space before the
      // label and after the chevron match.
      offCenter: Math.round(Math.abs((text.left - box.left) - (box.right - mark.right))),
      label: toggle.querySelector('.stream-more-label').textContent,
      expanded: toggle.getAttribute('aria-expanded'),
      chevron: getComputedStyle(chevron).transform,
      color: getComputedStyle(toggle).color,
      visible: toggle.offsetParent !== null && chevron.getBoundingClientRect().width > 0,
      width: Math.round(toggle.getBoundingClientRect().width),
    };
  };
  paintMoreToggle();
  out.shut = read();
  moreOpen = true; paintMoreToggle();
  out.open = read();
  moreOpen = false; paintMoreToggle();
  out.shutAgain = read();
  const pre = document.createElement('pre'); pre.id = 'result'; pre.textContent = JSON.stringify(out); document.body.append(pre);
})().catch((e) => { const pre = document.createElement('pre'); pre.id = 'result'; pre.textContent = JSON.stringify({ error: String(e && e.stack || e) }); document.body.append(pre); });
</script></body></html>`;
}

function measure() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-more-'));
  const file = path.join(dir, 'page.html');
  fs.writeFileSync(file, page());
  try {
    const r = spawnSync(CHROME, [
      '--headless=new', '--disable-gpu', '--no-sandbox', '--allow-file-access-from-files',
      `--user-data-dir=${path.join(dir, 'profile')}`, '--virtual-time-budget=10000', '--window-size=420,600',
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

test('MORE BECOMES LESS WHEN OPEN, WITH A CHEVRON THAT TURNS OVER AND A TINT', opts, () => {
  const r = measure();
  assert.equal(r.shut.label, 'More');
  assert.equal(r.shut.expanded, 'false');
  assert.equal(r.open.label, 'Less', 'the open button names what pressing it does');
  assert.equal(r.open.expanded, 'true');
  assert.equal(r.shut.visible && r.open.visible, true, 'the chevron is drawn, with a size, in both states');
  assert.notEqual(r.open.chevron, r.shut.chevron, 'the chevron turns over when open');
  assert.notEqual(r.open.color, r.shut.color, 'and the open button is tinted, not only shaded');
  assert.ok(r.shut.width > 80, 'the button is wider than its contents here, so centering can be seen');
  assert.ok(r.shut.offCenter <= 1 && r.open.offCenter <= 1, 'the label and chevron are centered in the button, as the plain word was (off by ' + r.shut.offCenter + 'px shut, ' + r.open.offCenter + 'px open)');
  assert.deepEqual(r.shutAgain, r.shut, 'closing it puts everything back');
});
