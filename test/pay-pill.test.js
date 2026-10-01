'use strict';

// What happens when a page shows an invoice nobody asked about.
//
// Reported by a user who had installed Sidecar minutes earlier: he imported a key, logged
// into a client, touched nothing else, and a full-screen card appeared saying "You're
// paying 33,000 sats". Nothing was charged and nothing could have been, since he had no
// wallet connected at all, but every part of that sentence is wrong to put in front of
// someone who did not ask for it.
//
// The rule this file pins: Sidecar only interrupts when the person reached first. An
// invoice that merely EXISTS on the page gets a pill in the corner that can be ignored
// for the whole session. A `lightning:` link somebody TAPS gets the card, because that is
// a request to pay. And with no wallet connected there is nothing to offer either way.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const content = fs.readFileSync(path.join(ROOT, 'content.js'), 'utf8');
const background = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');

const stripComments = (src) =>
  src.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');

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

// ---- an invoice that is merely present ---------------------------------------------------

test('WHETHER THE PERSON ASKED IS WHAT DECIDES', () => {
  // The rule, in one place. A zap modal is on screen because somebody clicked zap, and
  // the card they were about to want is not an interruption. A link scrolling past in a
  // feed is not that, and neither is an invoice copied with no payment UI in sight.
  const fn = stripComments(lift(content, 'function scanForInvoice('));
  assert.match(fn, /if \(found\.asked\) renderCard\(invoice\);/, 'a requested invoice no longer opens the card');
  assert.match(fn, /else renderPill\(invoice\)/, 'an unrequested invoice still interrupts');
});

test('the detector says which invoices were asked for', () => {
  const fn = stripComments(lift(content, 'function findPageInvoice('));
  // hasPayIntent is the qualifier for both loud cases: a dialog, a modal, or a QR.
  assert.match(fn, /hasPayIntent\(f\)\) return \{ invoice: inv, asked: true \}/, 'a dialog no longer counts as asked');
  assert.match(fn, /if \(!invoiceExpired\(inv\)\) return \{ invoice: inv, asked: true \}/, 'an invoice beside a QR no longer counts as asked');
  // And the two quiet ones. These are the shapes the bug report was made of.
  assert.match(fn, /if \(passive\) return \{ invoice: passive, asked: false \}/, 'a bare lightning: link is treated as a request');
  assert.match(fn, /return \{ invoice: copiedInvoice, asked: false \}/, 'a clipboard copy is treated as a request');
});

test('the pill is not a dialog and does not cover the page', () => {
  // A card is an overlay: fixed, inset 0, dimmed backdrop, role="dialog". That is correct
  // for a decision someone asked to make and wrong for a notice. If the pill ever grows
  // those, it has become the thing it replaced.
  const css = content.slice(content.indexOf('const PILL_CSS'), content.indexOf('const CARD_CSS'));
  assert.doesNotMatch(css, /inset:0/, 'the pill covers the page');
  assert.doesNotMatch(css, /backdrop-filter/, 'the pill dims the page behind it');
  assert.match(css, /position:fixed;right:\d+px;bottom:\d+px/, 'the pill is not anchored in a corner');
  const fn = stripComments(lift(content, 'function renderPill('));
  assert.doesNotMatch(fn, /role="dialog"/, 'the pill announces itself as a dialog');
  assert.match(fn, /role="button"/, 'the pill does not say it is activatable');
});

test('the pill opens the card, and dismissing it is remembered', () => {
  const fn = stripComments(lift(content, 'function renderPill('));
  assert.match(fn, /renderCard\(invoice\)/, 'tapping the pill leads nowhere');
  assert.match(fn, /dismissedInvoice = invoice/, 'dismissing the pill does not stick');
  // Keyboard, because a corner control that only takes a mouse is a corner control some
  // people cannot use.
  assert.match(fn, /keydown/, 'the pill cannot be operated from the keyboard');
});

// ---- the one thing that still opens the card by itself ------------------------------------

test('a TAPPED lightning: link opens the card', () => {
  const at = content.indexOf('document.addEventListener(\'click\'');
  assert.ok(at !== -1, 'nothing listens for a tapped lightning: link');
  const handler = stripComments(content.slice(at, at + 1600));
  assert.match(handler, /lightning:/i, 'the listener does not look for a lightning link');
  assert.match(handler, /renderCard\(inv\)/, 'a tapped link does not open the card');
  assert.match(handler, /composedPath/, 'a link inside a shadow root is missed');
  assert.match(handler, /invoiceExpired\(inv\)/, 'an expired invoice still opens a card');
  // THE TAP IS SIDECAR'S when it opens the card. Left alone, an app registered for
  // lightning: took it too: on a BTCPay checkout the tap opened BlueWallet in a new tab
  // instead of the card. Prevented only on the path that opens the card, so a tap Sidecar
  // declines (no wallet, expired, dismissed) still reaches that app.
  const opens = handler.slice(handler.indexOf('inv === dismissedInvoice) return;'));
  assert.match(opens, /e\.preventDefault\(\);[\s\S]*?renderCard\(inv\)/, 'the tap also launches the other wallet');
  assert.doesNotMatch(handler.slice(0, handler.indexOf('inv === dismissedInvoice) return;')), /preventDefault/,
    'a tap Sidecar does not handle is swallowed anyway');
});

test('A TAPPED LINK ANSWERS TO THE SWITCH FOR ITS KIND OF SITE', () => {
  // A BTCPay checkout's "Pay in wallet" is a lightning: link on a site with no Nostr in
  // it. "Show on unconnected sites" (off by default) is what lets Sidecar take that tap;
  // "Show on Nostr sites" covers a signed-in site's. Neither reaches the other's.
  const at = content.indexOf('document.addEventListener(\'click\'');
  const handler = stripComments(content.slice(at, at + 1600));
  assert.match(handler, /if \(!hasWallet\) return;/, 'a tap is taken with no wallet to pay it');
  assert.match(handler, /if \(connectedToSite\) \{ if \(!showCard\) return; \}/, 'a signed-in site ignores Show on Nostr sites');
  // An unconnected site with its switch off gets the OFFER, unless that was dismissed.
  assert.match(handler, /else if \(!pillAnywhere\) \{ if \(payOfferDismissed\) return; offer = true; \}/,
    'an unconnected site either takes every tap or never offers');
  assert.match(handler, /tappedInvoice = inv;\s*tappedHref = href;\s*if \(offer\) offerInvoice = inv;\s*renderCard\(inv\);/,
    'the tapped card is not marked as tapped, or not as the offer');
});

test('the scan still offers nothing unasked on an unconnected site, and leaves a tapped card up', () => {
  const fn = stripComments(lift(content, 'function scanForInvoice('));
  const gate = fn.slice(fn.indexOf('if (!connectedToSite)'), fn.indexOf('const found = findPageInvoice()'));
  assert.ok(gate.length > 0, 'the connected-site gate moved');
  // A checkout with a countdown re-scans every second: without this the card the person
  // opened would be gone before they could press Pay.
  assert.match(gate, /if \(cardHost && shownInvoice === tappedInvoice\) return;/, 'the scan takes a tapped card down');
  assert.match(gate, /return removeCard\(\);/, 'an unconnected site gets an unasked card or pill');
  assert.ok(fn.indexOf('if (!connectedToSite)') < fn.indexOf('findPageInvoice()'),
    'the page is searched for invoices before the site is known to be connected');
});

test('an unconnected site still pays only through Sidecar\'s approval', () => {
  // No binding, so the active account's wallet; no budget, so the approval prompt.
  const pay = lift(background, 'async function payFromPage(');
  assert.match(pay, /const pubkey = await resolveSiteAccount\(host\);/);
  assert.match(pay, /'blocked'\) throw new Error/, 'a blocked site can be paid from its own page');
  const core = lift(background, 'async function payInvoiceLocked(');
  assert.match(core, /BUDGETS\.covers\(pubkey, host, sats\)/, 'a site pays without a budget check');
});

test('THE CARD HANDS THE INVOICE TO ANOTHER WALLET, THE LINK AS THE PAGE WROTE IT', () => {
  const card = lift(content, 'function renderCard(');
  assert.match(card, /<button class="other" type="button">' \+ escapeHtml\(msg\('cardOtherWallet', 'Open in another wallet'\)\)/);
  const at = card.indexOf(".querySelector('.other').addEventListener");
  assert.ok(at !== -1, 'the handoff button does nothing');
  const fn = card.slice(at, at + 500);
  assert.match(fn, /invoice === tappedInvoice && tappedHref \? tappedHref : 'lightning:' \+ invoice/);
  assert.match(fn, /dismissedInvoice = invoice;\s*removeCard\(\);/, 'the card stays up over the other wallet');
  // An anchor clicked from here would come straight back to the listener that took the tap.
  assert.match(fn, /location\.href = href/);
  assert.doesNotMatch(fn, /\.click\(\)/, 'the handoff goes through an anchor and loops back to Sidecar');
  assert.match(content, /'\.card\.busy \.other\{display:none;\}'/, 'the handoff is offered while Sidecar is asking');
  const en = JSON.parse(fs.readFileSync(path.join(ROOT, '_locales', 'en', 'messages.json'), 'utf8'));
  assert.equal(en.cardOtherWallet.message, 'Open in another wallet');
});

test('OPTED IN, AN UNCONNECTED SITE GETS THE CORNER PILL AND NEVER THE CARD', () => {
  const fn = stripComments(lift(content, 'function scanForInvoice('));
  const branch = fn.slice(fn.indexOf('if (!connectedToSite)'), fn.indexOf('const found = findPageInvoice()'));
  assert.match(branch, /if \(!pillAnywhere\) return removeCard\(\);/, 'the pill shows on other sites without the setting');
  // Only an invoice in a payment panel, never one merely sitting on the page.
  assert.match(branch, /const inv = offered && offered\.asked \? offered\.invoice : '';/);
  assert.match(branch, /inv === dismissedInvoice \|\| !hasWallet\) return removeCard\(\);/);
  assert.match(branch, /return renderPill\(inv\);/);
  assert.doesNotMatch(branch, /renderCard\(/, 'an unconnected site opens the full-screen card by itself');
  assert.doesNotMatch(branch, /SIDECAR_TRY_ZAP_AUTOPAY/, 'an unconnected site is asked about auto-zaps');
});

const panel0 = () => fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');

test('the switch is off by default, carried to the page script, and nothing wider', () => {
  const bg = stripComments(background);
  assert.match(bg, /payPillAnywhere: st\.payPillAnywhere === true,/, 'the page-facing read does not carry it');
  assert.match(bg, /payPillAnywhere: merged\.payPillAnywhere === true,/, 'turning it on needs a page reload');
  // A page can write the Nostr-sites switch, and the unconnected-sites one only to OFF.
  assert.match(bg, /if \('showPayButton' in s\) clamped\.showPayButton = !!s\.showPayButton;/);
  assert.match(bg, /if \(s\.payPillAnywhere === false\) clamped\.payPillAnywhere = false;/);
  assert.doesNotMatch(bg, /clamped\.payPillAnywhere = (true|!!)/, 'a page can switch Sidecar on for the whole web');
  const card = lift(content, 'function renderCard(');
  assert.match(card, /connectedToSite \? \{ showPayButton: false \} : \{ payPillAnywhere: false \}/,
    '"Don\'t show this prompt again" switches off the wrong kind of site');
  const html = fs.readFileSync(path.join(ROOT, 'sidepanel.html'), 'utf8');
  assert.match(html, /id="paybutton-toggle" \/> <span data-i18n="Show on Nostr sites">/);
  assert.match(html, /id="paypill-anywhere-toggle" \/> <span data-i18n="Show on unconnected sites">/);
  assert.doesNotMatch(panel0(), /paypill-anywhere-toggle'\)\.disabled/, 'the two switches are tied together again');
  const panel = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');
  assert.match(panel, /\$\('paypill-anywhere-toggle'\)\.checked = settings\.payPillAnywhere === true;/);
  assert.match(panel, /settings: \{ payPillAnywhere: e\.target\.checked \}/);
});

test('PAYING FROM AN UNBOUND SITE DOES NOT BIND IT, OR IT WOULD STOP BEING UNCONNECTED', () => {
  // A bound site counts as connected: it lists under Connected sites, answers to "Show on
  // Nostr sites", and its next invoice gets the full-screen card by itself. A BTCPay
  // checkout paid once must stay a site that gets none of that.
  const pay = lift(background, 'async function payFromPage(');
  assert.match(pay, /const wasBound = !!\(await getSiteAccount\(host\)\);/);
  assert.ok(pay.indexOf('wasBound') < pay.indexOf('resolveSiteAccount'), 'the binding is read after it could have changed');
  assert.match(pay, /bind: wasBound,/, 'the card path binds whatever it pays');
  const core = lift(background, 'async function payInvoiceLocked(');
  assert.match(core, /if \(!\(opts && opts\.bind === false\)\) await setSiteAccount\(host, pubkey\);/);
  // Every other caller keeps binding: WebLN from a client is how a site gets paired.
  assert.doesNotMatch(background.replace(/async function payFromPage\([\s\S]*?\n\}/, ''), /bind: false|bind: wasBound/,
    'another payment path stopped pairing its site');
});

test('the wallet list looks again a few seconds after a payment lands', () => {
  const panel = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');
  const at = panel.indexOf("msg.event === 'walletChanged'");
  const h = panel.slice(at, at + 1800);
  assert.match(h, /setTimeout\(\(\) => \{[\s\S]*?refreshTransactionList\(\);[\s\S]*?\}, 4000\)/,
    'a payment the wallet lists a moment late never shows in Recent transactions');
});

// ---- the offer: how anyone learns Sidecar pays invoices on other sites --------------------

test('THE OFFER CARD SAYS WHAT SIDECAR CAN DO, AND ITS TOGGLE ONLY STOPS ASKING', () => {
  const card = stripComments(lift(content, 'function renderCard('));
  // An offer for as long as it still is one, so a redraw (theme, retry) keeps the wording.
  assert.match(card, /const offer = invoice === offerInvoice && !connectedToSite && !pillAnywhere;/);
  assert.match(card, /msg\('cardOfferEyebrow', 'Sidecar can pay this invoice'\)/);
  assert.match(card, /msg\('cardOfferDontAsk', 'Don\\'t ask again'\)/);
  assert.match(card, /const settings = offer \? \{ payOfferDismissed: true \}/, '"Don\'t ask again" switches something else off');
  // Pay carries the intent only. The card has no way to turn the setting on.
  assert.match(card, /offerPayAnywhere: offer,/);
  assert.doesNotMatch(card, /payPillAnywhere: true/, 'the page card turns on Show on unconnected sites itself');
  const en = JSON.parse(fs.readFileSync(path.join(ROOT, '_locales', 'en', 'messages.json'), 'utf8'));
  assert.equal(en.cardOfferEyebrow.message, 'Sidecar can pay this invoice');
  assert.equal(en.cardOfferDontAsk.message, "Don't ask again");
});

test('THE OPT-IN IS ASKED ON SIDECAR\'S APPROVAL SCREEN, NEVER BY THE PAGE', () => {
  const bg = stripComments(background);
  // Only for a site that was not bound, and only while the setting is still off.
  assert.match(bg, /offerPayAnywhere: !wasBound && offerPayAnywhere === true,/);
  assert.match(bg, /offerPayAnywhere: !!\(opts && opts\.offerPayAnywhere\) && settings\.payPillAnywhere !== true,/);
  // An approval with the box ticked turns it on and tells every open page.
  const core = lift(background, 'async function payInvoiceLocked(');
  assert.match(core, /if \(decision\.enablePayAnywhere\) \{[\s\S]*?payPillAnywhere: true[\s\S]*?pushPageSettings\(merged\);/);
  assert.ok(core.indexOf("decision.action === 'reject'") < core.indexOf('decision.enablePayAnywhere'),
    'a rejected payment can still switch it on');
  // A page may write the dismissal, only to true, and still never the setting itself.
  assert.match(bg, /if \(s\.payOfferDismissed === true\) clamped\.payOfferDismissed = true;/);
  assert.doesNotMatch(bg, /clamped\.payPillAnywhere = (true|!!)/);
});

test('BOTH APPROVAL SCREENS ASK, UNTICKED, AND ONLY AN APPROVAL CARRIES THE ANSWER', () => {
  const html = fs.readFileSync(path.join(ROOT, 'prompt.html'), 'utf8');
  assert.match(html, /<input type="checkbox" id="payanywhere-offer-box" \/>/, 'the popup pre-ticks it, or lost it');
  const prompt = fs.readFileSync(path.join(ROOT, 'prompt.js'), 'utf8');
  assert.match(prompt, /if \(data\.offerPayAnywhere === true\) els\.payAnywhereOffer\.classList\.remove\('hidden'\);/);
  assert.match(prompt, /if \(data\.offerPayAnywhere === true && els\.payAnywhereOfferBox\.checked\) \{\s*extra = Object\.assign\(\{\}, extra, \{ enablePayAnywhere: true \}\);/);
  const panelHtml = fs.readFileSync(path.join(ROOT, 'sidepanel.html'), 'utf8');
  assert.match(panelHtml, /<input type="checkbox" id="approval-payanywhere-offer-box" \/>/, 'the panel pre-ticks it, or lost it');
  const panel = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');
  // The panel's approval card is reused: the row follows each approval, and the box
  // starts unticked every time, so an earlier tick is never taken as this one's answer.
  assert.match(panel, /\$\('approval-payanywhere-offer'\)\.classList\.toggle\('hidden', data\.offerPayAnywhere !== true\);\s*\$\('approval-payanywhere-offer-box'\)\.checked = false;/);
  assert.match(panel, /pendingApproval\.data\.offerPayAnywhere === true &&\s*\$\('approval-payanywhere-offer-box'\)\.checked\) \{\s*extra = Object\.assign\(\{\}, extra, \{ enablePayAnywhere: true \}\);/);
  // And the Auto Zaps row, which had the same reuse bug: shown once, never hidden again.
  assert.match(panel, /\$\('approval-autozap-offer'\)\.classList\.toggle\('hidden', !\(data\.offerAutoZap > 0\)\);/);
});

// ---- no wallet, no offer ------------------------------------------------------------------

test('NOTHING IS OFFERED WITHOUT A WALLET TO PAY WITH', () => {
  const fn = stripComments(lift(content, 'function scanForInvoice('));
  assert.match(fn, /if \(!hasWallet\)/, 'the scan offers a payment with no wallet connected');
  const gate = fn.slice(fn.indexOf('if (!hasWallet)'));
  assert.match(gate, /return removeCard\(\)/, 'a wallet-less page is left with something on screen');
  // Re-asked when an invoice turns up rather than only at load, so connecting a wallet
  // does not need a page reload to take effect.
  assert.match(gate, /SIDECAR_GET_SETTINGS/, 'the answer is cached forever');
});

test('the worker reports whether a wallet exists, and still clamps everything else', () => {
  const at = background.indexOf("fromExtPage && message.type === 'SIDECAR_GET_SETTINGS'");
  assert.ok(at !== -1, 'the clamped settings path moved');
  const handler = stripComments(background.slice(at, at + 4600));
  assert.match(handler, /hasWallet = await KS\.hasNwc\(payer\)/, 'the wallet check is gone or unclamped');
  assert.match(handler, /hasWallet,/, 'the reply does not carry it');
  // The reason this is safe to answer at all: hasNwc only reports that an entry exists,
  // so it works locked and never touches the connection string.
  for (const leak of ['autoLockMinutes', 'autoZap:', 'budgetSats', 'defaultClientBy']) {
    assert.ok(!handler.includes(leak), 'the clamped reply now leaks ' + leak);
  }
});

// ---- the card's own language --------------------------------------------------------------

test('the card names itself a request, not a payment in progress', () => {
  // "You're paying 33,000 sats", present tense, above a dimmed page, is how a person
  // concludes they are being charged. It is an offer and it has to read as one.
  const fn = stripComments(lift(content, 'function renderCard('));
  assert.doesNotMatch(fn, /You're paying/, 'the card announces a payment that has not happened');
  assert.match(fn, /'Request to pay'/, 'the card no longer says it is a request awaiting authorization');
  // It has one voice now. The auto-zap variant spoke in the present tense because that
  // spend really was underway, and #270 moved every underway spend to the corner
  // indicator, so nothing on this card describes a payment that is already happening.
  assert.doesNotMatch(fn, /Auto-zapping/, 'a card announcing a payment in progress is back');
});

test('a THEME repaint does not promote a pill into a card', () => {
  // The bug this caught in testing: setCardTheme repainted "a visible card" by calling
  // renderCard on whatever was on screen, so the theme reply arriving a beat after the
  // pill turned the pill into the full overlay. Same shape, worse, for a payment already
  // in flight: it was repainted as a fresh offer to pay it.
  const fn = stripComments(lift(content, 'function setCardTheme('));
  assert.match(fn, /shownMode === 'pill'/, 'the repaint does not look at what is showing');
  assert.match(fn, /renderPill\(shownInvoice\)/, 'a pill is repainted as something else');
  assert.match(fn, /shownMode === 'flight'/, 'a payment in flight is repainted as an offer to pay it');
  // And in the state it was in. Rebuilding it from scratch restarts the spinner on a
  // payment that has already landed.
  assert.match(fn, /if \(wasPaid && cardControls\) cardControls\.setPaid\(\);/);
});

test('the wallet gate asks about the account that would actually pay', () => {
  // payFromPage resolves the SITE's bound account (falling back to the active one) and
  // refuses without a wallet on it. Asking about a different account would either offer a
  // payment that cannot happen or hide one that can.
  const at = background.indexOf("fromExtPage && message.type === 'SIDECAR_GET_SETTINGS'");
  const handler = stripComments(background.slice(at, at + 3000));
  assert.match(handler, /payer = await resolveSiteAccount\(cardHost\); hasWallet = await KS\.hasNwc\(payer\);/, 'the gate resolves a different account than the payer');
  const payer = stripComments(lift(background, 'async function payFromPage('));
  assert.match(payer, /resolveSiteAccount\(host\)/, 'payFromPage changed how it picks an account');
  assert.match(payer, /KS\.hasNwc\(pubkey\)/, 'payFromPage no longer requires a wallet');
});

test('A LINK INSIDE A PAYMENT PANEL COUNTS AS ASKED, ONE IN A FEED DOES NOT', () => {
  // Reported against the first cut: a zap modal in Jumble still got the pill. The link
  // branch runs first and returned unconditionally, so a modal's own pay link was stamped
  // passive before the dialog and QR branches ever looked at it.
  const fn = stripComments(lift(content, 'function findPageInvoice('));
  assert.match(fn, /if \(hasPayIntent\(a\)\) return \{ invoice: inv, asked: true \}/, 'a link is not asked the intent question');
  assert.match(fn, /if \(!passive\) passive = inv/, 'a passive link still returns immediately');
  // And it must not outrank the asked-for shapes just by being earlier in the document.
  const at = fn.indexOf('if (passive) return');
  assert.ok(at > fn.indexOf('for (const q of qrEls)'), 'a timeline link still beats an open modal');
});

test('pay intent is not evidence found anywhere on the page', () => {
  // Measured in a browser across six real shapes. Two mattered: a modal whose QR is a
  // plain data: <img> was invisible, and a QR anywhere on the page made every link look
  // requested, because walking up reaches body and body.querySelector finds everything.
  const fn = stripComments(lift(content, 'function hasPayIntent('));
  assert.match(fn, /!PAGE_LEVEL\.has\(tag\) && isPanelSized\(node\)/, 'the QR scan can reach the page again');
  assert.match(fn, /hops <= 4 &&/, 'the QR scan searches too far up the tree');
  assert.match(fn, /isOverlay\(node\)/, 'a modal that sets neither a role nor a recognizable QR is missed');
  const page = stripComments(content.slice(content.indexOf('const PAGE_LEVEL'), content.indexOf('function isOverlay')));
  for (const tag of ['body', 'html', 'main', 'article', 'section']) {
    assert.ok(page.includes("'" + tag + "'"), tag + ' is no longer treated as page-level');
  }
  // Layout, not markup: fixed AND either stacked above the page or covering a good part
  // of it, so a sticky footer bar with a zap link in it is not a payment panel.
  // A wrapper div around a whole feed reaches every QR in it, so excluding body and main
  // was not enough on its own: the container has to be panel-sized too.
  const sized = stripComments(lift(content, 'function isPanelSized('));
  assert.match(sized, /querySelectorAll\('\*'\)\.length <= 60/, 'any container counts as a panel');
  const ov = stripComments(lift(content, 'function isOverlay('));
  assert.match(ov, /cs\.position !== 'fixed'/, 'sticky and absolute elements now count as modals');
  assert.match(ov, /z >= 10\) \|\| area >= 0\.25/, 'any fixed element counts as a modal');
});
