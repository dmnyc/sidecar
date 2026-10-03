// Sidecar — destructive-overwrite detection for replaceable events (isolated module).
//
// Kinds 0 (profile), 3 (follows), 10000 (mute list) and 10040 (trust providers) are
// REPLACEABLE: the event
// being signed wholly overwrites the previous one on every relay. A buggy or naive
// client that publishes a short/empty list silently destroys the real one — the most
// common data-loss complaint on Nostr, and the reason Sidecar already ships follow-list
// RECOVERY. This module is the prevention half: it warns before the signature.
//
// HOW THE BASELINE IS OBTAINED — this is the crux of the design.
// The obvious approach (fetch the current version from relays when the prompt opens)
// doesn't work here: the approval prompt must never block on the network (clients time
// out with "Signer did not respond in time"), and the standalone prompt window has no
// relay access at all — it only talks to the background. So instead we keep a LOCAL
// baseline: whatever Sidecar itself last signed for this (account, kind). The check is
// then pure local state — synchronous, offline, and identical on both prompt surfaces.
//
// The panel, which does have relay access, can seed baselines from work it already
// does (see recordFromEvent) so a fresh install isn't blind until its first sign.
//
// LIMITS, stated plainly:
//  - No baseline ⇒ no warning. A first-ever sign of one of these kinds can't be judged.
//  - A baseline can be stale (something else published a newer version elsewhere).
//  - Therefore the ABSENCE of a warning NEVER means "this event is safe". This is a
//    safety net, not a gate. It must never be the only thing standing between a user
//    and data loss, and it must never block a signature on its own.
//
// Isolated (like keystore.js / permissions.js / relax-grants.js) so it can be unit
// tested against a chrome mock — see test/replaceable-baseline.test.js.

(function () {
  'use strict';

  const STORAGE_KEY = 'sidecar_replaceable_baseline';

  // Kinds we track. Anything else is none of this module's business.
  const KIND_FOLLOWS = 3;
  const KIND_MUTE = 10000;
  const KIND_PROFILE = 0;
  // NIP-85 trust provider list. A web-of-trust service switched off from its own site
  // publishes an EMPTY one, which also removes every row naming any other provider —
  // the same wipe shape as a client blanking a mute list. See nip85.js.
  const KIND_TRUST = 10040;
  const TRACKED = new Set([KIND_PROFILE, KIND_FOLLOWS, KIND_MUTE, KIND_TRUST]);

  // A shrink has to be BOTH proportionally large and numerically meaningful to warn.
  // Unfollowing a handful of people is routine; losing most of a list is not. Without
  // the floor, going 3 → 1 follows would cry wolf at the exact moment a new user is
  // still assembling their list.
  const SHRINK_RATIO = 0.5;   // warn when over half the entries disappear
  const SHRINK_FLOOR = 10;    // ...and at least this many are lost

  // A follow list that suddenly GROWS by hundreds is the other shape of the same harm.
  // A client whose own account switcher disagrees with Sidecar's builds the follow list
  // from the account it has selected and asks Sidecar to sign it as another: 30 follows
  // became 1,096 in one tap, which is someone else's list, and publishing it would
  // replace this account's own. A shrink check cannot see it, so this one does. Set
  // high, because following a whole pack at once is real: at least this many added,
  // and at least doubling the list. Follow lists only, and only when the caller asks
  // (see check): Sidecar's own writes, a Lazarus restore above all, legitimately grow a
  // list back by hundreds.
  const GROWTH_FLOOR = 300;
  const GROWTH_RATIO = 2;

  // Profile fields worth protecting. Deliberately NOT "every field that was there
  // before": plenty of clients round-trip only the fields they understand, so warning
  // on any omission would fire on ordinary edits from ordinary clients and train
  // people to click through — which would defeat the entire point.
  const PROFILE_FIELDS = ['about', 'picture', 'nip05', 'lud16', 'lud06', 'display_name'];

  function sget(keys) {
    return new Promise((r) => chrome.storage.local.get(keys, r));
  }
  function sset(obj) {
    return new Promise((r) => chrome.storage.local.set(obj, r));
  }

  async function all() {
    return (await sget(STORAGE_KEY))[STORAGE_KEY] || {};
  }
  function key(pubkey, kind) { return pubkey + '|' + kind; }

  // Unique lowercase p-tag values — the entry count for kinds 3 and 10000. Deduped
  // because a list carrying the same pubkey twice isn't two follows. Returns null when
  // `tags` isn't an array: a malformed event is "unknown", not "an empty list", or a
  // client sending junk would trigger a full-wipe warning on nothing.
  function countPTags(ev) {
    const tags = ev && ev.tags;
    if (!Array.isArray(tags)) return null;
    const out = new Set();
    for (const t of tags) {
      if (Array.isArray(t) && t[0] === 'p' && typeof t[1] === 'string' && t[1].length === 64) {
        out.add(t[1].toLowerCase());
      }
    }
    return out.size;
  }

  // Which PROFILE_FIELDS carry a non-empty value in a kind:0's JSON content.
  // Unparseable content yields null — "unknown", never "empty", so a client using a
  // content format we don't understand can't look like field loss.
  function profileFields(ev) {
    let obj;
    try { obj = JSON.parse((ev && ev.content) || ''); } catch (_) { return null; }
    if (!obj || typeof obj !== 'object') return null;
    const present = [];
    for (const f of PROFILE_FIELDS) {
      const v = obj[f];
      if (typeof v === 'string' ? v.trim() !== '' : v != null) present.push(f);
    }
    return present;
  }

  // Rows in a kind 10040: ["<kind>:<tag>", "<provider key>", "<relay>"], deduped. Same
  // rule as nip85.js, repeated here so this module stays loadable on its own. Rows
  // encrypted into .content can't be counted without decrypting, so the summary only
  // records that they exist (`private`), and the check never calls such a list empty.
  function countTrustRows(ev) {
    const tags = ev && ev.tags;
    if (!Array.isArray(tags)) return null;
    const out = new Set();
    for (const t of tags) {
      if (Array.isArray(t) && typeof t[0] === 'string' && /^\d+:[A-Za-z0-9_]+$/.test(t[0]) &&
          typeof t[1] === 'string' && /^[0-9a-f]{64}$/i.test(t[1])) {
        out.add(t[0] + ' ' + t[1].toLowerCase());
      }
    }
    return out.size;
  }

  // Summarize an event into the shape we persist and compare. Returns null for kinds
  // we don't track, or when a kind:0's content can't be read.
  function summarize(ev) {
    const kind = ev && ev.kind;
    if (!TRACKED.has(kind)) return null;
    if (kind === KIND_PROFILE) {
      const fields = profileFields(ev);
      if (!fields) return null;
      return { kind, fields };
    }
    if (kind === KIND_TRUST) {
      const count = countTrustRows(ev);
      if (count == null) return null;
      const priv = typeof ev.content === 'string' && ev.content.trim() !== '';
      return { kind, count, private: priv };
    }
    const count = countPTags(ev);
    if (count == null) return null; // malformed — can't judge it
    return { kind, count };
  }

  // Record what we just signed (or what the panel observed on relays) as the new
  // baseline for this account+kind. `ts` is passed in rather than read from the clock
  // so the caller controls it and tests stay deterministic.
  async function record(pubkey, ev, ts) {
    const s = summarize(ev);
    if (!s || !pubkey) return false;
    const m = await all();
    m[key(pubkey, s.kind)] = Object.assign({ ts: ts || 0 }, s);
    await sset({ [STORAGE_KEY]: m });
    return true;
  }

  // Only overwrite an existing baseline if `ts` is newer — so the panel seeding from a
  // relay copy can't clobber a fresher record of what Sidecar itself just signed.
  async function recordIfNewer(pubkey, ev, ts) {
    const s = summarize(ev);
    if (!s || !pubkey) return false;
    const m = await all();
    const prev = m[key(pubkey, s.kind)];
    if (prev && (prev.ts || 0) >= (ts || 0)) return false;
    m[key(pubkey, s.kind)] = Object.assign({ ts: ts || 0 }, s);
    await sset({ [STORAGE_KEY]: m });
    return true;
  }

  // The check. Returns null when there's nothing to say (untracked kind, no baseline,
  // or the change looks unremarkable), else a plain-language finding the prompt can
  // render. Never throws: a broken check must not be able to block a signature.
  //
  // { kind, type, from, to, lost, added, name, message }
  //
  // opts.growth also flags a follow list that grows by hundreds at once (see
  // GROWTH_FLOOR). opts.name names the account in the message ("Drops Sidecar's
  // follows…") for someone with more than one: a warning that says "your follows" when
  // the list in question is another account's is how a mix-up goes unread.
  //
  // `message` is English, for the paths that pass it on as an error. The approval
  // screens translate the finding with describe(), from its data, not from this text.
  async function check(pubkey, ev, opts) {
    const finding = await judge(pubkey, ev, opts);
    if (finding) finding.message = describe(finding);
    return finding;
  }

  async function judge(pubkey, ev, opts) {
    try {
      const o = opts || {};
      const name = o.name || '';
      const s = summarize(ev);
      if (!s || !pubkey) return null;
      const prev = (await all())[key(pubkey, s.kind)];
      if (!prev || prev.kind !== s.kind) return null; // nothing to compare against

      if (s.kind === KIND_PROFILE) {
        const before = new Set(prev.fields || []);
        const after = new Set(s.fields || []);
        const lost = [...before].filter((f) => !after.has(f));
        if (!lost.length) return null;
        return { kind: s.kind, type: 'profile-fields', lost, name };
      }

      if (s.kind === KIND_TRUST) {
        // Only the empty list is judged. A 10040 holds a handful of rows, so the shrink
        // floor below would never fire on one, and replacing one provider with another is
        // an ordinary edit. Encrypted rows count as something still there.
        if (s.count > 0 || s.private) return null;
        if (!(prev.count > 0) && !prev.private) return null;
        return { kind: s.kind, type: 'emptied', from: prev.count || 0, to: 0, lost: prev.count || 0, name };
      }

      const from = prev.count || 0;
      const to = s.count || 0;
      if (to >= from) {
        const added = to - from;
        if (o.growth && s.kind === KIND_FOLLOWS && added >= GROWTH_FLOOR && to >= from * GROWTH_RATIO) {
          return { kind: s.kind, type: 'growth', from, to, added, name };
        }
        return null; // growing or unchanged
      }
      const lost = from - to;

      // Emptying a list that had anything in it is always worth flagging, however
      // small — that's the total-wipe case people actually get burned by.
      if (to === 0 && from > 0) {
        return { kind: s.kind, type: 'emptied', from, to, lost, name };
      }
      if (lost >= SHRINK_FLOOR && to <= from * SHRINK_RATIO) {
        return { kind: s.kind, type: 'shrink', from, to, lost, name };
      }
      return null;
    } catch (_) {
      return null; // fail open — never let this stop a signature
    }
  }

  // A finding as one sentence, in the reader's language when i18n is passed (the panel
  // and the prompt pass I18N) and in English when it is not. One template per sentence,
  // with a named and an unnamed form, because "your" and "Sidecar's" do not swap as a
  // word in every language. Counts, names and field labels go in as parameters, so a
  // translation cannot change the numbers the warning is about.
  const EN = {
    tSec: (key, p) => fillIn(key, p),
    tn: (one, other, n, p) => fillIn(n === 1 ? one : other, Object.assign({ count: String(n) }, p)),
    fmtNum: (n) => String(n),
    lang: 'en',
  };
  function fillIn(s, p) {
    return String(s).replace(/\{\{(\w+)\}\}/g, (m, k) => (p && p[k] != null ? String(p[k]) : m));
  }

  function describe(f, i18n) {
    const { tSec, tn, fmtNum } = i18n || EN;
    const lang = (i18n || EN).lang;
    const name = f.name || '';

    if (f.type === 'profile-fields') {
      const fields = fieldList(f.lost || [], tSec, lang);
      return name
        ? tSec('Clears {{name}}’s {{fields}}.', { name, fields })
        : tSec('Clears your {{fields}}.', { fields });
    }
    const nums = { from: fmtNum(f.from || 0), to: fmtNum(f.to || 0) };
    if (f.type === 'growth') {
      return name
        ? tn('Adds {{count}} follow at once, taking {{name}}’s list from {{from}} to {{to}}. This may be another account’s follow list.',
          'Adds {{count}} follows at once, taking {{name}}’s list from {{from}} to {{to}}. This may be another account’s follow list.',
          f.added, Object.assign({ name }, nums))
        : tn('Adds {{count}} follow at once, taking your list from {{from}} to {{to}}. This may be another account’s follow list.',
          'Adds {{count}} follows at once, taking your list from {{from}} to {{to}}. This may be another account’s follow list.',
          f.added, nums);
    }
    const follows = f.kind === KIND_FOLLOWS;
    if (f.kind === KIND_TRUST) {
      // Without a count when the old list's rows were all encrypted: Sidecar never saw them.
      if (!f.from) {
        return name
          ? tSec('Clears {{name}}’s trust provider list, for every web-of-trust service it names.', { name })
          : tSec('Clears your trust provider list, for every web-of-trust service it names.');
      }
      return name
        ? tn('Clears the {{count}} entry in {{name}}’s trust provider list, for every web-of-trust service it names.',
          'Clears all {{count}} entries in {{name}}’s trust provider list, for every web-of-trust service it names.',
          f.from, { name })
        : tn('Clears the {{count}} entry in your trust provider list, for every web-of-trust service it names.',
          'Clears all {{count}} entries in your trust provider list, for every web-of-trust service it names.',
          f.from);
    }
    if (f.type === 'emptied') {
      if (follows) {
        return name
          ? tn('Removes the {{count}} account {{name}} follows.', 'Removes all {{count}} accounts {{name}} follows.', f.from, { name })
          : tn('Removes the {{count}} account you follow.', 'Removes all {{count}} accounts you follow.', f.from);
      }
      return name
        ? tn('Clears {{name}}’s mute list of {{count}} account.', 'Clears {{name}}’s mute list of {{count}} accounts.', f.from, { name })
        : tn('Clears your mute list of {{count}} account.', 'Clears your mute list of {{count}} accounts.', f.from);
    }
    if (f.type === 'shrink') {
      if (follows) {
        return name
          ? tSec('Drops {{name}}’s follows from {{from}} to {{to}}.', Object.assign({ name }, nums))
          : tSec('Drops your follows from {{from}} to {{to}}.', nums);
      }
      return name
        ? tSec('Drops {{name}}’s mute list from {{from}} to {{to}}.', Object.assign({ name }, nums))
        : tSec('Drops your mute list from {{from}} to {{to}}.', nums);
    }
    return '';
  }

  // Field labels translated one by one and joined the language's own way ("bio and
  // Lightning address", "bio, display name, and Lightning address").
  function fieldList(fields, tSec, lang) {
    const LABELS = {
      about: () => tSec('bio'), picture: () => tSec('profile picture'), nip05: () => tSec('verified name'),
      lud16: () => tSec('Lightning address'), lud06: () => tSec('Lightning address'),
      display_name: () => tSec('display name'),
    };
    const names = [...new Set(fields.map((f) => (LABELS[f] ? LABELS[f]() : f)))];
    try {
      return new Intl.ListFormat(lang, { type: 'conjunction' }).format(names);
    } catch (_) {
      return names.join(', ');
    }
  }

  async function forget(pubkey) {
    const m = await all();
    let changed = false;
    for (const k of Object.keys(m)) {
      if (k.startsWith(pubkey + '|')) { delete m[k]; changed = true; }
    }
    if (changed) await sset({ [STORAGE_KEY]: m });
  }

  const api = {
    STORAGE_KEY, TRACKED, PROFILE_FIELDS, SHRINK_RATIO, SHRINK_FLOOR, GROWTH_FLOOR, GROWTH_RATIO,
    KIND_PROFILE, KIND_FOLLOWS, KIND_MUTE, KIND_TRUST,
    summarize, record, recordIfNewer, check, describe, forget,
    isTracked: (k) => TRACKED.has(k),
  };
  if (typeof self !== 'undefined') self.SidecarBaseline = api;
  if (typeof globalThis !== 'undefined') globalThis.SidecarBaseline = api;
})();
