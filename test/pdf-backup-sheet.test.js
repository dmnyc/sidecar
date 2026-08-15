// Audit #195 — the backup sheet's encrypted variant.
//
// The design is either/or: one PDF, one page. A file carrying both a plain and
// an encrypted page would make the encryption pointless — the plain page alone
// restores (and steals) the account — so the interesting failure modes are
// structural: a page count that doesn't match /Kids, an ncryptsec build that
// still leaks the plain nsec (or vice versa), or an xref table whose offsets
// were computed on a different string than the one written. All three produce
// a PDF that opens fine and then bites, so these tests read the assembled
// bytes the way a reader would.
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

// The four faces the panel fetches and the invitation embeds, straight from
// fonts/ — the same bytes Firefox and Chrome will ship. (Plain reads, no
// presence dance: a missing face is a packaging bug the build should fail on.)
const font = (f) => new Uint8Array(fs.readFileSync(path.join(__dirname, '..', 'fonts', f)));
const FONTS = {
  script: font('pinyon-script.ttf'),
  text: font('ebgaramond-regular.ttf'),
  textItalic: font('ebgaramond-italic.ttf'),
  display: font('playfair-500.ttf'),
};

function load() {
  const sandbox = {
    TextEncoder,
    console,
    // Blob shim: keep the parts so the tests can read the assembled file as text.
    // Binary parts (the subset font programs) become equal-length placeholder
    // strings — each 'B' is one byte, so join() is a text view of the PDF whose
    // character offsets match the byte offsets the xref was computed on.
    Blob: class {
      constructor(parts, opts) {
        this.text = parts.map((p) => (typeof p === 'string' ? p : 'B'.repeat(p.byteLength))).join('');
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

test('without ncryptsec the sheet is the plain telegram: one page, shared font set', () => {
  const Pdf = load();
  const t = Pdf.build({ nsec: NSEC, npub: NPUB, name: 'Test Account' }).text;
  assert.match(t, /\/Count 1\b/);
  assert.match(t, /\/Kids \[3 0 R\]/);
  // Both sheets share one object graph (10 objects: fonts 5-9, OCG 10) so the
  // numbering never moves between them — nothing past the OCG can exist.
  assert.ok(!t.includes('11 0 obj'));
  const page = objectBody(t, 4);
  assert.ok(page.includes(NSEC), 'the plain nsec is on the sheet');
  assert.ok(page.includes('PERMANENT RECORD'), 'the telegram form strip is there');
});

test('with ncryptsec the PDF is a different one-page sheet, and only that sheet', () => {
  const Pdf = load();
  const t = Pdf.build({ nsec: NSEC, npub: NPUB, ncryptsec: NC, fonts: FONTS, date: new Date(0) }).text;
  assert.match(t, /\/Count 1\b/);
  assert.match(t, /\/Kids \[3 0 R\]/);
  assert.ok(!t.includes('19 0 obj'), 'no second page ever — either/or, not both');

  // The encrypted page carries the masked key — both halves of the split — and
  // never the plain nsec. This is the property the either/or design exists for:
  // the file must be useless without the password, and the nsec IS the bypass.
  const page = objectBody(t, 4);
  const mid = Math.ceil(NC.length / 2);
  assert.ok(page.includes(NC.slice(0, mid)), 'first half of the ncryptsec on the page');
  assert.ok(page.includes(NC.slice(mid)), 'second half of the ncryptsec on the page');
  assert.ok(!page.includes(NSEC), 'the plain nsec must not appear anywhere in the file');
  assert.ok(!t.includes(NSEC), 'nor anywhere outside the page stream');

  // Serif lines are placed per character (tracking with real advance widths),
  // and the space glyph is skipped — its advance IS the gap — so reassemble the
  // Tj payloads and match space-free. Says what it is in the particulars line,
  // so a thumbnail tells the sheets apart; /F6 is the copperplate script the
  // guest's name is set in, /F8 the Garamond italic of the body.
  const flat = [...page.matchAll(/\((.*?)\) Tj/g)].map((m) => m[1]).join('');
  assert.ok(flat.includes('SAVEYOURKEY'), 'the save-the-date display line is set');
  // The particulars strip is just the issue moment now — no serial, no banner.
  // Flattened (spaces are never drawn, only advanced), so the time and zone
  // assert too.
  assert.ok(flat.includes('1970-01-0100:00UTC'), 'the date, time, and zone are set');
  assert.ok(!flat.includes('SERIAL'), 'the serial is not');
  // The guest's address line under the script name: abbreviated, but showing
  // both halves so the sheet can still be eyeballed against the account list.
  assert.ok(flat.includes('npub1aaaaaaaaa...aaaaaa'), 'the abbreviated npub is set under the name');
  assert.ok(flat.includes('PASSWORDREQUIREDFORENTRY'), 'the QR caption');
  assert.ok(page.includes('/F6 '), 'the script face is used');
  assert.ok(page.includes('/F8 '), 'the italic face is used');
  assert.ok(!page.includes('PERMANENT RECORD'), 'not the telegram letterhead');

  // The embedded faces: objects 11-14 are the font dictionaries, 15-18 their
  // subset programs. Each program must exist, be declared as FontFile2 from its
  // dictionary, and be smaller than the face it came from — the subsetter's
  // whole job is that one page of lettering doesn't ship the whole font.
  for (const name of ['SDCARA+PinyonScript', 'SDCARB+EBGaramond', 'SDCARC+EBGaramond-Italic', 'SDCARD+PlayfairDisplay']) {
    assert.ok(t.includes(`/${name} `), `the ${name} face dictionary is present`);
  }
  const sizes = [FONTS.script, FONTS.text, FONTS.textItalic, FONTS.display];
  for (let i = 0; i < 4; i++) {
    const dict = objectBody(t, 11 + i);
    assert.ok(dict.includes(`/FontFile2 ${15 + i} 0 R`), `font ${11 + i} points at its program`);
    const file = objectBody(t, 15 + i);
    assert.match(file, /\/Length1 (\d+)/, `font program ${15 + i} declares its length`);
    const len = Number(file.match(/\/Length1 (\d+)/)[1]);
    assert.ok(len < sizes[i].byteLength, `subset of face ${i} (${len}) is smaller than the face (${sizes[i].byteLength})`);
    assert.ok(len > 0, 'and nonzero — the subset kept something');
  }
  // The page's resources must actually wire the faces in, or the embedded
  // programs are dead weight a reader never draws with.
  const pageObj = objectBody(t, 3);
  for (const f of ['F6', 'F7', 'F8', 'F9']) assert.ok(pageObj.includes(`/${f} `), `face ${f} is in the page resources`);
});

test('ncryptsec without fonts still prints: the Times trio stands in', () => {
  const Pdf = load();
  const t = Pdf.build({ nsec: NSEC, npub: NPUB, ncryptsec: NC }).text;
  // A failed fetch in the panel (or a test) must degrade, not throw: same
  // one-page either/or design, no embedded graph, the fallback italic in use.
  assert.match(t, /\/Count 1\b/);
  assert.ok(!t.includes('11 0 obj'), 'no embedded font objects without fonts');
  assert.ok(!t.includes('FontFile2'), 'and no font programs');
  assert.ok(objectBody(t, 4).includes('/F5 '), 'the Times-Italic stand-in is used');
  assert.ok(!t.includes(NSEC), 'and the either/or property holds all the same');
});

test('the two variants download under different names', () => {
  const Pdf = load();
  const plain = Pdf.filename(NPUB);
  const enc = Pdf.filename(NPUB, NC);
  // A shared name would let one file pose as the other in a Downloads folder,
  // where they are indistinguishable until opened — and only one of them is
  // the account in the clear.
  assert.notEqual(plain, enc);
  assert.equal(plain, 'sidecar-key-npub1aaaaaaa.pdf');
  assert.equal(enc, 'sidecar-encrypted-key-npub1aaaaaaa.pdf');
});

test('xref offsets point at the actual object headers, in every layout', () => {  // Plain telegram (10 objects), invitation with embedded faces (18), and the
  // Times fallback (10) — the binary font streams must advance the xref cursor
  // by their byte length, which the shim's one-'B'-per-byte view checks.
  for (const opts of [{}, { ncryptsec: NC, fonts: FONTS }, { ncryptsec: NC }]) {
    const Pdf = load();
    const t = Pdf.build({ nsec: NSEC, npub: NPUB, ...opts }).text;
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
