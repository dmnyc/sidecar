'use strict';

// CODE IN A NOTE, RENDERED AS CODE.
//
// Markdown fences and inline backticks were rendered as literal text, so a note full of
// `i18n.js` and ```…``` read as prose with punctuation scattered through it. Jumble and
// most clients show the first as a monospace box and the second as a tinted word, and a
// note written for those readers is unreadable without it.
//
// The tokenizer is shared by renderNoteText and renderNotePreview, and it already had
// two capture groups that every branch in both functions indexes by number. So the risk
// here is not the rendering, it is the regex: a new group in the wrong place silently
// repoints m[1] and m[2] at something else.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const core = fs.readFileSync(path.join(ROOT, 'composer-core.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');

// The real regex, lifted.
const RE_SRC = core.match(/const PREVIEW_RE = (\/.*\/gi);/)[1];
function tokens(text) {
  const c = { out: [] };
  c.globalThis = c;
  vm.createContext(c);
  vm.runInContext(
    'const RE = ' + RE_SRC + '; let m; RE.lastIndex = 0;' +
    'while ((m = RE.exec(text)) !== null) {' +
    '  out.push([m[1] ? "url" : m[2] ? "bech" : m[3] ? "fence" : "inline", m[0]]);' +
    '}', Object.assign(c, { text }));
  return [...c.out].map((t) => [...t]);
}

const fenceBody = (() => {
  const c = { String };
  c.globalThis = c;
  vm.createContext(c);
  vm.runInContext(core.match(/function fenceBody\(raw\)[\s\S]*?\n  \}/)[0] + ';globalThis.f = fenceBody;', c);
  return c.f;
})();

test('THE EXISTING GROUPS STILL MEAN WHAT EVERY BRANCH THINKS THEY MEAN', () => {
  // m[1] is the url and m[2] is the bech32 ref, in both renderers, by number. The new
  // groups are appended for exactly this reason.
  assert.deepEqual(tokens('https://example.com')[0], ['url', 'https://example.com']);
  const npub = 'npub1' + 'q'.repeat(58);
  assert.deepEqual(tokens(npub)[0], ['bech', npub]);
});

test('A FENCE SWALLOWS WHAT IS INSIDE IT, INCLUDING A URL', () => {
  // Left-to-right: a fence opens before anything it contains, so the leftmost match is
  // the fence and the URL inside never becomes a link. Linkifying inside a code block is
  // both wrong to read and a place a reader might click something they were only shown.
  const t = tokens('a ```\nvisit https://evil.example\n``` b');
  assert.deepEqual(t.map((x) => x[0]), ['fence']);
  assert.match(t[0][1], /evil\.example/);

  // But a URL before the fence is still a URL.
  const t2 = tokens('https://ok.example then ```\ncode\n```');
  assert.deepEqual(t2.map((x) => x[0]), ['url', 'fence']);
});

test('FENCED IS TRIED BEFORE INLINE', () => {
  // Otherwise ``` matches as an empty inline pair plus a stray backtick, and the fence
  // never forms.
  assert.deepEqual(tokens('```\nx\n```').map((x) => x[0]), ['fence']);
  assert.ok(RE_SRC.indexOf('```') < RE_SRC.lastIndexOf('`[^`'),
    'the inline alternative comes first, so a fence can never match');
});

test('AN UNCLOSED BACKTICK CANNOT EAT THE REST OF THE NOTE', () => {
  // The commonest way backticks appear in prose is one of them, by accident. Inline
  // refuses newlines, and an unterminated fence simply does not match.
  assert.deepEqual(tokens('a ` b'), []);
  assert.deepEqual(tokens('a `b\nc` d'), [], 'inline matched across a newline');
  assert.deepEqual(tokens('```\nnever closed'), []);
  // And a closed one on a single line does match.
  assert.deepEqual(tokens('use `i18n.js` here'), [['inline', '`i18n.js`']]);
});

test('the fence body drops its language tag, not its first line of code', () => {
  assert.equal(fenceBody('```\nconst a = 1;\n```'), 'const a = 1;');
  assert.equal(fenceBody('```js\nconst a = 1;\n```'), 'const a = 1;',
    'the tag is an instruction to a highlighter, and there is none here');
  // A one-line fence has no tag line to drop, so nothing is dropped.
  assert.equal(fenceBody('``` inline-ish content ```'), ' inline-ish content');
  // Trailing blank lines go; leading ones too.
  assert.equal(fenceBody('```\n\nline\n\n\n```'), 'line');
});

test('A FENCE SCROLLS SIDEWAYS RATHER THAN WRAPPING', () => {
  // Wrapping code invents line breaks that are not in it, and in a shell command or a
  // path that is the difference between correct and wrong. The panel is 360px, so
  // something has to give and it should be the viewport.
  const rule = css.slice(css.indexOf('pre.note-code {'), css.indexOf('pre.note-code code'));
  assert.match(rule, /overflow-x: auto/);
  const codeRule = css.slice(css.indexOf('pre.note-code code {'));
  assert.match(codeRule.slice(0, 300), /white-space: pre;/);
  assert.ok(!/white-space: pre-wrap/.test(codeRule.slice(0, 300)), 'code is being wrapped');
  // Bounded vertically too, or one long listing takes the whole sheet.
  assert.match(rule, /max-height: \d+px/);
});

test('BOTH RENDERERS DRAW IT, FROM ONE BUILDER', () => {
  // renderNoteText is the context strips and the reply block; renderNotePreview is the
  // Preview pane. A note that reads correctly in one and not the other is worse than
  // neither, because it looks like the note changed on the way out.
  assert.match(core, /function codeBlockEl\(raw\)/);
  assert.match(core, /function codeInlineEl\(raw\)/);
  const noteText = core.slice(core.indexOf('function renderNoteText('), core.indexOf('const PREVIEW_RE'));
  const preview = core.slice(core.indexOf('function renderNotePreview('));
  for (const [name, src] of [['renderNoteText', noteText], ['renderNotePreview', preview.slice(0, 4000)]]) {
    assert.match(src, /codeBlockEl\(m\[3\]\)/, name + ' does not render a fence');
    assert.match(src, /codeInlineEl\(m\[4\]\)/, name + ' does not render inline code');
  }
});

test('a fence counts against the cap, and is refused whole', () => {
  // The context strips truncate. Half a code block is worse than a line saying there is
  // one, because a reader cannot tell a cut from the code ending there.
  const noteText = core.slice(core.indexOf('function renderNoteText('), core.indexOf('const PREVIEW_RE'));
  assert.match(noteText, /if \(used \+ m\[3\]\.length > maxLen\) \{ pushText\('…'\); truncated = true; \}/);
  assert.match(noteText, /used \+= m\[3\]\.length;/);
  // The preview does not cap at all: it is what the note will look like.
  const preview = core.slice(core.indexOf('function renderNotePreview('));
  const branch = preview.slice(preview.indexOf('} else if (m[3]) {'), preview.indexOf('} else if (m[4]) {'));
  assert.ok(!/maxLen/.test(branch), 'the preview truncates a fence');
});

test('A CODE BLOCK IS COPYABLE, AND THE BUTTON DOES NOT SCROLL AWAY', () => {
  // The reason somebody pastes code into a note is for you to run it, and a box that
  // scrolls sideways is the worst thing there is to select by hand in a 360px panel.
  const fn = core.slice(core.indexOf('function codeBlockEl(raw)'));
  const body = fn.slice(0, fn.indexOf('\n  }\n'));
  assert.match(body, /navigator\.clipboard\.writeText\(body\)/);
  // The FENCE BODY, not the raw match: copying ``` with the code is copying punctuation
  // that was never part of it.
  assert.ok(!/writeText\(raw\)/.test(body), 'the backticks are copied along with the code');

  // Outside the scroller, in a wrapper, or it slides off with the content on a long line.
  assert.match(body, /className: 'note-code-wrap'/);
  assert.match(body, /wrap\.append\(pre, copy\)/);
  assert.match(css, /\.note-code-wrap \{ position: relative; \}/);
  assert.match(css, /\.note-code-copy \{[\s\S]*?position: absolute;/);
  // Room made for it, or the first line of code starts underneath the button.
  assert.match(css, /pre\.note-code \{ padding-right: \d+px; \}/);

  // The block can sit inside a row that is itself a link to the note.
  assert.match(body, /e\.preventDefault\(\);\s*\n\s*e\.stopPropagation\(\);/);
  // The tick reverts: a permanent one on a page with several blocks says the wrong
  // thing about which was copied.
  assert.match(body, /copy\.classList\.remove\('ok'\)/);
});

test('THE NOTIFICATION PANEL DRAWS THE SAME BOXES, BUT ONLY WHEN OPEN', () => {
  const panel = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');
  // Expanded renders, collapsed does not: a collapsed row is a 140-character snippet
  // under a three-line clamp among two dozen others, and a monospace box in one would be
  // taller than the row it is summarizing.
  assert.match(panel, /if \(open\) renderTextWithCode\(contentEl, text\);/);
  assert.match(panel, /else contentEl\.textContent = text\.length > 140/);

  // The mention-name pass rewrites the same element seconds later and has to redraw the
  // same way, or an expanded row loses its code boxes when a profile resolves.
  assert.match(panel, /if \(open\) renderTextWithCode\(contentEl, cleaned\);/);

  // Code ONLY. renderNoteText would add images, videos and quote cards, and the row
  // already carries its own media chips.
  const shared = core.slice(core.indexOf('function renderTextWithCode('));
  const fnBody = shared.slice(0, shared.indexOf('\n  }\n'));
  assert.ok(!/note-media|link-card|quote-inline/.test(fnBody),
    'the snippet renderer draws embeds, which makes a row a second copy of the note');

  // And it trims the newlines around a block, since these containers are pre-wrap and
  // each one would otherwise be an empty line stacked on the block's own margin.
  assert.match(fnBody, /replace\(\/\\s\+\$\/, ''\)/);
  assert.match(fnBody, /skipLead = true;/);
});
