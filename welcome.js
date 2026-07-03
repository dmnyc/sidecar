const APPS = [
  {
    name: 'Iris',
    url: 'https://iris.to',
    domain: 'iris.to',
    cat: 'social',
    icon: 'https://iris.to/img/apple-touch-icon.png',
    flush: true,
    desc: 'A fast, lightweight social client for Nostr — a familiar timeline with search and private messages.',
  },
  {
    name: 'Jumble',
    url: 'https://jumble.social',
    domain: 'jumble.social',
    cat: 'social',
    desc: 'A clean relay-first feed — browse any relay like a channel, great for discovering new voices.',
  },
  {
    name: 'Coracle',
    url: 'https://coracle.social',
    domain: 'coracle.social',
    cat: 'social',
    desc: 'Polished multi-protocol client with groups, DMs, and smart relay routing.',
  },
  {
    name: 'Primal',
    url: 'https://primal.net',
    domain: 'primal.net',
    cat: 'social',
    desc: 'Fast, slick social feed with trending analytics, advanced search, and a built-in wallet.',
  },
  {
    name: 'noStrudel',
    url: 'https://nostrudel.ninja',
    domain: 'nostrudel.ninja',
    cat: 'social',
    desc: 'Power-user toolkit: communities, streams, wikis, badges — nearly every NIP in one place.',
  },
  {
    name: 'Geyser',
    url: 'https://geyser.fund',
    domain: 'geyser.fund',
    cat: 'commerce',
    icon: 'https://geyser.fund/logo-brand.svg',
    flush: true,
    desc: 'Crowdfunding for Bitcoin and Nostr projects — launch a fundraiser and receive Lightning contributions.',
  },
  {
    name: 'YakiHonne',
    url: 'https://yakihonne.com',
    domain: 'yakihonne.com',
    cat: 'reading',
    desc: 'Articles, short notes, and curated content — a versatile client popular in the Global South.',
  },
  {
    name: 'zap.stream',
    url: 'https://zap.stream',
    domain: 'zap.stream',
    cat: 'media',
    desc: 'Live streaming platform with real-time Lightning zaps from your audience.',
  },
  {
    name: 'Shosho',
    url: 'https://shosho.live',
    domain: 'shosho.live',
    cat: 'media',
    desc: 'Stream your camera and chat with friends and followers live on Nostr. Watch streams on the web or mobile app, connect to any streaming server.',
  },
  {
    name: 'Nostr Nests',
    url: 'https://nostrnests.com',
    domain: 'nostrnests.com',
    cat: 'media',
    desc: 'Audio rooms for chatting, debating, jamming, and micro-conferences over Nostr.',
  },
  {
    name: 'zap.cooking',
    url: 'https://zap.cooking',
    domain: 'zap.cooking',
    cat: 'food',
    icon: 'icons/apps/zapcooking.jpg',
    flush: true,
    desc: 'A recipe community built on Nostr — share, discover, and zap great cooking.',
  },
  {
    name: 'Bookstr',
    url: 'https://bookstr.xyz',
    domain: 'bookstr.xyz',
    cat: 'reading',
    desc: 'Track your reading, write reviews, and share your shelves on a decentralized network.',
  },
  {
    name: 'Slidestr',
    url: 'https://slidestr.net',
    domain: 'slidestr.net',
    cat: 'images',
    desc: 'A beautiful image viewer and slideshow browser for Nostr photo content.',
    icon: 'https://slidestr.net/slidestr.svg',
  },
  {
    name: 'Fountain',
    url: 'https://fountain.fm',
    domain: 'fountain.fm',
    cat: 'media',
    desc: 'Podcast player with Bitcoin streaming payments — earn sats while you listen, tip hosts with every second.',
  },
  {
    name: 'Gamestr',
    url: 'https://gamestr.io',
    domain: 'gamestr.io',
    cat: 'gaming',
    desc: 'Decentralized gaming on Nostr — play games, earn sats, and own your scores on a censorship-resistant network.',
  },
  {
    name: 'Words with Zaps',
    url: 'https://www.wordswithzaps.top',
    domain: 'wordswithzaps.top',
    cat: 'gaming',
    desc: 'A two-player word game on Nostr with Lightning micropayments. Challenge friends, build words, and zap your way to victory.',
  },
  {
    name: 'Mutable',
    url: 'https://mutable.top',
    domain: 'mutable.top',
    cat: 'tools',
    icon: 'icons/apps/mutable.svg',
    flush: true,
    desc: 'Manage your mute lists and check your privacy — see who is muting you and how exposed your DM metadata is.',
  },
  {
    name: 'Plebs vs Zombies',
    url: 'https://plebsvszombies.cc',
    domain: 'plebsvszombies.cc',
    cat: 'tools',
    flush: true,
    desc: 'A gamified Nostr follow manager — cull your zombie followers and keep your network alive.',
  },
  {
    name: 'Divine',
    url: 'https://divine.video',
    domain: 'divine.video',
    cat: 'media',
    desc: 'Short-form looping videos on Nostr — discover and share clips with Lightning tipping built in.',
    icon: 'https://divine.video/favicon.png',
  },
  {
    name: 'Zapstore',
    url: 'https://zapstore.dev',
    domain: 'zapstore.dev',
    cat: 'tools',
    icon: 'https://zapstore.dev/images/parallax-apps/zapstore.png',
    desc: 'An open app store where apps are published by developers and curated by communities.',
  },
  {
    name: 'Plebeian Market',
    url: 'https://plebeian.market',
    domain: 'plebeian.market',
    cat: 'commerce',
    desc: 'A peer-to-peer marketplace on Nostr — buy and sell goods and services for Bitcoin, no middleman.',
  },
  {
    name: 'Formstr',
    url: 'https://formstr.app',
    domain: 'formstr.app',
    cat: 'tools',
    desc: 'Create forms and surveys on Nostr — collect responses privately, with no central server.',
  },
  {
    name: 'HiveTalk',
    url: 'https://hivetalk.org',
    domain: 'hivetalk.org',
    cat: 'media',
    desc: 'Free browser-based video meetings and rooms with Nostr sign-in and Lightning tipping.',
  },
  {
    name: 'Nostr Archives',
    url: 'https://nostrarchives.com',
    domain: 'nostrarchives.com',
    cat: 'tools',
    desc: 'Full-text search across Nostr’s history — find profiles and notes going back years.',
  },
];

const CAT_LABELS = {
  social:   'Social',
  media:    'Media',
  reading:  'Reading',
  gaming:   'Gaming',
  food:     'Food',
  images:   'Images',
  commerce: 'Commerce',
  tools:    'Tools',
};

function faviconUrl(domain) {
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
}

function renderCard(app) {
  const a = document.createElement('a');
  a.className = 'card';
  a.href = app.url;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.dataset.cat = app.cat;

  const faviconWrap = document.createElement('div');
  faviconWrap.className = 'favicon-wrap' + (app.flush ? ' flush' : '');

  if (app.logo) {
    faviconWrap.innerHTML = app.logo;
  } else {
    const img = document.createElement('img');
    img.src = app.icon || faviconUrl(app.domain);
    img.alt = app.name;
    img.width = 32;
    img.height = 32;

    const fallback = document.createElement('span');
    fallback.className = 'favicon-fallback';
    fallback.textContent = app.name[0];
    fallback.style.display = 'none';

    img.onerror = () => {
      img.style.display = 'none';
      fallback.style.display = '';
    };

    faviconWrap.appendChild(img);
    faviconWrap.appendChild(fallback);
  }

  const nameEl = document.createElement('div');
  nameEl.className = 'card-name';
  nameEl.textContent = app.name;

  const urlEl = document.createElement('div');
  urlEl.className = 'card-url';
  urlEl.textContent = app.domain;

  const nameGroup = document.createElement('div');
  nameGroup.appendChild(nameEl);
  nameGroup.appendChild(urlEl);

  const top = document.createElement('div');
  top.className = 'card-top';
  top.appendChild(faviconWrap);
  top.appendChild(nameGroup);

  const badge = document.createElement('span');
  badge.className = `cat-badge cat-${app.cat}`;
  badge.textContent = CAT_LABELS[app.cat];

  const desc = document.createElement('p');
  desc.className = 'card-desc';
  desc.textContent = app.desc;

  const cta = document.createElement('div');
  cta.className = 'card-cta';
  cta.textContent = 'Open →';

  a.appendChild(top);
  a.appendChild(badge);
  a.appendChild(desc);
  a.appendChild(cta);

  return a;
}

const grid = document.getElementById('grid');
// Group cards by category in the same order as the filter pills (CAT_LABELS key
// order), then alphabetically by name within each category.
const CAT_ORDER = Object.keys(CAT_LABELS);
const sorted = [...APPS].sort((a, b) =>
  (CAT_ORDER.indexOf(a.cat) - CAT_ORDER.indexOf(b.cat)) || a.name.localeCompare(b.name)
);
sorted.forEach(app => grid.appendChild(renderCard(app)));

// Category filter
document.getElementById('filters').addEventListener('click', e => {
  const btn = e.target.closest('.filter-btn');
  if (!btn) return;
  const cat = btn.dataset.cat;

  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');

  document.querySelectorAll('.card').forEach(card => {
    if (cat === 'all' || card.dataset.cat === cat) {
      card.classList.remove('hidden-cat');
    } else {
      card.classList.add('hidden-cat');
    }
  });
});

// First-run nudge: if no side panel is open yet, float a caption pointing up to
// the toolbar so the user knows to open and pin Sidecar. It shows at most once —
// closing it or reloading the page keeps it gone (a "seen" flag is persisted to
// chrome.storage.local). Also hides itself if the panel connects.
(function toolbarNudge() {
  if (!(typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage && chrome.storage && chrome.storage.local)) return;
  const SEEN_KEY = 'welcomeNudgeSeen';
  let dismissed = false;
  let poll = null;

  function stop() { if (poll) { clearInterval(poll); poll = null; } }
  function hide() {
    const el = document.getElementById('toolbar-callout');
    if (el) el.remove();
  }

  function show() {
    if (dismissed || document.getElementById('toolbar-callout')) return;
    const el = document.createElement('div');
    el.className = 'toolbar-callout';
    el.id = 'toolbar-callout';
    el.innerHTML =
      '<div class="callout-arrow"></div>' +
      '<img class="callout-icon" src="icons/icon128.png" alt="Sidecar">' +
      '<div class="callout-text">' +
        '<strong>Open &amp; pin Sidecar</strong>' +
        '<span>Click the Extensions button (puzzle-piece icon) up here, pin Sidecar, then click it to open the side panel.</span>' +
      '</div>' +
      '<button class="callout-x" aria-label="Dismiss">&times;</button>';
    document.body.appendChild(el);
    el.querySelector('.callout-x').addEventListener('click', () => {
      dismissed = true;
      stop();
      el.remove();
    });
    // Shown once — don't bring it back on reload.
    try { chrome.storage.local.set({ [SEEN_KEY]: true }); } catch (_) {}
  }

  function check() {
    if (dismissed) return;
    try {
      chrome.runtime.sendMessage({ type: 'SIDECAR_PANEL_OPEN' }, (resp) => {
        if (chrome.runtime.lastError) return; // SW not ready — retry on next poll
        if (resp && resp.open) { hide(); stop(); }
        else show();
      });
    } catch (_) {}
  }

  chrome.storage.local.get(SEEN_KEY, (r) => {
    if (!chrome.runtime.lastError && r && r[SEEN_KEY]) return; // already shown before — stay gone
    check();
    poll = setInterval(check, 2500);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
  });
})();
