'use strict';

// THE POLL TAB IS THE NOTE WITH ITS POLL ON, in the real extension: Poll opens the note's own
// editor with its poll, and Note turns the poll off again. (Kept from the thread tests when
// threads moved to dev/threads; the Poll tab stayed.)

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startExtension, CHROME, sleep } = require('./helpers/real-extension');


const opts = { skip: CHROME ? false : 'no Chrome found', timeout: 90000 };

async function openCompose(x) {
  const tab = await x.openPage(`chrome-extension://${x.extId}/compose.html`);
  for (let i = 0; i < 60; i++) {
    if (await tab.evaluate(`!!document.querySelector('.compose-editor') && !!window.SidecarLongform && !!window.SidecarComposePublish && !document.documentElement.classList.contains('compose-booting')`)) break;
    await sleep(250);
  }
  await sleep(500);
  return tab;
}
const tabBtn = (name) => `[...document.querySelectorAll('.compose-mode')].find((b) => b.textContent.trim().startsWith(${JSON.stringify(name)}))`;

test('the Poll tab is the note with its poll on, and Note turns it off', opts, async (t) => {
  let x;
  try { x = await startExtension(); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  try {
    await x.reload();
    const tab = await openCompose(x);
    await tab.evaluate(`${tabBtn('Poll')}.click()`);
    await sleep(200);
    assert.equal(await tab.evaluate(`document.querySelector('.compose-sheet').dataset.mode`), 'note');
    assert.equal(await tab.evaluate(`${tabBtn('Poll')}.classList.contains('active')`), true);
    assert.equal(await tab.evaluate(`!document.querySelector('.poll-editor').classList.contains('hidden')`), true);
    // A poll's question is a line or two: the editor starts at four lines, not the full pane.
    const editorH = () => tab.evaluate(`Math.round(document.querySelector('#compose-slot .compose-editor').getBoundingClientRect().height)`);
    const withPoll = await editorH();
    await tab.evaluate(`${tabBtn('Note')}.click()`);
    await sleep(200);
    const asNote = await editorH();
    // The prompt asks for the question while there is a poll, and is a note's again after.
    const prompt = () => tab.evaluate(`document.querySelector('#compose-slot .compose-editor').dataset.placeholder`);
    assert.equal(await prompt(), 'What’s on your mind?');
    await tab.evaluate(`${tabBtn('Poll')}.click()`);
    await sleep(200);
    assert.equal(await prompt(), 'Ask your question…');
    await tab.evaluate(`${tabBtn('Note')}.click()`);
    await sleep(200);
    assert.equal(await prompt(), 'What’s on your mind?');
    assert.ok(withPoll < 160 && asNote > withPoll + 60, `the editor is ${withPoll}px with a poll and ${asNote}px as a note`);
    assert.equal(await tab.evaluate(`${tabBtn('Note')}.classList.contains('active')`), true);
    assert.equal(await tab.evaluate(`document.querySelector('.poll-editor').classList.contains('hidden')`), true);
    // Four tabs: the composer's Thread tab lives on dev/threads.
    assert.deepEqual(await tab.evaluate(`[...document.querySelectorAll('.compose-mode')].map((b) => b.textContent.trim())`), ['Note', 'Poll', 'Article', 'Recipe']);
    assert.deepEqual(x.errors, []);
  } finally { x.close(); }
});

// The panel's composer hands a poll to the full-size one (More options), so its own poll is
// one a draft brings back. Its prompt asks for the question while that poll is there, and the
// button does not offer threads, which live on dev/threads.
test('the panel\'s composer asks for a poll\'s question, and More options names no threads', opts, async (t) => {
  let x;
  try { x = await startExtension(); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
  try {
    await x.reload();
    await x.evaluate(`document.getElementById('compose-fab').click()`); await sleep(400);
    await x.evaluate(`document.getElementById('compose-note-btn').click()`); await sleep(800);
    await x.evaluate(`(() => { const b = [...document.querySelectorAll('#modal button')].find((b) => b.textContent.trim() === 'Start fresh'); if (b) b.click(); })()`);
    await sleep(400);
    const prompt = () => x.evaluate(`document.querySelector('#modal .compose-editor').dataset.placeholder`);
    assert.equal(await prompt(), 'What’s on your mind?');
    assert.equal(await x.evaluate(`document.querySelector('#modal .compose-more-options').title`), 'More options: polls, articles and recipes');
    assert.deepEqual(x.errors, []);
  } finally { x.close(); }
});
