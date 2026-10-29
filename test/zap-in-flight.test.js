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
  assert.match(fn, /auto \? msgHtml\('flightZapping', 'Zapping \$1 sats', bold\) : msgHtml\('flightSending', 'Sending \$1 sats', bold\)/,
    'the indicator does not say what it is doing');
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
  assert.match(card, /label\.textContent = msg\('cardTryAgain', 'Try again'\)/);
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
  assert.match(lift(contentCode, 'function renderCard('), /awaitingDecision = false;[\s\S]{0,260}Try again/,
    'a failed payment must unwedge the scan as well as the card');
});

// ---- the panel ------------------------------------------------------------------------

test('THE PANEL LEAVES WHEN THE PAYMENT DOES', () => {
  // Same principle as the page, reached differently. There is no approval prompt behind
  // the panel's Send: it holds its own NWC client, so pressing Pay IS the authorization
  // and the moment the modal closes is the moment the money is genuinely moving. Nothing
  // here has to hedge, and once a payment in flight has an indicator of its own there is
  // nothing left for a "Keep browsing" button to tell anyone.
  assert.doesNotMatch(bare, /Keep browsing/, 'the button is redundant once the bar carries it');
  assert.doesNotMatch(bare, /pay-flight/, 'and so is the block it sat in');
  assert.doesNotMatch(css, /\.pay-flight/, 'the styles went with it');
  const fn = lift(bare, 'function beginFlight(');
  assert.match(fn, /beginPaymentFlight\(/, 'the Send feeds the one payment bar');
  assert.match(fn, /tSec\('Sending \{\{amount\}\} sats', \{ amount: fmtSats\(sats\) \}\)/);
  assert.match(fn, /tSec\('Sending payment'\)/);
});

test('the modal closes only once nothing can fail back into the form', () => {
  // A bad address, an out-of-range amount or a server that will not issue an invoice all
  // belong in the form. Closing on the click would throw those into the bar and leave the
  // person with no field to correct.
  const fn = bare.slice(bare.indexOf("pay.addEventListener('click'"));
  const body = fn.slice(0, fn.indexOf('\n      });'));
  const begin = body.indexOf('beginFlight(');
  assert.ok(begin > body.indexOf('lnAddressToInvoice('), 'the modal closes before the address is resolved');
  assert.ok(begin < body.indexOf('client.payInvoice('), 'the modal is still up while the payment runs');
  assert.ok(body.indexOf('closeModal()', begin) < body.indexOf('client.payInvoice('),
    'the modal has to be gone before the wallet call, not after it');
});

test('EVERY PANEL PAYMENT FEEDS THE BAR, AND NO PATH FEEDS A PROGRESS TOAST', () => {
  // One lifecycle, one place to look (#495). Each of the five panel payment paths starts
  // its flight with beginPaymentFlight, and none of them reaches for a 'progress' toast
  // anymore — two live indicators for one payment is exactly the split attention the bar
  // exists to end.
  const paths = [
    ['CLINK offer pay', "offerPay.addEventListener('click'", 'beginPaymentFlight('],
    ['profile sheet zap', "send.addEventListener('click'", 'beginPaymentFlight('],
    ['bell zap', 'function buildZapForm(', 'beginPaymentFlight('],
    ['Send form', "pay.addEventListener('click'", 'beginFlight('],
    ['creator zap', "send.addEventListener('click', async () => {", 'beginPaymentFlight('],
  ];
  for (const [name, anchor, call] of paths) {
    const at = name === 'profile sheet zap'
      ? bare.indexOf(anchor, bare.indexOf('const zapForm = h('))
      : bare.indexOf(anchor);
    assert.ok(at > -1, name + ' found');
    const body = bare.slice(at, bare.indexOf('\n      });', at));
    assert.match(body, new RegExp(call.replace('(', '\\(')), name + ' feeds the payment bar');
  }
  assert.doesNotMatch(bare, /'progress'\)/, 'no panel payment shows a progress toast anymore');
});

test('the flight starts only once the payment is genuinely going out', () => {
  // Same rule both surfaces already followed for the toast: a failure that can go back
  // into a form must not be announced from behind an indicator that says the money is
  // moving. Started after the invoice exists, before the wallet call.
  const send = bare.indexOf("send.addEventListener('click'", bare.indexOf('const zapForm = h('));
  const zapBody = bare.slice(send, bare.indexOf('\n      });', send));
  assert.ok(zapBody.indexOf('beginPaymentFlight(') > zapBody.indexOf('await zapInvoice('),
    'the zap bar starts after the invoice exists');
  assert.ok(zapBody.indexOf('beginPaymentFlight(') < zapBody.indexOf('client.payInvoice('),
    'the zap bar starts before the wallet call');
});

test('BOTH OUTCOMES SETTLE THE FLIGHT', () => {
  // The bar's flight has no clock of its own, so a settled payment must retire it or it
  // sits there forever — the exact failure the progress toast's contract guarded, one
  // layer down. Success settles with the amount; failure settles with the error.
  const pay = bare.slice(bare.indexOf("pay.addEventListener('click'"));
  const payBody = pay.slice(0, pay.indexOf('\n      });'));
  assert.match(payBody, /flight\.settle\(\s*true,/, 'a settled payment leaves its flight on the bar forever');
  assert.match(payBody, /if \(flight\) flight\.settle\(false, null, e\.message\);/, 'a failed payment leaves its flight on the bar forever');
  const send = bare.indexOf("send.addEventListener('click'", bare.indexOf('const zapForm = h('));
  const zapBody = bare.slice(send, bare.indexOf('\n      });', send));
  assert.match(zapBody, /flight\.settle\(true, tSec\('Zapped \{\{amount\}\} sats'/, 'the zap bar settles with what it zapped');
  assert.match(zapBody, /if \(flight\) flight\.settle\(false, null, e\.message\);/);
});

test('A FAILED PAYMENT REACHES SOMEONE ON ANOTHER SURFACE', () => {
  // What makes closing the modal safe — now with the bar's one blind spot closed: the
  // bar lives at the foot of the main view, so while an approval card or the lock screen
  // owns the panel, the failure would land where nobody is looking. surfacePaymentFailure
  // is the bridge: bar line always, toast underneath only when the main view is hidden.
  const fn = lift(bare, 'function surfacePaymentFailure(');
  assert.match(fn, /view\.classList\.contains\('hidden'\)/, 'it checks who owns the panel');
  assert.match(fn, /toast\(message, 'error'\)/, 'and toasts only for them');
  // The Send catch routes through it, with the inline line still serving whoever never
  // left the form.
  const pay = bare.slice(bare.indexOf("pay.addEventListener('click'"));
  const payBody = pay.slice(0, pay.indexOf('\n      });'));
  assert.match(payBody, /surfacePaymentFailure\(e\.message\);/);
  const toastAt = payBody.indexOf('surfacePaymentFailure(');
  const inlineAt = payBody.indexOf('err.textContent = e.message');
  assert.ok(toastAt > -1 && inlineAt > toastAt, 'the surface check comes first; the inline line is for whoever never got that far');
  assert.match(payBody, /pay\.disabled = false;/, 'and the button comes back');
});

test('THE BAR HAS ONE LIFECYCLE AND NO STOP', () => {
  // "A payment can't be cancelled once it is sent, so there is no Stop button" (#495).
  // The mining bar it is built like has one; this must not grow one, because a button
  // that most looks like cancel on a payment is the one thing it definitely is not.
  const html = fs.readFileSync(path.join(ROOT, 'sidepanel.html'), 'utf8');
  const at = html.indexOf('id="payment-status"');
  const block = html.slice(html.lastIndexOf('<!--', at), html.indexOf('</div>', at));
  assert.doesNotMatch(block, /<button/, 'no control belongs on a pending payment');
  assert.match(block, /role="status" aria-live="polite"/, 'a status that changes under you is announced');
  // Pending shows the shared spinner idiom; a settled result shows the outcome icon.
  const render = lift(bare, 'function renderPaymentStatus(');
  assert.match(render, /className: 'toast-spin'/, 'the one spinner idiom, not a new one');
  assert.match(render, /icon\(paymentResult\.ok \? 'check' : 'alert'\)/, 'the result says which kind it was');
  assert.match(render, /payment-active/, 'the bar lifts the compose FAB like the mining and relax bars do');
});

test('website payments ride the bar for their whole flight, not just at settle', () => {
  // The worker is where a website's sendPayment and every boost leg actually run, so the
  // panel only knows about them through these broadcasts (#495).
  const locked = lift(bgCode, 'async function payInvoiceLocked(');
  const started = locked.indexOf("tellPanelPayment('paymentStarted'");
  assert.ok(started > -1, 'the invoice path announces the flight');
  assert.ok(started > locked.indexOf('getSwNwc(pubkey)'), 'a no-wallet refusal never flashes the bar');
  assert.ok(started < locked.indexOf('payAndConfirm(c,'), 'the bar is up before the wallet call');
  const failed = locked.indexOf("tellPanelPayment('paymentSettled', { ok: false");
  assert.ok(failed > started && failed < locked.indexOf('const preimage'),
    'a failed flight is retired with its error');
  assert.match(locked, /tellPanelPayment\('paymentSettled', \{ ok: true, sats \}\)/);
  // A zap says Zapping, any other website payment says Sending — the verb the page pill
  // already uses for the same distinction.
  assert.match(locked, /zap: !!zapRecipient/);

  const keysend = lift(bgCode, 'async function payKeysendLocked(');
  const kStarted = keysend.indexOf("tellPanelPayment('paymentStarted'");
  assert.ok(kStarted > keysend.indexOf('getSwNwc(pubkey)'), 'the keysend flight starts after the wallet check');
  assert.ok(kStarted < keysend.indexOf('payAndConfirm(c,'));
  assert.match(keysend, /tellPanelPayment\('paymentSettled', \{ ok: false, sats: ks\.sats, error: e && e\.message \}\)/,
    'a failed boost leg is retired with its error');
  assert.match(keysend, /tellPanelPayment\('paymentSettled', \{ ok: true, sats: ks\.sats \}\)/);
  // Best-effort by construction: a payment must never fail because no panel was open.
  const helper = lift(bgCode, 'function tellPanelPayment(');
  assert.match(helper, /\.catch\(\(\) => \{\}\)/);
});

test('THE BAR SURVIVES THE STREAM VIEW', () => {
  // The stream theater hides every child of the main view but the status bars — a zap
  // from a stream is exactly where a payment and the theater meet, so the bar must be
  // on the sparing list in both the CSS and the directory-positioning code.
  const scss = fs.readFileSync(path.join(ROOT, 'streams.css'), 'utf8');
  const spared = scss.match(/:not\(#payment-status\)/g) || [];
  assert.ok(spared.length >= 3, 'every hiding selector spares the bar');
  const sjs = fs.readFileSync(path.join(ROOT, 'streams.js'), 'utf8');
  assert.equal((sjs.match(/'relax-status','payment-status','mining-status'/g) || []).length, 2,
    'the directory clears the bar, and observes it');
});
