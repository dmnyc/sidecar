'use strict';

// EDITING AROUND A MENTION PILL, AS A WORD PROCESSOR EDITS: the pill is one character.
// Every case runs in the real extension with real key presses, real clicks and real text
// input, in both composers (the panel's and the full-size one), and ends by typing a
// caret marker, so each expected line says what is left AND where the caret stands.
// Every case also checks what the composer saved: no invisible anchor in it, and one
// nostr: address for each pill on screen.
//
// Written after three pill bugs shipped in a row (1.18.2 and 1.18.3): each fix was tested
// for the case reported and not its neighbors. This is the neighbors: arrows, Delete and
// Backspace on both sides, word and line deletes, selection, Enter, undo, copy, cut,
// paste, clicks on and beside a pill, at the start of a note, the start of a line, the
// middle of one, the end, and between two pills.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startExtension, CHROME, sleep } = require('./helpers/real-extension');

const opts = { skip: CHROME ? false : 'no Chrome found', timeout: 600000 };

const L = {
  mid: `ed.append(T('Hi '), P('Bf'), T('\\u00a0rest'))`,
  linestart: `ed.append(T('above'), BR(), P('Bf'), T('\\u00a0rest'))`,
  notestart: `ed.append(P('Bf'), T('\\u00a0rest'))`,
  two: `ed.append(T('to '), P('Bf'), P('Cal'), T('\\u00a0rest'))`,
  end: `ed.append(T('Hi '), P('Bf'))`,
};
const K = (k, o) => ['key', k, o];
const L5 = Array(5).fill(K('ArrowLeft')), L6 = Array(6).fill(K('ArrowLeft')), L7 = Array(7).fill(K('ArrowLeft'));
const SL = K('ArrowLeft', { shift: true, commands: ['moveLeftAndModifySelection'] });
const UNDO = K('z', { meta: true, commands: ['undo'] });
const C = [
  ['mid: arrow left onto the pill\'s right side', 'mid', L5, [], 'Hi [@Bf]^ rest'],
  ['mid: one more arrow steps over the pill', 'mid', L6, [], 'Hi ^[@Bf] rest'],
  ['mid: arrow right steps over the pill', 'mid', [...L6, K('ArrowRight')], [], 'Hi [@Bf]^ rest'],
  ['mid: Delete in front', 'mid', L6, [K('Delete')], 'Hi ^ rest'],
  ['mid: Backspace behind', 'mid', L5, [K('Backspace')], 'Hi ^ rest'],
  ['mid: Shift+Left selects the pill, Delete', 'mid', L5, [SL, K('Delete')], 'Hi ^ rest'],
  ['mid: Shift+Left selects the pill, typing replaces it', 'mid', L5, [SL, ['type', 'X']], 'Hi X^ rest'],
  ['mid: Option+Backspace behind', 'mid', L5, [K('Backspace', { alt: true, commands: ['deleteWordBackward'] })], 'Hi ^ rest'],
  ['mid: Option+Delete in front', 'mid', L6, [K('Delete', { alt: true, commands: ['deleteWordForward'] })], 'Hi ^ rest'],
  ['mid: Cmd+Backspace clears to line start', 'mid', L5, [K('Backspace', { meta: true, commands: ['deleteToBeginningOfLine'] })], '^ rest'],
  ['mid: Enter in front moves the pill down', 'mid', L6, [K('Enter')], 'Hi |^[@Bf] rest'],
  ['mid: Enter behind', 'mid', L5, [K('Enter')], 'Hi [@Bf]|^ rest'],
  ['mid: Delete in front, then Cmd+Z brings it back', 'mid', L6, [K('Delete'), UNDO], 'Hi [@Bf] rest'],
  ['mid: Backspace behind, then Cmd+Z brings it back', 'mid', L5, [K('Backspace'), UNDO], 'Hi [@Bf] rest'],
  ['mid: Select all, Delete', 'mid', [], [K('a', { meta: true, commands: ['selectAll'] }), K('Delete')], '^'],
  ['mid: Shift+Home over the pill, Delete', 'mid', [], [K('ArrowLeft', { shift: true, meta: true, commands: ['moveToBeginningOfLineAndModifySelection'] }), K('Delete')], '^'],
  ['mid: copy the pill, paste at the end', 'mid', L5, [SL, K('c', { meta: true, commands: ['copy'] }), K('ArrowRight', { meta: true, commands: ['moveToEndOfLine'] }), K('v', { meta: true, commands: ['paste'] })], 'Hi [@Bf] rest[@Bf]^'],
  ['mid: cut the pill, paste at the end', 'mid', L5, [SL, K('x', { meta: true, commands: ['cut'] }), K('ArrowRight', { meta: true, commands: ['moveToEndOfLine'] }), K('v', { meta: true, commands: ['paste'] })], 'Hi  rest[@Bf]^'],
  ['mid: click on the pill\'s right half, type', 'mid', [['clickPillAt', 0, 0.75]], [], 'Hi [@Bf]^ rest'],
  ['mid: click on the pill\'s left half, type', 'mid', [['clickPillAt', 0, 0.25]], [], 'Hi ^[@Bf] rest'],
  ['line start: arrow onto its right side', 'linestart', L5, [], 'above|[@Bf]^ rest'],
  ['line start: one more arrow, in front of it', 'linestart', L6, [], 'above|^[@Bf] rest'],
  ['line start: one more, end of the line above', 'linestart', L7, [], 'above^|[@Bf] rest'],
  ['line start: Delete in front', 'linestart', L6, [K('Delete')], 'above|^ rest'],
  ['line start: Backspace in front joins the lines', 'linestart', L6, [K('Backspace')], 'above^[@Bf] rest'],
  ['line start: Delete at end of line above joins', 'linestart', L7, [K('Delete')], 'above^[@Bf] rest'],
  ['line start: Backspace behind', 'linestart', L5, [K('Backspace')], 'above|^ rest'],
  ['line start: type in front', 'linestart', L6, [['type', 'x ']], 'above|x ^[@Bf] rest'],
  ['line start: click left of it, Delete', 'linestart', [['clickLeft', 0]], [K('Delete')], 'above|^ rest'],
  ['line start: Delete in front, Cmd+Z', 'linestart', L6, [K('Delete'), UNDO], 'above|[@Bf] rest'],
  ['line start: join with Backspace, Cmd+Z', 'linestart', L6, [K('Backspace'), UNDO], 'above|[@Bf] rest'],
  ['line start: arrow up from the pill line', 'linestart', [K('ArrowUp')], [], ['above^|[@Bf] rest', 'abov^e|[@Bf] rest', 'abo^ve|[@Bf] rest', 'ab^ove|[@Bf] rest', 'a^bove|[@Bf] rest', '^above|[@Bf] rest']],
  ['line start: Home from the end', 'linestart', [K('ArrowLeft', { meta: true, commands: ['moveToBeginningOfLine'] })], [], 'above|^[@Bf] rest'],
  ['note start: Delete in front', 'notestart', [K('ArrowLeft', { meta: true, commands: ['moveToBeginningOfLine'] })], [K('Delete')], '^ rest'],
  ['note start: type in front', 'notestart', [K('ArrowLeft', { meta: true, commands: ['moveToBeginningOfLine'] })], [['type', 'x']], 'x^[@Bf] rest'],
  ['note start: Backspace behind', 'notestart', L5, [K('Backspace')], '^ rest'],
  ['two pills: arrow between them', 'two', L6, [], 'to [@Bf]^[@Cal] rest'],
  ['two pills: Delete between takes the second', 'two', L6, [K('Delete')], 'to [@Bf]^ rest'],
  ['two pills: Backspace between takes the first', 'two', L6, [K('Backspace')], 'to ^[@Cal] rest'],
  ['two pills: type between, the space comes with it', 'two', L6, [['type', 'X']], 'to [@Bf] X^[@Cal] rest'],
  ['end: Backspace behind', 'end', [], [K('Backspace')], 'Hi ^'],
  ['end: Delete in front', 'end', [K('ArrowLeft')], [K('Delete')], 'Hi ^'],
  ['end: a word typed against it gets its space as it is typed', 'end', [], [['type', 'x']], 'Hi [@Bf] x^'],
  ['end: undo takes the letter and its space together', 'end', [], [['type', 'x'], UNDO], 'Hi [@Bf]'],
  ['mid: Backspace the space, then type: the space comes back', 'mid', L5.slice(0, 4), [K('Backspace'), ['type', 'x']], 'Hi [@Bf] x^rest'],
  ['mid: punctuation against it needs no space', 'end', [], [['type', ',']], 'Hi [@Bf],^'],
];

for (const PAGE of ['compose', 'panel']) {
  const ED = PAGE === 'panel' ? '#modal .compose-editor' : '.compose-editor';
  const SHOWN = `document.querySelector('${ED}').innerHTML.replace(/\\u200B/g,'').replace(/<span[^>]*>(@[^<]*)<\\/span>/g,'[$1]').replace(/&nbsp;/g,' ').replace(/<br>/g,'|').replace(/<div>/g,'|').replace(/<\\/div>/g,'').replace(/^\\|/,'')`;
  // Firefox puts each line in a block of its own on Enter, the first one too, where Chrome
  // leaves the first line bare: the leading | that makes is the same text, and is dropped.
  test(`every edit around a pill behaves as one character does (${PAGE === 'panel' ? 'panel composer' : 'full-size composer'})`, opts, async (t) => {
    let x;
    try { x = await startExtension(); } catch (e) { if (e.skip) return t.skip(e.message); throw e; }
    let pass = 0; const fails = [];
    try {
      const now = Math.floor(Date.now() / 1000);
      x.put({ kind: 0, created_at: now - 50, tags: [], content: JSON.stringify({ name: 'Bf' }) }, 'bea');
      x.put({ kind: 0, created_at: now - 50, tags: [], content: JSON.stringify({ name: 'Cal' }) }, 'cal');
      await x.reload();
      const tab = await x.openPage(`chrome-extension://${x.extId}/${PAGE === 'panel' ? 'sidepanel' : 'compose'}.html`);
      if (PAGE === 'panel') {
        await tab.viewport({ width: 380, height: 820, scale: 1 });
        for (let i = 0; i < 40 && !(await tab.evaluate(`!!document.getElementById('compose-fab')`)); i++) await sleep(250);
        await sleep(800);
        await tab.evaluate(`document.getElementById('compose-fab').click()`); await sleep(400);
        await tab.evaluate(`document.getElementById('compose-note-btn').click()`); await sleep(800);
      }
      for (let i = 0; i < 60 && !(await tab.evaluate(`!!document.querySelector('${ED}') && !document.documentElement.classList.contains('compose-booting')`)); i++) await sleep(250);
      assert.ok(await tab.evaluate(`!!document.querySelector('${ED}')`), 'no editor on the ' + PAGE);
      await sleep(600);
      for (const [name, lay, nav, op, expect] of C) {
        await tab.evaluate(`(() => { const ed = document.querySelector('${ED}'); ed.innerHTML=''; const T=(s)=>document.createTextNode(s); const BR=()=>document.createElement('br'); const P=(n)=>{const p=document.createElement('span');p.className='mention-pill';p.contentEditable='false';p.dataset.bech32='nostr:'+NostrTools.nip19.npubEncode(n==='Bf'?'${x.bea}':'${x.cal}');p.textContent='@'+n;return p;}; ${L[lay]}; ed.focus(); ed.dispatchEvent(new Event('input',{bubbles:true})); const r=document.createRange(); r.selectNodeContents(ed); r.collapse(false); const s=getSelection(); s.removeAllRanges(); s.addRange(r); })()`);
        await sleep(120);
        try {
          for (const st of [...nav, ...op]) {
            if (st[0] === 'key') await tab.press(st[1], st[2] || {});
            else if (st[0] === 'type') await tab.type(st[1]);
            else if (st[0] === 'clickPillAt') {
              const p = await tab.evaluate(`(() => { const r = document.querySelectorAll('${ED} .mention-pill')[${st[1]}].getBoundingClientRect(); return { x: r.left + r.width * ${st[2]}, y: r.top + r.height/2 }; })()`);
              await tab.clickAt(p.x, p.y);
            }
            else if (st[0] === 'clickPill' || st[0] === 'clickLeft') {
              const p = await tab.evaluate(`(() => { const r = document.querySelectorAll('${ED} .mention-pill')[${st[1]}].getBoundingClientRect(); return { x: ${st[0] === 'clickPill' ? 'r.left + r.width/2' : 'r.left - 1'}, y: r.top + r.height/2 }; })()`);
              await tab.clickAt(p.x, p.y);
            }
            await sleep(st[2] && st[2].commands && st[2].commands[0] === 'paste' ? 1500 : 90);
          }
          // After Cmd+Z what came back is selected, as in Word: a marker typed would replace it.
          if (op[op.length - 1] !== UNDO) { await tab.type('^'); await sleep(120); }
        } catch (e) { fails.push([name, 'threw ' + e.message.slice(0, 80)]); continue; }
        const got = await tab.evaluate(SHOWN);
        const ok = [].concat(expect).includes(got);
        // What the composer saved: no anchor in it, and one address for every pill on screen.
        const pills = await tab.evaluate(`document.querySelectorAll('${ED} .mention-pill').length`);
        let saved = null;
        for (let i = 0; i < 20; i++) {
          await sleep(150);
          const all = (await x.message({ type: 'SIDECAR_SECRET_GET', store: 'drafts' })).result || {};
          const texts = Object.values(all).map((d) => (d && d.text) || '');
          saved = texts.find((t) => t.includes(got.includes('rest') ? 'rest' : '')) ?? texts[0] ?? '';
          if (((saved.match(/nostr:npub1/g) || []).length === pills) && saved.replace(/\u00a0/g, ' ').includes(got.replace(/\[@\w+\]/g, '').replace(/[|^]/g, '').trim().slice(0, 2))) break;
        }
        if (/\u200B/.test(saved) || (saved.match(/nostr:npub1/g) || []).length !== pills) { fails.push([name, 'saved text is wrong: ' + JSON.stringify(saved).slice(0, 160)]); continue; }
        if (ok) pass++; else fails.push([name, `expected ${expect}  got ${got}`]);
      }

    } finally { x.close(); }
    assert.deepEqual(fails, [], `${pass} of ${C.length} cases pass`);
    assert.deepEqual(x.errors, []);
  });
}
