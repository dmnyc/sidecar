'use strict';

// A PAGE'S LARGE PAYMENT IS NEVER MADE WITHOUT TWO PRESSES.
//
// The panel's own sends ask twice at 10,000 sats or more (largeSendGate, see
// send-invoice.test.js). A page's payment goes through an approval card instead, unless a
// budget for that site covers it, in which case it went through with no card at all,
// whatever the amount. Now no budget covers a single payment that large, and the card
// then asks the same way the panel does: "Confirm amount above" first, the payment second.
//
// The card exists twice, prompt.js and the panel's inline approval card, and both are
// held here.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const bg = read('background.js');
const prompt = read('prompt.js');
const panel = read('sidepanel.js');

function lift(src, decl) {
  const at = src.indexOf(decl);
  if (at === -1) throw new Error('Could not find ' + decl);
  const open = src.indexOf(') {', at) + 2;
  let depth = 0;
  for (let j = open; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}' && --depth === 0) return src.slice(at, j + 1);
  }
  throw new Error('Unbalanced braces after ' + decl);
}

test('ONE LINE, IN ALL THREE PLACES THAT DRAW IT', () => {
  const values = [bg, prompt, panel].map((src) => Number((src.match(/const LARGE_SEND_SATS = (\d+);/) || [])[1]));
  assert.deepEqual(values, [10000, 10000, 10000]);
});

test('NO BUDGET COVERS A LARGE PAYMENT, ON EITHER PAYMENT PATH', () => {
  // The invoice path: the budget check itself refuses a large amount.
  assert.match(lift(bg, 'async function payInvoiceLocked('),
    /const budgetOk = unlocked && sats < LARGE_SEND_SATS && \(await BUDGETS\.covers\(pubkey, host, sats\)\);/);
  // The keysend path: nothing is reserved against a budget for one, so the card opens.
  assert.match(lift(bg, 'async function payKeysendLocked('),
    /let reserved = !KS\.isLocked\(\) && ks\.sats < LARGE_SEND_SATS && \(await BUDGETS\.reserve\(pubkey, host, ks\.sats\)\);/);
});

test('auto-zap cannot reach the line on its own', () => {
  const cap = Number(bg.match(/const AUTOZAP_ABS_MAX = (\d+);/)[1]);
  assert.ok(cap < 10000, 'a per-zap cap of ' + cap + ' would let an auto-zap pay a large amount with no card');
});

// ---- prompt.js -----------------------------------------------------------------------

function promptPaint(amountSats, armed) {
  const allow = { textContent: '', cls: new Set(['primary']) };
  allow.classList = { toggle: (c, on) => (on ? allow.cls.add(c) : allow.cls.delete(c)) };
  // eslint-disable-next-line no-new-func
  const paintPay = new Function('els', 'data', 'fmtSats', 'isPayment', 'largeArmed', `
    const LARGE_SEND_SATS = 10000;
    const isLargePayment = () => isPayment && data.amountSats != null && data.amountSats >= LARGE_SEND_SATS;
    ${lift(prompt, 'function paintPay(')}
    return paintPay;`)({ allow }, { amountSats }, (n) => String(n), true, armed);
  paintPay();
  return allow;
}

test('THE PAGE CARD (prompt.js) OPENS ON "CONFIRM AMOUNT ABOVE" FOR A LARGE PAYMENT', () => {
  const a = promptPaint(25000, false);
  assert.equal(a.textContent, 'Confirm amount above');
  assert.ok(a.cls.has('secondary') && !a.cls.has('primary'));
  const b = promptPaint(25000, true);
  assert.equal(b.textContent, 'Pay 25000 sats', 'and becomes the payment once pressed');
  assert.ok(b.cls.has('primary') && !b.cls.has('secondary'));
  assert.equal(promptPaint(9999, false).textContent, 'Pay 9999 sats', 'a small one is just the payment');
  assert.equal(promptPaint(null, false).textContent, 'Pay', 'an amountless one has nothing to size');
});

test('prompt.js: the first press only confirms, before any PIN is asked for', () => {
  const decide = lift(prompt, 'async function decide(');
  const gate = decide.indexOf('isLargePayment() && !largeArmed');
  const unlock = decide.indexOf('data.needUnlock');
  assert.ok(gate !== -1 && unlock !== -1 && gate < unlock, 'the gate comes before the unlock');
  assert.match(decide, /largeArmed = true;[\s\S]{0,200}paintPay\(\);\s*return;/);
});

// ---- the panel's approval card --------------------------------------------------------

test('THE PANEL\'S APPROVAL CARD ASKS THE SAME WAY, ARMED PER APPROVAL', () => {
  const decide = lift(panel, 'async function decideApproval(');
  const gate = decide.indexOf('isLargeApproval(data)');
  const unlock = decide.indexOf('data.needUnlock');
  assert.ok(gate !== -1 && gate < unlock, 'the gate comes before the unlock');
  // Keyed to this approval's id, so a confirmation cannot carry over to the next card.
  assert.match(decide, /approvalLargeArmed\.id === id/);
  assert.match(decide, /approvalLargeArmed = \{\s*id,/);
  const paint = lift(panel, 'function paintApprovalPay(');
  assert.match(paint, /'Confirm amount above'/);
  assert.match(paint, /classList\.toggle\('secondary', ask\)/);
});

test('every card starts from the primary style, whatever the last one left', () => {
  // One Allow button serves every card; a large payment leaves it in "Confirm" style.
  const at = panel.indexOf("paintApprovalPay(pendingApproval && pendingApproval.id, data);");
  const before = panel.slice(at - 400, at);
  assert.match(before, /allow\.classList\.add\('primary'\);\s*allow\.classList\.remove\('secondary'\);/);
});
