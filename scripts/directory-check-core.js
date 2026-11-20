'use strict';

// The app directory (welcome.js) and the wallets list (wallets.js), read as data and judged:
// a site that no longer answers, a logo that is gone or comes back as something other than
// a picture. The network and the browser live in check-directory.js; this file holds what
// can be tested without either.

const fs = require('node:fs');
const path = require('node:path');

// Both files are plain browser scripts, so the lists are pulled out and evaluated alone,
// with t() as the identity: the English is what the checks print.
function extract(src, re, what) {
  const m = src.match(re);
  if (!m) throw new Error(`${what} not found`);
  const t = (x) => x;
  return new Function('t', `return ${m[1]}`)(t);
}

function readDirectory(root) {
  const apps = extract(fs.readFileSync(path.join(root, 'welcome.js'), 'utf8'),
    /function apps\(\) \{\s*return\s*(\[[\s\S]*?\n\s*\]);?\s*\}/, 'function apps() in welcome.js');
  const wallets = extract(fs.readFileSync(path.join(root, 'wallets.js'), 'utf8'),
    /const WALLETS = (\[[\s\S]*?\n\]);/, 'const WALLETS in wallets.js');
  return [
    ...apps.map((e) => ({ ...e, list: 'apps' })),
    ...wallets.map((e) => ({ ...e, list: 'wallets' })),
  ];
}

// The same address the pages fall back to when an entry names no icon of its own.
function faviconUrl(domain) {
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
}

// Every address a card shows or loads: its link, a second link if it has one, and its logo.
// An inline `logo` is markup carried in the file, so there is nothing to fetch.
function targets(entry) {
  const out = [{ kind: 'page', url: entry.url }];
  if (entry.extra && entry.extra.url) out.push({ kind: 'page', url: entry.extra.url, label: entry.extra.label, extra: true });
  if (entry.logo) return out;
  if (entry.icon && !/^https?:/i.test(entry.icon)) out.push({ kind: 'local-icon', url: entry.icon });
  else if (entry.icon) out.push({ kind: 'icon', url: entry.icon });
  else out.push({ kind: 'favicon', url: faviconUrl(entry.domain) });
  return out;
}

// What a picture's first bytes say it is. A bot check or a site's catch-all page answers
// 200 with HTML, so the status alone says nothing about whether a logo is there.
function imageKind(buf) {
  if (!buf || !buf.length) return null;
  const b = buf;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (b[0] === 0xff && b[1] === 0xd8) return 'jpeg';
  if (b.slice(0, 3).toString('latin1') === 'GIF') return 'gif';
  if (b.slice(0, 4).toString('latin1') === 'RIFF' && b.slice(8, 12).toString('latin1') === 'WEBP') return 'webp';
  if (b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0) return 'ico';
  const head = b.slice(0, 512).toString('utf8').replace(/^﻿/, '').trimStart();
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/i.test(head)) return 'svg';
  return null;
}

// A response that is a bot check rather than the site. These hosts say so in a header.
function challengeOf(headers) {
  const h = (k) => (headers && (typeof headers.get === 'function' ? headers.get(k) : headers[k])) || '';
  if (/challenge/i.test(h('cf-mitigated'))) return 'Cloudflare bot check';
  if (/challenge/i.test(h('x-vercel-mitigated'))) return 'Vercel bot check';
  return null;
}

// One fetched address, judged. `res` is { status, headers, finalUrl, body (Buffer) } or
// { error } when nothing came back at all. Returns { level: 'ok'|'warn'|'fail', why }.
function judge(target, res, entry) {
  if (res.error) return { level: 'fail', why: `no answer (${res.error})` };
  const challenge = challengeOf(res.headers);
  // A person's browser passes a bot check in front of a site, so a link behind one is
  // only unverified. A picture behind one never draws: an <img> cannot pass it.
  if (challenge && target.kind === 'page') return { level: 'warn', why: `${challenge} (${res.status}): not verified here, open it by hand` };
  if (challenge) return { level: 'fail', why: `${challenge} (${res.status}) instead of the picture` };
  if (target.kind === 'page') {
    if (res.status >= 400) return { level: 'fail', why: `HTTP ${res.status}` };
    // A link that now lands on another site: a sold or parked domain, or a move the
    // entry should follow. Not a card's second link, which is a referral that redirects
    // by design.
    if (target.extra) return { level: 'ok' };
    const want = hostOf(target.url);
    const got = hostOf(res.finalUrl || target.url);
    if (want && got && !sameSite(want, got)) return { level: 'warn', why: `now lands on ${got}` };
    return { level: 'ok' };
  }
  if (target.kind === 'favicon' && res.status === 404) {
    // Google answers 404 alongside its gray globe when it has no icon for the domain.
    return { level: 'fail', why: `Google has no favicon for ${entry.domain}, so the card shows a gray globe` };
  }
  if (res.status >= 400) return { level: 'fail', why: `HTTP ${res.status}` };
  const kind = imageKind(res.body);
  if (!kind) {
    const type = (res.headers && (typeof res.headers.get === 'function' ? res.headers.get('content-type') : res.headers['content-type'])) || 'unknown type';
    return { level: 'fail', why: `not a picture (${type})` };
  }
  return { level: 'ok', kind };
}

function hostOf(u) {
  try { return new URL(u).hostname.toLowerCase(); } catch (_) { return null; }
}

// www. and a subdomain of the same site count as the same place.
function sameSite(a, b) {
  const strip = (h) => h.replace(/^www\./, '');
  a = strip(a); b = strip(b);
  return a === b || a.endsWith('.' + b) || b.endsWith('.' + a);
}

// A bundled icon: the file exists and is a picture.
function judgeLocal(root, target) {
  const file = path.join(root, target.url);
  if (!fs.existsSync(file)) return { level: 'fail', why: `missing file ${target.url}` };
  const kind = imageKind(fs.readFileSync(file));
  return kind ? { level: 'ok', kind } : { level: 'fail', why: `${target.url} is not a picture` };
}

module.exports = { readDirectory, targets, imageKind, challengeOf, judge, judgeLocal, faviconUrl, sameSite };
