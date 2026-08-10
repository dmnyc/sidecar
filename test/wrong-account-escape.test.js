'use strict';

// Coverage for the "wrong account" hint on the signing approval.
//
// The problem: a client and Sidecar can disagree about which account is signed in, and the
// approval then names an identity the user didn't pick. The existing switcher can't always
// fix it, for two different reasons:
//   - on a single-login host it doesn't appear at all (it needs 2+ accounts signed in);
//   - on a shared host it DOES appear but is scoped to the accounts already signed in
//     there, so a user whose intended identity is a third one still can't reach it.
// Both were reported as Sidecar being stuck.
//
// The fix, on both approval surfaces:
//
//   Not the right account?
//   Detach and use another identity.          <- collapsed; expands to the account list
//     Picks who this site uses next, everywhere in Sidecar. Cancels this request ...
//     [ accounts, globally-active first and tagged, current signer excluded ]
//
// Picking a row DETACHES the host (clears its binding), makes that account active, and
// rejects the request. That is the same primitive as Settings -> Sites -> "Use <account>"
// (switchSiteModal in sidepanel.js) — the fix already existed, three levels into Settings,
// and the prompt is where the problem is actually discovered.
//
// Detach, not rebind: clearing the binding means the next getPublicKey re-pairs the host to
// whatever is active, so setActive is the line that decides who the user comes back as.
// Writing a new binding instead would pin an identity the site hasn't approved.
//
// Never "sign this one as them": the event the client built carries the pubkey the client
// still has cached, so signing it under another identity yields one correct event and then
// silent reverts on the next. That reads as working and isn't.
//
// The gate is deliberately BROAD: any content sign with at least one account the switcher
// can't offer. Every attempt to narrow it has been a bug.
//
// Two cuts tried to detect that the account was "pinned" (by a host binding, then by a
// client-stamped author pubkey). Both wrong — the case that matters most has no pin to
// observe, since a client showing account A while Sidecar's active account is B leaves
// nothing Sidecar can see. It cannot read the client's UI. Only the user can, which is the
// whole reason the escape exists.
//
// A third cut excluded shared-identity hosts on the grounds that "the real switcher is
// already showing". That produced the reported bug directly: the switcher on those hosts is
// scoped to accounts already authorized there, so suppressing the escape made a third
// account unreachable. The escape is now the COMPLEMENT of the switcher rather than an
// alternative to it, and the tests below pin that down, because it is the part most likely
// to get "tightened" back again.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const background = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
const sidepanelJs = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');
const sidepanelHtml = fs.readFileSync(path.join(ROOT, 'sidepanel.html'), 'utf8');
const promptJs = fs.readFileSync(path.join(ROOT, 'prompt.js'), 'utf8');
const promptHtml = fs.readFileSync(path.join(ROOT, 'prompt.html'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');

const PK_A = 'a'.repeat(64);
const PK_B = 'b'.repeat(64);
const HOST = 'jumble.social';

// ---------------------------------------------------------------------------
// 1. The payload gate
// ---------------------------------------------------------------------------
//
// Lifted verbatim from background.js rather than restated, so a change to the real
// condition either shows up here or breaks the lift.

function liftGate() {
  const m = background.match(/wrongAccountEscape: (.*),\n/);
  if (!m) throw new Error('Could not find the wrongAccountEscape gate in background.js');
  return m[1];
}

// Lifts the real list construction too, not just the gate. The two are one decision now —
// the gate is `escapeAccounts.length > 0`, so testing it against a hand-made array would
// prove nothing about which accounts actually reach the list.
function liftList() {
  const m = background.match(
    /const globalActivePubkey = await KS[\s\S]*?escapeAccounts\.sort\([^;]*;/
  );
  if (!m) throw new Error('Could not find the escapeAccounts construction in background.js');
  return m[0];
}

// accounts: every pubkey in the keystore. signer: the account the prompt shows.
// switcher: pubkeys the switcher above already offers. active: the globally-active account.
function evaluate({ accounts, signer, switcher = [], active = null, isContentSign = true }) {
  const ctx = {
    st: { accounts: accounts.map((pk) => ({ pubkey: pk, name: 'Acct ' + pk[0] })) },
    activePubkey: signer,
    otherAccounts: switcher.map((pk) => ({ pubkey: pk })),
    KS: { getActivePubkey: async () => active },
    self: { NostrTools: { nip19: { npubEncode: (pk) => 'npub_' + pk[0] } } },
    isContentSign,
    Set,
  };
  vm.createContext(ctx);
  return vm.runInContext(
    '(async () => {\n' + liftList() + '\n' +
    'return { show: ' + liftGate() + ', list: escapeAccounts };\n})()',
    ctx
  );
}

const A = 'a'.repeat(64), B = 'b'.repeat(64), C = 'c'.repeat(64);

test('escape offers the other account on a single-login host', async () => {
  const r = await evaluate({ accounts: [A, B], signer: A });
  assert.equal(r.show, true);
  assert.deepEqual(r.list.map((x) => x.pubkey), [B]);
});

test('escape is hidden with a single account in the keystore', async () => {
  // Nothing to switch to.
  const r = await evaluate({ accounts: [A], signer: A });
  assert.equal(r.show, false);
  assert.deepEqual(r.list, []);
});

test('escape is hidden when the switcher already offers every other account', async () => {
  // Shared host, both accounts authorized. The switcher can reach B, so offering it again
  // under a second action that also cancels the request would be strictly worse.
  const r = await evaluate({ accounts: [A, B], signer: A, switcher: [B] });
  assert.equal(r.show, false);
  assert.deepEqual(r.list, []);
});

test('escape offers the THIRD account the switcher cannot reach', async () => {
  // The reported bug. Three accounts, two signed in on the host, and the one the user wants
  // is the third. The switcher is scoped to accounts already authorized here, so it only
  // offers B — and the escape used to be suppressed entirely on shared hosts, leaving no
  // path to C at all.
  const r = await evaluate({ accounts: [A, B, C], signer: A, switcher: [B] });
  assert.equal(r.show, true);
  assert.deepEqual(r.list.map((x) => x.pubkey), [C], 'C must be reachable');
});

test('the two lists never overlap', async () => {
  // One account offered twice under two different actions — one of which cancels the
  // request and one of which does not — is a worse prompt than either alone.
  const r = await evaluate({ accounts: [A, B, C], signer: A, switcher: [B] });
  for (const acct of r.list) {
    assert.ok(acct.pubkey !== B, 'switcher account leaked into the escape list');
  }
});

test('the account being shown is never offered', async () => {
  // Detaching to re-pick the identity already on screen is a no-op with extra steps.
  const r = await evaluate({ accounts: [A, B, C], signer: A });
  assert.ok(!r.list.some((x) => x.pubkey === A));
  assert.deepEqual(r.list.map((x) => x.pubkey).sort(), [B, C].sort());
});

test('the globally-active account sorts first and is tagged', async () => {
  // With eight accounts the likeliest pick must not be buried, and an unexplained top row
  // reads as arbitrary — hence both the sort and the flag the UI renders.
  const r = await evaluate({ accounts: [A, B, C], signer: A, active: C });
  assert.equal(r.list[0].pubkey, C);
  assert.equal(r.list[0].active, true);
  assert.equal(r.list[1].active, false);
});

test('escape is hidden when the request is not a content sign', async () => {
  // Payments and getPublicKey both land here. A payment names the wallet, not a signing
  // identity, so "wrong account" has no meaning there; getPublicKey gets the real switcher.
  const r = await evaluate({ accounts: [A, B], signer: A, isContentSign: false });
  assert.equal(r.show, false);
});

test('the gate carries no shared-host or account-count term of its own', async () => {
  // Both are implied by the list being non-empty. Re-adding !sharedIdentity is what caused
  // the reported bug: it suppressed the escape on exactly the hosts whose switcher is
  // scoped, so a third account became unreachable.
  const src = liftGate();
  assert.ok(!/sharedIdentity/.test(src), 'gate must not re-exclude shared hosts');
  assert.ok(!/accounts\.length/.test(src), 'account count is implied by the list');
  assert.match(src, /escapeAccounts\.length > 0/);
});

test('the gate does not consult the binding or the author stamp', () => {
  // Two earlier cuts tried to detect that the account was "pinned" and both were wrong,
  // because the case that matters most has NO pin to observe: the client shows account A
  // while Sidecar's active account is B. Sidecar cannot see the client's UI.
  //
  // Asserted against the gate's source, not its result, because a value-level test can't
  // distinguish "ignores the binding" from "the binding happened to be set".
  const src = liftGate();
  assert.ok(!/getSiteAccount/.test(src), 'gate must not depend on a host binding');
  assert.ok(!/authorSwitched/.test(src), 'gate must not depend on a client author stamp');
});

test('relay auth is excluded via isContentSign, not a separate term', () => {
  // isContentSign is (signEvent && !isRelayAuth) || encrypt, so a kind 22242 auth event can
  // never reach the escape.
  const m = background.match(/const isContentSign =\n([\s\S]*?);\n/);
  assert.ok(m, 'could not find isContentSign');
  assert.match(m[1], /method === 'signEvent' && !isRelayAuth/);
});

test('the offered list is built from every account, not the authorized set', () => {
  // The account the user wants is the one that ISN'T authorized on this host yet.
  const m = background.match(/const escapeAccounts = (st\.accounts|otherAccounts)/);
  assert.ok(m);
  assert.equal(m[1], 'st.accounts');
});

test('the switcher subtraction is derived from otherAccounts itself', () => {
  // Not from a re-derived `sharedIdentity ? authorizedPool : []`, which would drift out of
  // step with the switcher's own filter and silently re-open the overlap.
  assert.match(background, /const offeredInSwitcher = new Set\(\(otherAccounts \|\| \[\]\)\.map\(\(a\) => a\.pubkey\)\)/);
});

// ---------------------------------------------------------------------------
// 2. No rebind machinery survives
// ---------------------------------------------------------------------------
//
// The picker was removed deliberately. These guard against half of it coming back — a
// 'rebind' action no surface sends, or a payload field nothing reads, is exactly the kind
// of dead code that gets mistaken for a working feature later ('block' in background.js
// was already discovered to be dead this way).

test('the action detaches the binding, never writes a new one', () => {
  // Rebinding would pin an identity the site hasn't approved, and would diverge from the
  // Settings -> Sites route, leaving two behaviors to reason about instead of one.
  const br = liftDetach();
  assert.match(br, /clearSiteAccount\(host\)/, 'must clear the binding');
  assert.ok(!/setSiteAccount/.test(br), 'must not write a new binding');
  assert.ok(!/'rebind'/.test(background), 'the old rebind action should be gone');
});

test('the offered list excludes the account already being shown', () => {
  // Detaching to re-pick the same identity is a no-op with extra steps.
  const m = background.match(/const escapeAccounts = st\.accounts\s*\n\s*\.filter\((.*)\)\n/);
  assert.ok(m, 'escapeAccounts should filter st.accounts');
  assert.match(m[1], /a\.pubkey !== activePubkey/);
});

test('the offered list is built from every account, not the authorized set', () => {
  // The account the user wants is the one that ISN'T authorized on this host yet, so
  // sourcing this from `otherAccounts` (host-scoped) would leave it empty in exactly the
  // case that matters.
  const m = background.match(/const escapeAccounts = (st\.accounts|otherAccounts)/);
  assert.ok(m);
  assert.equal(m[1], 'st.accounts');
});

test('the globally-active account sorts first and is flagged', () => {
  // With eight accounts the likeliest pick must not be buried, and an unexplained top row
  // reads as arbitrary — hence both the sort and the flag the UI tags.
  assert.match(background, /active: a\.pubkey === globalActivePubkey/);
  assert.match(background, /escapeAccounts\.sort\(\(x, y\) => \(y\.active \? 1 : 0\) - \(x\.active \? 1 : 0\)\)/);
  assert.match(background, /const globalActivePubkey = await KS\.getActivePubkey\(\)/);
});

// ---------------------------------------------------------------------------
// 2b. The detach decision branch
// ---------------------------------------------------------------------------

function liftDetach() {
  const m = background.match(/ {6}if \(decision\.action === 'detach'\) \{[\s\S]*?\n {6}\}/);
  if (!m) throw new Error("Could not find the detach branch in background.js");
  return m[0];
}

async function runDetach({ target, accounts = [PK_A, PK_B], status = 'ask' }) {
  const calls = [];
  const ctx = {
    decision: { action: 'detach', detachPubkey: target },
    host: HOST,
    method: 'signEvent',
    st: { accounts: accounts.map((pk) => ({ pubkey: pk, name: 'Acct ' + pk[0] })) },
    KS: {
      hasAccount: async (pk) => accounts.includes(pk),
      setActive: async (pk) => calls.push(['setActive', pk]),
    },
    PERMS: { getPermissionStatus: async () => status },
    RELAX: { revokeForHost: async (h) => calls.push(['revokeForHost', h]) },
    clearSiteAccount: async (h) => calls.push(['clearSiteAccount', h]),
    syncRelaxBadge: () => calls.push(['syncRelaxBadge']),
    Error,
  };
  vm.createContext(ctx);
  let threw = null;
  try {
    await vm.runInContext('(async () => {\n' + liftDetach() + '\n})()', ctx);
  } catch (e) {
    threw = e;
  }
  return { calls, threw };
}

test('detach clears the host binding', async () => {
  const { calls } = await runDetach({ target: PK_B });
  assert.deepEqual(calls.filter((c) => c[0] === 'clearSiteAccount'), [['clearSiteAccount', HOST]]);
});

test('detach makes the chosen account active', async () => {
  // This is the line that decides who the user comes back as — clearing alone would let
  // the reconnect land on whatever happened to be active.
  const { calls } = await runDetach({ target: PK_B });
  assert.deepEqual(calls.filter((c) => c[0] === 'setActive'), [['setActive', PK_B]]);
});

test('detach revokes any relax window on the host', async () => {
  // The auto-sign window was earned by the identity being left. Left standing it would
  // auto-approve the next request for the one arriving.
  const { calls } = await runDetach({ target: PK_B });
  assert.deepEqual(calls.filter((c) => c[0] === 'revokeForHost'), [['revokeForHost', HOST]]);
  assert.ok(calls.some((c) => c[0] === 'syncRelaxBadge'), 'badge should re-sync after the revoke');
});

test('detach always throws — it never returns to the signer', async () => {
  const { threw } = await runDetach({ target: PK_B });
  assert.ok(threw instanceof Error, 'detach must not fall through to signing');
});

test('the detach error names the host and the account to reconnect as', async () => {
  const { threw } = await runDetach({ target: PK_B });
  assert.match(threw.message, new RegExp(HOST));
  assert.match(threw.message, /sign out and back in as/i);
  assert.match(threw.message, /Acct b/);
});

test('detach to an account that no longer exists changes nothing', async () => {
  const { calls, threw } = await runDetach({ target: 'c'.repeat(64) });
  assert.ok(threw instanceof Error);
  assert.match(threw.message, /no longer available/i);
  assert.deepEqual(calls, [], 'a missing account must not touch the binding');
});

test('detach with a missing pubkey changes nothing', async () => {
  const { calls, threw } = await runDetach({ target: '' });
  assert.ok(threw instanceof Error);
  assert.deepEqual(calls, []);
});

test('detach to an account blocked on this host changes nothing', async () => {
  // The user blocked this site for that identity; honoring the pick would quietly undo it.
  const { calls, threw } = await runDetach({ target: PK_B, status: 'reject' });
  assert.ok(threw instanceof Error);
  assert.match(threw.message, /blocked/i);
  assert.deepEqual(calls, [], 'a blocked target must not touch the binding');
});

test('the detach branch runs before the block and trust branches', () => {
  // All three throw or settle; whichever comes first wins.
  const iDetach = background.indexOf("decision.action === 'detach'");
  const iBlock = background.indexOf("decision.action === 'block'");
  const iTrust = background.indexOf("decision.action === 'trust'");
  assert.ok(iDetach > 0 && iBlock > 0 && iTrust > 0);
  assert.ok(iDetach < iBlock, 'detach should precede block');
  assert.ok(iDetach < iTrust, 'detach should precede trust');
});

test("'detach' is not treated as an approval by the decrypt coalescing", () => {
  // settlePrompt grants a short decrypt window on 'once'/'trust'. detach is a refusal; if
  // it matched there it would hand the site a decrypt grant on the way out.
  const m = background.match(/if \(action === 'reject'\) \{[\s\S]*?grantDecrypt\(host, activePubkey\);/);
  assert.ok(m, 'could not find the decrypt-coalescing branch');
  assert.ok(!/detach/.test(m[0]), 'detach must not appear in the decrypt grant path');
});

test("'detach' is not batched across a grouped burst", () => {
  // Allow all / Reject all fan one decision across a same-kind burst. Detaching is a
  // per-site identity change, not something to apply N times.
  for (const src of [sidepanelJs, promptJs]) {
    const m = src.match(/groupIds\.length > 1 && \(([^)]*)\)/);
    if (m) assert.ok(!/detach/.test(m[1]), 'detach must not be in the batch predicate');
  }
});

test('detach needs the PIN when the keystore is locked', () => {
  // It signs nothing, but it clears the binding and moves the GLOBAL active account.
  // Without this a locked prompt is the one surface that can change persistent state with
  // no authentication, reachable by anyone who can make a site request a signature.
  for (const [label, src] of [['sidepanel.js', sidepanelJs], ['prompt.js', promptJs]]) {
    const m = src.match(/if \(data\.needUnlock && \(([^)]*)\)\)/);
    assert.ok(m, 'could not find the needUnlock gate in ' + label);
    assert.match(m[1], /action === 'detach'/, label + ' should gate detach on unlock');
    assert.ok(!/'reject'/.test(m[1]), label + ': reject must never need a PIN');
  }
});

// ---------------------------------------------------------------------------
// 3. Both surfaces
// ---------------------------------------------------------------------------
//
// Approvals render in the side panel AND in the standalone popup window. These are
// separate implementations of the same screen, and a change to one has shipped half-done
// before.

const COPY_TITLE = 'Not the right account?';
const COPY_TOGGLE = 'Detach and use another identity.';
const COPY_LEDE = 'Cancels this request and makes the selected account active.';

test('both surfaces carry the hint, the toggle and the list', () => {
  assert.match(sidepanelHtml, /id="approval-wrong-acct"/);
  assert.match(sidepanelHtml, /id="approval-wrong-acct-toggle"/);
  assert.match(sidepanelHtml, /id="approval-wrong-acct-list"/);
  assert.match(promptHtml, /id="wrong-acct"/);
  assert.match(promptHtml, /id="wrong-acct-toggle"/);
  assert.match(promptHtml, /id="wrong-acct-list"/);
});

test('both surfaces start hidden and collapsed', () => {
  assert.match(sidepanelHtml, /class="approval-wrong-acct hidden"/);
  assert.match(sidepanelHtml, /class="approval-wrong-acct-list hidden"/);
  assert.match(promptHtml, /class="wrong-acct hidden"/);
  assert.match(promptHtml, /class="wrong-acct-list hidden"/);
});

test('both surfaces use the same title and toggle copy, word for word', () => {
  // Two files, one explanation. Drift means the same situation reads differently depending
  // on whether the panel happened to be open.
  for (const [label, src] of [['sidepanel.html', sidepanelHtml], ['prompt.html', promptHtml]]) {
    assert.ok(src.includes('<strong>' + COPY_TITLE + '</strong>'), label + ' title');
    assert.ok(src.includes('>' + COPY_TOGGLE + '</button>'), label + ' toggle');
  }
});

test('both surfaces use the same lede copy, word for word', () => {
  // Exact equality on the extracted literal, not `includes`. A substring check passed when
  // one surface's lede grew an extra sentence, which is precisely the drift it was meant to
  // catch — parity claims have to be pinned at both ends of the string.
  const LEDE_RE = [
    ['sidepanel.js', sidepanelJs, /className: 'wrong-acct-lede', textContent: '([^']*)'/],
    ['prompt.js', promptJs, /lede\.textContent = '([^']*)';/],
  ];
  for (const [label, src, re] of LEDE_RE) {
    const m = src.match(re);
    assert.ok(m, 'could not extract the lede literal from ' + label);
    assert.equal(m[1], COPY_LEDE, label + ' lede must match exactly');
  }
});

test('the lede carries both facts the user cannot learn afterwards', () => {
  // That it cancels, and that the switch is app-wide rather than just this site. Everything
  // else was cut — three lines of lede in a sidebar was too much.
  for (const src of [sidepanelJs, promptJs]) {
    assert.match(src, /Cancels this request/);
    assert.match(src, /makes the selected account active/);
  }
});

test('the lede does not pre-announce the reconnect instruction', () => {
  // It arrives as a toast the moment detach settles, with the account name filled in —
  // which the lede can't do. Saying it twice is what made this three lines deep.
  for (const [label, src] of [['sidepanel.js', sidepanelJs], ['prompt.js', promptJs]]) {
    const fn = src.match(/function buildWrongAcctList\([\s\S]*?\n {2}\}/)[0];
    const lede = fn.match(/wrong-acct-lede[\s\S]*?;/)[0];
    assert.ok(!/sign out/i.test(lede), label + ': reconnect instruction belongs in the toast');
  }
});

test('a settled detach toasts the reconnect instruction in Sidecar', () => {
  // The background throws the same instruction as the signing error, but that goes to the
  // CLIENT. A client that swallows signing errors would leave the user with no next step.
  const fn = sidepanelJs.match(/async function decideApproval\(action, opts\) \{[\s\S]*?\n {2}\}/)[0];
  const blk = fn.match(/if \(action === 'detach'\) \{[\s\S]*?\n {4}\}/g) || [];
  const toastBlk = blk.find((b) => /toast\(/.test(b));
  assert.ok(toastBlk, 'decideApproval should toast after a detach');
  assert.match(toastBlk, /Sign out of/);
  assert.match(toastBlk, /back in as/);
  assert.match(toastBlk, /detachPubkey/, 'should name the account that was picked');
});

test('the detach toast reads the same as the Settings route', () => {
  // switchSiteModal already toasts this. Two wordings for one outcome is how the same fix
  // starts looking like two different features.
  const settings = sidepanelJs.match(/toast\('Detached\. Sign out of ' \+ host[^;]*;/);
  assert.ok(settings, 'could not find switchSiteModal toast');
  assert.match(sidepanelJs, /'Detached\. Sign out of ' \+ data\.host \+ ' and back in as ' \+/);
});

test('the copy never promises to sign as the other account', () => {
  // The one thing Sidecar cannot honestly offer here.
  for (const src of [sidepanelHtml, promptHtml, sidepanelJs, promptJs]) {
    assert.ok(!/[Ss]ign (this|it) as/.test(src), 'must not offer to sign as another account');
  }
});

test('the toggle is a button on both surfaces', () => {
  assert.match(sidepanelHtml, /<button class="approval-wrong-acct-toggle" id="approval-wrong-acct-toggle"/);
  assert.match(promptHtml, /<button class="wrong-acct-toggle" id="wrong-acct-toggle"/);
});

test('picking a row sends detach with that pubkey, on both surfaces', () => {
  assert.match(sidepanelJs, /decideApproval\('detach', \{ detachPubkey: a\.pubkey \}\)/);
  assert.match(promptJs, /decide\('detach', \{ detachPubkey: a\.pubkey \}\)/);
});

test('picking a row never approves', () => {
  // One character away from the worst bug in the extension: a control tapped *because* the
  // identity is wrong must not approve under that identity.
  for (const [label, src] of [['sidepanel.js', sidepanelJs], ['prompt.js', promptJs]]) {
    const fn = src.match(/function buildWrongAcctList\([\s\S]*?\n {2}\}/);
    assert.ok(fn, 'could not find buildWrongAcctList in ' + label);
    const m = fn[0].match(/row\.addEventListener\('click',[^;]*;/);
    assert.ok(m, 'could not find the row binding in ' + label);
    assert.match(m[0], /'detach'/, label + ': row must send detach');
    assert.ok(!/'once'|'trust'|'relax'|'budget'|'reject'/.test(m[0]), label + ': row must not approve');
  }
});

test('the active account is tagged on both surfaces', () => {
  for (const [label, src] of [['sidepanel.js', sidepanelJs], ['prompt.js', promptJs]]) {
    assert.match(src, /a\.active/, label + ' should read the active flag');
    assert.match(src, /'Active'/, label + ' should render the tag');
  }
});

test('both surfaces gate the hint on the payload flag', () => {
  assert.match(sidepanelJs, /data\.wrongAccountEscape/);
  assert.match(promptJs, /data\.wrongAccountEscape/);
});

test('both surfaces read the account list from allAccounts', () => {
  assert.match(sidepanelJs, /Array\.isArray\(data\.allAccounts\)/);
  assert.match(promptJs, /Array\.isArray\(data\.allAccounts\)/);
});

test('an empty account list hides the hint entirely', () => {
  // The gate can be true while the list is empty (every other account deleted). A visible
  // "Detach and use another identity" that expands to nothing is worse than no hint.
  assert.match(sidepanelJs, /!data\.wrongAccountEscape \|\| !accts\.length/);
  assert.match(promptJs, /!data\.wrongAccountEscape \|\| !accts\.length/);
});

test('the hint is re-evaluated every time an approval is shown', () => {
  // Not once at load: the panel re-shows the approval on queue advance and unlock.
  assert.match(sidepanelJs, /renderApprovalAccountCapsule\(data\);\s*\n\s*renderWrongAcctEscape\(data\);/);
  assert.match(promptJs, /buildAccountCapsule\(\);\s*\n\s*buildWrongAcct\(\);/);
});

test('the list re-collapses on every render', () => {
  // An expanded list left over from the previous request would offer to detach a different
  // host than the one now on screen.
  const panel = sidepanelJs.match(/function renderWrongAcctEscape\(data\) \{[\s\S]*?\n {2}\}/)[0];
  assert.match(panel, /list\.innerHTML = '';/);
  assert.match(panel, /hide\(list\);/);
  assert.match(panel, /setAttribute\('aria-expanded', 'false'\)/);
  const popup = promptJs.match(/function buildWrongAcct\(\) \{[\s\S]*?\n {2}\}/)[0];
  assert.match(popup, /innerHTML = '';/);
  assert.match(popup, /classList\.add\('hidden'\)/);
  assert.match(popup, /setAttribute\('aria-expanded', 'false'\)/);
});

test('the hint hides again when the flag is false', () => {
  // A show-only render leaks the hint onto the next request in the queue.
  assert.match(sidepanelJs, /hide\(hint\);/);
  assert.match(promptJs, /els\.wrongAcct\.classList\.toggle\('hidden', !data\.wrongAccountEscape/);
});

test('account names and the host are set as text, never as HTML', () => {
  // Profile metadata and the host are both attacker-controlled.
  for (const [label, src] of [['sidepanel.js', sidepanelJs], ['prompt.js', promptJs]]) {
    const fn = src.match(/function buildWrongAcctList\([\s\S]*?\n {2}\}/);
    assert.ok(fn, 'could not find buildWrongAcctList in ' + label);
    assert.ok(!/innerHTML\s*=\s*[^']/.test(fn[0].replace(/innerHTML = '';/g, '')),
      label + ' should not assign untrusted innerHTML');
    assert.match(fn[0], /textContent/);
  }
});

test('the toggle is de-emphasized, not accented', () => {
  // At --lav it competed with the account capsule directly above, which is the thing the
  // user actually needs to read on a signing screen. The underline carries the affordance.
  for (const [label, src, sel] of [
    ['styles.css', css, '.approval-wrong-acct-toggle'],
    ['prompt.html', promptHtml, '.wrong-acct-toggle'],
  ]) {
    const blk = src.match(new RegExp('\\' + sel + ' \\{[^}]*\\}'));
    assert.ok(blk, 'could not find ' + sel + ' in ' + label);
    assert.match(blk[0], /color: var\(--muted\)/, label + ': should use the secondary color');
    assert.ok(!/var\(--lav\)/.test(blk[0]), label + ': should not use the accent');
    assert.match(blk[0], /text-decoration: underline/, label + ': needs the link affordance');
  }
});

test('the hint has styles on both surfaces', () => {
  for (const sel of ['.approval-wrong-acct ', '.approval-wrong-acct-toggle ', '.approval-wrong-acct-list ']) {
    assert.ok(css.includes(sel + '{'), 'styles.css missing ' + sel);
  }
  for (const sel of ['.wrong-acct ', '.wrong-acct-toggle ', '.wrong-acct-list ']) {
    assert.ok(promptHtml.includes(sel + '{'), 'prompt.html missing ' + sel);
  }
  for (const src of [css, promptHtml]) {
    assert.ok(src.includes('.wrong-acct-lede {'), 'missing the lede style');
    assert.ok(src.includes('.wrong-acct-tag {'), 'missing the active-tag style');
  }
});

test('the popup hint only uses CSS variables that exist', () => {
  // prompt.html is a separate document with its own inline styles; --line, --panel and
  // --panel-2 were used here once and are defined nowhere, which silently renders as no
  // border on no background.
  const defined = new Set();
  const files = [promptHtml, css].concat(
    fs.readdirSync(path.join(ROOT, 'themes')).map((f) => fs.readFileSync(path.join(ROOT, 'themes', f), 'utf8'))
  );
  for (const src of files) for (const m of src.matchAll(/(--[a-z0-9-]+)\s*:/g)) defined.add(m[1]);
  for (const [label, src] of [['prompt.html', promptHtml], ['styles.css', css]]) {
    for (const blk of src.matchAll(/\.(?:approval-)?wrong-acct[a-z-]*[^{]*\{[^}]*\}/g)) {
      for (const v of blk[0].matchAll(/var\((--[a-z0-9-]+)/g)) {
        assert.ok(defined.has(v[1]), label + ' uses undefined ' + v[1]);
      }
    }
  }
});
