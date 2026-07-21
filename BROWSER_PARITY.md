# Browser Parity — Chrome & Firefox

Sidecar ships from one shared codebase to two browser builds. This doc exists so
that **every release lands in both** — so nothing goes out to Chrome and silently
skips Firefox (or vice versa).

## The two builds

|                   | Chrome / Chromium                     | Firefox                                              |
| ----------------- | ------------------------------------- | ---------------------------------------------------- |
| Store             | Chrome Web Store (published)          | AMO — addons.mozilla.org (not yet published)         |
| Extension origin  | `chrome-extension://<id>/`            | `moz-extension://<uuid>/`                            |
| Background        | MV3 `background.service_worker`       | event page: `background.scripts`                     |
| Side UI           | `side_panel` (`chrome.sidePanel`)     | `sidebar_action`                                     |
| Store metadata    | —                                     | requires `browser_specific_settings.gecko`           |
| Lives on          | `main`                                | `feat/firefox-port` (origin fix folded in)           |

The Firefox port is kept on its own branch(es) until it's ready for AMO. Merging a
release to `main` updates the Chrome build; the Firefox branch must be brought up to
the same version separately (see the checklist).

**Current status:** resumed. `feat/firefox-port` is rebased onto 1.4.0 `main`
(including the post-1.4.0 auto-lock UI work), `fix/firefox-message-origin` is folded
in, and the port implementation is complete through the shims/permission-UX phase
(see FIREFOX_PORT.md → Status). Next: the Firefox smoke test below, then the full
parity benchmark, then AMO.

## Shared vs. browser-specific

**Shared — edit once, both builds get it:**
`background.js`, `content.js`, `nostr-provider.js`, `prompt.html` / `prompt.js`,
`sidepanel.html` / `sidepanel.js`, `styles.css`, `welcome.*`, `CHANGELOG.md`,
`FEATURES.md`, and essentially all UI and logic.

**Browser-specific — must be reconciled per build:**

- **`manifest.json`** — `background` (`service_worker` vs `scripts`), `side_panel` vs
  `sidebar_action`, `browser_specific_settings` (Firefox only), and the `version` string.
- **Extension origin** — never hardcode a scheme. Use `chrome.runtime.getURL('/')`,
  which yields `chrome-extension://<id>/` on Chrome and `moz-extension://<uuid>/` on
  Firefox. Hardcoding `chrome-extension://` in the message-origin gate is exactly what
  blanked the Firefox panel — see `fix/firefox-message-origin`.
- Any `chrome.*` call that has no Firefox equivalent.

## Release checklist — run for every version bump

- [ ] Bump `version` in the **Chrome** manifest and the **Firefox** manifest to the same number.
- [ ] Bring the release's shared changes into the Firefox branch (rebase/merge `main`).
- [ ] Single shared `CHANGELOG.md` entry — both builds ship the same notes.
- [ ] `grep -rn "chrome-extension://\|moz-extension://"` in logic files → should be none;
      origins come from `runtime.getURL`.
- [ ] **Chrome smoke test** — load unpacked; exercise the approval popup, side panel,
      wallet, a media upload (kind 24242), and a repost content preview.
- [ ] **Firefox smoke test** — `about:debugging` → This Firefox → Load Temporary Add-on;
      exercise the sidebar, an approval, and confirm the panel actually renders (the
      blank-panel regression — i.e. the origin gate lets extension pages through).
- [ ] Package and submit: **Chrome Web Store** and **AMO**.
- [ ] Tag `vX.Y.Z`.

## Known cross-browser gotchas

- **Origin gate** (`background.js`) — use `runtime.getURL('/')`, not a hardcoded scheme.
  Fixed on `feat/firefox-port` (the old `fix/firefox-message-origin` commit, folded in).
- **Side UI** — `chrome.sidePanel` (Chrome) vs `sidebar_action` (Firefox); the manifest
  key and the open/close behavior both differ.
- **Background** — MV3 service worker (Chrome) vs event page `background.scripts` (Firefox).
- **AMO** — Firefox refuses to install without `browser_specific_settings.gecko.id`.

---

*Keep this doc honest: once the Firefox port merges to `main` and reaches AMO, update the
"not yet published" notes above.*
