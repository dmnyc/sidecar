'use strict';

// ---- nsites: a static site, authored in the composer, served from Blossom ----
//
// A site is a few Markdown pages. Publishing renders each one through a first-party
// template into a static HTML file, hashes every file, uploads the new blobs to
// Blossom servers, and signs a manifest — a replaceable Nostr event whose tags map
// site paths to blob hashes. Gateways such as nsite.lol read that manifest and serve
// the blobs at <pubkeyB36>.nsite.lol. Each save also files a regular snapshot event,
// so a site has versions.
//
// The wire shapes follow NIP-5A as drafted (nips.4rs.nl/nips/5a, read October 2026):
//
//   kind 15128  the root site's manifest. Replaceable, one per pubkey, no d tag.
//   kind 35128  a named site's manifest. Replaceable; d tag is the site name and
//               must match ^[a-z0-9-]{1,13}$ without a trailing dash, because the
//               gateway's DNS label is pubkeyB36 (50 chars) + the name, in 63.
//   kind  5128  a snapshot of one save. Regular event; created_at is the version.
//   kind 10063  the account's Blossom server list (BUD-03), which Sidecar already
//               discovers and writes elsewhere; publishing adds one only if the
//               account has none.
//
// A manifest's content is the empty string. Everything rides in tags:
//
//   ["path", "/index.html", "<sha256>"]   one per file; the hash is the blob's
//   ["x", "<sha256>", "aggregate"]         the aggregate hash over all path tags
//   ["server", "https://…"]                where the blobs live
//   ["title", …] ["description", …]        optional, and the gateway may show them
//
// The aggregate hash commits the whole file list: lines of "<hash> <path>\n" sorted
// ascending lexicographically, concatenated as UTF-8, SHA-256'd. A snapshot copies
// every path tag and that x tag, and adds one a tag naming the site it snapshots.
//
// Nothing here touches the key. Signing goes through the background under a publish
// session the user approves once per publish (see site-publish.js); this file only
// builds templates and byte arrays, and says what it needs signed.

(function () {
  const I18N = window.SidecarI18n;
  const { t, tn } = I18N;

  // Pinned to the NIP-5A draft text. nsite-cli's README once said 34128; the spec
  // itself says 35128 for a named site, and that is what this file builds.
  const MANIFEST_KIND = 15128;
  const NAMED_MANIFEST_KIND = 35128;
  const SNAPSHOT_KIND = 5128;
  const SERVER_LIST_KIND = 10063;
  const AUTH_KIND = 24242;

  // One rendered page is capped at 1 MB, an asset at 8 MB, and a site at 24 pages:
  // beyond these the author is writing an app, and the composer is the wrong tool.
  const PAGE_MAX_BYTES = 1024 * 1024;
  const ASSET_MAX_BYTES = 8 * 1024 * 1024;
  const MAX_PAGES = 24;

  // Servers a publish uploads to and verifies against. NIP-5A gateways read the
  // manifest's server tags; two make the site survive one of them disappearing.
  const SERVERS_PER_PUBLISH = 2;

  // ------------------------------------------------------------------
  // site names
  // ------------------------------------------------------------------

  // The gateway's DNS label is <pubkeyB36><name>, and pubkeyB36 is 50 of the 63
  // characters a DNS label allows, so the name gets at most 13 of [a-z0-9-] and
  // may not end in a dash. This is the spec's rule, not a style choice.
  function isValidSiteName(name) {
    return typeof name === 'string' && /^[a-z0-9-]{1,13}$/.test(name) && !name.endsWith('-');
  }

  // What the author typed, to what the spec would accept: lowercase, dashes for
  // everything else, trimmed of leading and trailing dashes, cut to 13. May still
  // be empty or invalid — the caller checks isValidSiteName after.
  function normalizeSiteName(raw) {
    return String(raw || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/-{2,}/g, '-')
      .replace(/^-+/, '')
      .replace(/-$/, '')
      .slice(0, 13);
  }

  // The a-tag coordinate of a site, NIP-33 shape: kind:pubkey(:d). The root site
  // has no d, and its coordinate is the kind and key alone.
  function siteAddress(pubkey, name) {
    return isValidSiteName(name)
      ? NAMED_MANIFEST_KIND + ':' + pubkey + ':' + name
      : MANIFEST_KIND + ':' + pubkey;
  }

  function manifestKindFor(name) {
    return isValidSiteName(name) ? NAMED_MANIFEST_KIND : MANIFEST_KIND;
  }

  // ------------------------------------------------------------------
  // hashes and manifests
  // ------------------------------------------------------------------

  async function sha256Hex(buffer) {
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  // The aggregate over a whole file list, exactly as the spec computes it: one
  // "<hash> <path>\n" line per file, the LINES sorted as strings, UTF-8, SHA-256.
  // The x tag lets a gateway skip re-hashing every blob when only the manifest moved.
  function aggregateHashLine(entry) {
    return entry.hash + ' ' + entry.path + '\n';
  }

  async function aggregateHash(files) {
    const shape = files.map(aggregateHashLine).sort().join('');
    return sha256Hex(new TextEncoder().encode(shape));
  }

  // The manifest template for one publish. `files` is [{ path, hash }], `servers`
  // the Blossom origins the blobs were verified against, and `name` empty or null
  // for the root site. content stays empty: the manifest is all tags. A name that
  // is present but unusable is refused rather than quietly demoted to a root-site
  // publish — that would overwrite the account's actual root site.
  async function buildManifestTemplate(d) {
    const files = d.files || [];
    if (!files.length) throw new Error(t('A site needs at least one page.'));
    const name = String(d.name || '').trim().toLowerCase();
    if (name && !isValidSiteName(name)) {
      throw new Error(t('That site name is not usable. Use lowercase letters, digits and dashes (up to 13).'));
    }
    const kind = name ? NAMED_MANIFEST_KIND : MANIFEST_KIND;
    const tags = [];
    for (const f of files) tags.push(['path', f.path, f.hash]);
    tags.push(['x', await aggregateHash(files), 'aggregate']);
    for (const s of (d.servers || []).slice(0, SERVERS_PER_PUBLISH)) tags.push(['server', s]);
    if (d.title) tags.push(['title', String(d.title).slice(0, 200)]);
    if (d.description) tags.push(['description', String(d.description).slice(0, 500)]);
    tags.push(['client', 'Sidecar']);
    return {
      kind,
      created_at: d.created_at || Math.floor(Date.now() / 1000),
      tags: kind === NAMED_MANIFEST_KIND ? [['d', name], ...tags] : tags,
      content: '',
    };
  }

  // The files a manifest event publishes, in tag order. Unknown tags are ignored,
  // so a manifest another client wrote parses as well as ours.
  function manifestFilesOf(event) {
    return ((event && event.tags) || [])
      .filter((tg) => Array.isArray(tg) && tg[0] === 'path' && typeof tg[1] === 'string' && typeof tg[2] === 'string')
      .map((tg) => ({ path: tg[1], hash: tg[2].toLowerCase() }));
  }

  function manifestServersOf(event) {
    return ((event && event.tags) || [])
      .filter((tg) => Array.isArray(tg) && tg[0] === 'server' && typeof tg[1] === 'string')
      .map((tg) => tg[1]);
  }

  function manifestTitleOf(event) {
    const tg = ((event && event.tags) || []).find((tg) => tg[0] === 'title');
    return (tg && tg[1]) || '';
  }

  function manifestNameOf(event) {
    if (!event || event.kind !== NAMED_MANIFEST_KIND) return null;
    const tg = (event.tags || []).find((tg) => tg[0] === 'd');
    return (tg && typeof tg[1] === 'string' && tg[1]) || null;
  }

  // The site a manifest is for, read back off an event of either manifest kind.
  function manifestIsFor(event, pubkey, name) {
    return event && event.pubkey === pubkey && manifestNameOf(event) === (isValidSiteName(name) ? name : null);
  }

  // The snapshot event for one save: every path tag and the aggregate x copied, one
  // a tag naming the site. Regular event — versions accumulate; created_at orders them.
  function buildSnapshotTemplate(manifestEvent, extra) {
    const tags = [['a', siteAddress(manifestEvent.pubkey, manifestNameOf(manifestEvent))]];
    for (const tg of manifestEvent.tags) {
      if (tg[0] === 'path' || tg[0] === 'x' || tg[0] === 'server') tags.push([...tg]);
    }
    if (extra && extra.manifestId) tags.push(['e', extra.manifestId]);
    return {
      kind: SNAPSHOT_KIND,
      created_at: manifestEvent.created_at,
      tags,
      content: '',
    };
  }

  // Which snapshots belong to a site: the a tag names it.
  function snapshotIsFor(event, pubkey, name) {
    const a = ((event && event.tags) || []).find((tg) => tg[0] === 'a');
    return !!a && a[1] === siteAddress(pubkey, name);
  }

  // ------------------------------------------------------------------
  // the gateway URL
  // ------------------------------------------------------------------

  // Hex key to lowercase base36, no padding — 50 characters, the DNS-label shape
  // NIP-5A gateways parse. BigInt does this in one line.
  function pubkeyB36(pubkey) {
    return BigInt('0x' + pubkey.toLowerCase()).toString(36);
  }

  // Where a gateway serves the site. The root site lives at the bare label; a named
  // site appends its name with no separator, per the spec's label grammar.
  function gatewayUrl(pubkey, name) {
    return 'https://' + pubkeyB36(pubkey) + (isValidSiteName(name) ? name : '') + '.nsite.lol';
  }

  // ------------------------------------------------------------------
  // markdown, and the template it renders into
  // ------------------------------------------------------------------

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // A safe href/src: absolute http(s), a site-relative path, or a data: image. The
  // rendered page is DOMPurify-sanitized afterwards regardless — this is taste, not
  // the security boundary; it keeps the sanitizer's job boring.
  function safeUrl(u) {
    const s = String(u || '').trim();
    if (/^(https?:)?\/\//i.test(s)) return s;
    if (/^data:image\//i.test(s)) return s;
    if (/^[/#]/.test(s)) return s;
    return null;
  }

  // INLINE REWRITES, one pass each, escaping as they go. The order matters: code
  // spans first, so their contents are protected from the emphasis and link passes.
  function renderInline(md) {
    let out = escapeHtml(md);
    const codes = [];
    out = out.replace(/`([^`]+)`/g, (_, c) => {
      codes.push('<code>' + c + '</code>');
      return '\u0000' + (codes.length - 1) + '\u0000';
    });
    out = out
      .replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;([^&]*)&quot;)?\)/g, (_, alt, src, title) => {
        const u = safeUrl(src);
        return u ? '<img src="' + escapeHtml(u) + '" alt="' + alt + '"' + (title ? ' title="' + title + '"' : '') + '>' : _;
      })
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, text, href) => {
        const u = safeUrl(href);
        return u ? '<a href="' + escapeHtml(u) + '">' + text + '</a>' : _;
      })
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
      .replace(/~~([^~]+)~~/g, '<del>$1</del>');
    return out.replace(/\u0000(\d+)\u0000/g, (_, i) => codes[Number(i)]);
  }

  // One page of Markdown to one HTML fragment. Deliberately small: headings,
  // paragraphs, lists, quotes, fenced code and rules are what a written site needs,
  // and a renderer this size is one this repo can read. Raw HTML in the source is
  // escaped — it shows as text, which is also why DOMPurify below is a backstop
  // rather than the only wall.
  function mdToHtml(md) {
    const lines = String(md || '').replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    let para = [];
    let list = null;   // 'ul' | 'ol' | null
    let quote = false;
    let fence = null;  // null, or the lines captured so far

    const flushPara = () => { if (para.length) { out.push('<p>' + renderInline(para.join(' ')) + '</p>'); para = []; } };
    const flushList = () => { if (list) { out.push('</' + list + '>'); list = null; } };
    const flushQuote = () => { if (quote) { out.push('</blockquote>'); quote = false; } };
    const flushAll = () => { flushPara(); flushList(); flushQuote(); };

    for (const raw of lines) {
      const line = raw.replace(/\s+$/, '');
      if (fence != null) {
        if (/^```/.test(line.trim())) { out.push('<pre><code>' + fence.join('\n') + '\n</code></pre>'); fence = null; }
        else fence.push(escapeHtml(raw));
        continue;
      }
      const trimmed = line.trim();
      if (!trimmed) { flushAll(); continue; }
      const fenceMatch = trimmed.match(/^```(\w*)$/);
      if (fenceMatch) { flushAll(); fence = []; continue; }
      const heading = trimmed.match(/^(#{1,6})\s+(.*)$/);
      if (heading) { flushAll(); const n = heading[1].length; out.push('<h' + n + '>' + renderInline(heading[2]) + '</h' + n + '>'); continue; }
      if (/^(-{3,}|\*{3,})$/.test(trimmed)) { flushAll(); out.push('<hr>'); continue; }
      const ulItem = trimmed.match(/^[-*]\s+(.*)$/);
      const olItem = trimmed.match(/^\d+[.)]\s+(.*)$/);
      if (ulItem || olItem) {
        const want = ulItem ? 'ul' : 'ol';
        flushPara(); flushQuote();
        if (list !== want) { flushList(); out.push('<' + want + '>'); list = want; }
        out.push('<li>' + renderInline((ulItem || olItem)[1]) + '</li>');
        continue;
      }
      const quoteLine = trimmed.match(/^>\s?(.*)$/);
      if (quoteLine) {
        flushPara(); flushList();
        if (!quote) { out.push('<blockquote>'); quote = true; }
        out.push('<p>' + renderInline(quoteLine[1]) + '</p>');
        continue;
      }
      flushList(); flushQuote();
      para.push(trimmed);
    }
    if (fence != null) out.push('<pre><code>' + fence.join('\n') + '\n</code></pre>');
    flushAll();
    return out.join('\n');
  }

  // The published site's one template: static, first-party, no script. The nav is
  // generated from the page list; the body arrives already sanitized and escaped of
  // any markup the author did not write in Markdown. Dark follows the visitor's
  // system preference, because a static page has nobody else to ask.
  const SITE_CSS = [
    ':root{color-scheme:light dark}',
    '*{box-sizing:border-box}',
    'body{margin:0;font:16px/1.65 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;',
    'color:#1c1c1e;background:#fdfdfc}',
    'main{max-width:44rem;margin:0 auto;padding:3rem 1.25rem 5rem}',
    'nav{display:flex;flex-wrap:wrap;gap:.25rem 1.25rem;padding:1rem 1.25rem;',
    'border-bottom:1px solid #e6e4df;font-size:.95rem}',
    'nav .brand{font-weight:650;margin-right:auto}',
    'nav a{color:inherit;text-decoration:none}',
    'nav a:hover,nav a[aria-current]{text-decoration:underline}',
    'h1,h2,h3{line-height:1.25;margin:2em 0 .5em}',
    'h1{font-size:1.9em;margin-top:0}',
    'a{color:#0a66c2}',
    'img,video{max-width:100%;height:auto;border-radius:6px}',
    'blockquote{margin:1em 0;padding:.25em 1em;border-left:3px solid #d8d5cf;color:#555}',
    'pre{background:#f4f2ee;padding:1em;border-radius:6px;overflow-x:auto;font-size:.9em}',
    'code{background:#f4f2ee;padding:.1em .3em;border-radius:4px;font-size:.92em}',
    'pre code{background:none;padding:0}',
    'hr{border:0;border-top:1px solid #e6e4df;margin:2.5em 0}',
    'footer{max-width:44rem;margin:0 auto;padding:1rem 1.25rem 3rem;color:#8a8782;font-size:.85rem}',
    '@media (prefers-color-scheme:dark){',
    'body{color:#e8e6e3;background:#17181a}',
    'nav{border-color:#2c2d30}a{color:#6cb2ff}',
    'blockquote{border-color:#3a3b3e;color:#b6b4b0}',
    'pre,code{background:#232427}hr{border-color:#2c2d30}',
    'footer{color:#7d7b78}}',
  ].join('');

  // The page label the nav shows: the page's own title, or "Home" for the entry page.
  function pageNavLabel(page) {
    if (page.slug === 'index') return t('Home');
    return page.title || page.slug;
  }

  function pagePathFor(slug) {
    return '/' + (slug === 'index' ? 'index.html' : encodeURIComponent(slug) + '.html');
  }

  // One full HTML document. `pages` carries every page so the nav can be complete;
  // `page` is the one being rendered.
  function renderSiteDocument(siteTitle, pages, page, bodyHtml) {
    const title = [page.title || pageNavLabel(page), siteTitle].filter(Boolean).join(' — ');
    const nav = pages.map((p) => {
      const cur = p.slug === page.slug ? ' aria-current="page"' : '';
      return '<a href="' + pagePathFor(p.slug) + '"' + cur + '>' + escapeHtml(pageNavLabel(p)) + '</a>';
    }).join('');
    return [
      '<!DOCTYPE html>',
      '<html lang="en">',
      '<head>',
      '<meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
      '<title>' + escapeHtml(title || siteTitle || 'Site') + '</title>',
      siteTitle ? '<meta property="og:title" content="' + escapeHtml(siteTitle) + '">' : '',
      '<style>' + SITE_CSS + '</style>',
      '</head>',
      '<body>',
      '<nav>' + (siteTitle ? '<span class="brand">' + escapeHtml(siteTitle) + '</span>' : '') + nav + '</nav>',
      '<main>',
      bodyHtml,
      '</main>',
      '<footer>Published with Sidecar</footer>',
      '</body>',
      '</html>',
    ].filter(Boolean).join('\n');
  }

  // ------------------------------------------------------------------
  // the site draft, and what publish renders from it
  // ------------------------------------------------------------------

  function newSiteDraft(name, title) {
    return { name: name || '', title: title || '', pages: [{ slug: 'index', title: '', md: '' }] };
  }

  function normalizePageSlug(raw, taken) {
    let slug = String(raw || '').trim().toLowerCase()
      .replace(/\.html?$/, '')
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/-{2,}/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);
    if (!slug) slug = 'page';
    let out = slug;
    let n = 2;
    while (taken.has(out)) out = slug + '-' + (n++);
    return out;
  }

  // A draft is postable when its entry page has something written. Anything else is
  // a site that 404s at the gateway the moment it is published.
  function siteDraftIsPostable(draft) {
    const index = (draft.pages || []).find((p) => p.slug === 'index');
    return !!(index && index.md && index.md.trim());
  }

  function siteDraftBytes(draft) {
    return (draft.pages || []).reduce((n, p) => n + (p.md || '').length, 0);
  }

  // The file list one publish writes: each page rendered through the template,
  // sanitized, capped. Pure — the tests run it without a browser except for the
  // sanitizer, which is injected (window.DOMPurify in the page, a no-op in tests
  // that would rather not vendor a DOM).
  function renderSiteFiles(draft, sanitize) {
    const clean = sanitize || ((s) => s);
    const pages = (draft.pages || []).filter((p) => p && p.slug);
    if (!pages.some((p) => p.slug === 'index')) throw new Error(t('A site needs an index page.'));
    if (pages.length > MAX_PAGES) throw new Error(t('Too many pages (max {{count}}).', { count: MAX_PAGES }));
    return pages.map((p) => {
      const bodyHtml = clean(mdToHtml(p.md), { USE_PROFILES: { html: true } });
      const html = renderSiteDocument(draft.title, pages, p, bodyHtml);
      const bytes = new TextEncoder().encode(html).length;
      if (bytes > PAGE_MAX_BYTES) throw new Error(t('{{page}} is over the 1 MB page limit.', { page: p.slug }));
      return { slug: p.slug, path: pagePathFor(p.slug), html, bytes, type: 'text/html; charset=utf-8' };
    });
  }

  // ------------------------------------------------------------------
  // reading a published site back, for editing and for versions
  // ------------------------------------------------------------------

  // The inverse of the renderer, as far as an inverse can exist: it reads OUR
  // template's output back to Markdown so a site published from another device (or
  // restored from a snapshot) can be edited again. Loses whitespace nuance and any
  // inline syntax the round trip cannot represent; keeps headings, emphasis, links,
  // images, lists, quotes and code.
  function htmlToMarkdown(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const main = doc.querySelector('main') || doc.body;
    const inlineOf = (el) => {
      let out = '';
      for (const node of el.childNodes) {
        if (node.nodeType === Node.TEXT_NODE) { out += node.nodeValue; continue; }
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        const tag = node.tagName.toLowerCase();
        const inner = inlineOf(node);
        if (tag === 'strong' || tag === 'b') out += '**' + inner + '**';
        else if (tag === 'em' || tag === 'i') out += '*' + inner + '*';
        else if (tag === 'del' || tag === 's') out += '~~' + inner + '~~';
        else if (tag === 'code') out += '`' + inner + '`';
        else if (tag === 'a') out += '[' + inner + '](' + (node.getAttribute('href') || '') + ')';
        else if (tag === 'img') out += '![' + (node.getAttribute('alt') || '') + '](' + (node.getAttribute('src') || '') + ')';
        else if (tag === 'br') out += '\n';
        else out += inner;
      }
      return out;
    };
    const blocks = [];
    const walk = (el) => {
      for (const node of el.childNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        const tag = node.tagName.toLowerCase();
        if (/^h[1-6]$/.test(tag)) {
          blocks.push('#'.repeat(Number(tag[1])) + ' ' + inlineOf(node));
        } else if (tag === 'p') {
          blocks.push(inlineOf(node));
        } else if (tag === 'ul' || tag === 'ol') {
          let n = 1;
          for (const li of node.children) {
            if (li.tagName.toLowerCase() !== 'li') continue;
            blocks.push((tag === 'ol' ? (n++) + '. ' : '- ') + inlineOf(li));
          }
        } else if (tag === 'blockquote') {
          for (const p of node.querySelectorAll('p')) blocks.push('> ' + inlineOf(p));
        } else if (tag === 'pre') {
          blocks.push('```\n' + (node.textContent || '').replace(/\n$/, '') + '\n```');
        } else if (tag === 'hr') {
          blocks.push('---');
        } else {
          walk(node);
        }
      }
    };
    walk(main);
    return blocks.join('\n\n') + '\n';
  }

  // The editable draft a published site (or one of its snapshots) restores into:
  // the manifest's file list, fetched and read back through the template's shape.
  // Pure over the events; the caller fetches the blobs.
  function siteDraftFromManifest(manifestEvent) {
    const files = manifestFilesOf(manifestEvent);
    return {
      name: manifestNameOf(manifestEvent) || '',
      title: manifestTitleOf(manifestEvent),
      // Filled page by page as the caller's fetches resolve; the slugs and order
      // come from the manifest itself, so nav matches what is live.
      pages: files
        .filter((f) => /\.html$/.test(f.path))
        .map((f) => ({ slug: decodeURIComponent(f.path.replace(/^\//, '').replace(/\.html$/, '')) || 'index', title: '', md: '' })),
      _blobs: files.filter((f) => !/\.html$/.test(f.path)),
    };
  }

  // ------------------------------------------------------------------
  // the diff a publish card shows
  // ------------------------------------------------------------------

  // What changes on the live site: paths added, paths removed, paths whose content
  // (hash) changed. Pure, so the tests can pin the card's numbers.
  function manifestDiff(baseFiles, nextFiles) {
    const base = new Map(baseFiles.map((f) => [f.path, f.hash]));
    const next = new Map(nextFiles.map((f) => [f.path, f.hash]));
    const added = [];
    const removed = [];
    const changed = [];
    for (const [path, hash] of next) {
      if (!base.has(path)) added.push(path);
      else if (base.get(path) !== hash) changed.push(path);
    }
    for (const path of base.keys()) if (!next.has(path)) removed.push(path);
    return { added, removed, changed };
  }

  // ------------------------------------------------------------------
  // everything that talks to the network or the signer
  // ------------------------------------------------------------------

  // Installed once per page, the way composer-core is: `d` carries the page's own
  // plumbing (background messages, relay pool, the shared Blossom server lookup,
  // and the signer this feature is allowed to use — the session signer, never
  // SIDECAR_OWNER_SIGN, so no publish can sign anything its approval did not name).
  const deps = {};
  function install(d) {
    Object.assign(deps, d);
    return api;
  }

  // The account's Blossom servers, newest list wins. Through the shared lookup the
  // composer already uses, so discovery, its cache and its relay policy are one
  // thing and not two.
  async function blossomServers(pubkey) {
    const servers = await deps.fetchBlossomServers(pubkey);
    if (!servers || servers.length < SERVERS_PER_PUBLISH) {
      throw new Error(t('Add at least {{count}} Blossom servers in Settings to publish a site.', { count: SERVERS_PER_PUBLISH }));
    }
    return servers;
  }

  // One blob to one server, authorized by the publish session; then the hash is
  // fetched back and compared, because a 200 that stored someone else's bytes is
  // worse than a failure. Returns the server the blob verified on.
  async function uploadVerified(session, bytes, type, hash, server) {
    const now = Math.floor(Date.now() / 1000);
    const auth = {
      kind: AUTH_KIND,
      created_at: now,
      tags: [['t', 'upload'], ['x', hash], ['expiration', String(now + 300)]],
      content: 'Upload site file',
    };
    const signed = await deps.siteSign(session, auth);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60000);
    let resp;
    try {
      resp = await fetch(server + '/upload', {
        method: 'PUT',
        body: bytes,
        headers: { Authorization: 'Nostr ' + btoa(JSON.stringify(signed)), 'Content-Type': type },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!resp.ok) throw new Error(t('HTTP {{status}}', { status: resp.status }));
    // THE HASH COMES BACK. A HEAD would trust the server's word about its own
    // storage; the GET re-reads what it actually holds.
    const back = await fetch(server + '/' + hash, { signal: AbortSignal.timeout(30000) });
    if (!back.ok) throw new Error(t('The server does not serve the blob back ({{status}})', { status: back.status }));
    const got = await back.arrayBuffer();
    if (await sha256Hex(got) !== hash) throw new Error(t('The blob a server returned is not the one uploaded.'));
    return server;
  }

  // Where this site's manifest currently lives on the relays, or null. Both
  // manifest kinds are replaceable, so newest created_at wins per kind.
  async function fetchCurrentManifest(pubkey, name) {
    const kind = manifestKindFor(name);
    const events = await deps.poolQuerySync(await deps.relayUrls(false), { kinds: [kind], authors: [pubkey] });
    let newest = null;
    for (const ev of events || []) {
      if (!manifestIsFor(ev, pubkey, name)) continue;
      if (!newest || ev.created_at > newest.created_at) newest = ev;
    }
    return newest;
  }

  // The whole publish, one approval. `draft` is the site draft; `onStatus` gets a
  // sentence per step for the composer's status line. Returns what the composer
  // needs to record: the signed manifest, the gateway URL and the servers used.
  //
  // The approval ask rides callLong, not call: the page's ordinary message budget
  // is seconds, and the answer arrives when a person has finished reading the card.
  // The card's queue entry carries a matching half-hour (background openPrompt).
  async function publish(draft, onStatus) {
    const pubkey = deps.activePubkey();
    const say = onStatus || (() => {});
    const name = isValidSiteName(draft.name) ? draft.name : '';
    const ask = deps.callLong || deps.call;

    say(t('Rendering pages…'));
    const files = renderSiteFiles(draft, window.DOMPurify && window.DOMPurify.sanitize);
    // Hash everything before asking. The approval names these bytes; nothing else
    // ever gets signed or uploaded under the session it opens.
    const hashed = [];
    for (const f of files) {
      hashed.push({ ...f, hash: await sha256Hex(new TextEncoder().encode(f.html)) });
    }

    say(t('Reading the site as it is now…'));
    const servers = await blossomServers(pubkey);
    const current = await fetchCurrentManifest(pubkey, name).catch(() => null);
    const baseFiles = current ? manifestFilesOf(current) : [];
    const diff = manifestDiff(baseFiles, hashed);
    const unchanged = !diff.added.length && !diff.removed.length && !diff.changed.length;
    if (unchanged && current) {
      throw new Error(t('This site is already published, with no changes to upload.'));
    }

    // ONE ASK. Site name, file count, bytes, the kinds this publish signs, and what
    // changes on the live site. The card shows the summary; the session keeps the
    // hash set, because every signature and every upload under it is checked
    // against exactly these bytes. The card is built by both approval surfaces from
    // this plan, so the two cannot disagree about what a click means.
    const totalBytes = hashed.reduce((n, f) => n + f.bytes, 0);
    say(t('Waiting for approval…'));
    const session = await ask({
      type: 'SIDECAR_SITE_PUBLISH',
      expectedPubkey: pubkey,
      plan: {
        name,
        files: hashed.map((f) => ({ path: f.path, hash: f.hash, size: f.bytes })),
        fileCount: hashed.length,
        totalBytes,
        servers,
        added: diff.added,
        removed: diff.removed,
        changed: diff.changed,
        replaces: current ? { id: current.id, created_at: current.created_at } : null,
        kinds: [manifestKindFor(name), SNAPSHOT_KIND, SERVER_LIST_KIND],
      },
    });

    try {
      // Upload what is not already where it must be. A file whose hash is already
      // in the live manifest is already on some server the manifest names; the
      // spec's two-server floor applies to NEW blobs, so unchanged files are
      // neither re-uploaded nor re-verified.
      const fresh = hashed.filter((f) => !baseFiles.some((b) => b.path === f.path && b.hash === f.hash));
      let done = 0;
      for (const f of fresh) {
        done++;
        say(t('Uploading {{name}}…', { name: f.path.slice(1) }));
        const bytes = new TextEncoder().encode(f.html);
        let ok = 0;
        let lastError = null;
        for (const server of servers) {
          if (ok >= SERVERS_PER_PUBLISH) break;
          try {
            await uploadVerified(session, bytes, f.type, f.hash, server);
            ok++;
          } catch (e) {
            console.warn('[Site] upload to ' + server + ' failed:', e);
            lastError = e;
          }
        }
        if (ok < SERVERS_PER_PUBLISH) {
          throw lastError || new Error(t('Not enough Blossom servers accepted {{file}}.', { file: f.path }));
        }
      }

      // The server tags name where the blobs actually verified — fresh ones on the
      // servers this publish used, carried-over files on whatever the old manifest
      // named, which is why the old manifest's servers stay listed.
      const serverSet = [...new Set([...servers.slice(0, SERVERS_PER_PUBLISH), ...manifestServersOf(current || {})])];

      say(t('Signing the manifest…'));
      const manifest = await buildManifestTemplate({
        name,
        files: hashed,
        servers: serverSet,
        title: draft.title,
        created_at: Math.floor(Date.now() / 1000),
      });
      const signedManifest = await deps.siteSign(session, manifest);
      const snapshot = buildSnapshotTemplate({ ...manifest, pubkey, created_at: manifest.created_at }, { manifestId: signedManifest.id });
      const signedSnapshot = await deps.siteSign(session, snapshot);

      // A 10063 only when the account has none: the server list is the account's,
      // not the site's, and another client may maintain it.
      const hasServerList = await deps.hasServerList(pubkey);
      const signedList = hasServerList ? null : await deps.siteSign(session, {
        kind: SERVER_LIST_KIND,
        created_at: Math.floor(Date.now() / 1000),
        tags: servers.slice(0, SERVERS_PER_PUBLISH).map((s) => ['server', s]),
        content: '',
      });

      say(t('Publishing…'));
      const relays = await deps.targetRelays();
      if (!relays.length) throw new Error(t('No relays configured (add some in Settings)'));
      const outgoing = [signedManifest, signedSnapshot, signedList].filter(Boolean);
      const results = await Promise.allSettled(deps.publishToRelays(relays, outgoing));
      const okCount = results.filter((r) => r.status === 'fulfilled' && r.value !== false).length;
      if (!okCount) throw new Error(t('No relay accepted the site manifest.'));

      say(t('Confirming at the gateway…'));
      const url = gatewayUrl(pubkey, name);
      const live = await confirmGateway(url).catch(() => false);

      return { manifest: signedManifest, snapshot: signedSnapshot, url, live, servers: serverSet };
    } finally {
      deps.call({ type: 'SIDECAR_SITE_PUBLISH_END', session }).catch(() => {});
    }
  }

  // The gateway is trusted for the entry document but flaky in general: a short
  // poll, not a single strike. A 404 that outlasts the poll reports as not
  // confirmed — the publish itself still happened.
  async function confirmGateway(url) {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const resp = await fetch(url + '/', { signal: AbortSignal.timeout(8000) });
        if (resp.ok) return true;
      } catch (_) { /* retried below */ }
      await new Promise((r) => setTimeout(r, 1500));
    }
    return false;
  }

  // Unpublish: an empty manifest replaces the live one (the gateway then 404s every
  // path), and NIP-09 kind 5 events ask relays to drop the old manifest and every
  // snapshot. It needs its own approval — same card, a plan whose shape says
  // removal — and it is not deletion: relays and caches may keep copies.
  async function unpublish(name, onStatus) {
    const pubkey = deps.activePubkey();
    const say = onStatus || (() => {});
    const site = isValidSiteName(name) ? name : '';
    const ask = deps.callLong || deps.call;
    say(t('Reading the site as it is now…'));
    const current = await fetchCurrentManifest(pubkey, site);
    if (!current) throw new Error(t('This site has no manifest on the relays.'));

    say(t('Waiting for approval…'));
    const session = await ask({
      type: 'SIDECAR_SITE_PUBLISH',
      expectedPubkey: pubkey,
      plan: {
        name: site,
        fileCount: 0,
        totalBytes: 0,
        servers: [],
        added: [],
        removed: manifestFilesOf(current).map((f) => f.path),
        changed: [],
        replaces: { id: current.id, created_at: current.created_at },
        kinds: [manifestKindFor(site), 5],
        unpublish: true,
      },
    });
    try {
      say(t('Signing…'));
      const empty = {
        kind: manifestKindFor(site),
        created_at: Math.floor(Date.now() / 1000),
        tags: manifestKindFor(site) === NAMED_MANIFEST_KIND
          ? [['d', site], ['client', 'Sidecar']]
          : [['client', 'Sidecar']],
        content: '',
      };
      const signedEmpty = await deps.siteSign(session, empty);
      const deletion = {
        kind: 5,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['a', siteAddress(pubkey, site)], ['e', current.id]],
        content: '',
      };
      const signedDeletion = await deps.siteSign(session, deletion);
      say(t('Publishing…'));
      const relays = await deps.targetRelays();
      const results = await Promise.allSettled(deps.publishToRelays(relays, [signedEmpty, signedDeletion]));
      const okCount = results.filter((r) => r.status === 'fulfilled' && r.value !== false).length;
      if (!okCount) throw new Error(t('No relay accepted the unpublish.'));
      return { url: gatewayUrl(pubkey, site) };
    } finally {
      deps.call({ type: 'SIDECAR_SITE_PUBLISH_END', session }).catch(() => {});
    }
  }

  const api = {
    MANIFEST_KIND, NAMED_MANIFEST_KIND, SNAPSHOT_KIND, SERVER_LIST_KIND, AUTH_KIND,
    PAGE_MAX_BYTES, ASSET_MAX_BYTES, MAX_PAGES, SERVERS_PER_PUBLISH,
    isValidSiteName, normalizeSiteName, siteAddress, manifestKindFor,
    aggregateHash, buildManifestTemplate, manifestFilesOf, manifestServersOf,
    manifestTitleOf, manifestNameOf, manifestIsFor,
    buildSnapshotTemplate, snapshotIsFor,
    pubkeyB36, gatewayUrl,
    escapeHtml, safeUrl, renderInline, mdToHtml, renderSiteDocument, pageNavLabel, pagePathFor,
    newSiteDraft, normalizePageSlug, siteDraftIsPostable, siteDraftBytes, renderSiteFiles,
    htmlToMarkdown, siteDraftFromManifest, manifestDiff,
    install, blossomServers, uploadVerified, fetchCurrentManifest, publish, unpublish, confirmGateway,
  };
  if (typeof self !== 'undefined') self.SidecarNsite = api;
  if (typeof globalThis !== 'undefined') globalThis.SidecarNsite = api;
})();
