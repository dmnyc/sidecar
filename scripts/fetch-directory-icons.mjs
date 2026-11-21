#!/usr/bin/env node
// Copies every app and wallet logo the directory loads from the web into icons/apps/, so a
// card's picture never depends on someone else's server being up, or on a bot check that an
// <img> cannot pass. Run it when a card is added or a site changes its logo:
//
//   node scripts/fetch-directory-icons.mjs            fetch what is missing
//   node scripts/fetch-directory-icons.mjs --refresh  fetch every one again
//
// For each card it tries, in order: the logo the card names; the Internet Archive's copy
// of that exact file (for a site whose host answers with a bot check); and Google's favicon
// service at 128px, which is also what a card naming no logo always used. A download counts
// only when its bytes are a picture. Raster images over 128px are scaled down with sips.
// What it fetched, and from where, is written to scripts/data/directory-icons.json; the
// cards themselves are pointed at the files by hand, with the source in a comment.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const core = require('./directory-check-core.js');
const OUT_DIR = path.join(ROOT, 'icons', 'apps');
const RECORD = path.join(ROOT, 'scripts', 'data', 'directory-icons.json');
const refresh = process.argv.includes('--refresh');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const EXT = { png: 'png', jpeg: 'jpg', gif: 'gif', webp: 'webp', svg: 'svg', ico: 'ico' };

export const slugOf = (name) => name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

async function get(url) {
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'image/avif,image/webp,image/svg+xml,image/*,*/*;q=0.8' }, redirect: 'follow', signal: AbortSignal.timeout(20000) });
    const body = Buffer.from(await res.arrayBuffer());
    if (!res.ok || core.challengeOf(res.headers)) return null;
    const kind = core.imageKind(body);
    return kind ? { kind, body } : null;
  } catch (_) { return null; }
}

function sources(entry) {
  const out = [];
  if (entry.icon && /^https?:/i.test(entry.icon)) {
    out.push({ from: 'site', url: entry.icon });
    out.push({ from: 'archive', url: `https://web.archive.org/web/2026id_/${entry.icon}` });
  }
  out.push({ from: 'google', url: `https://www.google.com/s2/favicons?domain=${entry.domain}&sz=128` });
  return out;
}

const record = fs.existsSync(RECORD) ? JSON.parse(fs.readFileSync(RECORD, 'utf8')) : {};
const entries = core.readDirectory(ROOT).filter((e) => !e.logo && (!e.icon || /^https?:/i.test(e.icon)));
const seen = new Set();
let failed = 0;
for (const e of entries) {
  const slug = slugOf(e.name);
  if (seen.has(slug)) continue; // the same app in both lists shares one file
  seen.add(slug);
  const have = fs.readdirSync(OUT_DIR).find((f) => f.replace(/\.[^.]+$/, '') === slug);
  if (have && !refresh) { console.log(`have     ${e.list.padEnd(8)} ${e.name}: icons/apps/${have}`); continue; }
  let got = null; let src = null;
  for (const s of sources(e)) { got = await get(s.url); if (got) { src = s; break; } }
  if (!got) { failed++; console.log(`FAILED   ${e.list.padEnd(8)} ${e.name}: no source gave a picture`); continue; }
  if (have) fs.rmSync(path.join(OUT_DIR, have));
  const file = path.join(OUT_DIR, `${slug}.${EXT[got.kind]}`);
  fs.writeFileSync(file, got.body);
  if (['png', 'jpeg'].includes(got.kind)) {
    const w = Number(execFileSync('sips', ['-g', 'pixelWidth', file]).toString().match(/pixelWidth: (\d+)/)[1]);
    if (w > 128) execFileSync('sips', ['-Z', '128', file], { stdio: 'ignore' });
  }
  record[slug] = { name: e.name, domain: e.domain, from: src.from, url: src.url.replace('https://web.archive.org/web/2026id_/', ''), kind: got.kind };
  console.log(`fetched  ${e.list.padEnd(8)} ${e.name}: icons/apps/${path.basename(file)} (${src.from}, ${fs.statSync(file).size} bytes)`);
}
fs.mkdirSync(path.dirname(RECORD), { recursive: true });
fs.writeFileSync(RECORD, JSON.stringify(Object.fromEntries(Object.entries(record).sort()), null, 2) + '\n');
console.log(failed ? `\n${failed} without a picture.` : '\nEvery card has a picture.');
process.exit(failed ? 1 : 0);
