// List Sidecar's translation keys, or write the developer test locale.
//
//   node scripts/i18n-keys.mjs               every key, one per line (what to translate)
//   node scripts/i18n-keys.mjs --json        the same as a JSON template, English to English
//   node scripts/i18n-keys.mjs --test-locale write locales/en-XB.json: every string
//                                            wrapped in ⟦…⟧, plural forms included
//
// en-XB exists to exercise the path a real language takes (a locale FILE fetched,
// parsed and applied, with English fallback) without waiting for a translator. It is
// git-ignored and never ships; select it under Settings → Developer on a local build.
// en-XA, by contrast, is generated in code and loads nothing.

import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { allKeys, ROOT } = require('./i18n-keys-core.js');

const keys = allKeys();
const arg = process.argv[2];

if (arg === '--test-locale') {
  const out = {};
  // Placeholders stay intact inside the brackets, so substitution still works.
  const mark = (s) => '⟦' + s + '⟧';
  for (const k of keys) {
    if (k.plural) {
      out[k.key + '_one'] = mark(k.key);
      out[k.key + '_other'] = mark(k.other);
    } else {
      out[k.key] = mark(k.key);
    }
  }
  mkdirSync(join(ROOT, 'locales'), { recursive: true });
  writeFileSync(join(ROOT, 'locales', 'en-XB.json'), JSON.stringify(out, null, 2) + '\n');
  console.log('wrote locales/en-XB.json: ' + keys.length + ' keys');
} else if (arg === '--json') {
  const out = {};
  for (const k of keys) {
    if (k.plural) { out[k.key + '_one'] = k.key; out[k.key + '_other'] = k.other; } else out[k.key] = k.key;
  }
  console.log(JSON.stringify(out, null, 2));
} else {
  for (const k of keys) console.log(k.plural ? k.key + '  |  ' + k.other : k.key);
  console.error(keys.length + ' keys');
}
