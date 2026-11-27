#!/usr/bin/env node
'use strict';

// Before every release: is every app and wallet in the directory still there?
//
//   node scripts/check-directory.js [--no-browser]
//
// Two passes over welcome.js (apps) and wallets.js (wallets):
//
// 1. Over HTTP, as a browser asks: each card's link and second link must answer, and each
//    logo must come back as a picture. A bot check or a site's catch-all page answers 200
//    with HTML, so a logo is judged by its bytes, not its status.
// 2. In the real extension, in Chrome: the Nostr apps and Wallets pages are opened and
//    every logo must actually draw. Some hosts hand a script a picture and a browser a bot
//    check (Snort did), and only this pass sees that.
//
// Prints what failed and exits 1, so a release does not go out with a dead card. A
// warning (a link that now lands on another site) is printed and does not fail.

const path = require('node:path');
const core = require('./directory-check-core');

const ROOT = path.resolve(__dirname, '..');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const TIMEOUT_MS = 20000;

async function fetchOnce(target) {
  const image = target.kind !== 'page';
  try {
    const res = await fetch(target.url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        'User-Agent': UA,
        Accept: image ? 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
          : 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    const body = Buffer.from(await res.arrayBuffer());
    return { status: res.status, headers: res.headers, finalUrl: res.url, body };
  } catch (e) {
    const cause = e && e.cause && (e.cause.code || e.cause.message);
    // What a browser would show instead of the site.
    if (/^ERR_TLS_CERT|CERT_|SELF_SIGNED|UNABLE_TO_VERIFY/.test(cause || '')) {
      return { error: `its certificate is not valid for this address (${cause}), so a browser shows a security warning` };
    }
    return { error: (e && e.name === 'TimeoutError') ? `timed out after ${TIMEOUT_MS / 1000}s` : (cause || (e && e.message) || String(e)) };
  }
}

// One retry, a moment later: a single dropped connection is not a dead site.
async function check(entry, target) {
  if (target.kind === 'local-icon') return core.judgeLocal(ROOT, target);
  let verdict = core.judge(target, await fetchOnce(target), entry);
  if (verdict.level === 'fail') {
    await new Promise((r) => setTimeout(r, 2000));
    verdict = core.judge(target, await fetchOnce(target), entry);
  }
  return verdict;
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]); }
  }));
  return out;
}

async function httpPass(entries) {
  const jobs = entries.flatMap((entry) => core.targets(entry).map((target) => ({ entry, target })));
  const verdicts = await pool(jobs, 8, ({ entry, target }) => check(entry, target));
  return jobs.map((j, i) => ({ ...j, verdict: verdicts[i] }));
}

// Every card's logo, as the page drew it. A logo that failed shows the card's initial in
// its place (the img's onerror), so either sign counts.
async function browserPass() {
  const { startExtension, sleep } = require('../test/helpers/real-extension');
  let x;
  try { x = await startExtension(); } catch (e) { if (e.skip) return { skipped: e.message }; throw e; }
  const rows = [];
  try {
    for (const [list, page] of [['apps', 'welcome.html#apps'], ['wallets', 'wallets.html']]) {
      const tab = await x.openPage(`chrome-extension://${x.extId}/${page}`);
      const settled = `(() => { const imgs = [...document.querySelectorAll('.card .favicon-wrap img')]; return imgs.length > 0 && imgs.every((i) => i.complete); })()`;
      for (let i = 0; i < 120 && !(await tab.evaluate(settled)); i++) await sleep(250);
      // Cards with a name: the apps page also draws an empty slot that is not an entry.
      const got = await tab.evaluate(`JSON.stringify([...document.querySelectorAll('.card')].filter((c) => c.querySelector('.card-name')).map((c) => {
        const img = c.querySelector('.favicon-wrap img');
        const fb = c.querySelector('.favicon-fallback');
        return {
          name: (c.querySelector('.card-name') || {}).textContent,
          src: img ? img.src : '(inline logo)',
          drawn: img ? (img.complete && img.naturalWidth > 0 && img.style.display !== 'none') : true,
          fallback: !!(fb && fb.style.display !== 'none'),
        };
      }))`);
      for (const r of JSON.parse(got)) rows.push({ list, ...r });
    }
  } finally { x.close(); }
  return { rows };
}

function line(list, name, what, why) {
  return `  ${list.padEnd(8)} ${String(name).padEnd(24)} ${what}\n  ${''.padEnd(8)} ${''.padEnd(24)} ${why}`;
}

(async () => {
  const entries = core.readDirectory(ROOT);
  console.log(`Checking ${entries.length} cards (${entries.filter((e) => e.list === 'apps').length} apps, ${entries.filter((e) => e.list === 'wallets').length} wallets)…`);

  const results = await httpPass(entries);
  const fails = results.filter((r) => r.verdict.level === 'fail');
  const warns = results.filter((r) => r.verdict.level === 'warn');
  console.log(`HTTP: ${results.length} addresses, ${fails.length} failed, ${warns.length} warnings.`);

  let browserFails = [];
  if (!process.argv.includes('--no-browser')) {
    const b = await browserPass();
    if (b.skipped) {
      console.log(`Browser: skipped (${b.skipped}). Run it where Chrome is installed before releasing.`);
    } else {
      browserFails = b.rows.filter((r) => !r.drawn || r.fallback);
      const expected = entries.length;
      console.log(`Browser: ${b.rows.length} cards drawn, ${browserFails.length} without their logo.`);
      if (b.rows.length !== expected) {
        browserFails.push({ list: '-', name: '(page)', src: '', count: true, why: `the pages drew ${b.rows.length} cards, the lists hold ${expected}` });
      }
    }
  }

  if (fails.length || browserFails.length) {
    console.log('\nFAILED');
    for (const r of fails) console.log(line(r.entry.list, r.entry.name, `${r.target.kind}: ${r.target.url}`, r.verdict.why));
    for (const r of browserFails) console.log(line(r.list, r.name, `logo in the browser: ${r.src}`, r.why || 'did not draw; the card shows its initial instead'));
  }
  if (warns.length) {
    console.log('\nWARNINGS');
    for (const r of warns) console.log(line(r.entry.list, r.entry.name, `${r.target.kind}: ${r.target.url}`, r.verdict.why));
  }
  if (!fails.length && !browserFails.length) console.log('\nEvery card answers and every logo draws.');
  process.exit(fails.length || browserFails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
