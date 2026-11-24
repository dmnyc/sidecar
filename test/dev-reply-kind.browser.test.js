'use strict';

// Reply to any event, with the reply's kind chosen beside the id: the dev tool in the main
// composer, in the real extension. An article is loaded by its id with Kind 1111 chosen, and
// the reply that reaches the relay is a NIP-22 comment naming the article's kind as its root.
// Then a note, with Kind 1 chosen, is answered with a plain kind 1 reply. The separate kind
// selector stays off throughout: the choice made here is enough on its own.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startExtension, CHROME, sleep } = require('./helpers/real-extension');

const opts = { skip: CHROME ? false : 'no Chrome found', timeout: 150000 };

async function replyWithKind(x, target, kind, text) {
  await x.evaluate(`document.getElementById('compose-fab').click()`);
  await sleep(400);
  // The button opens its menu; Compose a note is the composer.
  await x.evaluate(`[...document.querySelectorAll('button, [role="menuitem"]')].find((b) => b.textContent.trim() === 'Compose a note').click()`);
  await sleep(600);
  await x.evaluate(`(() => { const b = [...document.querySelectorAll('#modal button')].find((b) => b.textContent === 'Start fresh'); if (b) b.click(); })()`);
  await x.waitFor(`!!document.getElementById('compose-dev-reply')`, 15000);
  await x.evaluate(`(() => {
    const sel = document.getElementById('compose-dev-reply-kind');
    sel.value = '${kind}'; sel.dispatchEvent(new Event('change', { bubbles: true }));
    document.getElementById('compose-dev-reply').value = ${JSON.stringify(target)};
    [...document.querySelectorAll('#modal button')].find((b) => b.textContent === 'Reply to this event').click();
  })()`);
  // The composer reopens as a reply, saying which kind it will go out as.
  await x.waitFor(`!!document.querySelector('#modal .reply-target-kind')`, 15000);
  const label = await x.evaluate(`document.querySelector('#modal .reply-target-kind').textContent`);
  // A first composer opens with a greeting in it; this reply says only what it is given.
  await x.evaluate(`(() => { const ed = document.querySelector('#modal .compose-editor'); ed.focus(); document.execCommand('selectAll'); document.execCommand('insertText', false, ${JSON.stringify(text)}); })()`);
  await sleep(300);
  await x.evaluate(`[...document.querySelectorAll('#modal button.primary')].find((b) => b.textContent === 'Reply').click()`);
  return label;
}

test('a reply loaded by id goes out as the kind chosen beside the id', opts, async (t) => {
  let x;
  try { x = await startExtension(); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  try {
    // The tool on, the kind selector off, and no countdown to wait through.
    await x.message({ type: 'SIDECAR_SET_SETTINGS', settings: { devReplyById: true, devComposerKinds: false, noteCountdown: false } });
    const now = Math.floor(Date.now() / 1000);
    const article = x.put({ kind: 30023, created_at: now - 3600, tags: [['d', 'essay'], ['title', 'An essay']], content: 'Long form.' }, 'bea');
    const note = x.put({ kind: 1, created_at: now - 3600, tags: [], content: 'A plain note' }, 'bea');
    await x.reload();

    const label = await replyWithKind(x, article.id, 1111, 'A comment on the essay');
    assert.equal(label, 'kind 1111', 'the reply does not say it goes out as the chosen kind');
    let sent = null;
    for (let i = 0; i < 40 && !sent; i++) {
      sent = x.relay.events.find((e) => e.pubkey === x.me && e.content === 'A comment on the essay');
      if (!sent) await sleep(250);
    }
    assert.ok(sent, 'nothing reached the relay');
    assert.equal(sent.kind, 1111);
    const tag = (name) => (sent.tags.find((tg) => tg[0] === name) || [])[1];
    assert.equal(tag('E'), article.id);
    assert.equal(tag('K'), '30023', 'the comment names the wrong kind as its root');
    assert.equal(tag('e'), article.id);
    assert.equal(tag('k'), '30023');

    // And the other way: a note answered with kind 1, which is what it would take anyway,
    // through the same row, with the composer back to an ordinary one first.
    await sleep(1500);
    await x.evaluate(`(() => { const b = document.querySelector('#modal .modal-x'); if (b) b.click(); })()`);
    await sleep(800);
    const label1 = await replyWithKind(x, note.id, 1, 'A reply to the note');
    assert.equal(label1, 'kind 1');
    let reply = null;
    for (let i = 0; i < 40 && !reply; i++) {
      reply = x.relay.events.find((e) => e.pubkey === x.me && e.content === 'A reply to the note');
      if (!reply) await sleep(250);
    }
    assert.ok(reply, 'the kind 1 reply never reached the relay');
    assert.equal(reply.kind, 1);
    assert.ok(reply.tags.some((tg) => tg[0] === 'e' && tg[1] === note.id), 'the reply is not threaded to the note');
    assert.deepEqual(x.errors, []);
  } finally { x.close(); }
});
