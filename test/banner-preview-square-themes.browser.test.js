'use strict';

// THE BANNER PREVIEW IS A RECTANGLE IN EVERY SQUARE THEME. Turnstile and Ben Day keep faces
// round with an exception for `.upload-preview`, which the banner's preview carries too, and
// the exception outranks the banner's own rule: the 116 by 60 banner in Edit profile was
// drawn as an ellipse. Werkstätte left it out with `:not(.banner)`; now all three do, and the
// avatar beside it stays round. Against the REAL extension, measured where it is seen.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startExtension, CHROME } = require('./helpers/real-extension');

const opts = { skip: CHROME ? false : 'no Chrome found', timeout: 150000 };

for (const theme of ['turnstile', 'ben-day', 'werkstatte']) {
  test(`${theme}: the banner preview is not an ellipse, and the avatar preview is round`, opts, async (t) => {
    let x;
    try { x = await startExtension({ settings: { theme } }); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
    try {
      x.put({ kind: 0, created_at: Math.floor(Date.now() / 1000) - 500, tags: [], content: JSON.stringify({ name: 'Tester' }) }, 'me');
      await x.reload();
      await x.evaluate(`document.querySelector('.tab[data-tab="profile"]').click()`);
      await x.waitFor(`!!document.querySelector('.profile-edit-cta')`, 15000);
      await x.evaluate(`document.querySelector('.profile-edit-cta').click()`);
      await x.waitFor(`!!document.querySelector('.upload-preview.banner')`, 10000);
      const r = await x.evaluate(`(() => {
        const radius = (el) => getComputedStyle(el).borderTopLeftRadius;
        return {
          theme: document.documentElement.dataset.theme,
          banner: radius(document.querySelector('.upload-preview.banner')),
          avatar: radius(document.querySelector('.upload-preview:not(.banner)')),
        };
      })()`);
      assert.equal(r.theme, theme);
      assert.notEqual(r.banner, '50%', 'the banner is an ellipse: ' + JSON.stringify(r));
      assert.equal(r.avatar, '50%', 'the avatar is not round: ' + JSON.stringify(r));
      assert.deepEqual(x.errors, []);
    } finally { x.close(); }
  });
}
