'use strict';

// nspam in the bell, in the real extension. Two strangers reply to you, neither in your
// network: one writes like a person, one like a reply-spam bot (both bundles are from the
// model's own reference set). The person's replies join your list; the bot's stay in the
// collapsed group, each marked Likely spam. Nothing is hidden either way.
//
// A LINK IS NEVER LIFTED. The person also sends the shape of a real spam reply the model
// scored 0 (sure it was a person), and lifting it put spam at the top of the bell: one short
// line pushing a domain. Their plain replies join the list; that one stays grouped.
//
// NSPAM_BELL_SHOT=<file> also writes what the bell looked like with the group open.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startExtension, CHROME, sleep } = require('./helpers/real-extension');

const opts = { skip: CHROME ? false : 'no Chrome found', timeout: 150000 };
const fixtures = fs.readFileSync(path.join(__dirname, 'fixtures', 'nspam', 'parity_fixtures.jsonl'), 'utf8')
  .trim().split('\n').map((l) => JSON.parse(l));
// A person whose three replies score 0, and a bot whose three score 1, with the tags a reply
// to you carries here (one e, one p) and ten minutes between them.
const PERSON = fixtures[16];
const BOT = fixtures[13];

test('a stranger who writes like a person joins the list; a bot stays grouped, marked', opts, async (t) => {
  assert.equal(PERSON.label, 0);
  assert.equal(BOT.label, 1);
  let x;
  try { x = await startExtension(); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  try {
    const now = Math.floor(Date.now() / 1000);
    // You follow Bea, who follows nobody: Cal and Dan are outside your network.
    x.put({ kind: 3, created_at: now - 9000, tags: [['p', x.bea]], content: '' }, 'me');
    x.put({ kind: 3, created_at: now - 9000, tags: [], content: '' }, 'bea');
    x.put({ kind: 0, created_at: now - 9000, tags: [], content: JSON.stringify({ name: 'Cal' }) }, 'cal');
    x.put({ kind: 0, created_at: now - 9000, tags: [], content: JSON.stringify({ name: 'Dan' }) }, 'dan');
    const mine = x.put({ kind: 1, created_at: now - 7200, tags: [], content: 'A note of mine' }, 'me');
    const reply = (who, content, i) => x.put({ kind: 1, created_at: now - 600 - i * 600, tags: [['e', mine.id, '', 'root'], ['p', x.me]], content }, who);
    PERSON.notes.forEach((n, i) => reply('cal', n.content, i));
    const BAIT = '👀 LOok At tHis: one.example.cc';
    reply('cal', BAIT, PERSON.notes.length);
    BOT.notes.forEach((n, i) => reply('dan', n.content, i));
    await x.reload();

    // The network and the model warm in the background; open the bell until both have sorted.
    const rows = `(() => {
      const all = [...document.querySelectorAll('#modal .notif-item[data-pubkey]')];
      const grouped = (r) => !!r.closest('.notif-offnet');
      return {
        listed: all.filter((r) => !grouped(r)).map((r) => r.dataset.pubkey),
        group: (document.querySelector('#modal .notif-offnet-toggle span') || {}).textContent || '',
      };
    })()`;
    let seen = null;
    for (let i = 0; i < 25; i++) {
      await x.evaluate(`document.getElementById('notif-bell-btn').click()`);
      await sleep(1200);
      // The group sits at the end of the list, so read to the end: Load more until it is gone.
      for (let k = 0; k < 6 && await x.evaluate(`!!document.querySelector('#modal .notif-load-more')`); k++) {
        await x.evaluate(`document.querySelector('#modal .notif-load-more').click()`);
        await sleep(1500);
      }
      seen = await x.evaluate(rows);
      if (seen.group && seen.listed.includes(x.cal)) break;
      await x.evaluate(`(() => { const b = document.querySelector('#modal .modal-x'); if (b) b.click(); })()`);
      await sleep(800);
    }
    assert.deepEqual(seen.listed.filter((pk) => pk === x.cal).length, PERSON.notes.length, 'the person did not join the list: ' + JSON.stringify(seen));
    assert.equal(seen.listed.includes(x.dan), false, 'the bot was lifted into the list');
    assert.equal(seen.group, `${BOT.notes.length + 1} from outside your network`);

    // Open the group: every one of the bot's replies is there, and marked.
    await x.evaluate(`document.querySelector('#modal .notif-offnet-toggle').click()`);
    await sleep(500);
    const grouped = await x.evaluate(`[...document.querySelectorAll('#modal .notif-offnet .notif-item[data-pubkey]')].map((r) => ({
      who: r.dataset.pubkey, mark: (r.querySelector('.notif-spam-mark') || {}).textContent || '' }))`);
    assert.equal(grouped.length, BOT.notes.length + 1);
    for (const g of grouped.filter((g) => g.who === x.dan)) assert.equal(g.mark, 'Likely spam');
    // The link stays with the strangers, unmarked: the model cleared it, so it is not called spam.
    assert.deepEqual(grouped.filter((g) => g.who !== x.dan), [{ who: x.cal, mark: '' }]);
    // The person's rows carry no mark.
    assert.equal(await x.evaluate(`[...document.querySelectorAll('#modal .notif-item[data-pubkey="${x.cal}"] .notif-spam-mark')].length`), 0);
    if (process.env.NSPAM_BELL_SHOT) await x.screenshot(process.env.NSPAM_BELL_SHOT, { width: 360, height: 900 });
    assert.deepEqual(x.errors, []);
  } finally { x.close(); }
});
