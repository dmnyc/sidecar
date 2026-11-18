// Sidecar — global name search, for the @-mention dropdown and the search bar (isolated module).
//
// Your relays only know the names they have seen, so a name search that stops at them misses
// most of Nostr. This asks a NIP-50 search relay for kind 0 profiles that match what was typed.
// The answer is signed profile events, so a reply is checked the way any profile is: the
// signature has to verify, and the key it names is the key it belongs to. Nothing is taken
// on the relay's word.
//
// WHO ANSWERS IS THE USER'S CHOICE. Four sources: only the follows (nothing is sent), the
// account's own search relays (the public part of its kind 10007 list), the default
// relay below, or a relay the user types in. An account that has published search relays
// is already using them, with no question asked: it named them for exactly this. Only the
// default is ours, and it is the only one that is asked about, once.
//
// WHAT IT SENDS. The text typed, to the chosen relays, and nothing about the account. The
// default relay ranks by a web-of-trust viewpoint of its own (the "house" observer below), so
// no pubkey goes with the query. The page owns the ask.
//
// WHEN THE DEFAULT IS DOWN. After a failure the account's own search relays are asked
// instead, and for the next minute the search goes straight to them rather than making every
// keystroke wait out a timeout. A relay the user chose is never swapped for another: if it
// does not answer, the answer is that it did not.
//
// Isolated so it can be run on its own — see test/name-search.test.js.

(function () {
  'use strict';

  // The relay that answers, and the viewpoint it ranks through when the query names none.
  // A relay that ranks by trust refuses a search that does not say whose trust, and any
  // pubkey will do: scores are public. This one is the relay's own, so nothing about the
  // person typing is sent.
  const SEARCH_RELAY = 'wss://search.brainstorm.world';
  const HOUSE_OBSERVER = 'be7bf5de068c1d842ed34a7c270507ec940f5ea51671cfd062a95e9d09420d0a';
  const HOST = 'search.brainstorm.world';
  const NAME = 'Brainstorm'; // what the default is called to a person

  // The setting: where names beyond the follows are looked up. 'follows' | 'account' |
  // 'default' | 'custom', or undefined while nothing has been chosen. It is its own key and
  // not the one the previous index used: that answer was about a different service. A "no"
  // is carried over, though: someone who said no to a name index has not asked to be asked
  // again. (A true or false written by an earlier build of this setting reads as the default
  // and as follows-only.) A custom relay is kept beside it under CUSTOM_KEY.
  const KEY = 'nameSearch';
  const CUSTOM_KEY = 'nameSearchRelay';
  const LEGACY_KEY = 'nostrArchives';
  const SOURCES = ['follows', 'account', 'default', 'custom'];
  function choice(settings) {
    const s = settings || {};
    if (SOURCES.includes(s[KEY])) return s[KEY];
    if (s[KEY] === true) return 'default';
    if (s[KEY] === false) return 'follows';
    return s[LEGACY_KEY] === false ? 'follows' : undefined;
  }

  const HEX64 = /^[0-9a-f]{64}$/i;
  const MAX_QUERY = 64;
  const LIMIT = 8;
  const ASK_MS = 4000;
  const DOWN_MS = 60 * 1000;
  const LIST_TTL_MS = 10 * 60 * 1000;
  const RETRY_MS = 30 * 1000;
  const LIST_ASK_MS = 1500; // a healthy relay answers well inside this; a dead one must not hold the dropdown

  // What was typed, made safe to put in a NIP-50 search string. The relay reads `key:value`
  // words and a leading minus as instructions (a different viewpoint, no spam floor, an
  // exclusion), and none of that is the person's to give from the @-box: those words are
  // dropped, and what is left is the name being looked for.
  function cleanQuery(text) {
    const words = String(text == null ? '' : text)
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .split(/\s+/)
      .filter((w) => w && !/^[a-z]+:\S/i.test(w) && !w.startsWith('-') && !/^["'*]+$/.test(w));
    return words.join(' ').slice(0, MAX_QUERY).trim();
  }

  const wsUrl = (u) => typeof u === 'string' && /^wss:\/\/[^\s/@]+(\/[^\s]*)?$/i.test(u);
  const sameRelay = (a, b) => String(a).replace(/\/+$/, '').toLowerCase() === String(b).replace(/\/+$/, '').toLowerCase();
  // A relay address someone typed: wss only, no credentials, no spaces, a sane length. Anything
  // else is not used, rather than repaired into something they did not write.
  function cleanRelay(v) {
    const u = typeof v === 'string' ? v.trim() : '';
    return u.length <= 200 && wsUrl(u) ? u : null;
  }
  function hostOf(u) { try { return new URL(u).host; } catch (_) { return String(u); } }

  // One question to some relays, with a clock. { events, answered }: answered means at least
  // one relay said it was done (EOSE), so an empty list is a real "no match" and not a
  // relay that never spoke. A relay that closes the subscription with a reason (a login it
  // wants, a limit) has not answered.
  function ask(pool, relays, filter, ms) {
    return new Promise((resolve) => {
      const events = [];
      let answered = false;
      let done = false;
      let sub = null;
      const timer = setTimeout(() => finish(), ms || ASK_MS);
      function finish() {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try { if (sub) sub.close(); } catch (_) { /* already gone */ }
        resolve({ events, answered });
      }
      try {
        sub = pool.subscribeMany(relays, filter, {
          maxWait: ms || ASK_MS,
          onevent: (ev) => { if (ev) events.push(ev); },
          oneose: () => { answered = true; finish(); },
          onclose: () => finish(),
        });
      } catch (_) { finish(); }
    });
  }

  const clamp = (s, n) => (s.length > n ? s.slice(0, n) : s);
  const plainName = (v) => (typeof v === 'string' ? clamp(v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim(), 80) : '');
  const imageUrl = (v) => (typeof v === 'string' && v.length <= 2048 && /^https?:\/\/[^\s]+$/i.test(v) ? v : null);

  // Search answers as [{ pubkey, name, picture }], in the order the relay ranked them. Only
  // a kind 0 that verifies and names a real key counts, one profile per key (the newest),
  // and at most LIMIT: a relay is not obliged to honor the limit it was sent. `name` is null
  // when the profile has none, and the page shows a short npub in its place.
  function profiles(events, verify) {
    const newest = new Map();
    const order = [];
    for (const ev of events || []) {
      if (!ev || ev.kind !== 0 || typeof ev.pubkey !== 'string' || !HEX64.test(ev.pubkey)) continue;
      try { if (verify && !verify(ev)) continue; } catch (_) { continue; }
      const pk = ev.pubkey.toLowerCase();
      const had = newest.get(pk);
      if (!had) order.push(pk);
      if (!had || (ev.created_at || 0) > (had.created_at || 0)) newest.set(pk, ev);
    }
    return order.slice(0, LIMIT).map((pk) => {
      let c = {};
      try { const v = JSON.parse(newest.get(pk).content); if (v && typeof v === 'object') c = v; } catch (_) { /* a profile with no readable content */ }
      const name = plainName(c.display_name) || plainName(c.displayName) || plainName(c.name) || null;
      return { pubkey: pk, name, picture: imageUrl(c.picture) };
    });
  }

  // The relays an account lists for search (kind 10007, the public relay tags), kept for a
  // while per account. Only asked when the main relay has failed, so a normal search never
  // reads it. Private entries, which are encrypted, are not read: this is a fallback and
  // not a reason to decrypt anything.
  const lists = new Map();
  async function accountSearchRelays(poolOrGetter, pubkey, readRelays) {
    if (!HEX64.test(pubkey || '')) return [];
    const hit = lists.get(pubkey);
    if (hit && Date.now() - hit.at < LIST_TTL_MS) return hit.relays;
    // One read at a time per account: every key typed before the first answer would otherwise
    // start its own.
    if (!reading.has(pubkey)) {
      const p = readAccountList(poolOrGetter, pubkey, readRelays);
      reading.set(pubkey, p);
      p.then(() => reading.delete(pubkey), () => reading.delete(pubkey));
    }
    return reading.get(pubkey);
  }
  const reading = new Map();
  async function readAccountList(poolOrGetter, pubkey, readRelays) {
    let urls = [];
    let answered = false;
    try {
      const from = (await readRelays()) || [];
      if (from.length) {
        const pool = typeof poolOrGetter === 'function' ? poolOrGetter() : poolOrGetter;
        const got = await ask(pool, from, { kinds: [10007], authors: [pubkey], limit: 1 }, LIST_ASK_MS);
        answered = got.answered;
        const events = got.events;
        const own = (events || []).filter((e) => e && e.kind === 10007 && e.pubkey === pubkey)
          .sort((a, b) => (b.created_at - a.created_at) || (a.id < b.id ? 1 : -1))[0];
        urls = own ? (own.tags || []).filter((t) => Array.isArray(t) && t[0] === 'relay' && wsUrl(t[1])).map((t) => t[1]) : [];
      }
    } catch (_) { urls = []; }
    const relays = [...new Set(urls)].slice(0, 3);
    // An answer is kept for a while; silence is kept only briefly, so a relay that was slow to
    // connect is not read as "this account has no search relays" for ten minutes.
    lists.set(pubkey, { at: Date.now() - (answered ? 0 : LIST_TTL_MS - RETRY_MS), relays });
    return relays;
  }

  // What the setting means for this account right now. `account` is the account's own search
  // relays (null when they have not been read, which is only ever the case for a source that
  // does not use them). { mode, source, relays, account, offer }:
  //   mode   'on' a search runs, 'off' the follows only, 'ask' nothing chosen yet
  //   offer  what saying yes would turn on: the account's relays if it has any, else the default
  function plan(settings, account) {
    const c = choice(settings);
    const own = Array.isArray(account) ? account : null;
    const dflt = { source: 'default', hosts: [HOST] };
    const offer = own && own.length ? { source: 'account', hosts: own.map(hostOf) } : dflt;
    const on = (source, relays) => ({ mode: 'on', source, relays, account: own || [], offer: { source, hosts: relays.map(hostOf) } });
    if (c === 'default') return on('default', [SEARCH_RELAY]);
    if (c === 'custom') {
      const r = cleanRelay((settings || {})[CUSTOM_KEY]);
      return r ? on('custom', [r]) : { mode: 'off', source: 'follows', relays: [], account: own || [], offer: dflt };
    }
    if (c === 'account') return own && own.length ? on('account', own) : { mode: 'off', source: 'follows', relays: [], account: [], offer: dflt };
    if (c === undefined) return own && own.length ? on('account', own) : { mode: 'ask', source: undefined, relays: [], account: [], offer: dflt };
    return { mode: 'off', source: 'follows', relays: [], account: own || [], offer };
  }
  // The account's relays are read only for the sources that use them, and then once in a while.
  const usesAccount = (c) => c !== 'default' && c !== 'custom';
  async function resolve(settings, deps) {
    const own = usesAccount(choice(settings)) ? await accountSearchRelays(deps.pool, deps.pubkey, deps.readRelays || (async () => [])) : null;
    return plan(settings, own);
  }

  // One question to the chosen relays. The default relay is asked the way it wants (a viewpoint
  // named, which it requires); any other relay is asked the text alone. { events, answered }.
  async function askChosen(pool, relays, q) {
    const main = relays.filter((r) => sameRelay(r, SEARCH_RELAY));
    const rest = relays.filter((r) => !sameRelay(r, SEARCH_RELAY));
    const asks = [];
    if (main.length) asks.push(ask(pool, main, { kinds: [0], search: q + ' observer:' + HOUSE_OBSERVER, limit: LIMIT }, ASK_MS));
    if (rest.length) asks.push(ask(pool, rest, { kinds: [0], search: q, limit: LIMIT }, ASK_MS));
    const got = await Promise.all(asks);
    return { events: got.flatMap((g) => g.events), answered: got.some((g) => g.answered) };
  }

  // When the default relay last failed. For a minute after, a search goes straight to the
  // account's own search relays; a relay that is down is not asked on every keystroke.
  let downUntil = 0;

  // The whole search. deps:
  //   plan       from plan()/resolve(); without one the default relay is used
  //   pool       a SimplePool (subscribeMany)
  //   verify     the signature check (nostr-tools' verifyEvent)
  //   pubkey     the active account, for its search relay list
  //   readRelays async () => relays to read that list from
  // Resolves { results, failed }: failed when nobody answered, so the page can stop asking
  // for a little while instead of timing out on every key.
  async function search(text, deps) {
    const q = cleanQuery(text);
    if (q.length < 2) return { results: [], failed: false };
    const { pool, verify } = deps;
    const p = deps.plan || plan({ [KEY]: 'default' }, null);
    if (p.mode !== 'on') return { results: [], failed: false };
    if (p.source !== 'default') {
      // The user's own choice: those relays, and no others.
      const r = await askChosen(pool, p.relays.slice(0, 3), q);
      return { results: profiles(r.events, verify), failed: !r.answered };
    }
    if (Date.now() >= downUntil) {
      const r = await ask(pool, [SEARCH_RELAY], { kinds: [0], search: q + ' observer:' + HOUSE_OBSERVER, limit: LIMIT }, ASK_MS);
      if (r.answered) return { results: profiles(r.events, verify), failed: false };
      downUntil = Date.now() + DOWN_MS;
    }
    const own = (await accountSearchRelays(pool, deps.pubkey, deps.readRelays || (async () => []))).filter((u) => !sameRelay(u, SEARCH_RELAY));
    if (!own.length) return { results: [], failed: true };
    const r = await ask(pool, own, { kinds: [0], search: q, limit: LIMIT }, ASK_MS);
    return { results: profiles(r.events, verify), failed: !r.answered };
  }

  // For tests: forget what a run remembered.
  function reset() { downUntil = 0; lists.clear(); reading.clear(); }

  const api = { SEARCH_RELAY, HOUSE_OBSERVER, HOST, NAME, KEY, CUSTOM_KEY, LEGACY_KEY, SOURCES, choice, cleanRelay, hostOf, plan, resolve, cleanQuery, profiles, search, reset };
  if (typeof self !== 'undefined') self.SidecarNameSearch = api;
  if (typeof globalThis !== 'undefined') globalThis.SidecarNameSearch = api;
})();
