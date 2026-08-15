// Audit #195 — the backup sheet's optional encrypted second page.
//
// The interesting failure modes are structural, not cosmetic: a page count that
// doesn't match /Kids, an ncryptsec that leaks onto page 1 (or an nsec onto
// page 2), or an xref table whose offsets were computed on a different string
// than the one written. All three produce a PDF that opens fine and then bites.
// So these tests read the assembled bytes the way a reader would.
//
// qrcode is stubbed flat (all modules light) — the module matrix is exercised
// by the real generator elsewhere; here it only needs to be drawable.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'pdf-backup.js'), 'utf8');

const NSEC = 'nsec1' + 'q'.repeat(58); // 63 chars, as a real one is
const NPUB = 'npub1' + 'a'.repeat(58);
const NC = 'ncryptsec1' + 'z'.repeat(100); // ~110 chars, split across two lines

function load() {
  const sandbox = {
    TextEncoder,
    console,
    // Blob shim: keep the parts so the tests can read the assembled file as text.
    // Every part pdf-backup.js produces is a string, so join() is the whole PDF.
    Blob: class {
      constructor(parts, opts) {
        this.text = parts.join('');
        this.type = (opts && opts.type) || '';
      }
    },
  };
  sandbox.window = { qrcode: () => ({ addData() {}, make() {}, getModuleCount: () => 21, isDark: () => false }) };
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  return sandbox.window.SidecarBackupPdf;
}

// The stream body of object N, from its header to the endstream that closes it.
function objectBody(pdfText, n) {
  const start = pdfText.indexOf(`\n${n} 0 obj`);
  assert.ok(start >= 0, `object ${n} is missing from the PDF`);
  return pdfText.slice(start, pdfText.indexOf('endstream', start));
}

test('without ncryptsec the sheet is unchanged: one page, seven objects', () => {
  const Pdf = load();
  const t = Pdf.build({ nsec: NSEC, npub: NPUB, name: 'Test Account' }).text;
  assert.match(t, /\/Count 1\b/);
  assert.match(t, /\/Kids \[3 0 R\]/);
  // Object 8+ simply don't exist — numbering stays put for the one-page sheet.
  assert.ok(!t.includes('8 0 obj'));
  assert.ok(!t.includes('9 0 obj'));
});

test('with ncryptsec the PDF grows a second page and both keys stay on their own pages', () => {
  const Pdf = load();
  const t = Pdf.build({ nsec: NSEC, npub: NPUB, ncryptsec: NC }).text;
  assert.match(t, /\/Count 2\b/);
  assert.match(t, /\/Kids \[3 0 R 8 0 R\]/);

  // Page 2 (object 9's stream) carries the encrypted key — both halves of the
  // split — and never the plain nsec.
  const page2 = objectBody(t, 9);
  const mid = Math.ceil(NC.length / 2);
  assert.ok(page2.includes(NC.slice(0, mid)), 'first half of the ncryptsec on page 2');
  assert.ok(page2.includes(NC.slice(mid)), 'second half of the ncryptsec on page 2');
  assert.ok(!page2.includes(NSEC), 'plain nsec must not appear on the encrypted page');

  // Page 1 (object 4's stream) is the plain-key sheet and stays exactly that.
  const page1 = objectBody(t, 4);
  assert.ok(page1.includes(NSEC));
  assert.ok(!page1.includes(NC), 'ncryptsec must not appear on page 1');

  // Page 2 says what it is in the form strip, so a thumbnail tells the two apart.
  assert.ok(page2.includes('ENCRYPTED RECORD'));
  assert.ok(objectBody(t, 4).includes('PERMANENT RECORD'));
});

test('xref offsets point at the actual object headers, in both layouts', () => {
  for (const nc of [undefined, NC]) {
    const Pdf = load();
    const t = Pdf.build({ nsec: NSEC, npub: NPUB, ncryptsec: nc }).text;
    const headers = [...t.matchAll(/^(\d+) 0 obj/gm)];
    const rows = t.slice(t.indexOf('\nxref')).split('\n').filter((l) => / n $/.test(l));
    assert.equal(rows.length, headers.length, 'one xref row per object');
    headers.forEach((m, i) => {
      assert.equal(
        Number(rows[i].slice(0, 10)),
        m.index,
        `xref entry for object ${i + 1} matches its byte offset`
      );
    });
  }
});
