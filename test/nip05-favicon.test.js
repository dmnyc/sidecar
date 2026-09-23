'use strict';

// THE DOMAIN'S MARK BESIDE A VERIFIED NIP-05.
//
// Two things are being guarded here, and only one of them is cosmetic.
//
// The first is that the mark is gated on the VERDICT. A favicon beside a name is
// borrowed credibility. Beside an identifier that just failed to verify, it would be
// borrowed from the very domain that declined to vouch for it, which makes
// "satoshi@bitcoin.org" a better lie wearing bitcoin.org's mark than it is as bare text.
//
// The second is that nip05Domain takes a string out of a STRANGER'S kind 0 and decides
// whether it becomes a URL the panel fetches. That is the whole attack surface of this
// feature, so it is tested as a parser rather than eyeballed as a regex.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const panel = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');
const bare = panel.replace(/^\s*\/\/.*$/gm, '');

// ---- the parser, lifted and run ----

const ctx = { String };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(
  panel.match(/function nip05Domain\(nip05\)[\s\S]*?\n  \}/)[0] + ';globalThis.f = nip05Domain;',
  ctx
);
const domainOf = ctx.f;

test('A NIP-05 RESOLVES TO A BARE DOMAIN OR TO NOTHING', () => {
  assert.equal(domainOf('alice@example.com'), 'example.com');
  assert.equal(domainOf('_@example.com'), 'example.com');
  assert.equal(domainOf('example.com'), 'example.com', 'a bare domain is a valid NIP-05');
  assert.equal(domainOf('alice@sub.example.co.uk'), 'sub.example.co.uk');
  assert.equal(domainOf('  alice@Example.COM  '), 'example.com', 'trimmed and lowercased');
  assert.equal(domainOf('alice@xn--80ak6aa92e.com'), 'xn--80ak6aa92e.com', 'punycode is a real domain');
});

test('ANYTHING THAT IS NOT A BARE DOMAIN IS REFUSED, NOT CLEANED UP', () => {
  // Each of these would become a request somewhere it should not, if the parser tried
  // to salvage a domain out of it rather than rejecting the whole value.
  const hostile = [
    'alice@evil.com/path',          // a path: must not fetch evil.com
    'alice@evil.com?x=1',           // a query
    'alice@evil.com#frag',
    'alice@evil.com:8080',          // a port
    'alice@user:pw@evil.com',       // credentials
    'alice@https://evil.com',       // a scheme
    'alice@//evil.com',             // protocol-relative
    'alice@localhost',              // no TLS, and the user's own machine
    'alice@127.0.0.1',              // ditto, numerically
    'alice@[::1]',
    'alice@',
    '@example.com',                 // no domain after the @? this one has one, see below
    'alice@-example.com',           // a label cannot start with a hyphen
    'alice@example-.com',           // nor end with one
    'alice@exa mple.com',           // a space
    'alice@example',                // no TLS-bearing dot
    'alice@.com',
    '',
    null,
    undefined,
  ];
  for (const v of hostile) {
    const got = domainOf(v);
    if (v === '@example.com') continue; // handled by its own assertion below
    assert.equal(got, '', 'expected no domain from ' + JSON.stringify(v) + ', got ' + JSON.stringify(got));
  }
  // An empty local part still names a real domain, and NIP-05 allows the bare form,
  // so this one IS accepted. Called out so the line above is not read as a gap.
  assert.equal(domainOf('@example.com'), 'example.com');
  // So is surrounding whitespace: the value is trimmed before the @ split, so a handle
  // copied with a trailing space is the same handle rather than a rejection.
  assert.equal(domainOf('alice@example.com '), 'example.com');
});

test('the parser never returns something that changes origin when made a URL', () => {
  // The belt to the braces above: whatever comes back, pasting it into the template the
  // caller uses must land on exactly that host.
  const inputs = ['alice@evil.com/x', 'a@ok.com', 'a@https://evil.com', 'a@ok.com:1', '@ok.com'];
  for (const v of inputs) {
    const d = domainOf(v);
    if (!d) continue;
    const u = new URL('https://' + d + '/favicon.ico');
    assert.equal(u.hostname, d, v + ' resolved to a value whose URL hostname is ' + u.hostname);
    assert.equal(u.pathname, '/favicon.ico', v + ' smuggled a path through');
    assert.equal(u.port, '');
    assert.equal(u.username, '');
  }
});

// ---- the gate ----

test('THE MARK IS PAINTED ONLY ON A VERDICT OF OK', () => {
  const fn = bare.slice(bare.indexOf('function paintNip05Favicon('));
  const body = fn.slice(0, fn.indexOf('\n  }\n'));
  assert.match(body, /if \(!res \|\| !res\.ok\) return;/,
    'an unverified NIP-05 can wear its domain’s mark');
  // Cleared BEFORE the verdict is read, because the badge beside it is also the recheck
  // affordance: a row that verified and then stopped verifying must lose the mark.
  const beforeGate = body.slice(0, body.indexOf('if (!res'));
  assert.match(beforeGate, /querySelector\('\.nip05-favicon'\)[\s\S]*remove\(\)/,
    'a stale mark survives a second verdict');
});

test('EVERY NIP-05 SURFACE PAINTS IT, NOT JUST THE ONE THAT WAS ASKED FOR', () => {
  // There are three places a NIP-05 renders, and they are far apart in this file: the
  // peek card for somebody else, the account overview drawer, and your own Profile tab.
  // Wiring one and calling it done is the recurring shape of a half-finished change here.
  // Minus one each for the function's own declaration.
  const badge = (bare.match(/paintNip05Badge\(/g) || []).length - 1;
  const fav = (bare.match(/paintNip05Favicon\(/g) || []).length - 1;
  assert.ok(badge >= 6, 'expected three surfaces and their recheck paths, found ' + badge);
  assert.equal(fav, badge,
    'every paintNip05Badge call needs a paintNip05Favicon beside it ' +
    '(' + badge + ' badge vs ' + fav + ' favicon)');

  // And they must be PAIRED, not merely equal in number: six of each in one surface and
  // none in another would satisfy a count.
  const lines = bare.split('\n');
  lines.forEach((ln, i) => {
    if (!/paintNip05Badge\(/.test(ln) || /function /.test(ln)) return;
    const near = lines.slice(i, i + 3).join('\n');
    assert.match(near, /paintNip05Favicon\(/,
      'line ' + (i + 1) + ' paints a badge with no mark beside it: ' + ln.trim());
  });
});

test('it reuses the relay host store rather than opening a second one', () => {
  const fn = bare.slice(bare.indexOf('function nip05FaviconEl('));
  const body = fn.slice(0, fn.indexOf('\n  }\n'));
  assert.match(body, /relayIconCache/, 'a host’s favicon does not depend on why we asked');
  assert.match(body, /rememberRelayIcon\(domain, ''\)/,
    'a domain with no favicon is not remembered as such, so every repaint re-walks it');
  assert.match(body, /relayIconCache\.has\(domain\) && !known/,
    "'' means checked-and-none; treating it as unknown re-asks forever");
  assert.match(body, /referrerPolicy: 'no-referrer'/);
  assert.match(body, /'https:\/\/' \+ domain \+ path/, 'the scheme must not come from the input');
});

test('the mark is invisible until it loads', () => {
  const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
  // A domain with no favicon must leave the line as it was, not a gap and not a
  // broken-image box. The class is added on load, so display is the right switch.
  assert.match(css, /\.nip05-favicon \{[^}]*display: none/);
  assert.match(css, /\.nip05-favicon\.ok \{ display: inline-block; \}/);
});
