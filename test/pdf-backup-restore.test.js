'use strict';

// Restoring from the backup sheet's PDF file (#580). The encrypted sheet sets its 162
// character ncryptsec as two 81-character lines, each its own text string in the page,
// and the reader's pattern stopped at the end of the first string: the import was handed
// half a key and answered "Incorrect password, or not a valid ncryptsec key."
//
// This runs the real sheet builder (pdf-backup.js) into the real reader (secretFromPdfFile
// in sidepanel.js), because a test that wrote its own PDF would only prove the reader can
// read what the test wrote. The layout is left as it is; the reader joins the halves.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const zlib = require('node:zlib');

const ROOT = path.join(__dirname, '..');
const PDF_SRC = fs.readFileSync(path.join(ROOT, 'pdf-backup.js'), 'utf8');
const PANEL = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8').replace(/^\s*\/\/.*$/gm, '');

const NSEC = 'nsec1' + 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'.repeat(2).slice(0, 58); // 63 characters
const NPUB = 'npub1' + 'a'.repeat(58);
// 162 characters, every one different from its neighbors, so a join in the wrong order or
// with a character dropped cannot come out equal.
const NC = ('ncryptsec1' + 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'.repeat(5)).slice(0, 162);

function buildSheet(opts) {
  const sandbox = {
    TextEncoder, console,
    Blob: class {
      constructor(parts) {
        this.text = parts.map((p) => (typeof p === 'string' ? p : 'B'.repeat(p.byteLength))).join('');
      }
    },
  };
  sandbox.window = { qrcode: () => ({ addData() {}, make() {}, getModuleCount: () => 21, isDark: () => false }) };
  vm.createContext(sandbox);
  vm.runInContext(PDF_SRC, sandbox);
  const font = (f) => new Uint8Array(fs.readFileSync(path.join(ROOT, 'fonts', f)));
  const fonts = {
    script: font('pinyon-script.ttf'), text: font('ebgaramond-regular.ttf'),
    textItalic: font('ebgaramond-italic.ttf'), display: font('playfair-500.ttf'),
  };
  const out = sandbox.window.SidecarBackupPdf.build(Object.assign({ npub: NPUB, fonts, date: new Date(0) }, opts));
  // The sheet's own text, one byte per character like the real file's content stream.
  return Buffer.from(out.text, 'latin1');
}

// The reader, lifted from the panel with what it calls.
function reader() {
  const lift = (decl) => {
    const at = PANEL.indexOf(decl);
    assert.ok(at >= 0, decl + ' moved');
    const open = PANEL.indexOf('{', PANEL.indexOf(')', at));
    let depth = 0;
    for (let i = open; i < PANEL.length; i++) {
      if (PANEL[i] === '{') depth++;
      if (PANEL[i] === '}' && --depth === 0) return PANEL.slice(at, i + 1);
    }
    throw new Error('unbalanced ' + decl);
  };
  const ctx = { Uint8Array, String, Response, Blob, DecompressionStream, Error };
  vm.createContext(ctx);
  vm.runInContext(PANEL.match(/const NCRYPTSEC_LENGTH = \d+;/)[0].replace('const ', 'var '), ctx);
  for (const decl of ['function extractSecretFromText(', 'function extractSecretFromPdfText(', 'async function secretFromPdfFile(']) {
    vm.runInContext(lift(decl), ctx);
  }
  return (bytes) => ctx.secretFromPdfFile({ arrayBuffer: async () => new Uint8Array(bytes).buffer });
}

test('the encrypted sheet reads back as the whole ncryptsec, not its first half', async () => {
  const read = reader();
  const sheet = buildSheet({ nsec: NSEC, ncryptsec: NC });
  const got = await read(sheet);
  assert.equal(got.length, 162, 'got ' + got.length + ' of 162 characters');
  assert.equal(got, NC);
});

test('the plain sheet still reads back as one nsec', async () => {
  const read = reader();
  assert.equal(await read(buildSheet({ nsec: NSEC })), NSEC);
});

test('a sheet re-saved with compressed streams reads back whole', async () => {
  const read = reader();
  const sheet = buildSheet({ nsec: NSEC, ncryptsec: NC }).toString('latin1');
  // The page's content stream, deflated the way another tool's re-save would leave it.
  const at = sheet.indexOf('\n4 0 obj');
  const from = sheet.indexOf('stream\n', at) + 'stream\n'.length;
  const content = sheet.slice(from, sheet.indexOf('endstream', from));
  const packed = Buffer.concat([
    Buffer.from('%PDF-1.4\n4 0 obj\n<< /Filter /FlateDecode >>\nstream\n', 'latin1'),
    zlib.deflateSync(Buffer.from(content, 'latin1')),
    Buffer.from('\nendstream\nendobj\n', 'latin1'),
  ]);
  assert.ok(!packed.toString('latin1').includes(NC.slice(0, 20)), 'the key is still in the clear');
  assert.equal(await read(packed), NC);
});

test('only key characters are joined: a caption after a short key is not swallowed', async () => {
  const read = reader();
  const first = NC.slice(0, 81);
  const bytes = Buffer.from(`BT (${first}) Tj ET BT (Keep this sheet somewhere safe) Tj ET`, 'latin1');
  // Short, so it falls back to the plain pattern — the old behavior, and no invented key.
  assert.equal(await read(bytes), first);
});

test('a key the sheet one day sets on a single line still reads back', async () => {
  const read = reader();
  assert.equal(await read(Buffer.from(`BT (${NC}) Tj ET`, 'latin1')), NC);
});
