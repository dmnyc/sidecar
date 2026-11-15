// hls.js is 1.65 MB, so it loads on the first HLS play and not with the panel. These run the
// real streams.js against a document that records the <script> it injects, and answer that
// script's load or error by hand.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

async function setup({ native = false } = {}) {
  const els = new Map(); const observers = []; const nodes = []; const scripts = []; const hlsInstances = [];
  function el(){const flags=new Set(),attrs=new Map();const node={childNodes:[],hidden:false,textContent:'',value:'',style:{setProperty(){}},classList:{add(...xs){xs.forEach(x=>flags.add(x));},remove(...xs){xs.forEach(x=>flags.delete(x));},contains(x){return flags.has(x);},toggle(x,on){on=on??!flags.has(x);on?flags.add(x):flags.delete(x);return on;}},events:{},addEventListener(n,f){this.events[n]=f;},setAttribute(k,v){attrs.set(k,String(v));},getAttribute(k){return attrs.get(k) ?? null;},removeAttribute(n){attrs.delete(n);delete this[n];},getBoundingClientRect(){return {height:42,width:this.width ?? 360};},replaceChildren(...children){this.childNodes=children;},after(){},remove(){},get lastElementChild(){return this.childNodes[this.childNodes.length-1];},append(...children){this.childNodes.push(...children);},get children(){return this.childNodes;},insertBefore(child,before){const at=this.childNodes.indexOf(before);this.childNodes.splice(at<0?this.childNodes.length:at,0,child);},querySelector(){return el();},play(){this.plays++;return Promise.resolve();},pause(){this.pauses++;},load(){this.loads++;},canPlayType(){return 'probably';},plays:0,pauses:0,loads:0};nodes.push(node);return node;}
  const get = (id) => { if (!els.has(id)) els.set(id, el()); return els.get(id); };
  get('view-approval').classList.add('hidden'); get('view-lock').classList.add('hidden');
  get('stream-video').canPlayType = () => (native ? 'maybe' : '');
  const context = {
    SidecarI18n: require('./helpers/i18n').englishI18n(), SidecarStreams: require('../stream-core'),
    document: { getElementById: get, documentElement: el(), createElement: el, createElementNS: el, head: { appendChild(tag) { scripts.push(tag); } } },
    ResizeObserver: class { observe() {} }, MutationObserver: class { constructor(f) { observers.push(f); } observe() {} },
    window: { addEventListener() {} }, setInterval, clearInterval, setTimeout, clearTimeout, URL,
  };
  await vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../streams.js'), 'utf8'), context);
  const hlsClass = class {
    static isSupported() { return true; }
    static get Events() { return { ERROR: 'error', MANIFEST_PARSED: 'parsed' }; }
    constructor() { hlsInstances.push(this); this.sourced = ''; }
    on() {} loadSource(u) { this.sourced = u; } attachMedia() {} destroy() {}
  };
  return {
    scripts, hlsInstances, video: get('stream-video'), get,
    message: () => get('stream-video').parentNode,
    // The injected script finished loading: hls.js defines the global, then onload fires.
    loaded(i = 0) { context.Hls = hlsClass; scripts[i].onload(); },
    failed(i = 0) { scripts[i].onerror(); },
    play(url) {
      get('stream-url').value = url; get('stream-url-save').checked = false; get('stream-url-name').value = '';
      return get('stream-form').events.submit({ preventDefault() {} });
    },
    stop() { get('stream-stop').events.click(); },
    context,
  };
}
const tick = () => new Promise((r) => setImmediate(r));
const HLS_URL = 'https://example.com/live/index.m3u8';

test('hls.js is not loaded with the panel, and a plain video link never loads it', async () => {
  const s = await setup();
  assert.equal(s.scripts.length, 0, 'nothing is injected before a stream is played');
  await s.play('https://example.com/live.mp4'); await tick();
  assert.equal(s.scripts.length, 0, 'an mp4 has no use for hls.js');
  assert.equal(s.video.src, 'https://example.com/live.mp4');
});

test('the first HLS play injects hls.js once, then plays through it', async () => {
  const s = await setup();
  await s.play(HLS_URL); await tick();
  assert.equal(s.scripts.length, 1);
  assert.equal(s.scripts[0].src, 'hls.js');
  assert.equal(s.hlsInstances.length, 0, 'no player until the script has loaded');
  s.loaded(); await tick();
  assert.equal(s.hlsInstances.length, 1);
  assert.equal(s.hlsInstances[0].sourced, HLS_URL);
  await s.play('https://example.com/other/index.m3u8'); await tick();
  assert.equal(s.scripts.length, 1, 'the second play reuses the loaded library');
  assert.equal(s.hlsInstances.length, 2);
});

test('a failed load says so, plays nothing, and the next play tries again', async () => {
  const s = await setup();
  await s.play(HLS_URL); await tick();
  s.failed(); await tick();
  assert.equal(s.hlsInstances.length, 0);
  assert.equal(s.video.src, undefined, 'it must not hand an HLS playlist to a browser that cannot play it');
  assert.match(s.get('stream-message').textContent, /Stream unavailable/);
  await s.play(HLS_URL); await tick();
  assert.equal(s.scripts.length, 2, 'a failed load is not remembered');
  s.loaded(1); await tick();
  assert.equal(s.hlsInstances.length, 1);
});

test('a browser that plays HLS itself still plays it when hls.js will not load', async () => {
  const s = await setup({ native: true });
  await s.play(HLS_URL); await tick();
  s.failed(); await tick();
  assert.equal(s.video.src, HLS_URL);
});

test('stopping while the library loads leaves no player behind', async () => {
  const s = await setup();
  await s.play(HLS_URL); await tick();
  s.stop();
  s.loaded(); await tick();
  assert.equal(s.hlsInstances.length, 0, 'a stale play must not start after Stop');
});

test('the panel page no longer carries the hls.js tag, and still ships the file', () => {
  const html = fs.readFileSync(path.join(__dirname, '../sidepanel.html'), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  assert.doesNotMatch(html, /<script[^>]+src="hls\.js"/, 'the panel loads hls.js eagerly again');
  assert.ok(fs.existsSync(path.join(__dirname, '../hls.js')), 'the lazy loader has nothing to fetch');
  assert.match(fs.readFileSync(path.join(__dirname, '../scripts/vendor-hashes.sha256'), 'utf8'), / hls\.js\n/, 'the vendored file is no longer hash-checked');
});
