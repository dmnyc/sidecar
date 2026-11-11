#!/usr/bin/env node
// publish-images — upload gallery and help images to a Blossom server and to
// nostr.build under one Nostr key, and keep a local catalog of the URLs.
//
// Why this exists: the store galleries, the website slideshow and the help page
// should all show one set of images, and every place that shows them should point at
// the same public URL. This puts a file in two places and remembers where.
//
// KEY SAFETY: the key comes from an encrypted NIP-49 value in the environment and is
// opened by a password typed at a hidden prompt. Nothing is written to disk but the
// public URLs. See scripts/image-publish-core.js.
//
// Usage:
//   node scripts/publish-images.mjs upload <image...> [--to blossom|nostr-build|both] [--force]
//   node scripts/publish-images.mjs list [search] [--json]
//   node scripts/publish-images.mjs catalog
//
// Environment:
//   SIDECAR_NCRYPTSEC        NIP-49 encrypted secret key (required to upload)
//   SIDECAR_BLOSSOM_SERVER   Blossom server URL (required unless --to nostr-build)
//   SIDECAR_IMAGE_CATALOG    catalog path override
//
// Dev-only: scripts/ is stripped from the packaged extension by scripts/package.sh.

import { createRequire } from 'node:module';

const core = createRequire(import.meta.url)('./image-publish-core.js');

function usage() {
  console.log(`Publish images to Blossom and nostr.build

Usage:
  node scripts/publish-images.mjs upload <image...> [--to blossom|nostr-build|both] [--force]
  node scripts/publish-images.mjs list [search] [--json]
  node scripts/publish-images.mjs catalog

Environment:
  ${core.NCRYPTSEC_ENV}        NIP-49 encrypted secret key (required to upload)
  ${core.BLOSSOM_ENV}   Blossom server URL (required unless --to nostr-build)
  ${core.CATALOG_ENV}    catalog path override

An image already in the catalog for a target is not sent again; --force sends it anyway.`);
}

function parseUpload(args) {
  const files = [];
  let to = 'both';
  let force = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--force') force = true;
    else if (a === '--to') to = args[++i];
    else if (a.startsWith('--to=')) to = a.slice(5);
    else if (a.startsWith('--')) throw new Error('Unknown option: ' + a);
    else files.push(a);
  }
  if (!['blossom', 'nostr-build', 'both'].includes(to)) {
    throw new Error('--to takes blossom, nostr-build or both');
  }
  if (!files.length) throw new Error('Provide at least one image path');
  return { files, targets: to === 'both' ? ['blossom', 'nostr-build'] : [to], force };
}

async function upload(args, catalog) {
  const { files, targets, force } = parseUpload(args);

  let server = null;
  if (targets.includes('blossom')) {
    if (!process.env[core.BLOSSOM_ENV]) {
      throw new Error(core.BLOSSOM_ENV + ' is not set (or send to nostr.build only with --to nostr-build)');
    }
    server = core.normalizeServer(process.env[core.BLOSSOM_ENV]);
  }

  // Read and check every file before asking for a password, so a typo in the third
  // path does not come after two uploads.
  const images = files.map((f) => core.readImage(f));

  const known = core.readRecords(catalog);
  const have = (image, target) => known.find((r) => r.sha256 === image.hash && r.target === target);
  const todo = images.map((image) => ({
    image,
    targets: targets.filter((t) => force || !have(image, t)),
  }));
  for (const { image, targets: left } of todo) {
    for (const t of targets) {
      if (!left.includes(t)) console.log(have(image, t).url + '  (already published to ' + t + ')');
    }
  }
  if (todo.every((x) => !x.targets.length)) return;

  const ncryptsec = process.env[core.NCRYPTSEC_ENV];
  if (!ncryptsec) throw new Error(core.NCRYPTSEC_ENV + ' is not set');
  const tools = core.loadCrypto();
  const password = await core.promptPassword('ncryptsec password: ');
  let secretKey;
  try { secretKey = tools.decrypt(ncryptsec, password); } catch (_) {
    throw new Error('Could not decrypt ' + core.NCRYPTSEC_ENV + '; check the password and the value');
  }
  const pubkey = tools.getPublicKey(secretKey);

  try {
    for (const { image, targets: left } of todo) {
      for (const target of left) {
        try {
          const result = target === 'blossom'
            ? await core.uploadToBlossom({ image, secretKey, server })
            : await core.uploadToNostrBuild({ image, secretKey });
          const record = core.recordFor(image, result, pubkey);
          try {
            core.appendRecord(catalog, record);
            console.log(record.url + (record.verified ? '' : '  (served bytes differ from the local file)'));
          } catch (e) {
            console.error('Uploaded ' + record.url + ', but the catalog update failed: ' + e.message);
            process.exitCode = 1;
          }
        } catch (e) {
          console.error('Failed ' + image.localPath + ' (' + target + '): ' + e.message);
          process.exitCode = 1;
        }
      }
    }
  } finally {
    secretKey.fill(0);
  }
}

function list(args, catalog) {
  const json = args.includes('--json');
  const search = (args.find((a) => a !== '--json') || '').toLowerCase();
  const records = core.readRecords(catalog)
    .filter((r) => !search || (r.fileName + ' ' + r.sha256 + ' ' + r.url + ' ' + r.target).toLowerCase().includes(search))
    .reverse();
  if (json) { console.log(JSON.stringify(records, null, 2)); return; }
  if (!records.length) {
    console.log(search ? 'No matching uploads.' : 'No uploads recorded yet. Catalog: ' + catalog);
    return;
  }
  console.table(records.map((r) => ({ uploaded: r.recordedAt, file: r.fileName, target: r.target, url: r.url })));
}

async function run() {
  const [command, ...args] = process.argv.slice(2);
  const catalog = core.catalogPath();
  if (!command || ['help', '--help', '-h'].includes(command)) return usage();
  if (command === 'catalog') return console.log(catalog);
  if (command === 'list') return list(args, catalog);
  if (command === 'upload') return upload(args, catalog);
  throw new Error('Unknown command: ' + command);
}

run().catch((e) => {
  console.error('Error: ' + e.message);
  process.exitCode = 1;
});
