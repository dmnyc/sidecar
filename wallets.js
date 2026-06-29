// Sidecar — wallet suggestions. Each entry is a wallet that can hand you a
// Nostr Wallet Connect (NWC) string to paste into Sidecar. Rendered in array
// order (curated), not sorted.
const WALLETS = [
  {
    name: 'Alby Hub',
    url: 'https://albyhub.com',
    domain: 'albyhub.com',
    cat: 'selfcustodial',
    desc: 'Your own Lightning node — self-host it or run it on Alby Cloud — then create an NWC connection for Sidecar.',
  },
  {
    name: 'Zeus',
    url: 'https://zeusln.com',
    domain: 'zeusln.com',
    cat: 'selfcustodial',
    desc: 'Self-custodial mobile wallet with an embedded node. Export a Nostr Wallet Connect string and paste it into Sidecar.',
  },
  {
    name: 'YakiHonne',
    url: 'https://yakihonne.com',
    domain: 'yakihonne.com',
    cat: 'custodial',
    desc: 'Custodial wallet built into the YakiHonne app. Spin up a wallet and grab an NWC connection in a couple of taps — the quickest way to get going.',
  },
  {
    name: 'Rizful',
    url: 'https://www.rizful.com',
    domain: 'rizful.com',
    cat: 'custodial',
    desc: 'Custodial hosted Lightning node. Create a Nostr Wallet Connect string from your dashboard and paste it into Sidecar.',
  },
  {
    name: 'Coinos',
    url: 'https://coinos.io',
    domain: 'coinos.io',
    cat: 'custodial',
    logo: '<svg viewBox="0 0 72 72" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style="width:34px;height:34px;color:#f1e8f8"><path fill-rule="evenodd" clip-rule="evenodd" d="M36 4.23529C18.4568 4.23529 4.23529 18.4568 4.23529 36C4.23529 53.5432 18.4568 67.7647 36 67.7647C53.5432 67.7647 67.7647 53.5432 67.7647 36C67.7647 18.4568 53.5432 4.23529 36 4.23529ZM0 36C0 16.1177 16.1177 0 36 0C55.8823 0 72 16.1177 72 36C72 55.8823 55.8823 72 36 72C16.1177 72 0 55.8823 0 36Z" fill="currentColor"></path><path fill-rule="evenodd" clip-rule="evenodd" d="M36 58.5882C48.4751 58.5882 58.5882 48.4751 58.5882 36C58.5882 23.5248 48.4751 13.4117 36 13.4117C23.5249 13.4117 13.4118 23.5248 13.4118 36C13.4118 48.4751 23.5249 58.5882 36 58.5882ZM36 54C45.9411 54 54 45.9411 54 36C54 26.0589 45.9411 18 36 18C26.0589 18 18 26.0589 18 36C18 45.9411 26.0589 54 36 54Z" fill="currentColor"></path><path fill-rule="evenodd" clip-rule="evenodd" d="M36.0001 22.8988C36.0001 22.8988 36 22.8988 36 22.8988C28.7644 22.8988 22.8988 28.7644 22.8988 36C22.8988 43.2356 28.7644 49.1012 36 49.1012C36 49.1012 36.0001 49.1012 36.0001 49.1012V22.8988Z" fill="currentColor"></path></svg>',
    desc: 'Custodial web wallet. Turn on Nostr Wallet Connect in settings and paste the connection string into Sidecar.',
  },
  {
    name: 'Minibits',
    url: 'https://www.minibits.cash',
    domain: 'minibits.cash',
    cat: 'ecash',
    desc: 'Cashu ecash mobile wallet. Create a Nostr Wallet Connect string to connect it to Sidecar.',
  },
];

const CAT_LABELS = {
  custodial: 'Custodial',
  selfcustodial: 'Self-custodial',
  ecash: 'Ecash',
};

function faviconUrl(domain) {
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
}

function renderCard(wallet) {
  const a = document.createElement('a');
  a.className = 'card';
  a.href = wallet.url;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.dataset.cat = wallet.cat;

  const faviconWrap = document.createElement('div');
  faviconWrap.className = 'favicon-wrap';

  if (wallet.logo) {
    faviconWrap.innerHTML = wallet.logo;
  } else {
    const img = document.createElement('img');
    img.src = wallet.icon || faviconUrl(wallet.domain);
    img.alt = wallet.name;
    img.width = 32;
    img.height = 32;

    const fallback = document.createElement('span');
    fallback.className = 'favicon-fallback';
    fallback.textContent = wallet.name[0];
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
  nameEl.textContent = wallet.name;

  const urlEl = document.createElement('div');
  urlEl.className = 'card-url';
  urlEl.textContent = wallet.domain;

  const nameGroup = document.createElement('div');
  nameGroup.appendChild(nameEl);
  nameGroup.appendChild(urlEl);

  const top = document.createElement('div');
  top.className = 'card-top';
  top.appendChild(faviconWrap);
  top.appendChild(nameGroup);

  const badge = document.createElement('span');
  badge.className = `cat-badge cat-${wallet.cat}`;
  badge.textContent = CAT_LABELS[wallet.cat];

  const desc = document.createElement('p');
  desc.className = 'card-desc';
  desc.textContent = wallet.desc;

  const cta = document.createElement('div');
  cta.className = 'card-cta';
  cta.textContent = 'Get this wallet →';

  a.appendChild(top);
  a.appendChild(badge);
  a.appendChild(desc);
  a.appendChild(cta);

  return a;
}

const grid = document.getElementById('grid');
WALLETS.forEach((wallet) => grid.appendChild(renderCard(wallet)));

// Category filter
document.getElementById('filters').addEventListener('click', (e) => {
  const btn = e.target.closest('.filter-btn');
  if (!btn) return;
  const cat = btn.dataset.cat;

  document.querySelectorAll('.filter-btn').forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');

  document.querySelectorAll('.card').forEach((card) => {
    if (cat === 'all' || card.dataset.cat === cat) {
      card.classList.remove('hidden-cat');
    } else {
      card.classList.add('hidden-cat');
    }
  });
});
