'use strict';

// EDITING A PROFILE DOES NOT ASK FOR THE PIN AGAIN.
//
// The edit sheet carried a PIN field, "required to publish", although the key is already
// unlocked to be on that screen and the panel drops to the lock screen the moment it locks. The
// setup wizard and the Lightning address save already published without one. This drives the
// real panel in a real Chrome: open Profile, press Edit, change a field, press Publish, and read
// what reached the relay. The profile that comes out is signed by the account, carries the edit,
// and keeps the fields the sheet never touched.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startExtension, CHROME } = require('./helpers/real-extension');

const opts = { skip: CHROME ? false : 'no Chrome found', timeout: 120000 };

test('the profile edit sheet publishes without a PIN, and keeps the fields it did not touch', opts, async (t) => {
  let x;
  try { x = await startExtension(); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  try {
    // A profile already on the relay, with a field the sheet has no control for.
    x.put({ kind: 0, created_at: Math.floor(Date.now() / 1000) - 60, tags: [], content: JSON.stringify({ name: 'tester', display_name: 'Tester', about: 'before', custom_field: 'kept' }) }, 'me');

    await x.reload(); // the panel was open before the account was added, and still says there is none
    await x.evaluate(`document.querySelector('.tab[data-tab="profile"]').click()`);
    await x.waitFor(`!!document.querySelector('.profile-edit-cta')`, 15000);
    await x.evaluate(`document.querySelector('.profile-edit-cta').click()`);
    await x.waitFor(`!document.getElementById('view-profile-edit').classList.contains('hidden')`, 5000);

    const sheet = await x.evaluate(`(() => {
      const body = document.getElementById('profile-edit-body');
      return {
        password: !!body.querySelector('input[type="password"]'),
        labels: [...body.querySelectorAll('.field-label')].map((l) => l.textContent),
        publish: [...body.querySelectorAll('button.primary')].map((b) => b.textContent),
      };
    })()`);
    assert.equal(sheet.password, false, 'the sheet still asks for a PIN');
    assert.ok(!sheet.labels.some((l) => /pin/i.test(l)), 'a PIN label is still on the sheet: ' + sheet.labels.join(' | '));
    assert.deepEqual(sheet.publish, ['Publish profile']);

    await x.evaluate(`(() => {
      const body = document.getElementById('profile-edit-body');
      const label = [...body.querySelectorAll('.field-label')].find((l) => l.textContent === 'About');
      const ta = label.nextElementSibling;
      ta.value = 'after the edit';
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      body.querySelector('button.primary').click();
    })()`);

    const end = Date.now() + 15000;
    let published = null;
    while (Date.now() < end && !published) {
      published = x.relay.events.filter((e) => e.kind === 0 && e.pubkey === x.me && JSON.parse(e.content).about === 'after the edit')[0] || null;
      if (!published) await x.sleep(150);
    }
    assert.ok(published, 'no edited profile reached the relay: ' + JSON.stringify(x.relay.events.filter((e) => e.kind === 0).map((e) => e.content)));
    const content = JSON.parse(published.content);
    assert.equal(content.display_name, 'Tester');
    assert.equal(content.custom_field, 'kept', 'a field the sheet does not edit was dropped');
    await x.waitFor(`document.getElementById('view-profile-edit').classList.contains('hidden')`, 5000);
  } finally {
    x.close();
  }
});
