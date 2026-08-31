'use strict';

// The web-of-trust set behind notification filtering.
//
// Sidecar's existing notification filtering is a DENYLIST in every branch — muted
// pubkeys, threads, hashtags, words, display names — and a denylist cannot win against
// key rotation: fresh keys arrive faster than anyone can mute them, and dictionary text
// defeats word mutes without also eating real conversation. This is the allowlist.
//
// Almost everything below pins the FAIL-OPEN direction. The dangerous failure here is not
// letting a stranger through; it is hiding someone real because a relay was slow, and
// doing it invisibly. The follow-list code already carries that scar.

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const hex = (c) => String(c).repeat(64).slice(0, 64);
const ME = hex('a');

let W;
before(() => {
  const ctx = { self: {}, Set, Promise, String, Array };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'wot.js'), 'utf8'), ctx, { filename: 'wot.js' });
  W = ctx.globalThis.SidecarWot;
  assert.ok(W, 'SidecarWot loaded');
});

test('one vote is not enough, ten is', async () => {
  // THE WHOLE DESIGN. Taking anyone your follows follow is a weak signal — one careless
  // follow launders a stranger in. On a real 1,066-follow list the raw two-hop set runs to
  // about 48.9k people and only ~9.3k clear the bar.
  const follows = Array.from({ length: 12 }, (_, i) => hex('0').slice(0, 62) + String(i).padStart(2, '0'));
  const popular = hex('d');
  const obscure = hex('e');
  const r = await W.build({
    me: ME, follows, chunkSize: 4,
    fetchFollowsOf: async (chunk) => {
      const out = chunk.map(() => popular);          // every seed follows this one
      if (chunk.includes(follows[0])) out.push(obscure); // exactly one follows this one
      return out;
    },
  });
  assert.equal(W.inNetwork(r.set, popular), true, '12 vouches clears a threshold of 10');
  assert.equal(W.inNetwork(r.set, obscure), false, 'one vouch does not');
  assert.equal(r.seen, 2, 'both were seen');
  assert.equal(r.qualified, 1, 'one qualified — reporting both is the point');
});

test('you and your own follows are in unconditionally', async () => {
  // A follow is a louder vote than ten strangers' follows; no threshold should overrule
  // the people you chose yourself.
  const r = await W.build({ me: ME, follows: [hex('b')], fetchFollowsOf: async () => [] });
  assert.equal(W.inNetwork(r.set, ME), true);
  assert.equal(W.inNetwork(r.set, hex('b')), true, 'a direct follow needs no vouching');
});

test('muted people do not get in through the back door', () => {
  const follows = Array.from({ length: 12 }, (_, i) => hex('0').slice(0, 62) + String(i).padStart(2, '0'));
  const creep = hex('c');
  return W.build({
    me: ME, follows, chunkSize: 4,
    muted: new Set([W.short(creep)]),
    fetchFollowsOf: async (chunk) => chunk.map(() => creep),
  }).then((r) => {
    // The denylist and the allowlist compose rather than sitting side by side.
    assert.equal(W.inNetwork(r.set, creep), false, 'muted, however many vouch for them');
    assert.equal(r.qualified, 0);
  });
});

test('EVERY follow is expanded, not the first N', async () => {
  // An earlier version capped seeds at 300 and quietly covered 28% of a real 1,066-follow
  // list while reporting a confident total. The cap that matters is per REQUEST.
  const follows = Array.from({ length: 400 }, (_, i) => hex('0').slice(0, 61) + String(i).padStart(3, '0'));
  let touched = 0;
  const r = await W.build({
    me: ME, follows, chunkSize: 50,
    fetchFollowsOf: async (chunk) => { touched += chunk.length; return []; },
  });
  assert.equal(touched, 400, 'all of them');
  assert.equal(r.expanded, 400);
  assert.equal(r.follows, 400);
});

test('AN EMPTY SET LETS EVERYONE THROUGH', () => {
  // The fail-open contract. No follow list, a failed fetch, a fresh account — none of
  // those are evidence about anybody, and treating them as such hides real replies.
  assert.equal(W.inNetwork(new Set(), hex('9')), true);
  assert.equal(W.inNetwork(null, hex('9')), true);
  assert.equal(W.inNetwork(undefined, hex('9')), true);
});

test('an account with no follows filters nothing', async () => {
  const r = await W.build({ me: ME, follows: [], fetchFollowsOf: async () => [hex('d')] });
  assert.equal(r.set.size, 0, 'the set must be EMPTY, not just small — see inNetwork');
  assert.equal(W.inNetwork(r.set, hex('9')), true, 'a fresh account filters nobody');
});

test('a chunk that fails narrows the set, it does not empty it', async () => {
  // One relay timing out must not turn the panel into a wall of "filtered".
  let call = 0;
  const follows = Array.from({ length: 4 }, (_, i) => hex('0').slice(0, 63) + String(i));
  const r = await W.build({
    me: ME, follows, chunkSize: 1,
    fetchFollowsOf: async () => { call++; if (call === 1) throw new Error('relay timeout'); return []; },
  });
  assert.equal(W.inNetwork(r.set, follows[0]), true, 'hop one never depended on the fetch');
  assert.ok(r.expanded < follows.length, 'and the caller can see it was partial');
});

test('keys are stored truncated, and that only ever fails open', () => {
  // A collision lets a stranger through as in-network, which is the safe direction; the
  // reverse cannot happen, since a real member always matches its own prefix.
  assert.equal(W.KEY_LEN, 16);
  assert.equal(W.short(hex('b')).length, 16);
  assert.equal(W.THRESHOLD, 10, "Wisp's tuned figure, a better start than one invented here");
});

test('junk never narrows the set', async () => {
  const r = await W.build({
    me: 'not-a-key',
    follows: [hex('b'), 'nope', '', null, 123],
    fetchFollowsOf: async () => ['garbage', null],
  });
  assert.equal(W.inNetwork(r.set, hex('b')), true);
  assert.equal(W.inNetwork(r.set, 'not-a-key'), true, 'a malformed pubkey is no reason to bury it');
});

test('partition keeps everything, and judges the right person', () => {
  // A zap receipt is authored by the LNURL service, so filtering on ev.pubkey would judge
  // the wrong party entirely — the caller passes zapSender for exactly this reason.
  const set = new Set([W.short(hex('b'))]);
  const events = [
    { id: '1', pubkey: hex('b') },
    { id: '2', pubkey: hex('9') },
    { id: '3', pubkey: hex('f'), zapper: hex('b') },
  ];
  const { inn, out } = W.partition(set, events, (e) => e.zapper || e.pubkey);
  assert.deepEqual([...inn].map((e) => e.id), ['1', '3']);
  assert.deepEqual([...out].map((e) => e.id), ['2']);
  assert.equal(inn.length + out.length, events.length, 'nothing may be discarded');
});

// ---- how the panel drives it ------------------------------------------------------

const panel = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'sidepanel.html'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');

test('the module loads before the panel that reads it', () => {
  assert.match(html, /<script src="wot\.js"><\/script>/);
  assert.ok(
    html.indexOf('<script src="wot.js">') < html.indexOf('<script src="sidepanel.js">'),
    'wot.js must load first — the panel reads self.SidecarWot'
  );
});

test('NOTHING IS DROPPED, ONLY MOVED', () => {
  // The one property that separates this from every content filter that has ever
  // annoyed anybody. Out-of-network rows go into a collapsed, counted group.
  assert.match(panel, /const offNet = split \? split\.out : \[\];/);
  assert.match(panel, /function showOffNet\(\)/);
  assert.match(panel, /' from outside your network'/);
  // And they are still rendered with the same builder as everything else.
  // Inserted before the explanatory note, which lives at the foot of the group.
  assert.match(panel, /offNet\.forEach\(\(ev\) => inner\.insertBefore\(buildItem\(ev\), note\)\)/);
  // Never filtered out of the list up front.
  assert.doesNotMatch(panel, /\.filter\(\(e\) => inNetwork/);
});

test('it judges the sender, not the event author', () => {
  // A zap receipt is authored by the LNURL service. Partitioning on ev.pubkey would sort
  // by the wrong person entirely, which is the same bug isMutedNotif already carries a
  // comment about.
  assert.match(panel, /partition\(wotSet, shown, zapSender\)/);
});

test('no warm set means no sorting', () => {
  // Building costs a kind:3 per follow, so the bell must never wait on it. No set is the
  // fail-open direction: everything shows as it did before.
  assert.match(panel, /_wotPubkey === a\.pubkey \? _wotSet : null/);
  assert.match(panel, /const split = wotSet \? self\.SidecarWot\.partition/);
  assert.match(panel, /if \(notifWotFilter\) getWotSet\(\)\.catch\(\(\) => \{\}\);/, 'warmed, not awaited');
});

test('a set belongs to one account and expires', () => {
  // It is a social graph. Keeping one per account would put megabytes on disk for
  // accounts you are not looking at, and keeping it forever would be worse.
  assert.match(panel, /const WOT_TTL_MS = 24 \* 60 \* 60 \* 1000;/);
  assert.match(panel, /saved\.pubkey === pubkey/, 'a cached set must match the active account');
  assert.match(panel, /Date\.now\(\) - \(saved\.ts \|\| 0\) < WOT_TTL_MS/);
  assert.match(panel, /function forgetWot\(\)/);
  assert.match(panel, /forgetWot\(\);/, 'dropped when the follow list is');
  // An empty set is the fail-open signal and is not worth persisting.
  assert.match(panel, /if \(res\.set\.size\) \{/);
});

test('the build fails open', () => {
  const fn = panel.slice(panel.indexOf('async function getWotSet()'));
  const body = fn.slice(0, fn.indexOf('\n  }\n'));
  assert.match(body, /catch \(_\) \{[\s\S]*?return \(_wotSet = null\);/, 'any failure means no filter');
});

test('there is a switch, and it is on by default', () => {
  // Default on because it SORTS. If it hid things, the honest default would be off.
  assert.match(panel, /let notifWotFilter = true;/);
  assert.match(panel, /notifWotFilter = !\(settings && settings\.notifWotFilter === false\);/);
  assert.match(html, /id="wotfilter-toggle"/);
  // Its own section: sorting the bell by who you follow is not a matter of how the panel
  // looks, and someone sent here from the bell must arrive somewhere that names what they
  // came for. It first landed under Appearance, next to Reduce motion, which is why the
  // jump was useless even once the link worked.
  assert.match(html, /data-section="notifications"/);
  const notifSec = html.slice(html.indexOf('data-section="notifications"'));
  assert.match(notifSec.slice(0, notifSec.indexOf('</section>')), /id="wotfilter-toggle"/,
    'the toggle must live in the section the link opens');
  assert.match(html, /Nothing is hidden\./, 'the copy must say so');
  assert.match(css, /\.notif-offnet-toggle \{/);
});

test('LIVE ARRIVALS ARE SORTED TOO', () => {
  // The gap: a notification landing while the bell was open was prepended straight to the
  // list, so a stranger went to the top and was only sorted the next time you reopened —
  // which is exactly when someone is most likely to be watching.
  assert.match(panel, /_openNotifBell\.addLive\(ev\);/);
  assert.doesNotMatch(panel, /_openNotifBell\.list\.prepend/, 'never prepended blind');
  const fn = panel.slice(panel.indexOf('function addLive(ev)'));
  const body = fn.slice(0, fn.indexOf('\n      }'));
  assert.match(body, /!self\.SidecarWot\.inNetwork\(wotSet, zapSender\(ev\)\)/, 'same test, same sender');
  assert.match(body, /offNet\.unshift\(ev\)/, 'out-of-network joins the group');
  assert.match(body, /list\.prepend\(buildItem\(ev\)\)/, 'in-network still goes to the top');
  // Collapsed, the count is the only thing that should move.
  // `> 1` because the note is always in there: one child means no rows yet.
  assert.match(body, /if \(inner && inner\.children\.length > 1\) inner\.prepend/);
});

test('the group cannot end up below the end note', () => {
  // A live arrival can create the group after "you're all caught up" is already on screen.
  const fn = panel.slice(panel.indexOf('function showOffNet()'));
  const body = fn.slice(0, fn.indexOf('\n      }'));
  assert.match(body, /if \(endNote\) scroll\.insertBefore\(offNetBox, endNote\);/);
});

test('THE FILTER SAYS WHAT IT IS DOING', () => {
  // A filter that fails open is silent by design, which makes "it isn't working"
  // unanswerable: you cannot tell a set that decided everyone is in-network from one that
  // never built. Four states, and the two fail-open ones say so plainly.
  assert.match(panel, /let _wotState = 'idle';/);
  assert.match(panel, /function renderWotStatus\(\)/);
  assert.match(html, /id="wot-status"/);
  for (const st of ['building', 'empty', 'failed']) {
    assert.ok(new RegExp("\\b" + st + ":").test(panel.match(/const WOT_STATUS = \{[\s\S]*?\n  \};/)[0]),
      'no copy for state: ' + st);
  }
  const map = panel.match(/const WOT_STATUS = \{[\s\S]*?\n  \};/)[0];
  assert.match(map, /Showing everything/, 'the fail-open states must say what the bell is doing');
  // And every transition repaints it, or the row lies.
  assert.ok((panel.match(/renderWotStatus\(\);/g) || []).length >= 5, 'every state change must repaint');
});

test('the group explains itself and offers the way out', () => {
  // The question gets asked HERE, and the switch lived in Settings with nothing pointing
  // at it — so the honest answer to "is there an opt-out" was "yes, and you would never
  // find it". Expanded only: collapsed, the count is doing its job.
  assert.match(panel, /className: 'notif-offnet-note'/);
  assert.match(panel, /Sorted by who you follow, and who they follow\. Nothing is hidden\. /);
  assert.match(panel, /className: 'notif-offnet-settings', textContent: 'Settings'/);
  // Settings is a VIEW, not a tab, and its sections are collapsed by default. The first
  // version called showTab('settings') — which is a local function inside
  // webCommentModal that flips the composer between write and preview, so it threw and
  // the link silently did nothing. Same four steps the auto-lock jump uses.
  const jump = panel.slice(panel.indexOf("toSettings.addEventListener"));
  // Comments stripped: the one in there names showTab precisely to explain why it is
  // wrong, and it tripped the doesNotMatch below on the first run.
  const body = jump.slice(0, jump.indexOf('});')).replace(/\/\/[^\n]*/g, '');
  assert.match(body, /closeModal\(\);/);
  assert.match(body, /hide\(\$\('view-main'\)\);/);
  assert.match(body, /show\(\$\('view-settings'\)\);/);
  assert.match(body, /openSettingsSection\('notifications'\);/, 'or it lands on collapsed headers');
  assert.match(body, /renderSettings\(\);/);
  assert.doesNotMatch(body, /showTab\(/, 'showTab is the composer\'s, not the panel\'s');
  // No jargon in the bell's own strings. Comments are stripped first: the comment there
  // says "web of trust" precisely to explain why the UI does not, and it tripped this
  // check on the first run.
  const bell = panel
    .slice(panel.indexOf('function showOffNet()'), panel.indexOf('function addLive(ev)'))
    .replace(/\/\/[^\n]*/g, '');
  assert.doesNotMatch(bell, /\bWoT\b|web of trust/i, 'no jargon in what the user reads');
});

test('the panel reports both numbers, and composes with mutes', () => {
  // One number hides the work: "9.3k in your network" could be anything, while
  // "9.3k from 48.9k your follows follow" says what the threshold actually did.
  assert.match(panel, /let _wotSeen = 0;/);
  assert.match(panel, /_wotSeen = res\.seen;/);
  assert.match(panel, /, from ' \+ fmtSats\(_wotSeen\) \+ ' your follows follow\.'/);
  // Persisted alongside the keys, or a cached set would claim numbers it does not have.
  assert.match(panel, /seen: res\.seen, qualified: res\.qualified/);
  assert.match(panel, /_wotSeen = saved\.seen \|\| 0;/);
  // And the mute list is handed in, so the denylist and allowlist compose.
  assert.match(panel, /muted: mutedShort,/);
  assert.match(panel, /mute\.pubkeys\.forEach\(\(pk\) => mutedShort\.add\(self\.SidecarWot\.short\(pk\)\)\)/);
});

test('the seed cap is gone', () => {
  // It capped a real 1,066-follow list at 300 and reported a confident total anyway.
  const wot = fs.readFileSync(path.join(ROOT, 'wot.js'), 'utf8');
  assert.doesNotMatch(wot.replace(/\/\/[^\n]*/g, ''), /MAX_SEEDS/, 'no seed cap should remain');
  assert.match(wot, /const CONCURRENCY = \d+;/, 'chunks run in parallel instead');
});

test('ONE VOTE PER PERSON, NOT PER COPY OF THEIR LIST', () => {
  // The bug that doubled the qualified count. A kind:3 is replaceable and a pool query
  // spans relays, so the same person's list comes back once per relay holding it —
  // counting every copy multiplied each vote by however many relays answered. Measured
  // against a real account: ~17.7k qualified where a correct count gives ~9.3k.
  const a = hex('a'), b = hex('b'), x = hex('e');
  const evs = [
    { pubkey: a, created_at: 100, tags: [['p', x]] },
    { pubkey: a, created_at: 90, tags: [['p', x]] },   // same person, older copy
    { pubkey: a, created_at: 100, tags: [['p', x]] },  // same person, same list, other relay
    { pubkey: b, created_at: 50, tags: [['p', x]] },
  ];
  const out = W.followsFromEvents(evs);
  assert.equal(out.filter((k) => k === x).length, 2, 'two people vouched, not four');
});

test('the newest list wins, and duplicates inside one list count once', () => {
  const a = hex('a'), old = hex('c'), fresh = hex('d');
  const out = W.followsFromEvents([
    { pubkey: a, created_at: 10, tags: [['p', old]] },
    { pubkey: a, created_at: 20, tags: [['p', fresh], ['p', fresh]] },
  ]);
  assert.deepEqual([...out], [fresh], 'unfollowed people do not linger, and following twice is one endorsement');
});

test('junk events cannot cast votes', () => {
  const out = W.followsFromEvents([
    null,
    { pubkey: 'nope', tags: [['p', hex('d')]] },
    { pubkey: hex('a'), tags: [['p', 'garbage'], ['e', hex('d')], ['p', hex('d')]] },
  ]);
  assert.deepEqual([...out], [hex('d')]);
});

test('A CACHED SET CANNOT OUTLIVE THE ALGORITHM THAT BUILT IT', () => {
  // After the vote-counting fix the panel kept serving a day-old set built the wrong way
  // and reported byte-identical numbers, which looked exactly like the fix not working.
  // A cache that cannot say which algorithm filled it is a trap.
  assert.match(panel, /const WOT_ALGO = \d+;/);
  assert.match(panel, /saved\.algo === WOT_ALGO/, 'a stale algorithm must miss the cache');
  assert.match(panel, /algo: WOT_ALGO,/, 'and be stamped on write');
});

test('the set can be rebuilt on demand', () => {
  // A day is right for something this expensive and wrong when you have just changed your
  // follows, fixed your relays, or want to know whether the number is real.
  assert.match(panel, /async function rebuildWot\(\)/);
  const fn = panel.slice(panel.indexOf('async function rebuildWot()'));
  const body = fn.slice(0, fn.indexOf('\n  }'));
  assert.match(body, /forgetWot\(\);/, 'the in-memory copy goes too');
  assert.match(body, /chrome\.storage\.local\.remove\(WOT_STORE/, 'and the stored one');
  assert.match(body, /getWotSet\(\)/, 'then build it again');
  assert.match(html, /id="wot-rebuild"/);
});
