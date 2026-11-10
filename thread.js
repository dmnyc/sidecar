'use strict';

// ---- the comment thread ----
//
// Most Nostr clients draw a NIP-22 comment over a web address nowhere at all, so a comment
// you wrote on a page, and the replies it has gathered, are invisible everywhere but
// Sidecar. This is where they are read: the page it was written on, the comment in full,
// and its replies as the tree they are, in a tab with room for it.
//
// A thread is found, not remembered. The comment comes off your relays by id; what it
// answers comes off the relays it was written to; and its replies are asked for where
// replies actually arrive, which is the inbox of whoever is being answered, not only the
// relays you happen to have configured. Nothing is stored here.
//
// Like the composer's tab it has its own relay pool, none of the panel's, and it reads the
// account and the theme from the worker. Replying hands the comment to the composer tab,
// the same draft slot the panel's Reply uses; reacting signs through the worker and
// publishes from this page.
(function () {
  const SC = window.SidecarCore;
  const { h, icon, logoSrcFor, avatarPhSrc } = SC;
  const TC = window.SidecarThreadCore;
  const I18N = window.SidecarI18n;
  const { t, tn } = I18N;
  const NT = window.NostrTools;
  const $ = (id) => document.getElementById(id);

  const BG_TIMEOUT_MS = 15000;
  const REFRESH_AFTER_MS = 45000;
  const MAX_WAVES = 8;          // levels of replies asked for: deeper than this is a different conversation
  const MAX_COMMENTS = 400;     // and past this a page is a wall, not a thread
  const MAX_ANCESTORS = 12;
  const QUICK_REACTIONS = ['❤️', '🔥', '👍', '😂', '🙌', '🤙', '😮', '🫡'];

  // Lifted from the composer's tab unchanged: a timeout, lastError read inside the
  // callback, and a synchronous throw caught for the extension context having gone away.
  function bg(message, timeoutMs) {
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = (fn, arg) => { if (!done) { done = true; clearTimeout(timer); fn(arg); } };
      const timer = setTimeout(
        () => finish(reject, new Error(t('Sidecar’s background worker did not respond.'))),
        timeoutMs || BG_TIMEOUT_MS
      );
      try {
        chrome.runtime.sendMessage(message, (resp) => {
          const err = chrome.runtime.lastError;
          if (err) return finish(reject, new Error(err.message || t('Sidecar’s background worker is unavailable.')));
          finish(resolve, resp);
        });
      } catch (e) {
        finish(reject, e instanceof Error ? e : new Error(String(e)));
      }
    });
  }
  async function call(message) {
    const resp = await bg(message);
    if (!resp || !resp.ok) throw new Error(I18N.controlError(resp) || t('Request failed'));
    return resp.result;
  }

  // The panel's toast classes, so styles.css dresses it without a rule of its own.
  function toast(message, kind) {
    const host = $('toasts');
    const el = h('div', { className: 'toast toast-' + (kind === 'error' ? 'error' : 'success') });
    el.append(icon(kind === 'error' ? 'alert' : 'check'));
    el.append(h('span', { textContent: message }));
    host.append(el);
    requestAnimationFrame(() => el.classList.add('show'));
    const dismiss = () => { el.classList.remove('show'); setTimeout(() => el.remove(), 250); };
    const timer = setTimeout(dismiss, 3600);
    el.addEventListener('click', () => { clearTimeout(timer); dismiss(); });
    return el;
  }

  // ---- state ----
  let state = null;
  let settings = {};
  let client = null;           // the web client "Open in …" goes to, as this account chose it
  let current = null;          // what is on screen: { id, ev, ctx }
  let loadToken = 0;           // a load that is not the latest one draws nothing
  let lastLoadAt = 0;
  let loading = false;

  const shortNpub = (npub) =>
    (typeof npub === 'string' && npub.length > 20 ? npub.slice(0, 10) + '…' + npub.slice(-4) : npub || '');
  const npubOf = (pubkey) => { try { return NT.nip19.npubEncode(pubkey); } catch (_) { return ''; } };

  // ---- theme, as the composer's tab applies it ----
  const THEME_ALIASES = { 'art-deco': 'industria' };
  const VALID_THEMES = ['speakeasy', 'metropolis', 'film-noir', 'brownstone', 'nixie', 'cast-iron', 'wabi-sabi', 'constellation', 'jazz-age', 'departures',
    'industria', 'aegean', 'bauhaus', 'populuxe', 'par-avion', 'werkstatte', 'ukiyo-e', 'mycelium', 'ben-day', 'turnstile']
    .concat(window.SidecarSeasons.KEYS);
  const { COMPOSE_DARK_BAR_THEMES } = window.SidecarCore;
  function applyTheme(s, pubkey) {
    const by = (s && s.themeBy) || null;
    let name = window.SidecarSeasons.resolve(s, pubkey)
      || (by && pubkey && by[pubkey]) || (s && s.theme) || 'speakeasy';
    name = THEME_ALIASES[name] || name;
    if (!VALID_THEMES.includes(name)) name = 'speakeasy';
    document.documentElement.setAttribute('data-theme', name);
    // For the next load's first paint (compose-boot.js), before any message is answered.
    try { localStorage.setItem('sidecar_compose_theme', name); } catch (_) {}
    const logo = $('compose-logo');
    if (logo) logo.src = COMPOSE_DARK_BAR_THEMES.has(name) ? 'icons/sidecar-logo.svg' : logoSrcFor(name);
  }

  // ---- relays ----
  let _pool = null;
  function pool() {
    if (!_pool) {
      const ws = (window.SidecarWsGuard && window.SidecarWsGuard.impl()) || undefined;
      _pool = new NT.SimplePool({ enableReconnect: true, websocketImplementation: ws });
    }
    return _pool;
  }
  const AGGREGATOR = 'wss://purplepag.es';   // the kind 0 / 10002 index, beside the configured relays

  // The relays this account reads from and writes to, as the worker works them out: its own
  // declared list, and the configured set. Asked once a half-minute, not once per level of
  // replies: each is a round trip to the worker, and a load asks a dozen times.
  const memo = { at: 0, mine: null, configured: null };
  const fresh = () => Date.now() - memo.at < 30000;
  async function accountRelays() {
    if (fresh() && memo.mine) return memo.mine;
    const out = { read: [], write: [] };
    try {
      const map = await call({ type: 'SIDECAR_GET_ACCOUNT_RELAYS', pubkey: state && state.activePubkey });
      for (const [u, m] of Object.entries(map || {})) {
        if (!m || m.read !== false) out.read.push(u);
        if (!m || m.write !== false) out.write.push(u);
      }
    } catch (_) { return out; /* not remembered: the next ask tries again */ }
    memo.mine = out;
    memo.at = Date.now();
    return out;
  }
  async function configuredRelays() {
    if (fresh() && memo.configured) return memo.configured;
    let urls = [];
    try { urls = Object.keys((await call({ type: 'SIDECAR_GET_RELAYS' })) || {}); } catch (_) { return urls; }
    memo.configured = urls;
    return urls;
  }
  async function baseRelays() {
    const mine = await accountRelays();
    return TC.relaySet([mine.read, await configuredRelays()]);
  }

  const withTimeout = (p, ms) => Promise.race([p, new Promise((res) => setTimeout(() => res(null), ms))]);

  const relayListCache = new Map();
  // A person's own relay list, from the relays that index them. Empty when nobody has one,
  // which is an answer, and remembered like one.
  async function relayList(pubkey) {
    if (relayListCache.has(pubkey)) return relayListCache.get(pubkey);
    let list = { read: [], write: [] };
    try {
      const relays = TC.relaySet([await baseRelays(), [AGGREGATOR]], 10);
      const ev = await withTimeout(pool().get(relays, { kinds: [10002], authors: [pubkey] }, { maxWait: 4000 }), 6000);
      if (ev && ev.pubkey === pubkey) list = TC.relayListOf(ev);
    } catch (_) { /* a miss is not cached: the next load asks again */ return list; }
    relayListCache.set(pubkey, list);
    return list;
  }

  // One event by id, from the relays it is most likely on: the ones its tag named, the
  // author's own, then yours.
  async function fetchEvent(id, extra) {
    const relays = TC.relaySet([...(extra || []).map((x) => (Array.isArray(x) ? x : [x])), await baseRelays()]);
    if (!relays.length) return null;
    try { return await withTimeout(pool().get(relays, { ids: [id] }, { maxWait: 5000 }), 8000); } catch (_) { return null; }
  }

  // ---- people ----
  const profileCache = new Map();
  function ownProfile(pubkey) {
    const own = ((state && state.accounts) || []).find((a) => a.pubkey === pubkey);
    return own && own.name ? { pubkey, name: own.name, picture: own.picture || null } : null;
  }
  // Names and pictures for a batch of people, one query. A person found is kept; one not
  // found is asked about again next time, since a slow relay is not a nameless author.
  async function loadProfiles(pubkeys) {
    const want = [...new Set(pubkeys)].filter((pk) => TC.HEX.test(pk) && !(profileCache.get(pk) || {}).name);
    for (const pk of want.slice()) { const own = ownProfile(pk); if (own) profileCache.set(pk, own); }
    const ask = want.filter((pk) => !(profileCache.get(pk) || {}).name);
    if (ask.length) {
      try {
        const relays = TC.relaySet([await baseRelays(), [AGGREGATOR]], 10);
        const got = await withTimeout(pool().querySync(relays, { kinds: [0], authors: ask }, { maxWait: 4500 }), 8000) || [];
        const newest = new Map();
        for (const ev of got) if (!newest.has(ev.pubkey) || ev.created_at > newest.get(ev.pubkey).created_at) newest.set(ev.pubkey, ev);
        for (const [pk, ev] of newest) {
          let meta = {};
          try { meta = JSON.parse(ev.content) || {}; } catch (_) {}
          const name = meta.display_name || meta.name || null;
          if (name) profileCache.set(pk, { pubkey: pk, name, picture: meta.picture || null });
        }
      } catch (_) { /* names are a courtesy; the thread reads without them */ }
    }
  }
  const nameOf = (pubkey) => (profileCache.get(pubkey) || {}).name || shortNpub(npubOf(pubkey)) || t('Someone');
  function applyAvatar(box, p) {
    box.innerHTML = '';
    box.classList.remove('avatar-ph');
    const img = document.createElement('img');
    img.alt = '';
    img.referrerPolicy = 'no-referrer';
    if (p && p.picture) {
      img.src = p.picture;
      img.onerror = () => { img.src = avatarPhSrc(); img.onerror = null; box.classList.add('avatar-ph'); };
    } else {
      img.src = avatarPhSrc();
      box.classList.add('avatar-ph');
    }
    box.append(img);
  }
  const avatarEl = (pubkey, size) => {
    const box = h('span', { className: 'avatar thread-av thread-av-' + size });
    applyAvatar(box, profileCache.get(pubkey) || null);
    return box;
  };

  // ---- loading a thread ----
  //
  // Four things, in the order they can be known: the comment; what it answers (walking up
  // through the comments it replies to until something that is not one); its replies, a
  // level at a time because a reply's own replies are asked for by ITS id; and the
  // reactions under all of them. Each level of replies is asked for at the inboxes of the
  // people being answered in it.
  async function fetchThread(id) {
    const ev = await fetchEvent(id);
    if (!ev || ev.kind !== TC.KIND_COMMENT) return { ev: null };
    const authorList = await relayList(ev.pubkey);

    // Up: each parent is on the relay its tag names, the child's author's, or yours.
    const ancestors = [];
    let answered = null;           // the Nostr note the top comment answers, when it is one
    let missing = '';              // a parent that no relay returned
    let cur = ev;
    for (let i = 0; i < MAX_ANCESTORS; i++) {
      const p = TC.parentOf(cur);
      if (!p.id) break;
      const pe = await fetchEvent(p.id, [p.hint, (await relayList(cur.pubkey)).write]);
      if (!pe) { missing = p.id; break; }
      if (pe.kind === TC.KIND_COMMENT) { ancestors.unshift(pe); cur = pe; continue; }
      answered = pe;
      break;
    }

    // Down.
    const found = [];
    const seen = new Set([ev.id]);
    let frontier = [ev];
    for (let wave = 0; wave < MAX_WAVES && frontier.length && found.length < MAX_COMMENTS; wave++) {
      const lists = await Promise.all([...new Set(frontier.map((f) => f.pubkey))].map(relayList));
      const relays = TC.relaySet([lists.flatMap((l) => l.read), await baseRelays(), (await accountRelays()).write], 16);
      let got = [];
      try {
        got = await withTimeout(pool().querySync(relays, { kinds: [TC.KIND_COMMENT], '#e': frontier.map((f) => f.id), limit: 500 }, { maxWait: 5000 }), 9000) || [];
      } catch (_) { /* a level that cannot be read ends the walk; what was found stands */ }
      const ids = new Set(frontier.map((f) => f.id));
      const next = [];
      for (const r of got) {
        if (!r || r.kind !== TC.KIND_COMMENT || seen.has(r.id) || !ids.has(TC.parentOf(r).id)) continue;
        seen.add(r.id);
        found.push(r);
        next.push(r);
      }
      frontier = next;
    }
    const tree = TC.buildTree(ev.id, found);

    // Reactions under every comment on screen, from where those comments' authors read.
    const shown = [ev.id, ...TC.idsOf(tree)];
    let reactions = [];
    try {
      const rl = await Promise.all([...new Set([ev, ...found].map((c) => c.pubkey))].slice(0, 12).map(relayList));
      const relays = TC.relaySet([rl.flatMap((l) => l.read), await baseRelays()], 16);
      reactions = await withTimeout(pool().querySync(relays, { kinds: [7], '#e': shown.slice(0, 300), limit: 1000 }, { maxWait: 4500 }), 8000) || [];
    } catch (_) { /* chips are a nicety */ }
    const tally = TC.tallyReactions(reactions, state.activePubkey);

    // Everyone who will be named, and everyone a comment mentions.
    const people = new Set([ev.pubkey, ...ancestors.map((a) => a.pubkey), ...found.map((f) => f.pubkey)]);
    if (answered) people.add(answered.pubkey);
    for (const c of [ev, ...ancestors, ...found, ...(answered ? [answered] : [])]) for (const pk of mentionedPubkeys(c.content)) people.add(pk);
    await loadProfiles([...people]);
    return { ev, ancestors, answered, missing, tree, tally, authorList, total: tree.total };
  }

  // The people a comment's text names with a nostr: reference.
  function mentionedPubkeys(text) {
    const out = [];
    for (const tok of TC.tokenize(text)) {
      if (tok.type !== 'nostr') continue;
      try {
        const d = NT.nip19.decode(tok.value.slice(6));
        if (d.type === 'npub') out.push(d.data);
        else if (d.type === 'nprofile') out.push(d.data.pubkey);
      } catch (_) {}
    }
    return out;
  }

  // ---- drawing ----
  function relativeTime(ts) {
    const diff = Math.floor(Date.now() / 1000) - ts;
    if (diff < 60) return t('just now');
    if (diff < 3600) return I18N.fmtRelative(-Math.floor(diff / 60), 'minute');
    if (diff < 86400) return I18N.fmtRelative(-Math.floor(diff / 3600), 'hour');
    if (diff < 7 * 86400) return I18N.fmtRelative(-Math.floor(diff / 86400), 'day');
    const d = new Date(ts * 1000);
    return I18N.fmtDate(d, { month: 'short', day: 'numeric', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
  }
  const fullDate = (ts) => I18N.fmtDate(new Date(ts * 1000), { dateStyle: 'medium', timeStyle: 'short' });

  const profileUrl = (pubkey) => { try { return client.profile(npubOf(pubkey)); } catch (_) { return ''; } };
  const eventUrl = (e) => { try { return client.url(NT.nip19.neventEncode({ id: e.id, author: e.pubkey, kind: e.kind, relays: [] })); } catch (_) { return ''; } };
  const link = (href, props, kids) => h('a', { href, target: '_blank', rel: 'noopener noreferrer', ...props }, kids || []);
  const trimUrl = (u) => u.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '');

  // A comment's words, drawn from tokens and never from markup: text as text, an address
  // as a link that opens a new tab with no referrer, a person as their name.
  function textEl(content, className) {
    const el = h('div', { className, dir: 'auto' });
    for (const tok of TC.tokenize(content)) {
      if (tok.type === 'text') { el.append(document.createTextNode(tok.value)); continue; }
      if (tok.type === 'url') { el.append(link(tok.value, { className: 'thread-link', textContent: trimUrl(tok.value) })); continue; }
      let shown = tok.value.slice(0, 18) + '…';
      let href = '';
      try {
        const d = NT.nip19.decode(tok.value.slice(6));
        if (d.type === 'npub' || d.type === 'nprofile') {
          const pk = d.type === 'npub' ? d.data : d.data.pubkey;
          shown = '@' + nameOf(pk);
          href = profileUrl(pk);
        } else {
          href = client.url(tok.value.slice(6));
        }
      } catch (_) { /* a reference that does not decode stays what it was written as */ }
      el.append(href ? link(href, { className: 'thread-link thread-mention', textContent: shown }) : document.createTextNode(tok.value));
    }
    return el;
  }

  function chipEl(chip, target, ctx) {
    const mark = h('span', { className: 'thread-chip-mark' });
    if (chip.emojiUrl) {
      const img = document.createElement('img');
      img.alt = chip.glyph;
      img.referrerPolicy = 'no-referrer';
      img.onerror = () => { mark.textContent = chip.glyph; };
      img.src = chip.emojiUrl;
      mark.append(img);
    } else if (chip.glyph === TC.reactionDisplay({ content: '+' }).glyph) {
      mark.append(icon('heart'));
    } else {
      mark.textContent = chip.glyph;
    }
    const el = h('button', { className: 'thread-chip' + (chip.mine ? ' mine' : ''), type: 'button' }, [
      mark, h('span', { className: 'thread-chip-n', textContent: I18N.fmtNum(chip.count) }),
    ]);
    el.setAttribute('aria-pressed', String(chip.mine));
    // Tapping a chip adds yours to it. A custom emoji is a picture carried in the event, so
    // it cannot be sent again from the character alone; those chips are for reading.
    if (chip.mine || chip.emojiUrl) el.disabled = true;
    else el.addEventListener('click', () => react(target, chip.glyph === '❤️' ? '+' : chip.glyph, ctx));
    return el;
  }
  function paintChips(box, target, ctx) {
    box.textContent = '';
    for (const chip of ctx.tally.get(target.id) || []) box.append(chipEl(chip, target, ctx));
    box.classList.toggle('hidden', !box.childElementCount);
  }

  // The small icon every row's actions are made of: the notification list's size and style.
  function act(label, glyph, onClick, extra) {
    const b = h('button', { className: 'notif-act ' + (extra || ''), type: 'button', title: label });
    b.setAttribute('aria-label', label);   // h() assigns properties, and aria-label is an attribute
    b.append(glyph);
    b.addEventListener('click', (e) => { e.stopPropagation(); onClick(b); });
    return b;
  }

  // One comment: who, when, the words, what has been said about it, what can be done.
  function commentEl(ev, ctx, o = {}) {
    const focus = !!o.focus;
    const el = h('article', { className: 'thread-c' + (focus ? ' thread-c-focus' : '') });
    const who = h('a', { className: 'thread-c-name', href: profileUrl(ev.pubkey), target: '_blank', rel: 'noopener noreferrer', textContent: nameOf(ev.pubkey) });
    const when = h('a', { className: 'thread-c-time', href: '?id=' + ev.id, textContent: relativeTime(ev.created_at), title: fullDate(ev.created_at) });
    // The permalink opens THIS comment as the thread, in place: the page is a view of one
    // comment and what hangs from it, and any comment in it can be the one.
    when.addEventListener('click', (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
      e.preventDefault();
      if (ev.id !== (current && current.id)) openThread(ev.id, { push: true });
    });
    const head = h('div', { className: 'thread-c-head' }, [avatarEl(ev.pubkey, focus ? 'lg' : 'sm'), h('div', { className: 'thread-c-who' }, [who, when])]);
    const chips = h('div', { className: 'thread-chips hidden' });
    chips._for = ev.id;   // which comment's tally this box draws, for repainting one
    paintChips(chips, ev, ctx);
    const acts = h('div', { className: 'thread-acts' }, [
      act(t('Reply'), icon('message-filled'), () => replyTo(ev), 'needs-composer'),
      act(t('React'), icon('heart'), (btn) => openReactPicker(btn, ev, ctx)),
    ]);
    if (focus) {
      acts.append(
        h('span', { className: 'thread-acts-gap' }),
        act(t('Open in {{client}}', { client: client.label }), icon('arrow-up-right'), () => { const u = eventUrl(ev); if (u) window.open(u, '_blank', 'noopener'); }),
        act(t('Refresh'), icon('reload'), () => refresh(true), 'thread-refresh'),
      );
    }
    el.append(head, textEl(ev.content, 'thread-text'), chips, acts);
    return el;
  }

  function nodeEl(node, ctx) {
    const li = h('li', { className: 'thread-node thread-depth-' + node.shown });
    const c = commentEl(node.ev, ctx);
    li.append(c);
    if (node.children.length) {
      const kids = h('ol', { className: 'thread-children' + (node.depth >= 4 ? ' flat' : '') });
      for (const k of node.children) kids.append(nodeEl(k, ctx));
      // Folds the replies under this one. Collapsed it says how many it is hiding, so a
      // long argument can be passed over without losing its place in the page.
      const fold = h('button', { className: 'thread-fold', type: 'button' });
      const paintFold = (open) => {
        fold.textContent = '';
        fold.append(icon('chevron-down'), h('span', { textContent: open ? t('Hide replies') : tn('Show {{count}} reply', 'Show {{count}} replies', node.descendants) }));
        fold.setAttribute('aria-expanded', String(open));
        li.classList.toggle('collapsed', !open);
      };
      fold.addEventListener('click', () => paintFold(li.classList.contains('collapsed')));
      paintFold(true);
      c.querySelector('.thread-acts').append(h('span', { className: 'thread-acts-gap' }), fold);
      li.append(kids);
    }
    return li;
  }

  // What the thread is about, above everything: the page it was written on, or the note it
  // answers.
  function contextEl(view) {
    const { ev, answered } = view;
    const root = TC.rootOf(ev);
    const box = h('section', { className: 'thread-ctx' });
    if (root && root.kind === 'web') {
      const url = root.url;
      box.append(
        h('span', { className: 'thread-ctx-ico' }, [icon('globe')]),
        h('div', { className: 'thread-ctx-main' }, [
          h('div', { className: 'thread-ctx-host', textContent: TC.hostOf(url) || url }),
          link(url, { className: 'thread-ctx-url', textContent: url }),
        ]),
        link(TC.jumbleThreadUrl(url), { className: 'thread-ctx-more', textContent: t('See all comments on this page') }),
      );
      return box;
    }
    box.classList.add('thread-ctx-note');
    if (answered) {
      box.append(
        avatarEl(answered.pubkey, 'sm'),
        h('div', { className: 'thread-ctx-main' }, [
          h('div', { className: 'thread-ctx-host', textContent: nameOf(answered.pubkey) }),
          textEl(answered.content, 'thread-ctx-snippet'),
        ]),
        link(eventUrl(answered), { className: 'thread-ctx-more', textContent: t('Open in {{client}}', { client: client.label }) }),
      );
      return box;
    }
    box.append(
      h('span', { className: 'thread-ctx-ico' }, [icon('message-circle')]),
      h('div', { className: 'thread-ctx-main' }, [h('div', { className: 'thread-ctx-host', textContent: root && root.kind === 'other' ? root.ref : t('A Nostr note') })]),
    );
    return box;
  }

  function ancestorEl(a, ctx) {
    const row = h('a', { className: 'thread-anc', href: '?id=' + a.id }, [
      avatarEl(a.pubkey, 'xs'),
      h('span', { className: 'thread-anc-who', textContent: nameOf(a.pubkey) }),
      h('span', { className: 'thread-anc-text', dir: 'auto', textContent: a.content.replace(/\s+/g, ' ').slice(0, 160) }),
      h('span', { className: 'thread-anc-time', textContent: relativeTime(a.created_at) }),
    ]);
    row.addEventListener('click', (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
      e.preventDefault();
      openThread(a.id, { push: true });
    });
    return row;
  }

  function render(view) {
    const sheet = $('thread-sheet');
    const ctx = { tally: view.tally, view };
    view.ctx = ctx;
    sheet.textContent = '';
    sheet.append(contextEl(view));
    if (view.ancestors.length || view.missing) {
      const anc = h('nav', { className: 'thread-ancestors' });
      for (const a of view.ancestors) anc.append(ancestorEl(a, ctx));
      if (view.missing) anc.prepend(h('div', { className: 'thread-anc thread-anc-missing', textContent: t('A comment your relays did not return') }));
      sheet.append(anc);
    }
    sheet.append(commentEl(view.ev, ctx, { focus: true }));
    const head = h('h2', { className: 'thread-replies-head' }, [h('span', { textContent: t('Replies') })]);
    if (view.total) head.append(h('span', { className: 'thread-count', textContent: I18N.fmtNum(view.total) }));
    sheet.append(head);
    if (!view.tree.children.length) {
      sheet.append(h('p', { className: 'hint thread-none', textContent: t('No replies yet.') }));
    } else {
      const list = h('ol', { className: 'thread-list' });
      for (const n of view.tree.children) list.append(nodeEl(n, ctx));
      sheet.append(list);
    }
  }

  function renderMessage(text, retry) {
    const sheet = $('thread-sheet');
    sheet.textContent = '';
    sheet.append(h('p', { className: 'hint thread-wait', textContent: text }));
    if (retry) {
      const b = h('button', { className: 'secondary', type: 'button', textContent: t('Try again') });
      b.addEventListener('click', retry);
      sheet.append(b);
    }
  }

  // ---- opening a thread ----
  async function openThread(id, o = {}) {
    if (!TC.HEX.test(id || '')) { renderMessage(t('This address does not name a comment.')); return; }
    const token = ++loadToken;
    loading = true;
    if (o.push) { try { history.pushState({ id }, '', '?id=' + id); } catch (_) {} }
    if (!o.quiet) { renderMessage(t('Reading your relays…')); window.scrollTo(0, 0); }
    let view;
    try { view = await fetchThread(id); } catch (e) { view = null; console.warn('Sidecar thread: could not read the thread', e); }
    if (token !== loadToken) return;     // a newer one has taken the page
    loading = false;
    lastLoadAt = Date.now();
    if (!view || !view.ev) {
      current = null;
      renderMessage(t('Couldn’t find this comment on your relays.'), () => openThread(id));
      return;
    }
    const y = window.scrollY;
    current = { id, ev: view.ev, view };
    render(view);
    if (o.quiet) window.scrollTo(0, y);
    document.title = nameOf(view.ev.pubkey) + ' · ' + t('Comment thread');
  }

  // Quietly, in place: a thread that has had a reply since it was drawn gets it without the
  // page going blank. `manual` is the refresh button, which says when there was nothing new.
  async function refresh(manual) {
    if (!current || loading) return;
    try { const next = await call({ type: 'SIDECAR_GET_STATE' }); if (next && next.activePubkey) state = next; } catch (_) {}
    const before = current.view.total;
    await openThread(current.id, { quiet: true });
    if (manual && current && current.view.total === before) toast(t('Nothing new.'), 'success');
  }

  // ---- reacting ----
  async function react(target, ch, ctx) {
    // Shown at once, taken back if it fails: a chip that waits on a relay feels like a tap
    // that did not land.
    const mine = TC.tallyReactions([{ kind: 7, pubkey: state.activePubkey, content: ch, tags: [['e', target.id]] }], state.activePubkey).get(target.id)[0];
    const chips = (ctx.tally.get(target.id) || []).map((c) => ({ ...c }));
    const before = chips.map((c) => ({ ...c }));
    const hit = chips.find((c) => c.glyph === mine.glyph);
    if (hit) { hit.count++; hit.mine = true; } else chips.push({ ...mine });
    ctx.tally.set(target.id, chips);
    repaintChips(target, ctx);
    try {
      const tags = [['e', target.id], ['p', target.pubkey], ['k', String(target.kind)]];
      if (settings.showClientTag !== false) tags.push(['client', 'Sidecar']);
      const signed = await call({
        type: 'SIDECAR_OWNER_SIGN', event: { kind: 7, created_at: Math.floor(Date.now() / 1000), tags, content: ch }, expectedPubkey: state.activePubkey,
      });
      // Where it is read: the account's own relays, and the inbox of whoever is reacted to.
      const relays = TC.relaySet([(await accountRelays()).write, (await relayList(target.pubkey)).read]);
      if (!relays.length) throw new Error(t('No relays configured (add some in Settings)'));
      const report = await SC.publishToRelays({
        pool: pool(), relays, signed, params: { onauth: (tpl) => call({ type: 'SIDECAR_OWNER_SIGN', event: tpl, expectedPubkey: state.activePubkey }) },
        normalize: (u) => NT.utils.normalizeURL(u),
      });
      if (!report.accepted.length) throw new Error(t('No relay accepted the reaction.'));
      toast(t('Reacted {{reaction}}', { reaction: TC.reactionDisplay(signed).glyph }), 'success');
    } catch (e) {
      ctx.tally.set(target.id, before);
      repaintChips(target, ctx);
      toast(e.message, 'error');
    }
  }
  function repaintChips(target, ctx) {
    for (const box of document.querySelectorAll('.thread-chips')) {
      if (box._for === target.id) paintChips(box, target, ctx);
    }
  }

  // The picker: the quick row, a search, and the whole table under it, in a popover at the
  // button that asked. It closes on the next click anywhere else, or on Escape.
  let openPicker = null;
  function closePicker() { if (openPicker) { openPicker.remove(); openPicker = null; } }
  function openReactPicker(anchor, target, ctx) {
    closePicker();
    const groups = SC.emojiGroups();
    const pop = h('div', { className: 'thread-react', role: 'dialog' });
    pop.setAttribute('aria-label', t('React'));
    const pick = (ch) => { closePicker(); react(target, ch, ctx); };
    if (!groups) {
      pop.append(h('p', { className: 'hint', textContent: t('The emoji table did not load. Reload Sidecar and try again.') }));
    } else {
      const quick = h('div', { className: 'emoji-quick' });
      for (const ch of QUICK_REACTIONS) {
        const b = h('button', { className: 'emoji-cell emoji-quick-cell', type: 'button', textContent: ch, title: ch });
        b.addEventListener('click', () => pick(ch === '❤️' ? '+' : ch));
        quick.append(b);
      }
      const search = h('input', { type: 'search', placeholder: t('Search emoji'), autocomplete: 'off' });
      const grid = h('div', { className: 'emoji-grid' });
      const scroll = h('div', { className: 'emoji-scroll' }, [grid]);
      const paint = (rows) => {
        grid.textContent = '';
        const frag = document.createDocumentFragment();
        for (const [ch, name] of rows) {
          const b = h('button', { className: 'emoji-cell', type: 'button', textContent: ch, title: name });
          b.setAttribute('aria-label', name);
          b.addEventListener('click', () => pick(ch));
          frag.append(b);
        }
        grid.append(frag);
        if (!rows.length) grid.append(h('p', { className: 'hint emoji-none', textContent: t('No emoji matches that.') }));
      };
      paint(groups[0][1]);
      let timer = null;
      search.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          const q = SC.emojiQuery(search.value);
          if (!q) { paint(groups[0][1]); return; }
          const hits = [];
          for (const [, rows] of groups) {
            for (const row of rows) { if (SC.emojiHit(row[2], q)) hits.push(row); if (hits.length >= SC.EMOJI_SEARCH_MAX) break; }
            if (hits.length >= SC.EMOJI_SEARCH_MAX) break;
          }
          paint(hits);
        }, 120);
      });
      pop.append(quick, search, scroll);
    }
    document.body.append(pop);
    openPicker = pop;
    // Under the button, kept inside the window.
    const r = anchor.getBoundingClientRect();
    const w = pop.offsetWidth || 300;
    const left = Math.max(8, Math.min(window.scrollX + r.left, window.scrollX + document.documentElement.clientWidth - w - 8));
    pop.style.left = left + 'px';
    pop.style.top = (window.scrollY + r.bottom + 6) + 'px';
    const input = pop.querySelector('input[type=search]');
    if (input) input.focus();
  }

  // ---- replying ----
  //
  // A reply is written in the composer's tab: the target goes into the same draft slot the
  // panel's Reply uses, and the composer is opened on it, or pointed at it if it is already
  // open. Mirrors handOffToTab in the panel, which this page cannot call.
  async function replyTo(target) {
    try {
      const dkey = state.activePubkey + '|r:' + target.id;
      const all = (await call({ type: 'SIDECAR_SECRET_GET', store: 'drafts' })) || {};
      if (!all[dkey]) all[dkey] = { text: '', media: [], savedAt: Date.now() };
      const write = (await accountRelays()).write;
      if (write.length) all[dkey].expandRelays = write;
      all[dkey].replyTo = { id: target.id, pubkey: target.pubkey, kind: target.kind, tags: target.tags, content: target.content };
      const replies = Object.keys(all).filter((k) => k.includes('|r:'));
      if (replies.length > 20) {
        replies.sort((a, b) => (all[b].savedAt || 0) - (all[a].savedAt || 0)).slice(20).forEach((k) => delete all[k]);
      }
      await call({ type: 'SIDECAR_SECRET_SET', store: 'drafts', value: all });
      const open = await liveComposeTab();
      if (open) {
        if (open.done || open.replyId !== target.id) chrome.runtime.sendMessage({ type: 'SIDECAR_COMPOSE_OPEN', replyId: target.id }).catch(() => {});
        await chrome.tabs.update(open.tabId, { active: true });
        await chrome.windows.update(open.windowId, { focused: true });
        return;
      }
      chrome.tabs.create({ url: chrome.runtime.getURL('compose.html') + '?reply=' + encodeURIComponent(target.id) });
    } catch (e) {
      toast(e.message || t('Could not open the composer.'), 'error');
    }
  }
  async function liveComposeTab() {
    try {
      if (!chrome.runtime.getContexts) return null;
      const url = chrome.runtime.getURL('compose.html');
      const ctxs = await chrome.runtime.getContexts({ contextTypes: ['TAB'] });
      const found = (ctxs || []).find((c) => c.documentUrl && c.documentUrl.split(/[?#]/)[0] === url);
      if (!found) return null;
      let replyId = null;
      try { replyId = new URL(found.documentUrl).searchParams.get('reply') || null; } catch (_) {}
      return { ...found, replyId, done: /#done$/.test(found.documentUrl) };
    } catch (_) { return null; }
  }

  // ---- boot ----
  async function boot() {
    try { await I18N.ready; } catch (_) {}
    I18N.applyDom();
    state = await call({ type: 'SIDECAR_GET_STATE' });
    if (!state || !state.activePubkey) {
      renderMessage(t('Open Sidecar and unlock it, then open this comment again.'));
      document.documentElement.classList.remove('compose-booting');
      return;
    }
    settings = await call({ type: 'SIDECAR_GET_SETTINGS' }).catch(() => ({})) || {};
    applyTheme(settings, state.activePubkey);
    client = SC.resolveClient(settings, state.activePubkey);

    $('thread-x').addEventListener('click', () => window.close());
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePicker(); });
    document.addEventListener('click', (e) => { if (openPicker && !openPicker.contains(e.target) && !e.target.closest('.notif-act')) closePicker(); });
    // Back and forward walk the comments that were opened in this tab.
    window.addEventListener('popstate', () => openThread(new URLSearchParams(location.search).get('id') || ''));
    // A thread that has had a reply since you last looked gets it when you come back to it.
    const stale = () => { if (document.visibilityState === 'visible' && current && Date.now() - lastLoadAt > REFRESH_AFTER_MS) refresh(false); };
    document.addEventListener('visibilitychange', stale);
    window.addEventListener('focus', stale);
    // The panel pointing an open thread tab at another comment, from one of Sidecar's own
    // pages only: a content script reaches this listener too, but speaks from a web address.
    chrome.runtime.onMessage.addListener((msg, sender) => {
      if (!msg || msg.type !== 'SIDECAR_THREAD_OPEN') return;
      if (!sender || sender.id !== chrome.runtime.id || !String(sender.url || '').startsWith(chrome.runtime.getURL(''))) return;
      if (TC.HEX.test(msg.id || '')) openThread(msg.id, { push: true });
    });

    await openThread(new URLSearchParams(location.search).get('id') || '');
  }

  const shown = () => document.documentElement.classList.remove('compose-booting');
  boot().then(shown, (e) => {
    shown();
    const sheet = $('thread-sheet');
    if (sheet) { sheet.textContent = ''; sheet.append(h('p', { className: 'hint thread-wait', textContent: (e && e.message) || t('Sidecar could not open this comment.') })); }
  });
})();
