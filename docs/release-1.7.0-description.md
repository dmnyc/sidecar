Sidecar lives in your browser's side panel and hands every Nostr web app a secure window.nostr to sign in with — so you never paste your nsec into a website again. Your keys stay on your device, encrypted behind a PIN. It's a companion to your favorite Nostr client, not a replacement: sign, post, and zap in a tap, then jump right back to the app you love.

🔑 Your keys, your control

Full NIP-07 signer: getPublicKey, signEvent, NIP-04 & NIP-44 encrypt/decrypt, and your relay list.
Private keys are encrypted at rest (PBKDF2 → AES-GCM via WebCrypto) — never stored in plaintext, never transmitted off your device.

PIN-protected (at least 8 characters, with a live strength check) and automatic re-lock, on by default after a period of inactivity you can adjust. A paste guard blocks dropping an nsec anywhere except the import field.

Multiple accounts — store as many keys as you like, switch the active one in a click, drag to reorder. Switching works the way you'd expect: log out of a site, switch accounts here, log back in, and the site follows — while sessions you've left open elsewhere keep signing as the account they started with.

Per-site permissions with a clear prompt that previews exactly what you're signing — with human-readable event kinds and a heads-up on the few worth a second look. Relay auth (NIP-42) signs automatically so clients stay connected.

A warning before an app erases your data. Your follow list, mute list, and profile are stored as events that replace the previous version outright — no merge, no undo — so one careless app can wipe years of follows in a single signature. Sidecar checks what it's being asked to sign against what it last signed for you, and stops to tell you in plain language what would be lost.

🔐 Key portability

Import or export any account as a NIP-49 ncryptsec — a password-encrypted key, so it never has to touch a clipboard as a raw nsec.
Back up or restore your whole vault — every account's key and connected wallet — in one encrypted file.
NIP-05 identifiers are verified against their domain, with a check or warning right on your profile.

👤 Your profile, your way

View and edit your profile, see your following count, and publish updates in a tap.
Edit and publish your outbox relays (NIP-65) right from your profile.
Follow-list recovery — if another app wipes or shrinks your follows, scan your relays and restore a healthy earlier version (powered by Mutable).

✍️ Post without leaving the page

A composer for notes with @mention autocomplete that searches your follows and all of Nostr, embedded note previews, link cards, and image/video upload (to your own Blossom servers, with an automatic fallback).
Drafts autosave per account, and a short review countdown lets you read the note exactly as it'll publish before it sends.

💬 Comment on any webpage

The speech-bubble icon in the top bar opens a composer for the page you're reading. Your comment publishes as a kind 1111 (NIP-22) addressed to the page's URL — so everyone commenting on the same page lands in the same thread. Mentions work the same way they do in notes. The review countdown fires before it goes out, and a stray click doesn't lose your draft.

🔍 Find anyone, open it anywhere

Paste an npub, note, nevent or naddr into the search bar and it opens in whichever Nostr client you prefer. Type a name instead and Sidecar suggests people as you go, starting with the ones you follow. NIP-05 addresses like name@domain resolve against their own domain.

Paste a link from a client you don't use and it reopens in the one you do.

🔔 Notifications at a glance

A bell shows replies, mentions, reposts, reactions, and zaps for your active account — opening instantly and updating live while you watch, and always reflecting a mute the moment you check (even one made in another app). Each taps through to your preferred web client.

⚡ Lightning wallet (Nostr Wallet Connect)

Connect any NWC wallet — Alby Hub, Zeus, YakiHonne, Coinos, Minibits and more — with built-in suggestions to help you pick one. No wallet yet? Quick-start one through Rizful with a single one-time code, no separate app required.

Send (BOLT11 or Lightning address), receive by invoice or by your Lightning address (with a QR), view history, and back up or export your connection (PIN-gated, with a QR).

Tap your balance to switch between sats, BTC, and your local currency — sixteen to choose from — and open a bitcoin price chart with historical ranges and a hover indicator right on the wallet card.

Pay a Lightning invoice from any Nostr page in a tap, plus a WebLN provider with optional per-site spending budgets you can edit or revoke any time.

Auto Zaps — approve small zaps under a limit you set, so small tips go out with nothing to approve — starting at 200 sats a zap and 20,000 a day, and hard-capped at 1,000 and 100,000.

Every payment ends with a bolt of lightning across the page, drawn fresh each time. Turn it off in Settings if you'd rather not.

Sidecar never holds your funds — you stay in control of your own wallet.

🎨 Dressed to your taste

Five themes, switchable in Settings. Speakeasy — the original after-hours velvet — stays the default, joined by Film Noir (matte black with silver), Art Deco (daylight eggshell and gold), Aegean (Greek whitewash and cobalt) and Brownstone (New York sandstone after dark). Your choice sticks across sessions, and the "Pay with Sidecar" card injected on web pages wears the same look.

🛡️ Private by design

Open source. No analytics, no tracking, no remote code — everything runs locally in your browser. Link previews are fetched with a guard against private-network requests.
Works in Chrome, Brave, Edge, and other Chromium browsers, plus Firefox 128 and later. Pin Sidecar, open the side panel (or Firefox sidebar), and you're ready. 🍸

🗞️ What's new

1.7.0
• Comment on any webpage — the speech bubble in the top bar opens a composer for the page you're reading. Publishes a kind 1111 (NIP-22) over the page's URL, with @mentions, a review countdown, and a link card. Links point at Jumble, the only client rendering them today.
• Quick-start a Lightning wallet through Rizful — enter a one-time code and Sidecar receives an NWC connection. No separate app.
• The price chart now shows historical ranges with a hover indicator.
• Smarter wallet backup — Sidecar now verifies your relay backup matches the wallet you have connected, and warns before overwriting a different one.
• Restoring a wallet shows the right balance — the client was cached under the account, not the connection, so a restored wallet displayed the previous wallet's balance until you removed and re-imported it.
• Imported accounts now load profile pictures on the first try — a storage write race was silently overwriting freshly fetched profiles.
• Add an account from the dropdown — no trip to settings.
• Interface text stays put — chrome is unselectable, content opts back in.

1.6.0
• A warning before an app erases your data — your follow list, mute list, and profile replace the previous version outright, with no undo. Sidecar compares what it's asked to sign against what it last signed for you and stops to tell you exactly what would be lost.
• Zaps strike — a bolt of lightning crosses the page on every payment, drawn fresh each time. Turn it off in Settings.
• Tap your balance to cycle sats, BTC, and your local currency, on the wallet card and the pinned bar. Sixteen currencies.
• A 24-hour bitcoin price chart on the wallet card.
• Search — paste an npub, note, nevent, naddr or a name@domain address and it opens in your preferred client. Type a name and it suggests people as you go, starting with your follows.
• Two new themes — Aegean (Greek whitewash and cobalt) and Brownstone (New York sandstone after dark). Five in total.
• Auto Zaps now work — small zaps within your limit go through with nothing to approve, defaulting to 200 sats a zap and 20,000 a day, hard-capped at 1,000 and 100,000.
