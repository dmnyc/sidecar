// Sidecar content script — bridges the page's window.nostr (nostr-provider.js) to the
// extension service worker. Injects the provider at document_start, then relays each
// request to the background, attaching the TRUSTED host (taken from location here, never
// from the page), and posts the response back to the page.

(function () {
  'use strict';

  // Inject the page-context provider as early as possible.
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('nostr-provider.js');
  script.onload = function () {
    this.remove();
  };
  (document.head || document.documentElement).appendChild(script);

  const host = location.hostname; // trusted origin identity, set by the content script

  const SCOPE_TO_TYPE = {
    nostr: 'SIDECAR_NOSTR_RPC',
    webln: 'SIDECAR_WEBLN_RPC',
  };

  window.addEventListener('message', function (event) {
    if (event.source !== window) return;
    const d = event.data;
    if (!d || d.ext !== 'sidecar' || d.kind !== 'request') return;
    const type = SCOPE_TO_TYPE[d.scope];
    if (!type) return;

    // Always answer the page exactly once. If the service worker dies mid-request
    // (MV3 recycles it) the callback may never fire, which would hang the page's
    // window.nostr/webln promise — so a timeout guarantees a (failed) response.
    let replied = false;
    function reply(response) {
      if (replied) return;
      replied = true;
      clearTimeout(timer);
      window.postMessage({ ext: 'sidecar', scope: d.scope, kind: 'response', id: d.id, response }, '*');
    }
    const timer = setTimeout(
      () => reply({ ok: false, error: 'Sidecar did not respond (timed out). Try again.' }),
      180000
    );

    chrome.runtime.sendMessage(
      { type, scope: d.scope, method: d.method, params: d.params, host },
      function (response) {
        const err = chrome.runtime.lastError;
        reply(err ? { ok: false, error: err.message } : response);
      }
    );
  });
})();
