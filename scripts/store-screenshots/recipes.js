'use strict';
// A recipe is what a person does on a client's page to make it ask Sidecar for something: click
// "Extension" on a login dialog, open a zap, and so on. It lives in a small JSON file chosen at
// capture time, because the client and its buttons change from release to release.
//
//   {
//     "login": [ { "click": "Log in" }, { "click": "Extension" } ],
//     "signedIn": true,
//     "pay": { "url": "https://client.example/", "steps": [ { "click": "css:.zap" }, { "approve": "Allow once" } ] }
//   }
//
// Steps:
//   { click: "Visible text" | "css:selector", exact: true, optional: true, trusted: true, timeout: ms, after: ms }
//                                              looked for until it appears (8 s; optional ones 1.2 s) because a live page
//                                              draws a dialog a moment after the click that opens it
//                                              exact: the element's whole text is that text, so "Send" is the
//                                              button called Send and not a label that begins with it
//                                              trusted: a real mouse click, which counts as a user gesture
//                                              (a copy button needs one); the default is element.click()
//   { fill: "css:selector", text: "..." }
//   { wait: milliseconds }
//   { waitFor: "Text on the page" | "css:selector", timeout: ms }
//   { shadowClick: "selector", timeout: ms }   press a control inside one of the extension's own in-page
//                                              cards, which live in closed shadow roots
//   { approve: "Sign", when: "zap request", optional: true, timeout: ms }
//                                              press a button on Sidecar's approval card in the panel, but only
//                                              when the card's request matches `when`. `when` is required for
//                                              anything that approves (Sign, Allow once, Trust this site), so a
//                                              recipe can never sign an event it did not name. Reject is allowed
//                                              without one.
//   { answer: [ { approve: "Reject", when: "encrypt" }, { approve: "Sign", when: "zap request" } ],
//     until: "lightning payment", timeout: ms }
//                                              answer whatever cards the client raises, in whatever order, each only
//                                              when its `when` matches, until the card matching `until` is up. A card
//                                              no rule names stops the run and is named in the error: nothing
//                                              unnamed is ever approved.
//   { eval: "javascript run in the page" }
//
// "signedIn": true answers the login card with Allow once instead of Reject, once its picture is
// taken, so the client is signed in for what follows. A string picks the button instead:
// "Trust this site" makes the client a connected site, which is what lets Sidecar's in-page card show. The pay card itself is always answered with Reject,
// and the capture never pays: it stops at the card, whatever the page asks.
// With no recipe for a scene, the page is simply asked directly (window.nostr / window.webln), so
// the card still appears; only the page behind it is less specific.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runSteps(page, steps = [], ctx = {}) {
  for (const step of steps) {
    if (step.wait) { await sleep(step.wait); continue; }
    if (step.waitFor) {
      const want = String(step.waitFor);
      const expr = want.startsWith('css:')
        ? `!!document.querySelector(${JSON.stringify(want.slice(4))})`
        : `(document.body && document.body.innerText || '').toLowerCase().includes(${JSON.stringify(want.toLowerCase())})`;
      const end = Date.now() + (step.timeout || 20000);
      let ok = false;
      while (Date.now() < end) { if (await page.evaluate(expr)) { ok = true; break; } await sleep(300); }
      if (!ok) throw new Error('Recipe step failed: ' + want + ' never appeared on the page');
      continue;
    }
    if (step.shadowClick) {
      const end = Date.now() + (step.timeout || 15000);
      let ok = false;
      while (Date.now() < end) { if (await page.clickInShadow(String(step.shadowClick))) { ok = true; break; } await sleep(300); }
      if (!ok) throw new Error('Recipe step failed: no control matching ' + step.shadowClick + ' appeared in the extension’s card');
      await sleep(step.after || 600);
      continue;
    }
    if (step.answer) {
      if (!ctx.peekCard || !ctx.pressCard) throw new Error('Recipe step failed: answer needs the panel');
      const rules = step.answer;
      for (const r of rules) {
        if (!/^reject( all)?$/i.test(String(r.approve)) && !r.when) {
          throw new Error('Recipe step failed: approving ' + r.approve + ' needs a "when", so only the request you name is approved');
        }
      }
      const until = new RegExp(step.until || 'lightning payment', 'i');
      const end = Date.now() + (step.timeout || 45000);
      while (Date.now() < end) {
        const card = await ctx.peekCard();
        if (!card) { await sleep(400); continue; }
        if (until.test(card.ask)) break;
        const rule = rules.find((r) => new RegExp(r.when || '.', 'i').test(card.ask) && card.buttons.some((b) => b.toLowerCase() === String(r.approve).toLowerCase()));
        if (!rule) throw new Error('Recipe step failed: the panel is asking "' + card.ask + '" (' + card.buttons.join(' | ') + '), which no rule in the recipe names');
        await ctx.pressCard(String(rule.approve));
        await sleep(500);
      }
      continue;
    }
    if (step.approve) {
      if (!ctx.approve) throw new Error('Recipe step failed: approve needs the panel');
      if (!/^reject( all)?$/i.test(String(step.approve)) && !step.when) {
        throw new Error('Recipe step failed: approving ' + step.approve + ' needs a "when", so only the request you name is approved');
      }
      const ok = await ctx.approve(String(step.approve), step.timeout || 15000, step.when);
      if (!ok && !step.optional) throw new Error('Recipe step failed: no approval card offered ' + step.approve);
      continue;
    }
    if (step.eval) { await page.evaluate(step.eval); continue; }
    if (step.fill) {
      const ok = await page.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(String(step.fill).replace(/^css:/, ''))}); if (!e) return false; e.focus(); const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(e), 'value').set; set.call(e, ${JSON.stringify(step.text || '')}); e.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
      if (!ok) throw new Error('Recipe step failed: no field matches ' + step.fill);
      continue;
    }
    if (step.click) {
      const want = String(step.click);
      // A live page draws its dialogs a moment after the click that opens them, so the target is looked for until it
      // appears. A required step waits up to its timeout (8 s by default); an optional one only briefly, since it
      // is allowed to be absent.
      const expression = `(() => {
        const want = ${JSON.stringify(want)};
        let el = null;
        if (want.startsWith('css:')) el = document.querySelector(want.slice(4));
        else {
          const lc = want.toLowerCase();
          const cands = [...document.querySelectorAll('button, a, [role=button], [role=menuitem], li, div, span, p, label, h1, h2, h3, h4')]
            .filter((e) => { const t = (e.textContent || '').trim().toLowerCase(); return ${step.exact ? 't === lc' : 't.includes(lc)'}; });
          // The innermost match is the control; an ancestor that merely contains the text is not.
          el = cands.find((e) => !cands.some((o) => o !== e && e.contains(o))) || null;
        }
        if (!el) return false;
        el.scrollIntoView({ block: 'center' });
        // An icon is often a bare SVG, which has no click(): press the nearest thing that does.
        let target = el;
        for (let i = 0; i < 5 && target && typeof target.click !== 'function'; i++) target = target.parentElement;
        if (!target) return false;
        if (${step.trusted ? 'true' : 'false'}) { const r = target.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }
        target.click();
        return true;
      })()`;
      const deadline = Date.now() + (step.timeout !== undefined ? step.timeout : (step.optional ? 1200 : 8000));
      let ok = await page.evaluate(expression);
      while (!ok && Date.now() < deadline) { await sleep(300); ok = await page.evaluate(expression); }
      if (ok && typeof ok === 'object') {
        if (!page.clickAt) throw new Error('Recipe step failed: a trusted click needs a page that can send one');
        await page.clickAt(ok.x, ok.y);
      }
      if (!ok && step.optional) continue;
      if (!ok) throw new Error('Recipe step failed: nothing on the page matches ' + want);
      await sleep(step.after || 600);
    }
  }
}

module.exports = { runSteps };
