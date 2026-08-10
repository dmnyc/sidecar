'use strict';

// Coverage for the "wrong account" hint on the signing approval.
//
// The problem: a client and Sidecar can disagree about which account is signed in, and
// the approval then names an identity the user didn't pick. The existing account switcher
// only appears once 2+ accounts have logged in on that host, so on a single-login host
// there's no control at all — and no indication that cancelling and reconnecting is the
// way out. Users hit this and concluded Sidecar was stuck.
//
// The fix is a hint plus one action, not a picker:
//
//   Not the right account?
//   Cancel and login with another identity.   <- clickable, rejects the request
//
// An earlier cut listed every account and rebound the host on a pick. It was dropped
// because the only honest outcome was still "canceled — now reconnect on the site": the
// event the client built carries the pubkey the client still has cached, so signing it as
// someone else yields one correct event and then silent reverts. With eight accounts in
// the keystore that was a long scroll offering a choice that changed nothing. So there is
// no 'rebind' decision to test — only that the hint appears in the right places, on both
// surfaces, with matching copy, and that its line actually rejects.
//
// The gate is deliberately BROAD — any content sign, 2+ accounts, no switcher already
// showing. Two earlier cuts tried to detect that the account was "pinned" (by a host
// binding, or by a client stamping the author pubkey on the template) and both were
// wrong: pin detection can only ever remove a working hint, and the case that matters
// most has no pin to detect. A client showing account A while Sidecar's active account is
// B leaves nothing for Sidecar to observe — it cannot see the client's UI. Only the user
// can, which is the whole reason the hint exists. The tests below pin that breadth down,
// because it is the part most likely to get "tightened" back.

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

function gate({ isContentSign, sharedIdentity, accounts }) {
  const ctx = { isContentSign, sharedIdentity, st: { accounts } };
  vm.createContext(ctx);
  return vm.runInContext('(' + liftGate() + ')', ctx);
}

const TWO = [{ pubkey: PK_A }, { pubkey: PK_B }];

test('hint shows on a content sign with more than one account', () => {
  assert.equal(gate({ isContentSign: true, sharedIdentity: false, accounts: TWO }), true);
});

test('the gate does not consult the binding or the author stamp', () => {
  // This is the breadth guarantee, and it is the whole fix. Both pins were tried and
  // both were wrong, because the case that matters most has NO pin to detect: the client
  // is displaying account A, Sidecar's active account is B, there is no binding and no
  // author stamp. None of that is observable from the extension — it cannot see the
  // client's UI. The prompt simply names the wrong identity and the user is the only one
  // who can tell.
  //
  // Asserted against the gate's source, not its result, because a value-level test can't
  // distinguish "ignores the binding" from "the binding happened to be set".
  const src = liftGate();
  assert.ok(!/getSiteAccount/.test(src), 'gate must not depend on a host binding');
  assert.ok(!/authorSwitched/.test(src), 'gate must not depend on a client author stamp');
});

test('hint is hidden with a single account in the keystore', () => {
  // Nothing to log in as.
  assert.equal(gate({ isContentSign: true, sharedIdentity: false, accounts: [{ pubkey: PK_A }] }), false);
});

test('hint is hidden on a shared-identity host', () => {
  // 2+ accounts have logged in here, so the real switcher is already on screen and the
  // user can just pick — telling them to cancel and reconnect would be worse advice.
  assert.equal(gate({ isContentSign: true, sharedIdentity: true, accounts: TWO }), false);
});

test('hint is hidden when the request is not a content sign', () => {
  // Payments and getPublicKey both land here. A payment names the wallet, not a signing
  // identity, so "wrong account" has no meaning on that screen; getPublicKey already
  // gets the real switcher.
  assert.equal(gate({ isContentSign: false, sharedIdentity: false, accounts: TWO }), false);
});

test('relay auth is excluded via isContentSign, not a separate term', () => {
  // isContentSign is (signEvent && !isRelayAuth) || encrypt, so a kind 22242 auth event
  // can never reach the hint. Asserting that implication rather than passing the
  // impossible isContentSign+isRelayAuth pair an earlier version of this test used.
  const m = background.match(/const isContentSign =\n([\s\S]*?);\n/);
  assert.ok(m, 'could not find isContentSign');
  assert.match(m[1], /method === 'signEvent' && !isRelayAuth/);
});

// ---------------------------------------------------------------------------
// 2. No rebind machinery survives
// ---------------------------------------------------------------------------
//
// The picker was removed deliberately. These guard against half of it coming back — a
// 'rebind' action no surface sends, or a payload field nothing reads, is exactly the kind
// of dead code that gets mistaken for a working feature later ('block' in background.js
// was already discovered to be dead this way).

test("no 'rebind' decision exists in the background", () => {
  assert.ok(!/decision\.action === 'rebind'/.test(background), 'rebind branch should be gone');
  assert.ok(!/rebindPubkey/.test(background), 'rebindPubkey should be gone');
});

test("no surface sends a 'rebind' decision", () => {
  for (const [label, src] of [['sidepanel.js', sidepanelJs], ['prompt.js', promptJs]]) {
    assert.ok(!/'rebind'/.test(src), label + ' should not reference a rebind action');
    assert.ok(!/rebindPubkey/.test(src), label + ' should not send rebindPubkey');
  }
});

test('the payload no longer carries an account list for the hint', () => {
  // allAccounts existed only to render the picker.
  assert.ok(!/allAccounts/.test(background), 'allAccounts should be gone from the payload');
  for (const [label, src] of [['sidepanel.js', sidepanelJs], ['prompt.js', promptJs]]) {
    assert.ok(!/allAccounts/.test(src), label + ' should not read allAccounts');
  }
});

test('the unlock gate is back to the three actions that sign', () => {
  // rebind was gated on unlock because it mutated persistent state. With it gone the
  // gate should cover exactly the signing actions again — and never reject.
  for (const [label, src] of [['sidepanel.js', sidepanelJs], ['prompt.js', promptJs]]) {
    const m = src.match(/if \(data\.needUnlock && \(([^)]*)\)\)/);
    assert.ok(m, 'could not find the needUnlock gate in ' + label);
    const actions = m[1].match(/'[a-z]+'/g).map((x) => x.slice(1, -1)).sort();
    assert.deepEqual(actions, ['once', 'relax', 'trust'], label);
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
const COPY_BODY = 'Cancel and login with another identity.';

test('both surfaces carry the hint element', () => {
  assert.match(sidepanelHtml, /id="approval-wrong-acct"/);
  assert.match(promptHtml, /id="wrong-acct"/);
});

test('both surfaces start hidden', () => {
  assert.match(sidepanelHtml, /class="approval-wrong-acct hidden"/);
  assert.match(promptHtml, /class="wrong-acct hidden"/);
});

test('both surfaces use the same copy, word for word', () => {
  // Two files, one sentence. Drift here means two different explanations of the same
  // situation depending on whether the panel happened to be open.
  for (const [label, src] of [['sidepanel.html', sidepanelHtml], ['prompt.html', promptHtml]]) {
    assert.ok(src.includes('<strong>' + COPY_TITLE + '</strong>'), label + ' title');
    assert.ok(src.includes('>' + COPY_BODY + '</button>'), label + ' body');
  }
});

test('the copy says cancel, not switch', () => {
  // The hint must not imply Sidecar can sign this request as someone else — it can't,
  // and promising it was the flaw in the picker.
  for (const src of [sidepanelHtml, promptHtml]) {
    assert.match(src, /Cancel and login with/);
    assert.ok(!/Pick who this site should use/.test(src), 'leftover picker copy');
  }
});

test('the cancel line is a button on both surfaces', () => {
  // Plain text left the user reading advice with nothing to act on.
  assert.match(sidepanelHtml, /<button class="approval-wrong-acct-cancel" id="approval-wrong-acct-cancel">/);
  assert.match(promptHtml, /<button class="wrong-acct-cancel" id="wrong-acct-cancel">/);
});

test('the cancel line rejects, on both surfaces', () => {
  assert.match(sidepanelJs, /\$\('approval-wrong-acct-cancel'\)\.addEventListener\('click', \(\) => decideApproval\('reject'\)\)/);
  assert.match(promptJs, /els\.wrongAcctCancel\.addEventListener\('click', \(\) => decide\('reject'\)\)/);
});

test('the cancel line never signs', () => {
  // One character away from being the worst bug in the extension: a control the user
  // taps *because* the identity is wrong must not approve under that identity.
  const BINDINGS = [
    ['sidepanel.js', sidepanelJs, /\$\('approval-wrong-acct-cancel'\)\.addEventListener\([^;]*;/],
    ['prompt.js', promptJs, /els\.wrongAcctCancel\.addEventListener\([^;]*;/],
  ];
  for (const [label, src, re] of BINDINGS) {
    const m = src.match(re);
    assert.ok(m, 'could not find the cancel binding in ' + label);
    assert.match(m[0], /'reject'/, label + ': cancel must send reject');
    assert.ok(!/'once'|'trust'|'relax'|'budget'/.test(m[0]), label + ': cancel must not approve');
  }
});

test('the popup binds cancel directly, not via els.reject', () => {
  // init() replaces els.reject with a plain Close button when the request has already
  // expired. Forwarding through it would leave cancel wired to a stale node.
  const m = promptJs.match(/els\.wrongAcctCancel\.addEventListener\([^)]*\)[^;]*;/);
  assert.ok(m, 'could not find the popup cancel binding');
  assert.ok(!/els\.reject/.test(m[0]), 'must not forward through els.reject');
});

test('the cancel line is not disabled by the destructive lock', () => {
  // setApprovalLocked / setLocked gate Allow + Trust behind "I understand". The way out
  // is never gated — same rule that keeps Reject enabled.
  for (const [label, src] of [['sidepanel.js', sidepanelJs], ['prompt.js', promptJs]]) {
    const fn = src.match(/function set(?:Approval)?Locked\(locked\) \{[\s\S]*?\n {2}\}/);
    assert.ok(fn, label);
    assert.ok(!/wrongAcct|wrong-acct/.test(fn[0]), label + ': cancel must stay enabled');
  }
});

test('both surfaces gate the hint on the payload flag', () => {
  assert.match(sidepanelJs, /data\.wrongAccountEscape/);
  assert.match(promptJs, /data\.wrongAccountEscape/);
});

test('the hint is re-evaluated every time an approval is shown', () => {
  // Not once at load: the panel re-renders on queue advance and unlock, and a hint left
  // standing from a previous request would advise cancelling a prompt that is fine.
  assert.match(sidepanelJs, /renderApprovalAccountCapsule\(data\);\s*\n\s*renderWrongAcctEscape\(data\);/);
  assert.match(promptJs, /buildAccountCapsule\(\);\s*\n\s*buildWrongAcct\(\);/);
});

test('the hint hides again when the flag is false', () => {
  // A show-only render leaks the hint onto the next request in the queue.
  assert.match(sidepanelJs, /if \(data\.wrongAccountEscape\) show\(hint\);\s*\n\s*else hide\(hint\);/);
  assert.match(promptJs, /classList\.toggle\('hidden', !data\.wrongAccountEscape\)/);
});

test('the hint has styles on both surfaces', () => {
  assert.match(css, /\.approval-wrong-acct \{/);
  assert.match(css, /\.approval-wrong-acct strong \{/);
  assert.match(promptHtml, /\.wrong-acct \{/);
  assert.match(promptHtml, /\.wrong-acct strong \{/);
});

test('the cancel line is de-emphasized, not accented', () => {
  // At --lav it competed with the account capsule directly above, which is the thing the
  // user actually needs to read on a signing screen. The underline carries the affordance.
  for (const [label, src, sel] of [
    ['styles.css', css, '.approval-wrong-acct-cancel'],
    ['prompt.html', promptHtml, '.wrong-acct-cancel'],
  ]) {
    const blk = src.match(new RegExp('\\' + sel + ' \\{[^}]*\\}'));
    assert.ok(blk, 'could not find ' + sel + ' in ' + label);
    assert.match(blk[0], /color: var\(--muted\)/, label + ': should use the secondary color');
    assert.ok(!/var\(--lav\)/.test(blk[0]), label + ': should not use the accent');
    assert.match(blk[0], /text-decoration: underline/, label + ': needs the link affordance');
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
    for (const blk of src.matchAll(/\.(?:approval-)?wrong-acct[^{]*\{[^}]*\}/g)) {
      for (const v of blk[0].matchAll(/var\((--[a-z0-9-]+)/g)) {
        assert.ok(defined.has(v[1]), label + ' uses undefined ' + v[1]);
      }
    }
  }
});
