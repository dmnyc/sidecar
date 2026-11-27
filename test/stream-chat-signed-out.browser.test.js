'use strict';

// READING CHAT NEEDS NO ACCOUNT.
//
// The chat button only appeared when the panel had an account, so someone who had installed
// Sidecar and not added one yet could watch a stream and never see the chat beside it. Reading
// is a public lookup; what needs an account is posting, reacting, zapping and opening a profile.
// This builds the real chat (stream-chat.js, the real styles) in a real Chrome against a fake
// relay that serves one signed message, and walks it signed out, signed in, and locked.
//
// Needs a Chrome or Chromium binary (CHROME_PATH, or one of the usual places); without one
// it skips, like the other browser tests.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = process.env.STREAM_CHAT_SIGNED_OUT_ROOT || path.join(__dirname, '..');
const CHROME = require('./helpers/chrome-path').findChrome(); // never the Chrome you browse with: see helpers/chrome-path.js

function page() {
  return `<!doctype html><html data-theme="speakeasy"><head><meta charset="utf-8">
<link rel="stylesheet" href="file://${ROOT}/styles.css"><link rel="stylesheet" href="file://${ROOT}/streams.css"></head>
<body style="width:360px;height:700px;margin:0">
<div id="stream-dock" style="height:40px"></div><div id="stream-info"></div>
<script>
// A fake relay. It has to exist before nostr-tools loads: that file takes the page's WebSocket
// once, when it is read. Every relay the chat asks serves the one signed message set below.
window.WebSocket = class {
  static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
  constructor(url) { this.url = url; this.readyState = 0; setTimeout(() => { this.readyState = 1; this.onopen && this.onopen({}); }, 0); }
  send(data) {
    const m = JSON.parse(data);
    if (m[0] !== 'REQ') return;
    setTimeout(() => {
      if (window.__message && (m[2].kinds || []).includes(1311)) this._in(['EVENT', m[1], window.__message]);
      this._in(['EOSE', m[1]]);
    }, 0);
  }
  close() { this.readyState = 3; this.onclose && this.onclose({ code: 1000 }); }
  _in(a) { this.onmessage && this.onmessage({ data: JSON.stringify(a) }); }
};
</script>
<script src="file://${ROOT}/i18n.js"></script><script src="file://${ROOT}/nostr-tools.js"></script>
<script src="file://${ROOT}/emoji-data.js"></script><script src="file://${ROOT}/composer-core.js"></script>
<script src="file://${ROOT}/stream-core.js"></script><script src="file://${ROOT}/stream-chat.js"></script>
<script>
(async () => {
  const out = {};
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const host = 'a'.repeat(64);
  const item = { key: '30311:' + host + ':show', relays: [], host };

  // One signed chat message, which the fake relay above serves to every relay the chat asks.
  const sk = NostrTools.generateSecretKey();
  window.__message = NostrTools.finalizeEvent({ kind: 1311, created_at: Math.floor(Date.now() / 1000) - 5, tags: [['a', item.key]], content: 'hello from the room' }, sk);

  let signedIn = false, unlocked = true;
  const core = window.SidecarCore.installComposer(new Proxy({}, { get: () => () => {} }));
  window.SidecarStreamChatAccount = {
    identity: () => (signedIn && unlocked ? { pubkey: 'b'.repeat(64), name: 'Dani' } : null),
    readable: () => unlocked,
    prepare: async () => {}, muted: () => false, cachedProfiles: () => new Map(),
    createMentionEditor: (o) => core.createMentionEditor(o),
    profile: () => {}, zap: () => {}, send: async (t) => t,
    showAccounts: () => { out.accountsOpened = (out.accountsOpened || 0) + 1; },
  };
  const view = window.SidecarStreamChat.mount(null, () => item, () => unlocked, () => {});
  const pane = () => document.getElementById('stream-chat-panel');
  const toggle = () => document.getElementById('stream-chat-toggle');
  const snap = () => ({
    toggleShown: !toggle().hidden,
    paneOpen: !pane().hidden,
    who: pane().querySelector('.stream-chat-identity').textContent.trim(),
    messages: pane().querySelectorAll('.stream-chat-message').length,
    actionBars: pane().querySelectorAll('.stream-chat-message .stream-chat-actions').length,
    authorDisabled: [...pane().querySelectorAll('.stream-chat-message .stream-chat-author')].every((b) => b.disabled),
    sendDisabled: pane().querySelector('.stream-chat-form button.primary').disabled,
    // Whether each part of the composer is on screen (an ancestor with display:none has no offsetParent).
    shown: {
      editor: !!pane().querySelector('.stream-chat-editor') && pane().querySelector('.stream-chat-editor').offsetParent !== null,
      send: pane().querySelector('.stream-chat-form > .primary').offsetParent !== null,
      emoji: !!pane().querySelector('.stream-chat-emoji') && pane().querySelector('.stream-chat-emoji').offsetParent !== null,
      hide: pane().querySelector('.stream-chat-hide').offsetParent !== null,
      link: !!pane().querySelector('.stream-chat-signup') && pane().querySelector('.stream-chat-signup').offsetParent !== null,
    },
    // The look is the shared add-link's, as the computed style says: gold, borderless, 12px, bold, no underline.
    linkStyle: (() => {
      const l = pane().querySelector('.stream-chat-signup');
      if (!l) return null;
      const reference = document.createElement('button'); reference.className = 'account-stat-add-link'; document.body.append(reference);
      const pick = (el) => { const s = getComputedStyle(el); return [s.color, s.fontSize, s.fontWeight, s.borderTopWidth, s.textDecorationLine, s.backgroundColor].join('|'); };
      const same = pick(l) === pick(reference);
      reference.remove();
      return same;
    })(),
  });

  // Signed out, panel unlocked.
  view.sync();
  out.outToggle = !toggle().hidden;
  view.open();
  await wait(300);
  out.signedOut = snap();

  // The link goes to the Accounts tab and takes the chat down with it.
  pane().querySelector('.stream-chat-signup').click();
  await wait(100);
  out.afterLink = { paneOpen: !pane().hidden, accountsOpened: out.accountsOpened || 0 };
  view.open();
  await wait(300);

  // An account arrives while the chat is open.
  signedIn = true;
  window.dispatchEvent(new CustomEvent('sidecar-chat-account'));
  await wait(300);
  out.signedIn = snap();

  // The panel locks: the chat closes and its button goes.
  unlocked = false;
  window.dispatchEvent(new CustomEvent('sidecar-chat-account'));
  view.sync();
  await wait(100);
  out.locked = snap();

  const pre = document.createElement('pre'); pre.id = 'result'; pre.textContent = JSON.stringify(out); document.body.append(pre);
})().catch((e) => { const pre = document.createElement('pre'); pre.id = 'result'; pre.textContent = JSON.stringify({ error: String(e && e.stack || e) }); document.body.append(pre); });
</script></body></html>`;
}

function measure() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-chat-out-'));
  const file = path.join(dir, 'page.html');
  fs.writeFileSync(file, page());
  try {
    const r = spawnSync(CHROME, [
      '--headless=new', '--disable-gpu', '--no-sandbox', '--allow-file-access-from-files',
      `--user-data-dir=${path.join(dir, 'profile')}`, '--virtual-time-budget=15000', '--window-size=420,900',
      '--dump-dom', `file://${file}`,
    ], { encoding: 'utf8', timeout: 60000 });
    const m = /<pre id="result">([\s\S]*?)<\/pre>/.exec(r.stdout || '');
    assert.ok(m, 'Chrome did not report: ' + (r.stderr || '').slice(0, 300));
    const out = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'));
    assert.ok(!out.error, out.error);
    return out;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const opts = { skip: CHROME ? false : 'no Chrome found', timeout: 90000 };

test('A SIGNED-OUT READER SEES THE CHAT, AND ONLY WHAT NEEDS NO ACCOUNT', opts, () => {
  const r = measure();
  assert.equal(r.outToggle, true, 'the chat button shows with no account');
  assert.equal(r.signedOut.paneOpen, true, 'and opens');
  assert.equal(r.signedOut.who, 'Add an account to chat →', 'the line says what is missing, not "Unlock", with the arrow the other add-links carry');
  assert.equal(r.signedOut.messages, 1, 'the message is read from the relays');
  assert.equal(r.signedOut.actionBars, 0, 'reply, react and zap are not offered with no account to use them');
  assert.equal(r.signedOut.authorDisabled, true, 'a name that opens a profile sheet is plain text without an account');
});

test('SIGNED OUT, THE COMPOSER IS GONE AND THE LINE LEADS TO THE ACCOUNTS TAB', opts, () => {
  const r = measure();
  assert.equal(r.signedOut.shown.editor, false, 'no message box');
  assert.equal(r.signedOut.shown.send, false, 'no send button');
  assert.equal(r.signedOut.shown.emoji, false, 'no emoji button');
  assert.equal(r.signedOut.shown.link, true, '“Add an account to chat” is a link');
  assert.equal(r.signedOut.linkStyle, true, 'it looks like “Add wallet →” and the zap sheet’s “Connect a wallet to zap from here →”');
  assert.equal(r.signedOut.shown.hide, true, 'and the chat can still be hidden');
  assert.deepEqual(r.afterLink, { paneOpen: false, accountsOpened: 1 }, 'tapping it closes the chat and opens the Accounts tab');
  assert.equal(r.signedIn.shown.editor, true, 'with an account the message box is back');
  assert.equal(r.signedIn.shown.send, true);
  assert.equal(r.signedIn.shown.link, false);
});

test('AN ACCOUNT ADDED TO AN OPEN CHAT TURNS THE CONTROLS ON', opts, () => {
  const r = measure();
  assert.equal(r.signedIn.paneOpen, true, 'the chat stays open');
  assert.equal(r.signedIn.who, 'Posting as Dani');
  assert.equal(r.signedIn.actionBars, 1, 'reply, react and zap appear on the message');
  assert.equal(r.signedIn.authorDisabled, false);
});

test('A LOCKED PANEL STILL HIDES THE CHAT', opts, () => {
  const r = measure();
  assert.equal(r.locked.paneOpen, false);
  assert.equal(r.locked.toggleShown, false);
});
