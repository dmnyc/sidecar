'use strict';

// EVERY CLASS AND ID A SHIPPED STYLESHEET NAMES IS NAMED BY THE CODE TOO. A rule for markup
// that no longer exists costs nothing on screen, so nobody notices it: the one-time
// shared-identity card outlived its code by a release, with its colors still set in three
// themes. Each class and id in the CSS that the pages load must appear, as a whole word, in
// a .js or .html file outside the tests (docs/streaming's preview loads streams.css, so
// it counts). Names the code builds from parts are listed below with
// where they are built.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');

// Built at run time, so never written out whole.
const BUILT = [
  /^cat-/, // `cat-${…}` (welcome.js, wallets.js)
  /^toast-(error|success|progress)$/, // 'toast-' + kind (compose.js, sidepanel.js, thread.js)
  /^debug-log-(warn|error)$/, // 'debug-log-' + level (sidepanel.js)
];
// Kept on purpose with nothing using it yet; the reason is in the stylesheet.
const KEPT = new Set(['nixie-num']);

const tracked = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
const html = tracked.filter((f) => f.endsWith('.html') && !f.includes('/'));
const cssFiles = [...new Set(html.flatMap((f) => [...fs.readFileSync(path.join(ROOT, f), 'utf8').matchAll(/href="([^"]+\.css)"/g)].map((m) => m[1])))]
  .filter((f) => fs.existsSync(path.join(ROOT, f)));
const code = tracked.filter((f) => /\.(m?js|html)$/.test(f) && !/^(test|scripts|vendor)\//.test(f))
  .map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
const words = new Set(code.match(/[A-Za-z_][\w-]*/g));

test('the pages load the stylesheets this test reads', () => {
  for (const f of ['styles.css', 'streams.css', 'welcome.css', 'themes/ben-day.css']) assert.ok(cssFiles.includes(f), f + ' not found');
});

test('no stylesheet styles a class or id the code never names', () => {
  const dead = [];
  for (const f of cssFiles) {
    const text = fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));
    for (const m of text.matchAll(/([^{};]+)\{/g)) {
      const sel = m[1];
      if (sel.trim().startsWith('@')) continue;
      const bare = sel.replace(/"[^"]*"|'[^']*'/g, '').replace(/url\([^)]*\)/g, '');
      for (const [, tok] of bare.matchAll(/(?<![\w-])[.#](-?[A-Za-z_][\w-]*)/g)) {
        if (words.has(tok) || KEPT.has(tok) || BUILT.some((re) => re.test(tok))) continue;
        const line = text.slice(0, m.index + sel.length - sel.trimStart().length).split('\n').length;
        dead.push(`${f}:${line} ${tok}`);
      }
    }
  }
  assert.deepEqual(dead, []);
});
