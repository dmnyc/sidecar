'use strict';
// The people in a store screenshot, and the pretend wallet's history.
//
// Gatsby and Amelia are the demo accounts: their keys come from the demo vault when a run
// is given one, so the panel shows their real public keys. Without a vault they get fixed
// test keys, enough to see a layout but not to publish. The others only ever appear as a
// name and a face beside a transaction.

const GATSBY = {
  about: 'Can’t repeat the past? Why of course you can!',
  lud16: 'gatsby@sidecar.top',
  // The pictures Gatsby's profile really uses. A run serves local copies of them from the
  // fixtures folder, so the profile keeps its real addresses and nothing is fetched.
  picture: 'https://pfp.nostr.build/e0f6469871f7da2c6d6451359883a906a4a4fb93e6ff7261ffcdd99e3e0737d2.jpg',
  banner: 'https://image.nostr.build/b94fe123ca4a9ea276e49fd972adf56eabc96e150db8f8d0db4f07426d7d86ed.jpg',
};

const AVATAR_HOST = 'avatars.example';

// Pictures for people who are not in a vault: their real profile pictures, whose addresses the
// profile keeps. A run serves a local copy of each from the fixtures folder (<id>-avatar.jpg).
const PICTURES = {
  amelia: 'https://pfp.nostr.build/f41d99a323d0939069f6939f72215562a8bb69b8176cff666a20ce45ff8dad90.png',
  holden: 'https://pfp.nostr.build/118f3510b8c711e7259a1be0d6989eac935d1559abec944f6d5eaf91879fd493.jpg',
  kandinsky: 'https://pfp.nostr.build/d5836b9164d94abc30974f404a6bfda9b2b6af4e8d6bde3aa285981069a7af99.jpg',
};

// The public keys these people have, so a vault that gives someone else's key under their name is
// noticed rather than shown. Public keys only.
const EXPECTED_NPUB = {
  gatsby: 'npub1p9wpmrhm6jvsh7tl6xc00ytkxyfxvfwun2ayjed6rx4lpgunu47s76752r',
  kandinsky: 'npub1a8sxjpapeww6sqez8cnxz70jqzmrfmnzgc08kcqejdnr9lnmrxgsaeeuv6',
  holden: 'npub1445a4edcts54zla44w6tvse282gzngttw03zqfvraq0hk8umaraq80yn4h',
};
const hex = (n) => n.toString(16).padStart(2, '0').repeat(32);

// `vaultAccounts`: [{ name, nsec, picture }] from the demo vault, or null.
function personasFor({ NT, vaultAccounts }) {
  const fromVault = (name) => (vaultAccounts || []).find((a) => String(a.name || '').toLowerCase() === name);
  const make = (id, name, fixtureByte, extra = {}) => {
    const v = fromVault(id);
    let secretHex = hex(fixtureByte);
    if (v && v.nsec) {
      const d = v.nsec.startsWith('nsec1') ? NT.nip19.decode(v.nsec).data : v.nsec;
      secretHex = typeof d === 'string' ? d : Array.from(d).map((b) => b.toString(16).padStart(2, '0')).join('');
    }
    const sk = Uint8Array.from(secretHex.match(/../g).map((h) => parseInt(h, 16)));
    const pubkey = NT.getPublicKey(sk);
    const expected = EXPECTED_NPUB[id];
    return {
      id, name, secretHex, sk, pubkey, fromVault: !!v,
      keyMatches: !v || !expected || NT.nip19.npubEncode(pubkey) === expected,
      picture: (v && v.picture) || PICTURES[id] || `https://${AVATAR_HOST}/${id}.svg`,
      ...extra,
    };
  };
  return {
    gatsby: make('gatsby', 'Gatsby', 0x31, GATSBY),
    amelia: make('amelia', 'Amelia', 0x32, { about: 'I flew over your lawn at dusk and the lights were visible from three thousand feet.' }),
    kandinsky: make('kandinsky', 'Kandinsky', 0x33),
    holden: make('holden', 'Holden', 0x34),
  };
}

// Colored initials, for anyone without a picture in the fixtures folder.
function avatarSvg(name, seed) {
  const hues = [265, 28, 160, 330, 200];
  const hue = hues[seed % hues.length];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">`
    + `<rect width="256" height="256" fill="hsl(${hue} 45% 32%)"/>`
    + `<text x="128" y="128" font-family="Helvetica, Arial, sans-serif" font-size="120" font-weight="600" fill="#f4ecff" `
    + `text-anchor="middle" dominant-baseline="central">${name[0].toUpperCase()}</text></svg>`;
}

// The Wallet tab's history, newest first, the way a wallet answers list_transactions.
// A zap received carries the sender's signed zap request as its description (that is how the
// panel learns who it came from); a zap sent carries nothing, so those are named through the
// pay-meta record the panel keeps for what it paid. Amounts are in millisatoshis.
function historyFor({ NT, personas, now }) {
  const { gatsby, amelia, kandinsky, holden } = personas;
  const zapRequest = (from, to, sats, note) => JSON.stringify(NT.finalizeEvent({
    kind: 9734, created_at: now, content: note || '', tags: [['p', to.pubkey], ['amount', String(sats * 1000)], ['relays', 'wss://nos.lol']],
  }, from.sk));
  let n = 0;
  const id = () => (++n).toString(16).padStart(64, '0');
  const rows = [];
  const payMeta = {};
  const add = (type, sats, ago, fields) => {
    const settled = now - ago;
    const hash = id();
    const row = { type, payment_hash: hash, invoice: 'lnbc' + hash.slice(-40), amount: sats * 1000, fees_paid: 0, created_at: settled - 5, settled_at: settled, preimage: id(), ...fields };
    rows.push(row);
    return row;
  };
  const MIN = 60; const HOUR = 3600;
  add('incoming', 210, 6 * MIN, { description: zapRequest(amelia, gatsby, 210) });
  add('incoming', 1000, 41 * MIN, { description: zapRequest(kandinsky, gatsby, 1000, 'Lovely manuscript') });
  const toAmelia = add('outgoing', 210, 2 * HOUR, { description: '' });
  payMeta[toAmelia.invoice] = { zapPubkey: amelia.pubkey };
  add('incoming', 21, 3 * HOUR, { description: '' });
  const toKandinsky = add('outgoing', 5000, 8 * HOUR, { description: '' });
  payMeta[toKandinsky.invoice] = { zapPubkey: kandinsky.pubkey };
  add('incoming', 12206, 19 * HOUR, { description: 'Invoice — manuscript' });
  const toHolden = add('outgoing', 2100, 26 * HOUR, { description: '' });
  payMeta[toHolden.invoice] = { zapPubkey: holden.pubkey };
  return { rows, payMeta };
}

module.exports = { personasFor, historyFor, avatarSvg, AVATAR_HOST, GATSBY, EXPECTED_NPUB };
