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
    desc: 'A polished multi-protocol client — groups, DMs, and smart relay routing built in.',
  },
  {
    name: 'Flotilla',
    url: 'https://flotilla.social',
    domain: 'flotilla.social',
    cat: 'other',
    icon: 'https://flotilla.social/apple-touch-icon.png',
    flush: true,
    desc: 'Community platform — chat, voice, video, and events in spaces you truly own.',
  },
  {
    name: 'Cordn',
    url: 'https://cordn.net',
    domain: 'cordn.net',
    cat: 'other',
    icon: 'https://cordn.net/pwa/icon-192.png',
    flush: true,
    desc: 'Coordinator-assisted encrypted group messaging — sign in and chat with your key.',
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
    desc: 'Crowdfunding for Bitcoin and Nostr projects — fundraisers powered by Lightning contributions.',
  },
  {
    name: 'YakiHonne',
    url: 'https://yakihonne.com',
    domain: 'yakihonne.com',
    cat: 'social',
    desc: 'Articles, short notes, and curated content — a versatile client popular in the Global South.',
  },
  {
    name: 'zap.stream',
    url: 'https://zap.stream',
    domain: 'zap.stream',
    cat: 'media',
    desc: 'Live streaming with real-time Lightning zaps — go live or tip streamers as you watch.',
  },
  {
    name: 'Tunestr',
    url: 'https://tunestr.io',
    domain: 'tunestr.io',
    cat: 'media',
    icon: 'https://tunestr.io/logo.png',
    flush: true,
    desc: 'Live music streaming — independent artists get paid directly by fans, no middlemen.',
  },
  {
    name: 'Shosho',
    url: 'https://shosho.live',
    domain: 'shosho.live',
    cat: 'media',
    desc: 'Go live from your camera and chat with friends — watch on the web or the mobile app.',
  },
  {
    name: 'Nostr Nests',
    url: 'https://nostrnests.com',
    domain: 'nostrnests.com',
    cat: 'media',
    desc: 'Audio rooms for chatting, debating, jamming, and micro-conferences over Nostr.',
  },
  {
    name: 'Zap Cooking',
    url: 'https://zap.cooking',
    domain: 'zap.cooking',
    cat: 'social',
    icon: 'icons/apps/zapcooking.jpg',
    flush: true,
    desc: 'A food culture community and recipe app — share, discover, and zap great #nostrichefs.',
  },
  {
    name: 'Slidestr',
    url: 'https://slidestr.net',
    domain: 'slidestr.net',
    cat: 'other',
    desc: 'A beautiful image viewer for Nostr — browse photo content as an effortless slideshow.',
    icon: 'https://slidestr.net/slidestr.svg',
  },
  {
    name: 'Imwald',
    url: 'https://jumble.imwald.eu',
    domain: 'jumble.imwald.eu',
    cat: 'other',
    icon: 'https://jumble.imwald.eu/apple-touch-icon.png',
    flush: true,
    desc: 'A user-friendly client for relay feed browsing, publications, and relay discovery.',
  },
  {
    name: 'ContextVM',
    url: 'https://contextvm.org',
    domain: 'contextvm.org',
    cat: 'other',
    desc: 'Bridges Nostr and the Model Context Protocol (MCP) — AI tooling over open relays.',
  },
  {
    name: 'Wavlake',
    url: 'https://wavlake.com',
    domain: 'wavlake.com',
    cat: 'media',
    icon: 'https://wavlake.com/apple-touch-icon.png',
    flush: true,
    desc: 'Music streaming where artists get paid directly — play, boost, and zap tracks over Lightning.',
  },
  {
    name: 'WaveFunc Radio',
    url: 'https://wavefunc.live',
    domain: 'wavefunc.live',
    cat: 'media',
    icon: 'https://wavefunc.live/apple-touch-icon.png',
    flush: true,
    desc: 'A decentralized internet radio directory and player — browse stations and tune in.',
  },
  {
    name: 'Fountain',
    url: 'https://fountain.fm',
    domain: 'fountain.fm',
    cat: 'media',
    desc: 'Podcast player with streaming payments — earn sats while you listen and tip your hosts.',
  },
  {
    name: 'Boost Me Bitch',
    url: 'https://www.boostmebitch.com',
    domain: 'boostmebitch.com',
    cat: 'media',
    icon: 'https://www.boostmebitch.com/icons/icon-192.png',
    flush: true,
    desc: 'A podcast boost station — search, listen, and boost Podcasting 2.0 shows over Lightning.',
  },
  {
    name: 'Gamestr',
    url: 'https://gamestr.io',
    domain: 'gamestr.io',
    cat: 'gaming',
    desc: 'Decentralized gaming — play, earn sats, and own your scores on a censorship-resistant network.',
  },
  {
    name: 'Words with Zaps',
    url: 'https://www.wordswithzaps.top',
    domain: 'wordswithzaps.top',
    cat: 'gaming',
    desc: 'A two-player word game with Lightning stakes — challenge friends and zap your way to victory.',
  },
  {
    name: 'Mutable',
    url: 'https://mutable.top',
    domain: 'mutable.top',
    cat: 'tools',
    icon: 'icons/apps/mutable.svg',
    flush: true,
    desc: 'Manage your mute lists and check your privacy — see who mutes you and what your DMs expose.',
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
    logo: '<svg width="19" height="32" viewBox="0 0 19 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M18.8379 13.9711L8.84956 0.356086C8.30464 -0.386684 7.10438 0.128479 7.30103 1.02073L9.04686 8.94232C9.16268 9.46783 8.74887 9.96266 8.19641 9.9593L0.871032 9.91477C0.194934 9.91066 -0.223975 10.6293 0.126748 11.1916L7.69743 23.3297C7.99957 23.8141 7.73264 24.4447 7.16744 24.5816L5.40958 25.0076C4.70199 25.179 4.51727 26.0734 5.10186 26.4974L12.4572 31.8326C12.9554 32.194 13.6711 31.9411 13.8147 31.3529L15.8505 23.0152C16.0137 22.3465 15.3281 21.7801 14.6762 22.0452L13.0661 22.7001C12.5619 22.9052 11.991 22.6092 11.8849 22.0877L10.7521 16.5224C10.6486 16.014 11.038 15.5365 11.5704 15.5188L18.1639 15.2998C18.8529 15.2769 19.2383 14.517 18.8379 13.9711Z" fill="white"></path></svg>',
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
  {
    name: 'Jank',
    url: 'https://jank.army',
    domain: 'jank.army',
    cat: 'social',
    desc: 'A TweetDeck-style multi-column dashboard — follows, search, and notifications in one view.',
    logo: `<svg viewBox="230 166 332 281" aria-hidden="true" style="width:32px;height:27px;color:var(--gold)"><path fill="currentColor" d="M554.5,269.9c-10.61-24.36-56.44-8.2-72.12-0.24c-15.68,7.96-45.35,29.91-54.27,20.02c-8.92-9.89,3.81-21.09,9.65-36.18c5.55-14.35,5.79-36.06,5.79-36.06c0-52.58-47.52-50.55-47.52-50.55s-47.52-2.04-47.52,50.55c0,0,0.24,21.71,5.79,36.06c5.83,15.09,18.57,26.29,9.65,36.18c-8.92,9.89-38.59-12.06-54.27-20.02s-61.51-24.12-72.12,0.24c-10.61,24.36-8.92,62.71,4.82,116.74c0,0,5.07,16.4,7.24,19.3c2.17,2.89,11.1,9.65,8.2-1.93c-2.89-11.58-16.76-101.55,10.01-107.34c0,0,2.53-0.42,4.7,1.09c0,0,7.6,2.41,7.24,15.92c-0.38,14.12-1.63,83.04,15.38,108.9c0,0,5.25,9.05,7.42-1.09c1.66-7.73-9.75-63.72,0.2-89.96c5.31-10.82,16.69-6.17,21-3.89l1.63,0.94c0.05,0.03,0.08,0.05,0.08,0.05l-0.01-0.01l0.02,0.01l-0.01,0c0,0,0.03,0.02,0.05,0.02l2.27,1.3c2.84,1.89,7.26,5.84,7.21,12.12c-1.51,33.64-2.45,95.9,10.98,99.32c0,0,4.7,4.34,3.98-13.39c-0.55-13.43-0.68-59.84,8.56-79.85l0,0.01c0,0,2.86-5.44,9.98-4.98l4.05,0.87l0.02,0.01c0,0,0.02,0,0.05,0.01l0.73,0.16c2.66,0.74,11.18,4.72,11.33,25.16c0.1,13.04,1.81,76.52,11.34,77.04c9.53-0.52,11.24-64,11.34-77.04c0.15-20.45,8.67-24.42,11.33-25.16l0.73-0.16c0.03,0,0.06-0.01,0.06-0.01l0.02-0.01l4.05-0.87c7.12-0.46,9.98,4.98,9.98,4.98l0-0.01c9.24,20.01,9.11,66.42,8.56,79.85c-0.72,17.73,3.98,13.39,3.98,13.39c13.43-3.42,12.49-65.68,10.98-99.32c-0.05-6.29,4.37-10.24,7.21-12.12l2.27-1.3c0.01-0.01,0.05-0.02,0.05-0.02l-0.01,0l0.02-0.01l-0.01,0.01c0,0,0.03-0.02,0.08-0.05l1.63-0.94c4.32-2.28,15.69-6.93,21,3.89c9.94,26.25-1.46,82.23,0.2,89.96c2.17,10.13,7.42,1.09,7.42,1.09c17.01-25.87,15.76-94.78,15.38-108.9c-0.36-13.51,7.24-15.92,7.24-15.92c2.17-1.51,4.7-1.09,4.7-1.09c26.77,5.79,12.9,95.76,10.01,107.34s6.03,4.82,8.2,1.93c2.17-2.89,7.24-19.3,7.24-19.3C563.43,332.61,565.12,294.26,554.5,269.9z"/></svg>`,
  },
  {
    name: 'Nostria',
    url: 'https://nostria.app',
    domain: 'nostria.app',
    cat: 'social',
    desc: 'A focused social client — “social without the noise,” built for real human connections.',
  },
  {
    name: 'NoorNote',
    url: 'https://noornote.app',
    domain: 'noornote.app',
    cat: 'social',
    icon: 'https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://noornote.app/&size=256',
    desc: 'A feature-rich client with guided onboarding and dozens of built-in addons to explore.',
  },
  {
    name: 'MyNostrSpace',
    url: 'https://mynostrspace.com',
    domain: 'mynostrspace.com',
    cat: 'social',
    desc: 'A nostalgic, MySpace-style take on Nostr — a customizable profile page with your own theme.',
  },
  {
    name: 'YakBak',
    url: 'https://yakbak.app',
    domain: 'yakbak.app',
    cat: 'media',
    desc: 'Share short voice notes on Nostr — record, post, and listen to audio from the people you follow.',
  },
  {
    name: 'nostr.build',
    url: 'https://nostr.build',
    domain: 'nostr.build',
    cat: 'media',
    desc: 'Privacy-focused media hosting — upload images and video, with metadata stripped automatically.',
  },
  {
    name: 'Ghostr',
    url: 'https://ghostr.org',
    domain: 'ghostr.org',
    cat: 'tools',
    icon: 'https://ghostr.org/favicon/apple-touch-icon.png',
    desc: 'Dead-simple post delegation — writers draft, publishers sign, with no scary key sharing.',
  },
  {
    name: 'Listr',
    url: 'https://listr.lol',
    domain: 'listr.lol',
    cat: 'tools',
    desc: 'Create, manage, and discover Nostr lists — follow packs, mute lists, and more.',
  },
  {
    name: 'Stacker News',
    url: 'https://stacker.news',
    domain: 'stacker.news',
    cat: 'social',
    desc: 'A Hacker News-style forum where good posts earn Bitcoin — share links, discuss, get zapped.',
  },
  {
    name: 'Shopstr',
    url: 'https://shopstr.market',
    domain: 'shopstr.market',
    cat: 'commerce',
    desc: 'A permissionless marketplace — buy and sell for Bitcoin over Lightning or Cashu, peer to peer.',
  },
  {
    name: 'GratefulDay',
    url: 'https://gratefulday.space',
    domain: 'gratefulday.space',
    cat: 'other',
    desc: 'A daily gratitude journal — note what you’re thankful for and build a calendar of good days.',
  },
  {
    name: 'Local Bitcoiners',
    url: 'https://localbitcoiners.com',
    domain: 'localbitcoiners.com',
    cat: 'media',
    desc: 'A podcast about Bitcoin meetup culture — sign in with Nostr and boost episodes with sats.',
  },
  {
    name: 'Club Orange',
    url: 'https://signup.cluborange.org/co/thedaniel',
    domain: 'cluborange.org',
    cat: 'other',
    desc: 'A location-based social network for Bitcoiners — a member club with Nostr sign-in.',
  },
];

const CAT_LABELS = {
  social:   'Social',
  media:    'Media',
  gaming:   'Gaming',
  commerce: 'Commerce',
  tools:    'Tools',
  other:    'Other Stuff',
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
