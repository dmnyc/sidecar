'use strict';
// A recipe is what a person does on a client's page to make it ask Sidecar for something: click
// "Extension" on a login dialog, open a zap, and so on. It lives in a small JSON file chosen at
// capture time, because the client and its buttons change from release to release.
//
//   {
//     "url": "https://client.example/login",
//     "login": [ { "click": "Extension" }, { "wait": 1500 } ],
//     "pay": { "url": "https://client.example/note/abc", "steps": [ { "click": "Zap" }, { "click": "21" } ] }
//   }
//
// Steps: { click: "Visible text" | "css:selector" }, { fill: "css:selector", text: "..." },
//        { wait: milliseconds }, { eval: "javascript run in the page" }.
// With no recipe for a scene, the page is simply asked directly (window.nostr / window.webln), so
// the card still appears; only the page behind it is less specific.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runSteps(page, steps = []) {
  for (const step of steps) {
    if (step.wait) { await sleep(step.wait); continue; }
    if (step.eval) { await page.evaluate(step.eval); continue; }
    if (step.fill) {
      const ok = await page.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(String(step.fill).replace(/^css:/, ''))}); if (!e) return false; e.focus(); const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(e), 'value').set; set.call(e, ${JSON.stringify(step.text || '')}); e.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
      if (!ok) throw new Error('Recipe step failed: no field matches ' + step.fill);
      continue;
    }
    if (step.click) {
      const want = String(step.click);
      const ok = await page.evaluate(`(() => {
        const want = ${JSON.stringify(want)};
        let el = null;
        if (want.startsWith('css:')) el = document.querySelector(want.slice(4));
        else {
          const lc = want.toLowerCase();
          const cands = [...document.querySelectorAll('button, a, [role=button], [role=menuitem], li, div, span')]
            .filter((e) => (e.textContent || '').trim().toLowerCase().includes(lc));
          // The innermost match is the control; an ancestor that merely contains the text is not.
          el = cands.find((e) => !cands.some((o) => o !== e && e.contains(o))) || null;
        }
        if (!el) return false;
        el.scrollIntoView({ block: 'center' });
        el.click();
        return true;
      })()`);
      if (!ok) throw new Error('Recipe step failed: nothing on the page matches ' + want);
      await sleep(step.after || 600);
    }
  }
}

module.exports = { runSteps };
