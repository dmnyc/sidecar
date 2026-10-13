'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { englishI18n } = require('./helpers/i18n');
const source = fs.readFileSync(require.resolve('../relay-rider'), 'utf8');
async function fixture(lang) {
  const I18N = englishI18n(); await I18N.ready; I18N.setLocale(lang, []);
  const drawn = [], pixels = [];
  const ctx = { save() {}, restore() {}, measureText: s => ({ width: [...s].length * 5 }),
    fillText: (text, x, y) => drawn.push({text,x,y,direction:ctx.direction}),
    fillRect: (...args) => pixels.push(args) };
  const scope = { I18N, ctx, Intl, W: 160 };
  vm.createContext(scope);
  vm.runInContext(source.slice(source.indexOf('  const F = {'), source.indexOf('  // ---- title face')), scope);
  vm.runInContext(source.slice(source.indexOf('  function captionLines('), source.indexOf('  function localizedOverlay(')), scope);
  return { scope, drawn, pixels };
}

test('translated canvas text preserves the whole shaped string and measures it with the rendering font', async () => {
  const f = await fixture('ar');
  const text = 'توصيل ٢١';
  f.scope.text(text, 4, 8, '#fff');
  assert.deepEqual(f.drawn, [{text,x:4,y:8,direction:'rtl'}]);
  assert.equal(f.pixels.length,0);
  assert.equal(f.scope.textW(text), [...text].length*5);
});

test('English bitmap glyphs remain pixel-rendered; unsupported characters use Unicode', async () => {
  const f = await fixture('en');
  f.scope.text('FUEL',0,0,'#fff');
  assert.ok(f.pixels.length>0); assert.equal(f.drawn.length,0);
  f.scope.text('燃料',0,0,'#fff');
  assert.equal(f.drawn[0].text,'燃料');
});

test('translated captions wrap long words and unspaced text without dropping glyphs', async () => {
  const f = await fixture('ja');
  for (const value of ['燃料がなくなりました配達を完了してください', 'ÜberraschendlangesWort', 'Press the space bar to continue']) {
    const lines = f.scope.captionLines(value, 40);
    assert.ok(lines.length>1);
    assert.equal(lines.join('').replace(/\s/g,''), value.replace(/\s/g,''));
    assert.ok(lines.every(line => f.scope.textW(line)<=40));
  }
});

test('overflowing captions stay available in a scrolling panel and return to canvas when space permits', async () => {
  const f = await fixture('de');
  const captionPanel = { hidden: true, style: {}, scrollTop: 0,
    replaceChildren(...rows) { this.rows = rows; } };
  Object.assign(f.scope, { captionPanel, H: 190, HUD_H: 20, scale: 2,
    document: { createElement: () => ({ textContent: '' }) },
    blockTop: () => 30, panel() {}, titleDiagram() {}, C: {cream:'#fff'} });
  vm.runInContext("let captionSignature = '';\n" + source.slice(source.indexOf('  function localizedOverlay('), source.indexOf('  function overlayTitle(')), f.scope);
  const rows = Array.from({length:20},(_,i)=>'Translated instruction '+i);
  f.scope.localizedOverlay(rows, true);
  assert.equal(captionPanel.hidden,false);
  assert.deepEqual(captionPanel.rows.map(row=>row.textContent),rows);
  assert.equal(captionPanel.style.top,'44px');
  captionPanel.scrollTop=75;
  f.scope.localizedOverlay(rows,true);
  assert.equal(captionPanel.scrollTop,75,'animation frames must not reset the reading position');
  f.scope.H=1000;
  f.scope.localizedOverlay(rows,true);
  assert.equal(captionPanel.hidden,true,'roomy layouts use the canvas again');
});
