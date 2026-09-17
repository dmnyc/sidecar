'use strict';

// A payment in flight, and the fact that leaving is not cancelling (#270).
//
// The NWC request is published the moment Pay is pressed, and the wallet may settle it
// whatever the screen does afterwards. So nothing offered here can stop it, and the one
// thing the UI must never do is imply otherwise: on the single screen where being wrong
// costs money, the button that most looked like cancel was the one that definitely was
// not.
//
// The first cut of this fix renamed that button to "Keep browsing" and kept the card up
// behind it. The better answer was to stop needing the sentence at all. Once Pay is
// pressed there is no decision left on the card, so on the page it collapses into the
// corner indicator that already reports invoices nobody has to answer, and the panel
// offers its own door.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const panel = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');
const content = fs.readFileSync(path.join(ROOT, 'content.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
const background = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
const bare = panel.replace(/^\s*\/\/.*$/gm, '');
const contentCode = content.replace(/^\s*\/\/.*$/gm, '');
const bgCode = background.replace(/^\s*\/\/.*$/gm, '');

function lift(src, decl) {
  const at = src.indexOf(decl);
  if (at === -1) throw new Error('Could not find ' + decl);
  const open = src.indexOf('{', at);
  let depth = 0;
  for (let j = open; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}' && --depth === 0) return src.slice(at, j + 1);
  }
  throw new Error('Unbalanced braces after ' + decl);
}

test('THE PAGE CARD STEPS ASIDE, BUT NOT UNTIL THE MONEY IS ACTUALLY MOVING', () => {
  assert.doesNotMatch(contentCode, /Stop waiting/, 'the old label names the one thing it cannot do');
  assert.doesNotMatch(contentCode, /stopwait/, 'and the class named it too');
  assert.doesNotMatch(contentCode, /class="leave"/,
    'a button that has to say it is not a cancel is a card that should not still be up');
  const fn = lift(contentCode, 'function renderCard(');
  const click = fn.slice(fn.indexOf("payBtn.addEventListener('click'"));
  // Pressing Pay is not the handover. Sidecar still has to ask, and the corner cannot
  // say "Sending" about a payment sitting at an approval prompt.
  assert.match(click, /setAwaiting\(\);/, 'the click does not lock the card');
  assert.doesNotMatch(click, /renderFlightPill/,
    'the click hands over before the payment is authorized, which is both a lie and an opening');
  // Ordered after the send on purpose: if the extension was updated out from under the
  // page, sendMessage throws and the catch needs a live card to write the error into.
  assert.ok(
    click.indexOf('SIDECAR_PAY_PAGE_INVOICE') < click.indexOf('setAwaiting'),
    'the card is locked before the request that needs it unlocked for errors'
  );
});

test('THE CARD KEEPS COVERING THE PAGE WHILE THE DECISION IS OUT', () => {
  // The reason this matters, and it is not tidiness. That overlay is the only thing
  // between the person and the page's own payment UI: a "Connect Wallet to Pay" button
  // that routes back into Sidecar through the injected window.webln, and a QR a phone can
  // scan. Both stay live for as long as the approval prompt does, and either one is a
  // second payment for the same invoice.
  const fn = lift(contentCode, 'function renderCard(');
  const aw = fn.slice(fn.indexOf('function setAwaiting('), fn.indexOf('function setPaid('));
  assert.match(aw, /card\.classList\.add\('busy'\)/, 'the card does not lock down');
  assert.match(aw, /payBtn\.disabled = true/, 'Pay can be pressed twice');
  assert.match(aw, /'Confirm in Sidecar'/, 'the card does not say where the decision went');
  assert.match(aw, /Nothing has left your wallet yet/, 'it should say what has not happened yet');
  assert.doesNotMatch(aw, /Sending|on its way/, 'nothing is sent until the approval comes back');

  // Esc and a background click must not take the overlay away and hand the page's own pay
  // button back. Reject lives in Sidecar, and it comes back here as a failure.
  const dismiss = fn.slice(fn.indexOf('function dismiss('), fn.indexOf('const label ='));
  assert.match(dismiss, /if \(awaiting\) return;/, 'a stray click can drop the cover mid-approval');

  // The card flattens into a status line rather than sitting there looking pressable.
  const css = content.slice(content.indexOf('const CARD_CSS'), content.indexOf('let cardTheme'));
  assert.match(css, /\.card\.busy \.cancel\{display:none;\}/);
  assert.match(css, /\.card\.busy \.pay\{background:none/, 'the locked button still reads as a button');
});

test('the handover waits for the worker to say the payment was authorized', () => {
  // Fired at the one line both routes converge on: after the approval prompt resolves, or
  // straight away when a site budget or auto-zap meant there was never a prompt.
  assert.match(bgCode, /function notifyTabAuthorized\(invoice\)/);
  assert.match(bgCode, /event: 'authorized'/);
  const locked = lift(bgCode, 'async function payInvoiceLocked(');
  const at = locked.indexOf('notifyTabAuthorized(invoice);');
  assert.ok(at > -1, 'nothing tells the tab the payment cleared approval');
  assert.ok(at > locked.indexOf('await openPrompt('), 'the tab is told before the user has decided');
  assert.ok(at < locked.indexOf('c.payInvoice(invoice)'), 'the tab is told after the wallet call');
  // A rejection throws inside the prompt block, so it never reaches the notify.
  assert.ok(
    locked.indexOf("action === 'reject'") < at,
    'a rejected payment would be announced as authorized'
  );

  // And the content script only takes the handover for the invoice it is asking about.
  const h = content.slice(content.indexOf("msg.event === 'authorized'"), content.indexOf("msg.event === 'paid'"));
  assert.match(h, /shownInvoice === msg\.invoice/, 'a stale ping can replace an unrelated card');
  assert.match(h, /renderFlightPill\(msg\.invoice\)/);
});

test('the tab is found without a seventh argument, and released either way', () => {
  // payInvoiceCore, payInvoiceLocked and payFromPage already take six positional
  // arguments each. The registry is keyed by invoice because that is what the locked
  // function has in hand when the decision clears.
  assert.match(bgCode, /const payTabs = new Map\(\)/);
  const at = bgCode.indexOf("message.type === 'SIDECAR_PAY_PAGE_INVOICE'");
  const handler = bgCode.slice(at, bgCode.indexOf('return false;', at));
  assert.match(handler, /payTabs\.set\(key, \{ tabId, invoice: message\.invoice \}\)/);
  // Both arms, or a payment that fails leaves the tab registered for the next one.
  assert.equal((handler.match(/payTabs\.delete\(key\)/g) || []).length, 2,
    'the registration must be dropped on success AND on failure');
  // Normalized on both sides, since the tab sends a lowercased invoice and the worker
  // strips the lightning: prefix on its own.
  assert.match(bgCode, /const payKey = \(inv\) =>/);
});

test('what replaces it is a corner indicator, not another overlay', () => {
  const fn = lift(contentCode, 'function renderFlightPill(');
  assert.match(fn, /class="pill flight"/, 'the indicator is not the corner pill');
  assert.doesNotMatch(fn, /role="dialog"/, 'the indicator announces itself as a dialog');
  assert.match(fn, /role="status" aria-live="polite"/,
    'a status that changes under you has to be announced');
  assert.match(fn, /auto \? 'Zapping ' : 'Sending '/, 'the indicator does not say what it is doing');
  // Hiding it hides the indicator, not the payment. Remembered anyway, or the next DOM
  // scan turns around and offers to pay an invoice that is already being paid.
  assert.match(fn, /dismissedInvoice = invoice/);
  const pillCss = content.slice(content.indexOf('const PILL_CSS'), content.indexOf('const CARD_CSS'));
  assert.match(pillCss, /\.pill\.flight\{cursor:default;\}/, 'the indicator still looks pressable');
  assert.doesNotMatch(pillCss, /inset:0/, 'the indicator covers the page');
});

test('an auto-zap gets the same corner treatment and no card at all', () => {
  // The purest case of what this fixes: a spend nobody was asked about, reported on a
  // full-screen overlay with a disabled button and nothing to do.
  const at = content.indexOf("msg.event === 'autopaying'");
  const handler = content.slice(at, content.indexOf('} else if', at));
  assert.match(handler, /renderFlightPill\(msg\.invoice, true\)/);
  assert.doesNotMatch(handler, /renderCard/, 'a receipt is not a decision and does not get a card');
});

test('a failure comes back to the card, because a retry is a decision again', () => {
  // The one way back out of the corner. An error string needs the room and the button
  // that only the card has, and "Try again" is meaningless in a one-line pill.
  const fn = lift(contentCode, 'function renderFlightPill(');
  assert.match(fn, /setError: \(detail\) => renderCard\(invoice, detail\)/);
  const card = lift(contentCode, 'function renderCard(');
  assert.match(card, /if \(errorText\) setError\(errorText\);/, 'the reopened card does not show the error');
  assert.match(card, /label\.textContent = 'Try again'/);
});

test('and the page cannot take either state off the screen', () => {
  // Pages routinely pull the invoice out of the DOM the moment they believe it settled.
  // For a payment in flight that would drop its only report. For a card with a decision
  // out it is worse: the page uncovers its own pay button mid-approval, and there is no
  // card left to hand over to the corner when the answer arrives.
  const fn = lift(contentCode, 'function scanForInvoice(');
  assert.match(fn, /if \(shownMode === 'flight' \|\| awaitingDecision\) return;/,
    'a rescan can still tear down a payment or an approval');
  assert.ok(
    fn.indexOf('awaitingDecision') < fn.indexOf('return removeCard()'),
    'the guard has to come before the first teardown, or it never runs'
  );
  // Module scope on purpose: the card's own `awaiting` closure is invisible from here.
  // And cleared by removeCard, or a torn-down card leaves the scan wedged forever.
  assert.match(lift(contentCode, 'function removeCard('), /awaitingDecision = false;/);
  assert.match(lift(contentCode, 'function renderCard('), /awaitingDecision = false;[\s\S]{0,200}Try again/,
    'a failed payment must unwedge the scan as well as the card');
});

// ---- the panel ------------------------------------------------------------------------

test('THE PANEL LEAVES WHEN THE PAYMENT DOES', () => {
  // Same principle as the page, reached differently. There is no approval prompt behind
  // the panel's Send: it holds its own NWC client, so pressing Pay IS the authorization
  // and the moment the modal closes is the moment the money is genuinely moving. Nothing
  // here has to hedge, and once a payment in flight has an indicator of its own there is
  // nothing left for a "Keep browsing" button to tell anyone.
  assert.doesNotMatch(bare, /Keep browsing/, 'the button is redundant once the toast carries it');
  assert.doesNotMatch(bare, /pay-flight/, 'and so is the block it sat in');
  assert.doesNotMatch(css, /\.pay-flight/, 'the styles went with it');
  assert.match(bare, /function beginFlight\(sats\)/);
  assert.match(bare, /toast\(sats != null \? 'Sending ' \+ fmtSats\(sats\) \+ ' sats' : 'Sending payment', 'progress'\)/);
});

test('the modal closes only once nothing can fail back into the form', () => {
  // A bad address, an out-of-range amount or a server that will not issue an invoice all
  // belong in the form. Closing on the click would throw those into a toast and leave the
  // person with no field to correct.
  const fn = bare.slice(bare.indexOf("pay.addEventListener('click'"));
  const body = fn.slice(0, fn.indexOf('\n      });'));
  const begin = body.indexOf('beginFlight(');
  assert.ok(begin > body.indexOf('lnAddressToInvoice('), 'the modal closes before the address is resolved');
  assert.ok(begin < body.indexOf('client.payInvoice('), 'the modal is still up while the payment runs');
  assert.ok(body.indexOf('closeModal()', begin) < body.indexOf('client.payInvoice('),
    'the modal has to be gone before the wallet call, not after it');
});

test('a progress toast does not expire, and both outcomes retire it', () => {
  // The one toast in the panel with no clock on it. If it ever gets one, a slow payment
  // goes silent again, which is the complaint #270 opened with.
  const fn = bare.slice(bare.indexOf('function toast(message, type)'));
  const body = fn.slice(0, fn.indexOf('\n  }'));
  assert.match(body, /const holds = type === 'progress';/);
  assert.match(body, /const hide = holds \? null : setTimeout\(dismiss, 3200\);/, 'the progress toast has a timer');
  assert.match(body, /t\.close = dismiss;/, 'the caller cannot retire it');
  assert.match(body, /if \(holds\) t\.appendChild\(h\('span', \{ className: 'toast-spin' \}\)\);/);
  // Not green and not red: it is neither outcome, and reading it as either is the point.
  assert.match(css, /\.toast-progress \{[^}]*background: linear-gradient/);
  assert.doesNotMatch(css.slice(css.indexOf('.toast-progress')), /^[^}]*#176a44/);

  const pay = bare.slice(bare.indexOf("pay.addEventListener('click'"));
  const payBody = pay.slice(0, pay.indexOf('\n      });'));
  assert.match(payBody, /flight\.close\(\);/, 'a settled payment leaves its toast on screen forever');
  assert.match(payBody, /if \(flight\) flight\.close\(\);/, 'a failed payment leaves its toast on screen forever');
});

test('THE PROFILE SHEET ZAP GETS THE SAME INDICATOR', () => {
  // The panel path people actually reach. The sheet is dismissible mid-zap, so a disabled
  // button inside it was never an in-flight indicator: close the sheet and there was
  // nothing at all until the toast landed.
  const at = bare.indexOf("send.addEventListener('click'");
  const body = bare.slice(at, bare.indexOf('\n      });', at));
  assert.match(body, /toast\('Zapping ' \+ fmtSats\(sats\) \+ ' sats', 'progress'\)/);
  // Started after the invoice exists, so an address that will not issue one still errors
  // into the sheet rather than behind a toast that says the zap is going.
  assert.ok(body.indexOf('flight = toast(') > body.indexOf('await zapInvoice('),
    'the indicator starts before there is anything to indicate');
  assert.ok(body.indexOf('flight = toast(') < body.indexOf('client.payInvoice('));
  assert.match(body, /flight\.close\(\);\n\s*lightningStrike\(\)/, 'the toast outlives the zap');
  assert.match(body, /if \(flight\) flight\.close\(\);/, 'a failed zap leaves its toast up');
});

test('A FAILED PAYMENT REACHES SOMEONE WHO LEFT', () => {
  // What makes closing the modal safe. `err` lives inside it, so once it is gone a failed
  // payment has no inline line to land on: without the toast it would tell them nothing
  // at all. Success already toasted, which made the asymmetry worse, since leaving was
  // rewarded on success and punished on failure.
  const at = bare.lastIndexOf('} catch (e) {', bare.indexOf('err.textContent = e.message;\n          pay.disabled = false;'));
  const block = bare.slice(at, bare.indexOf("pay.textContent = 'Pay';", at));
  assert.match(block, /toast\(e\.message, 'error'\)/, 'a failure has to reach them wherever they are');
  const toastAt = block.indexOf('toast(e.message');
  const inlineAt = block.indexOf('err.textContent = e.message');
  assert.ok(toastAt > -1 && inlineAt > toastAt, 'the toast comes first; the inline line is for whoever never got that far');
  assert.match(block, /pay\.disabled = false;/, 'and the button comes back');
});

test('the profile sheet zap reports failure the same way', () => {
  // The other payInvoice call site. It had the same reporting gap: success toasted and
  // failure wrote into a sheet the user may have closed, so a zap that worked was
  // announced and a zap that failed was silent.
  const at = bare.indexOf('zapErr.textContent = e.message');
  assert.notEqual(at, -1);
  assert.match(bare.slice(at - 260, at), /toast\(e\.message, 'error'\)/);
});
