'use strict';

// Deleting the wallet backup from the relays.
//
// kind:30078 is replaceable, so the deletion that works is a newer record with the same
// d-tag and nothing in it; a kind 5 alone is a request relays may ignore. These run the
// real functions from sidepanel.js against stubs for the signer and the relays.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'sidepanel.js'), 'utf8');
function lift(pattern, label) {
  const m = source.match(pattern);
  if (!m) throw new Error('Could not find ' + label + ' in sidepanel.js');
  return m[0];
}

const ME = 'a'.repeat(64);
const DTAG = 'sidecar:nwc-backup';

function harness({ existing, relaysAfter, tombstonePublishThrows, requestPublishThrows, readEvents }) {
  const signed = [];
  const published = [];
  const ctx = {
    console, Math, Date,
    state: { activePubkey: ME },
    t: (s) => s,
    NWC_BACKUP_DTAG: DTAG,
    BACKUP_READ_CAP_MS: 8000,
    // before the deletion: what the relays hold; after: relaysAfter
    fetchBackupEvent: async () => existing || null,
    backupReadRelays: async () => ['wss://a.example', 'wss://b.example'],
    call: async (m) => {
      assert.equal(m.type, 'SIDECAR_OWNER_SIGN');
      assert.equal(m.expectedPubkey, ME, 'signs only as the account the panel is showing');
      signed.push(m.event);
      return { ...m.event, id: 'id' + signed.length, pubkey: ME, sig: 'sig' };
    },
    publishToRelays: async (relays, ev) => {
      published.push({ relays, ev });
      if (ev.kind === 30078 && tombstonePublishThrows) throw new Error('no relay took it');
      if (ev.kind === 5 && requestPublishThrows) throw new Error('refused');
      return relays.length;
    },
    poolQueryAnswered: async () => ({ events: relaysAfter || [], answered: true, complete: true }),
  };
  vm.createContext(ctx);
  vm.runInContext(
    lift(/async function deleteNwcBackup\(\)\s*\{[\s\S]*?\n  \}/, 'deleteNwcBackup') + '\nglobalThis.deleteNwcBackup = deleteNwcBackup;',
    ctx
  );
  return { ctx, signed, published };
}

test('the deletion is an empty record at the same address, newer than the backup', async () => {
  const { ctx, signed } = harness({ existing: { content: 'CIPHERTEXT', created_at: 1750000000 } });
  await ctx.deleteNwcBackup();
  const tomb = signed.find((e) => e.kind === 30078);
  assert.equal(JSON.stringify(tomb.tags), JSON.stringify([['d', DTAG]]));
  assert.equal(tomb.content, '');
  assert.ok(tomb.created_at > 1750000000);
});

test('a backup stamped in the future is still replaced: the record is one second newer', async () => {
  const future = Math.floor(Date.now() / 1000) + 3600;
  const { ctx, signed } = harness({ existing: { content: 'CIPHERTEXT', created_at: future } });
  await ctx.deleteNwcBackup();
  assert.equal(signed.find((e) => e.kind === 30078).created_at, future + 1);
});

test('a kind 5 for the address goes along', async () => {
  const { ctx, signed } = harness({});
  await ctx.deleteNwcBackup();
  const req = signed.find((e) => e.kind === 5);
  assert.equal(JSON.stringify(req.tags), JSON.stringify([['a', '30078:' + ME + ':' + DTAG], ['k', '30078']]));
});

test('only Sidecar’s own record is touched: no other app’s d-tag is signed or requested', async () => {
  const { ctx, signed } = harness({});
  await ctx.deleteNwcBackup();
  const tags = signed.flatMap((e) => e.tags);
  const addresses = tags.filter((x) => x[0] === 'd' || x[0] === 'a').map((x) => x[1]);
  assert.deepEqual([...new Set(addresses)].sort(), ['30078:' + ME + ':' + DTAG, DTAG].sort());
  assert.equal(signed.filter((e) => e.kind === 5 && e.tags.some((x) => x[0] === 'e')).length, 0, 'no blanket e-tag deletions');
});

test('both go to every relay the backup is read from', async () => {
  const { ctx, published } = harness({});
  await ctx.deleteNwcBackup();
  assert.equal(published.length, 2);
  for (const p of published) assert.equal(p.relays.join(','), 'wss://a.example,wss://b.example');
});

test('relays that answer with no ciphertext left report nothing remaining', async () => {
  const tomb = { pubkey: ME, content: '', created_at: 1 };
  const { ctx } = harness({ relaysAfter: [tomb] });
  assert.equal((await ctx.deleteNwcBackup()).remaining, 0);
});

test('a relay still holding the ciphertext is counted, whatever was sent', async () => {
  const held = [
    { pubkey: ME, content: 'CIPHERTEXT', created_at: 1 },
    { pubkey: ME, content: 'OLDER', created_at: 0 },
    { pubkey: ME, content: '', created_at: 2 },
    { pubkey: 'b'.repeat(64), content: 'someone else', created_at: 1 },
  ];
  const { ctx } = harness({ relaysAfter: held });
  assert.equal((await ctx.deleteNwcBackup()).remaining, 2);
});

test('if no relay takes the deletion it fails loudly instead of reporting success', async () => {
  const { ctx } = harness({ tombstonePublishThrows: true });
  await assert.rejects(ctx.deleteNwcBackup(), /no relay took it/);
});

test('a refused kind 5 does not fail the deletion: the replacement is the deletion', async () => {
  const { ctx } = harness({ requestPublishThrows: true });
  assert.equal((await ctx.deleteNwcBackup()).remaining, 0);
});

// ---- reading a deleted backup ---------------------------------------------------

function reader(events, extra) {
  const ctx = {
    console,
    state: { activePubkey: ME },
    t: (s) => s,
    BACKUP_READ_CAP_MS: 8000,
    backupReadRelays: async () => ['wss://a.example'],
    poolQueryAnswered: async () => Object.assign({ events, answered: true, complete: true }, extra),
  };
  vm.createContext(ctx);
  vm.runInContext(
    lift(/async function fetchBackupEvent\(dtag\)\s*\{[\s\S]*?\n  \}/, 'fetchBackupEvent') + '\nglobalThis.fetchBackupEvent = fetchBackupEvent;',
    ctx
  );
  return ctx;
}

test('an empty record that is newest reads as no backup, not as a copy that cannot be read', async () => {
  const ctx = reader([
    { pubkey: ME, content: 'CIPHERTEXT', created_at: 100 },
    { pubkey: ME, content: '', created_at: 200 },
  ]);
  assert.equal(await ctx.fetchBackupEvent(DTAG), null);
});

test('a backup newer than a deletion is a backup again', async () => {
  const ctx = reader([
    { pubkey: ME, content: '', created_at: 200 },
    { pubkey: ME, content: 'CIPHERTEXT', created_at: 300 },
  ]);
  assert.equal((await ctx.fetchBackupEvent(DTAG)).content, 'CIPHERTEXT');
});

// ---- the confirmation -----------------------------------------------------------

test('the confirmation warns, leads with the destructive button, and acts only on its click', () => {
  let confirmed = 0;
  let closed = 0;
  const mk = (tag) => {
    const el = { tag, children: [], handlers: {}, className: '', textContent: '' };
    el.append = (...k) => { el.children.push(...k); };
    el.addEventListener = (type, fn) => { el.handlers[type] = fn; };
    return el;
  };
  const modal = mk('div');
  const ctx = {
    t: (s) => s,
    h: (tag, props, kids) => { const e = mk(tag); Object.assign(e, props || {}); if (kids) e.append(...kids); return e; },
    document: { createTextNode: (s) => ({ text: s }) },
    openModal: (build) => build(modal),
    closeModal: () => { closed++; },
  };
  vm.createContext(ctx);
  vm.runInContext(
    lift(/function confirmDeleteNwcBackup\(onConfirm\)\s*\{[\s\S]*?\n  \}/, 'confirmDeleteNwcBackup') + '\nglobalThis.f = confirmDeleteNwcBackup;',
    ctx
  );
  ctx.f(() => { confirmed++; });
  const [title, body, actions] = modal.children;
  assert.equal(title.textContent, 'Delete wallet backup?');
  const text = body.children.map((c) => c.text || c.textContent).join(' ');
  assert.match(text, /Removes the backup Sidecar saved on your relays/);
  assert.match(text, /Other apps’ backups and the connected wallet stay/);
  assert.match(text, /Delete requests are best effort, so some relays may keep a copy/);
  assert.equal(body.children.some((c) => c.tag === 'strong'), false, 'the warning is plain text, not bold');
  const [go, cancel] = actions.children;
  assert.equal(go.className, 'danger', 'the delete button wears the destructive color');
  assert.equal(go.textContent, 'Delete backup');
  assert.equal(cancel.textContent, 'Cancel');
  assert.equal(confirmed, 0, 'opening the dialog deletes nothing');
  cancel.handlers.click();
  assert.equal(confirmed, 0, 'Cancel deletes nothing');
  go.handlers.click();
  assert.equal(confirmed, 1);
  assert.equal(closed, 2);
});
