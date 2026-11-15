'use strict';

// Catalog completeness is separate from translation accuracy and native review.
// English fallback keeps the UI usable, but does not make a catalog complete.
const forms = new Set(['zero', 'one', 'two', 'few', 'many', 'other']);
const slots = text => [...String(text).matchAll(/\{\{(\w+)\}\}/g)].map(m => m[1]).sort();
function auditCatalog(code, catalog, keys) {
  const categories = new Intl.PluralRules(code).resolvedOptions().pluralCategories;
  const known = new Map(), required = new Set(), security = new Set();
  for (const entry of keys) {
    if (!entry.plural || entry.simple) {
      known.set(entry.key, {entry, plural:false}); required.add(entry.key);
      if (entry.security) security.add(entry.key);
    }
    if (entry.plural) {
      for (const form of forms) known.set(entry.key+'_'+form, {entry,plural:true});
      for (const form of categories) {
        const key = entry.key+'_'+form; required.add(key);
        if (entry.security) security.add(key);
      }
    }
  }
  const missing = [], invalid = [], unknown = [];
  for (const key of required) {
    if (typeof catalog[key] !== 'string' || !catalog[key].trim()) missing.push(key);
  }
  for (const [key, value] of Object.entries(catalog)) {
    const record = known.get(key);
    if (!record) { unknown.push(key); continue; }
    if (typeof value !== 'string' || !value.trim()) { invalid.push({key,reason:'empty or non-string value'}); continue; }
    if (/<[a-z!/]/i.test(value)) invalid.push({key,reason:'markup'});
    // Plural grammar can spell out a count; all other parameters must survive.
    const params = text => slots(text).filter(name => !record.plural || name !== 'count');
    if (JSON.stringify(params(value)) !== JSON.stringify(params(record.entry.key))) {
      invalid.push({key,reason:'placeholder mismatch'});
    }
  }
  return {code,required:required.size,translated:required.size-missing.length,
    complete:!missing.length&&!invalid.length&&!unknown.length,
    missing,invalid,unknown,securityKeys:[...security]};
}
module.exports = {auditCatalog};
