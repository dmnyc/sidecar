# Browser Parity — Chrome & Firefox

Sidecar ships from one shared codebase to two browser builds. This doc exists so
that **every release lands in both** — so nothing goes out to Chrome and silently
skips Firefox (or vice versa).

## The two builds

|                   | Chrome / Chromium                     | Firefox                                              |
| ----------------- | ------------------------------------- | ---------------------------------------------------- |
| Store             | Chrome Web Store (published)          | AMO — addons.mozilla.org (published)                 |
| Extension origin  | `chrome-extension://<id>/`            | `moz-extension://<uuid>/`                            |
| Background        | MV3 `background.service_worker`       | event page: `background.scripts`                     |
| Side UI           | `side_panel` (`chrome.sidePanel`)     | `sidebar_action`                                     |
| Store metadata    | —                                     | requires `browser_specific_settings.gecko`           |
| Lives on          | `main`                                | `main` — same commit, same manifest                  |
| Minimum version   | Chrome 114                            | Firefox 128                                          |

**Both builds ship from `main`, from one `manifest.json`.** There is no Firefox
branch and no second manifest — the repo's manifest carries *both* browsers' keys
so a single unpacked load works in either browser with no build step, and
`scripts/package.sh` strips each zip down to the keys its store accepts:

- **Chrome zip** drops `sidebar_action`, `browser_specific_settings`, and
  `background.scripts`.
- **Firefox zip** drops `side_panel`, `minimum_chrome_version`,
  `background.service_worker`, and the Chrome-only `sidePanel` permission (which
  the AMO validator would otherwise flag as unrecognized).

This matters when adding a background module: put it in **both**
`importScripts(...)` inside `background.js` (Chrome) **and**
`background.scripts` in the manifest (Firefox). Miss the second and the Firefox
build loads a background that's missing a module, with no error until something
calls into it.

**Current status:** shipped and live on both stores. Firefox launched in 1.5.0;
AMO is public. AMO auto-approves listed extensions that pass automated validation
and publishes within minutes, while the Chrome Web Store takes up to a week — so
the normal steady state is a newer version live on Firefox and the previous one
on Chrome. That gap is expected, not a problem to manage.

## Shared vs. browser-specific

**Shared — edit once, both builds get it:**
`background.js`, `content.js`, `nostr-provider.js`, `prompt.html` / `prompt.js`,
`sidepanel.html` / `sidepanel.js`, `styles.css`, `welcome.*`, `CHANGELOG.md`,
`FEATURES.md`, and essentially all UI and logic.

**Browser-specific — all of it lives in the one manifest, stripped per store:**

- **`manifest.json`** — `background` (`service_worker` vs `scripts`), `side_panel`
  vs `sidebar_action`, `browser_specific_settings` (Firefox only),
  `minimum_chrome_version` (Chrome only), and the `sidePanel` permission.
- **Extension origin** — never hardcode a scheme. Use `chrome.runtime.getURL('/')`,
  which yields `chrome-extension://<id>/` on Chrome and `moz-extension://<uuid>/` on
  Firefox. Hardcoding `chrome-extension://` in the message-origin gate is exactly what
  blanked the Firefox panel once.
- Any `chrome.*` call that has no Firefox equivalent. Check the floor before using
  a newer API: `chrome.storage.session` needs Firefox 115, so it's safe at the 128
  minimum.

## Release checklist — run for every version bump

- [ ] Bump `version` in `manifest.json` — one file, both builds — and match it in
      `package.json`. Only the manifest reaches the zip (`package.sh` reads it and
      strips `package.json` from the archive), so a stale `package.json` ships
      nothing wrong and gets missed: it sat at 1.5.0 from v1.5.1 through v1.6.0.
- [ ] Any new background module added to **both** `importScripts(...)` in
      `background.js` and `background.scripts` in the manifest.
- [ ] Single shared `CHANGELOG.md` entry — both builds ship the same notes.
- [ ] `grep -rn "chrome-extension://\|moz-extension://"` in logic files → should be
      none outside comments; origins come from `runtime.getURL`.
- [ ] **Chrome smoke test** — load unpacked; exercise the approval popup, side panel,
      wallet, a media upload (kind 24242), and a repost content preview.
- [ ] **Firefox smoke test** — `about:debugging` → This Firefox → Load Temporary Add-on;
      exercise the sidebar, an approval, and confirm the panel actually renders (the
      blank-panel regression — i.e. the origin gate lets extension pages through).
      Don't skip this when Firefox ships first: **AMO permanently locks a version
      string**, so a Firefox-only bug found after upload can't be fixed as the same
      version — it forces a point release, and the two stores end up on different
      numbers.
- [ ] Tag `vX.Y.Z`, then `scripts/package.sh vX.Y.Z` (it requires the tag and a clean
      tree, and emits both zips).
- [ ] Submit to **both** stores at once and let Firefox land first.

## Known cross-browser gotchas

- **Origin gate** (`background.js`) — use `runtime.getURL('/')`, not a hardcoded scheme.
- **Side UI** — `chrome.sidePanel` (Chrome) vs `sidebar_action` (Firefox); the manifest
  key and the open/close behavior both differ.
- **Background** — MV3 service worker (Chrome) vs event page `background.scripts`
  (Firefox). Keepalive concerns are Chrome-specific but harmless on Firefox.
- **AMO** — Firefox refuses to install without `browser_specific_settings.gecko.id`,
  and AMO rejects a re-upload of a version string it already has.

---

*Keep this doc honest: it described a separate `feat/firefox-port` branch and a second
Firefox manifest long after both were gone, and its checklist told you to bump a file
that no longer exists. If the build layout changes again, fix this in the same PR.*
