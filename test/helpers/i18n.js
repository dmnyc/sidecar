'use strict';

// The real i18n.js, in English, for tests that run panel code in a vm context.
//
// Panel functions now call t(), tn() and I18N.fmtNum(), which sidepanel.js takes from
// window.SidecarI18n at the top of its closure. A test that lifts one function into a
// bare context has none of those, and the function then throws a ReferenceError that
// its own catch turns into a wrong answer (a dash for a count, a screen that never
// arrives). withI18n(ctx) puts the same names in the context, backed by the real module
// rather than a stub, so English output is exactly what the extension produces.

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'i18n.js'), 'utf8');

function englishI18n() {
  const ctx = {
    Intl, Promise, Object, String, Number, Math, Set, Array, JSON,
    chrome: {
      i18n: { getUILanguage: () => 'en-US' },
      storage: { local: { get: (k, cb) => cb({}) } },
      runtime: { getURL: (p) => p },
    },
    fetch: async () => ({ ok: false }),
  };
  ctx.self = ctx;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return ctx.SidecarI18n;
}

// Adds I18N, t, tn and tSec to a context object (before or after vm.createContext), and
// returns it.
function withI18n(ctx) {
  const I18N = englishI18n();
  ctx.I18N = I18N;
  ctx.t = I18N.t;
  ctx.tn = I18N.tn;
  ctx.tSec = I18N.tSec;
  // Under the name the pages read it by, for code that runs whole (composer-core.js takes
  // window.SidecarI18n, and a context whose window is itself finds it here).
  ctx.SidecarI18n = I18N;
  return ctx;
}

module.exports = { englishI18n, withI18n };
