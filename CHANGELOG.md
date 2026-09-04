# Changelog

All notable changes to Sidecar. This project follows [Keep a Changelog](https://keepachangelog.com/)
and [Semantic Versioning](https://semver.org/).

Release practice: the latest release's highlights are also summarized in-app, in the help
guide's **What's new** section (`help.html#whats-new`, linked from Settings → Updates).
Update that section alongside this file as part of every release.

## [1.12.0] — 2026-09-04

### Added
- **Reply from the notifications list.** A note or a comment can be answered without leaving Sidecar. The composer opens with what you are answering shown above the editor, and it stays there through Preview and through the review countdown, because the last screen before something publishes is the wrong place to lose sight of what it is a reply to. Replies to notes follow NIP-10, replies to page comments follow NIP-22, and the two are not interchangeable: answering a comment with a plain note lands outside the thread it was meant for. Not offered on reactions, reposts or zaps, which have no thread to join.
- **A web-of-trust filter for notifications.** Reply spam from fresh keys cannot be muted, because every mute is a denylist and a denylist cannot outrun key rotation. The bell now sorts by who your circle already vouches for: people you follow, plus anyone at least ten of your follows follow. Out-of-network notifications are collapsed into a counted group rather than hidden, and an empty or failed trust set means everyone is in network. Settings gains a Notifications section with a progress bar while the set is built.
- **Relay sign-in (NIP-42).** Sidecar can now answer a relay's authentication challenge. This never affected posting, since an event carries its own signature, but it affected reading: a relay that gates reads has no way to know who is asking, so relays like relay.nostr.build and nostr.land served the panel nothing at all. Answering is limited to the account's own relays, configured and declared; a relay reached through someone else's hint gets no answer, because identifying yourself to it is a disclosure.
- **Relay icons.** Each relay in the list shows its own icon, read from its NIP-11 document and falling back to the usual favicon paths.
- **Recent Activity can be verified.** Each signature now records its event id, and a row with one offers a tap-through that opens the signed event in your preferred client. The log recorded that something was signed and never what, which is precisely what "trust, but verify" needs.
- **A way back from a browser out of connections.** When Chrome exhausts its WebSocket budget nothing in the UI could rebuild the connections, and the only recovery was quitting the browser. A Reset connections button now appears under the balance when the failure is connection-shaped.

### Changed
- **Zap notifications say how much, far more often.** The amount was read only from the zap request's optional `amount` tag, which many wallets omit. It now falls back to the invoice, where the number has been all along. On a real inbox that took receipts showing an amount from 93 of 150 to all 150. A one-sat zap also reads "1 sat" rather than "1 sats", thousands are grouped, and a sub-sat zap says "<1 sat" instead of rounding to nothing.
- **Repost and reply marks are drawn, not emoji.** Emoji are painted by the operating system, so they ignore the theme and differ between machines. Those two now use the same bundled icon set as the rest of the panel and take their color from the theme. A reaction keeps the sender's own emoji, which is content rather than decoration.
- **The notifications header carries an identity only when there is a question.** With one account it repeated something you had never left; with several it is the only thing on screen saying whose list you are reading, since the sheet covers the account chip.
- **The composer grows with the panel** rather than staying at a fixed width, and closing it accidentally no longer loses what you were writing.

### Fixed
- **Sidecar told you a relay was down when your browser had run out of sockets.** A failed probe proves only that a connection could not be opened, and Sidecar turned that into "the relay looks down, not Sidecar", a claim it had no standing to make, and one that sent people to check a service that was fine. It now probes relays you already use as a control first, and only names a relay when at least one other answered.
- **Relay connections leaked until the browser ran dry.** The vendored library creates a socket and, when the connection times out, never closes it. One leaked per attempt, and once the browser's budget was gone nothing could connect: every relay reported a timeout while the same relays answered normally from outside the browser, and only restarting fixed it. Reported upstream as nbd-wtf/nostr-tools#550.
- **A signing request could hang with nothing on screen.** Only one approval shows at a time, and an approval handed to the panel that never rendered blocked every request behind it: no prompt, no error, no entry in Recent Activity, and the page waiting out its own three-minute timeout. Reactions and reposts appeared to do nothing at all.
- **Notification names showed as npubs.** Names were fetched one request per row across every relay at once, enough of which failed that the failures were cached as "this person has no name". They are fetched in one query for the whole page now, and a profile that arrives late fills in.
- **Your relay list could be replaced with Sidecar's defaults.** The panel could not tell "this account has published no relay list" from "the relays did not answer", so a timed-out lookup showed the app's shared default relays labelled as your own, and publishing from that screen would have overwritten a real list. The two are now distinguished, the last list actually seen is remembered, and Publish is disabled until a lookup succeeds.
- **Posts could fail with "No relays configured".** With use-only-my-relays on, a timed-out relay-list lookup produced an empty publish list, so the note went nowhere and the message blamed settings that were perfectly correct.
- **Custom relay lists in Werkstätte and elsewhere.** Round controls that had squared off, an approval avatar among them.

## [1.11.0] — 2026-08-31

### Added
- **The version number, where you need it and copyable.** It now sits at the bottom of the lock screen as well as in About, and a tap copies it — version numbers exist to be quoted back in a support thread, and reading one off a screen is where that goes wrong. On the lock screen it fades away after a few seconds, and comes back when you reach for it.
- **Something to look at where there's nothing.** An empty bookmark list, an empty notifications list, and the end of a list now carry a line from an early twentieth century writer rather than a blank panel. Twenty-one of them to begin with, from Wharton and Kafka through Woolf and Langston Hughes, and the collection grows a little every release.
- **Your npub as a QR code.** In the Profile tab and in an account's menu, so handing someone your key across a table no longer means reading out sixty-three characters. It encodes `nostr:npub1…` by default, which a Nostr client can open directly, and switches to the bare `npub1…` for a scanner that would only show a URI it cannot act on — the clients that draw these disagree about which to use, so Sidecar offers both.
- **The theme picker is a gallery.** Twelve themes had outgrown a list of name buttons that showed you nothing but their own display face. Settings now filters Dark or Light and shows six cards at a time, each one a live preview of its theme — the real field, the real wallet card, the real balance in the real display face, animating with that theme's own arrival when you pick it.
- **Relay health, on demand.** The Profile tab's relay list gains a Check relay health button. Every client that shows relay status shows whether a socket is open, which is nearly meaningless: a relay can complete the handshake and never answer, or serve reads and silently refuse your posts, and both look fine everywhere. This opens a socket, asks for one event, and waits for the answer — so a row can say it is healthy and fast, that it is gated behind payment or login, that it answers nothing, or that it is holding none of your notes, which is the one thing worth knowing before you drop it.
- **A new theme: Werkstätte.** The twelfth, and the second achromatic one: white-painted metal, near-black ink, and gold used the way the Wiener Werkstätte used it — as leaf laid onto a surface rather than as a color to write in. The field is Josef Hoffmann's *Gitterwerk*, the lattice of little squares that got him nicknamed Quadratl-Hoffmann, drawn here as a checkerboard with alternate cells inverted. Nothing in it is round except the things that have to be: faces, a count, an outcome, a spinner. Set in Syncopate, the capitals of a Secession poster, and the balance arrives gilded — each figure drawn as a hairline outline and then filled with gold, which is the actual order the work is done in.
- **A new theme: Metropolis.** Deco taken down to the machine floor — soot and concrete under shafts of light from somewhere above the frame, with tarnished brass as the only color in it. Set in Limelight, the capitals of a 1920s poster. When a balance arrives it strikes white, cools through pale gold, and settles into brass; nothing glows at rest, so the strike is the only light the theme spends.
- **A new theme: Par Avion.** The fifth light theme, and an airmail envelope from about 1935: the red-and-blue chevron running down both edges and across the top, a world map printed on the paper inside it, and one deep pen blue carrying every accent. The wallet card wears the same stripe border the theme takes its name from, and the map is wider than the panel — each time you unlock, the window has moved a leg further round the world. Display type is typed rather than set — Special Elite, a portable typewriter's ribbon — and so is the balance: each figure is struck onto the paper one character at a time, left to right, whole the instant it lands.
- **A new theme: Cast Iron.** Black metal taken all the way down — plates a step from void, no drawn outlines: boxes are announced by edge lighting and shadow alone. Every scrap of type is set in Impressed Metal, a groove-outline face whose letters read as the impression a stamp leaves in the plate; figures arrive under a press and settle slightly crooked, like hand-struck marks. No white ink anywhere — the quietest thing in the picker.
- **Restart for the auto-sign timer.** While a relaxed-permissions window runs, the bottom bar's arrow button winds the countdown back to its full original duration — the same act as tapping the relax chips again, without leaving what you were doing. Each theme paints the restart disc in its own quieter register so it never competes with End.

### Changed
- **Reduce motion covers the lightning bolt.** The setting scoped itself to the wallet balance and countdowns, so the loudest animation in the app — a bolt drawn across the whole panel, and across the page — still fired at someone who had just asked for less movement. It now covers all of it. The separate Payment animation switch stays, because wanting no bolt is not the same as wanting no animation anywhere.
- **Balances can re-hide themselves after a reveal.** Tapping the eye to check an amount unmasks the wallet until you mask it again, which is fine at your desk and less so anywhere else. A new switch under Wallet & payments makes a reveal expire instead: 30 seconds, then it masks again and says so, with nothing counting down beside the figure. Off by default — the eye behaves exactly as it always has. Whether balances are masked to begin with is now a switch in the same place, rather than only reachable from the eye on the balance card.
- **Settings is organized into collapsible sections.** The single long scroll is now eight labeled ones — Appearance, Posting, Apps & browsing, Wallet & payments, Relays, Security & backup, Developer (dev builds only), Sharing & updates — with one open at a time (Appearance on first run) and your choice remembered. The danger zone stays outside every section at the bottom: a reset is never behind a toggle.

### Fixed
- **The logo could be dragged off the page.** Grabbing the Sidecar mark on the lock screen, in a panel footer, or in About peeled off a translucent copy and dragged it around. It stays where it is now.
- **Bookmarks were in no order at all.** They were shown in the order the tags happened to sit in, which is not an order: the list is rewritten wholesale by whichever client last touched it, and no two agree on where a new entry goes. The same bookmarks read one way in Sidecar and another everywhere else. They are sorted newest first now, which is what every other client shows. Removing your last bookmark also used to leave the panel blank.
- **The Wallet tab could go blank and stay blank.** Reloading the panel did not help; switching accounts and back did. The panel's channel to its background worker had no way to fail — no timeout, and a worker torn down mid-request simply never answered — so the tab waited forever on a reply that was not coming, with nothing on screen to say so. It now gives up, says what happened, and offers to try again. The approval window shared the same fault, where it mattered more: a stuck prompt left an approval you could neither grant nor refuse.
- **NIP-05 said the same thing about six different outcomes.** One orange badge covered everything, and it had the severity backwards in both directions: someone offline saw an alarm on a perfectly good address, while someone whose address had come to point at a different key saw the same mild warning and no reason to act. Being unable to check now looks like not knowing, and an address that resolves to someone else looks like the problem it is. It is also checked once and remembered, rather than on every render.
- **Choosing an account had no way out.** Tapping a different account asks you to tap again to confirm, and nothing offered to cancel — the second tap was the only way to clear it, and it switched accounts. Both switchers, the Accounts tab and the one in the header, now offer a cancel for as long as the row is asking.
- **Zaps read as zaps in the wallet.** A Lightning zap carries the whole kind 9734 event as its invoice description, and the wallet printed it: a row of raw JSON where a name should be. Zaps now show as “Zap from alice” with whatever the zapper typed underneath, resolving the name from the profile cache and falling back to a short npub until it lands. Wallets differ on where they put the zap request — the invoice description or the transaction metadata — so both are read. Any other JSON-object description also stopped printing raw. (#243)
- **Zaps you send read as zaps too.** The other half of the above, and it needed a different answer: a zap you send commits to its request by hash, so the kind 9734 never travels with the payment and the wallet that paid it genuinely does not know who it paid. Sidecar signed that request seconds earlier, so it remembers the recipient and the row can say who — with their name and face — instead of a bare Sent.
- **Site payment budgets are readable while balances are hidden.** Hiding balances masked the budget row too, leaving “•••• of •••• sats left today” — a limit you set for one site, blanked out on the screen you visit to check it. Balances and transaction amounts still mask; a cap you chose is not a holding.
- **The auto-zap card stopped offering a switch that turned off something else.** “Don’t show this prompt again” on an auto-zap receipt wrote a setting the auto card never reads, so it kept appearing while the manual “Pay with Sidecar” card silently disappeared. The switch is gone from that card; manual cards keep it, where it is accurate. (#208)
- **The wallet balance no longer replays its animation for no reason.** Signing anything while the Wallet tab was open re-ran the balance's arrival animation on a figure that hadn't moved, and closing any wallet modal did the same. The panel was tracking "has this balance changed?" by remembering the element it last painted, so rebuilding the card — which happens whenever an approval settles or a modal closes — looked identical to a brand-new balance. It now remembers the figure per surface and per account, so the animation is spent on a balance that actually changed, on arriving at the tab, and on switching accounts.

## [1.10.0] — 2026-08-26

### Added
- **Two new themes: Nixie and Populuxe.** Nixie is the fourth dark theme — red-hot digits behind a wire screen, every figure striking through its change points and settling like a real tube. Populuxe is the fourth light one and the first theme where every ink passes WCAG AA against its background: a chrome-and-tile diner built on Rowdies, with a balance that pops in from the center and bounces. (#225, #232)
- **Balance animations with each theme's own character — and a switch to turn them off.** The figure now arrives the way the theme says it should: Nixie's digits strike and settle, Brownstone's balance is lit by gaslamp, Bauhaus splits into glyphs with its blue comma, Film Noir holds a steady figure. The countdown rings got the same treatment, including a glowing ring for Nixie. A Settings switch turns balance animations off entirely, and Reduce Motion is respected everywhere. (#226)
- **Bookmarks.** A topbar button showing the bookmark lists other clients write for your account (NIP-51 kinds 10003/10004), read from your relays — entries open at your preferred client, and each list can be cleared or removed. (#230)
- **Mute lists work in notifications.** A mute list written by any client carries four kinds of entry — muted people, hashtags, muted words, and muted threads — and Sidecar was reading only the people. Words, hashtags, and threads now hide notifications, including words that appear only in a sender's display name, which is where a key-rotating campaign puts its keyword; late-arriving names are pruned from the open bell, the cache, and the unread count as soon as they resolve. (#233, #234)
- **An invoice the page copies to its own clipboard gets the pay card.** Sites that generate an invoice into the clipboard (instead of the page) used to leave you hunting for it; the card now appears when that copy happens, same rules as an invoice in the page. (#223)
- **Send resolves a Lightning address before asking for an amount.** Typing an @address into Send now resolves it up front — you see the recipient's real address before committing, rather than discovering a typo after typing an amount. (#221)
- **New apps and clients in the directory:** JANK and Nostrich as note-viewing clients, NostrHub in the app catalog. (#222)

### Fixed
- **The bio editor sizes itself to your bio.** Both bio fields — the profile editor and the setup wizard's — opened at a fixed three lines, leaving the native resize corner as the only way to see a long bio while editing it. The field now opens sized to what's there, grows as you type, and scrolls internally past half the panel so the save button stays reachable. (#236)
- **A PIN change no longer orphans your wallet.** The NWC connection string was stored encrypted under the old PIN-derived key, and a PIN change re-wrapped the accounts but not the wallet — the wallet looked connected and could never be read again. Connections are now re-wrapped with everything else. (#218)
- **Automatic zaps only where you're connected.** An invoice embedded on a page you've never signed in with can't be auto-paid, whatever its size against the auto-zap cap: the payment path now requires an actual site connection, checked in the background rather than trusted from the page. (#235)
- **The signing prompt settles what it's signing before it asks.** A malformed signEvent request reached the approval card as a blank with Allow looking as ordinary as ever; the shape is validated at the boundary now, and the composer derives the quote tags a proper quote needs. (#219)
- **Backups say when, confirm what a restore overwrites, and count what's real.** Restoring shows what will be replaced and asks; the numbers reported are the counts that actually matched. (#228)
- **Toasts rise above the bottom chrome, and a tap dismisses them.** They were clipped behind the composer bar; now they clear it and can be sent away. (#227)
- **The wallet card's corner buttons are clickable where they appear.** Their hit area sat under the balance figure's; taps landed on nothing. (#229)
- **The fiat symbol and the balance figure are right in every theme.** The currency symbol was being dropped on some paints and rendered illegibly in others; the figure now centers by its ink, and holds one length regardless of digit count. (#232)

### Changed
- **The vault is behind key slots.** One random data key now encrypts everything, and each unlock factor (your PIN, today) wraps that key rather than the secrets directly. Adding or changing an unlock factor re-wraps 32 bytes and no ciphertext moves — the architecture that made the NWC re-wrap bug possible is gone. You'll notice nothing; future unlock factors will ride on it. (#220)
- **AMO submissions ship a reproducible source archive.** Packaging is deterministic — same tag, same bytes, published hash verifiable by anyone — and the source bundle accompanies every Firefox upload. (#231)

## [1.9.1] — 2026-08-19

*1.9.0 was packaged and tagged but never released; everything below ships here instead.*

### Added
- **A printable backup sheet for a new key.** After you've set a name, picture and bio, Sidecar offers a one-page PDF holding the key it just generated — styled as an old-fashioned telegram, set in Courier, generated entirely in the browser with no library and no network call. The nsec is on it twice: as selectable text you can copy, and as a QR you can scan back in. A serial derived from the npub (`NP-AEH2ZW-CQ4NWX`) lets you tell one sheet from another, and match a sheet to an identity, without revealing anything secret. The tinted paper stock is an optional content group set to off for printing, so it looks like a telegram on screen without flooding a printer with ink; the border carries the color instead. Dismissible — it interrupts once, at the only moment the key is new and unsaved. (#175)
- **Import a key by scanning the backup sheet.** Four ways in, because the sheet is only useful if it reads back: upload a photo or screenshot of it, upload the PDF itself, paste an image straight from the clipboard, or scan the sheet live with your camera. The camera runs in its own popup window rather than the side panel — a side panel can't surface a camera permission prompt, so the button there would have failed silently forever. Decoding happens locally; nothing is uploaded. (#182, #183)
- **Account overview.** A collapsible drawer under the active account showing what's actually configured for it: following count, unread alerts, relay count, NIP-05, Lightning address, and whether a wallet is connected *and* backed up. Each unset field links to the part of the guide that explains what it is and why you'd want it, rather than just reporting a blank. (#173)
- **Bootstrap relays can be turned off, per account.** Sidecar seeds a small default relay set so a brand-new key can reach the network at all. Once you've published your own relay list from the Profile tab, Sidecar offers to stop using the defaults for that account and read and publish only through the relays you declared. Set per account, not globally — see below for why that distinction is load-bearing. (#173, #186)
- **A way out of a payment that looks stuck.** A zap that hasn't confirmed after 15 seconds now offers to stop waiting, instead of leaving you watching a spinner for the full timeout. Stopping only stops *watching*: the payment is still in flight, and the card says so rather than claiming it failed. (#180)
- **`relay-doctor`, a NIP-65 auditor for the command line.** Checks a relay set for liveness and for whether it will actually deliver — a relay that accepts your connection but refuses your events, or serves reads but not writes, looks healthy in every client and quietly costs you posts. Reports healthy / gated / auth-gated / not-serving / down per relay, plus size and mailbox-deliverability advisories. No dependencies, and it never handles a private key. Documented in `docs/relay-doctor.md`.
- **A locked second page in the backup sheet.** The printed key sheet can also carry the nsec as a password-encrypted ncryptsec, typeset to pass for a masquerade invitation — safe to file next to the paper original, useless to anyone without the password. A save picker for the PDF keeps it off the downloads shelf, and the decryption work runs in a worker so importing one no longer freezes the panel. (#206)
- **WebLN reads ask first.** Balance, node info, and invoice creation used to run with no consent moment whenever the keystore was unlocked: a page you'd never approved at any tier could silently read your wallet balance, and that first call bound the host to your account, so a prompt could never appear later either. Reads now ask once per site and account; the answer lasts the session and ends at lock — unlocking isn't consent to a session of reads. Trusted sites stay silent, as the tier treats every other method. (#201)
- **"Forget all sites."** The records tying sites to identities — permission tiers for every account, which account each site signs in as, shared-sign-in history, and the site rows of the activity log — were otherwise permanent, and the site maps had no cap. One button under the Connected sites list in the Activity tab now sweeps all of them in a step. Accounts, keys, wallets, and drafts are untouched; every site simply asks again. (#212)
- **Three additions to the app directory** — Circl, SatsList's official mark, and a proper tile for Nostr Archives.

### Fixed
- **The wallet no longer dies on a dropped connection.** The NWC client cached a pool whose socket had closed, and nostr-tools defaults `enableReconnect` to false, so once that socket died the client reused the corpse forever — every payment and balance check failed until the service worker happened to be evicted and rebuilt it. Recovery was accidental, which is why it read as intermittent. Reconnect is now on, and a request that publishes nothing is named as a lost connection rather than a silent wallet. (#178, #185)
- **NIP-65 only was a single global switch, and it fails closed.** With it on, publishing uses only the account's declared write relays and never falls back to the defaults — correct for an account that has published a relay list, and fatal for one that hasn't. Turning it on for one identity left every other identity with an empty publish set, unable to post at all, deterministically, until it came back off. Now stored per account. (#186)
- **The overview's relay count didn't say which relays it counted.** It reported only the declared NIP-65 set, so an account that had never published a relay list showed `0` while reading and writing perfectly well through the bootstrap relays — and `0` reads as broken, not as "using defaults." An account that *had* published saw a number that didn't match Settings, with nothing on either screen explaining that the two measure different sets. The count now names its source, and the one case where zero is genuinely a fault is flagged as one. (#186)
- **The Accounts overview no longer goes stale.** Connecting or removing a wallet refreshed the Wallet tab but not the overview drawer, which kept showing the old state — a removed wallet still badged as connected — until something else happened to re-render the panel. Switching to the Accounts tab now re-renders it, the same as the other tabs already did. (#214)
- **Profile's Backup & restore no longer lets a data backup pose as a key backup.** The download button says plainly that the file holds your data and never your secret key — "no secret key" in the toast too — and exporting the key itself (copyable text, encrypted ncryptsec, or the printed sheet) now lives in the same section behind one button, mirroring the Accounts screen instead of hiding in a settings row. (#214)
- **The composer previews a quote nested inside a quoted note,** which previously rendered blank, and no longer pads block items (quotes, images) with stray blank lines. (#209)

### Changed
- **The help guide's navigation is a dropdown.** The section list had grown long enough to push the guide's actual content below the fold. Sections now collapse into a menu in the guide's own visual style, with Nostr apps and Wallets kept outside it as the two destinations people arrive looking for. (#173)
- **The wallet quick-start points at the wallet directory.** With no wallet connected, the route to the full list of options was buried below the Rizful quick-start; it now sits in the same card. (#173)
- **Store packages no longer carry `docs/`.** Release guides, store descriptions and internal notes were being zipped into the uploaded build.
- **Unsent drafts and payment notes are encrypted at rest,** under the same PIN-derived key that protects your keys — readable only while Sidecar is unlocked, unreadable from the browser profile alone. Drafts and notes saved by an earlier version migrate on first access after the update, and changing your PIN re-wraps them with the vault in one write. Forgetting sites or clearing the activity log does not erase them. (#213)
- **Approvals say what they cover.** A decrypt approval now states what "Trust this site" means for your DMs — the site silently reads every future one until you revoke it, the sharpest edge of the tier and one the UI never named. WebLN read prompts' button says the grant lasts this session, and the note explaining that one Allow covers a decrypt burst appears on the cards it describes. (#201, #211)
- **The Nostr Archives name index is opt-in.** The first time an @-mention search would query it, Sidecar asks — nothing is sent until you agree — and the answer can be changed or revoked from the search bar's scope chip or in Settings. A chip on the search box now also shows whether the current search is local (your follows) or global (the index). (#205)

### Security
- **The RPC host comes from the sender's own URL, never the message body.** A page can't act under another site's trust tier, relax window, or decrypt grant, even if a future content-script refactor ever forwarded a page-influenced field. (#202)
- **`externally_connectable` is denied outright** in the manifest, and the keystore, wallet, owner-crypto, and prompt handlers additionally hard-require an extension-page sender for everything a content script doesn't legitimately need — so no content-script bug can pivot a hostile page into signing, key reveal, or unlocking. (#204)
- **Three low-risk paths hardened.** LNURL-pay callbacks must be https (an http:// one leaks payment metadata in cleartext and is MITM-swappable); the right-click QR image fetch passes through the same private-network guard as every other service-worker fetch; and a crafted ncryptsec carrying an outsized scrypt work factor is rejected before it can ask for gigabytes of memory. (#203)
- **The raw wallet string stays in the worker.** Code that only needs to know whether a wallet is connected — or to back one up to relays — now asks for metadata or worker-encrypted ciphertext instead of the connection string; the string itself answers to the side panel alone, and the backup encryption is NIP-44 only, with no silent fallback to the older, weaker scheme. (#200)

## [1.8.0] — 2026-08-12

### Added
- **Sixth theme: Bauhaus.** Flat planes of primary color, black rule lines, and a Futura-lineage display face — the school's own geometric sans. White walls instead of cream keep it unmistakably separate from Art Deco. In Settings → Theme. (#170)
- **Every theme now has its own display font.** Each of the six themes is set in a typeface from a different category — Playfair (Didone serif), Oswald (condensed grotesque), Bitter (slab serif), Josefin Sans (1920s geometric), Cinzel (Roman caps), Jost (Futura geometric). The theme picker reads as a type specimen: each card shows its name in the face you'd get by choosing it. (#170)
- **A distinct icon per event kind in Recent activity.** Reactions, zaps, reposts, mentions and replies each carry their own glyph instead of sharing a single feather. (#164)
- **"Wrong account?" escape on the signing prompt.** When a site is signed in with more than one of your accounts, the approval prompt says so and lets you switch — without closing the prompt, losing the request, or reloading the page. (#169)

### Fixed
- **A signing approval now outranks any open modal.** With notifications, the composer, or settings open, a signing request could be hidden behind the modal — invisible and impossible to reject. The approval overlay now closes any open modal before showing itself. (#168)
- **A signing request the sleeping service worker never received is retried.** The MV3 service worker can be evicted mid-message; the request now reaches the signer on a second attempt instead of hanging. (#167)
- **Relay connections are no longer exhausted.** A connection leak could leave the wallet and publisher unable to reach any relay until a reload; publish failures now say something useful instead of reporting success. (#166)
- **The panel no longer repaints behind an open overlay.** A deferred render was firing through the modal, causing a flash of stale account names behind the approval prompt. (#165)
- **One NWC pool per client — the wallet no longer dies until a reload.** (#162)
- **Copied secrets are cleared from the clipboard after 60 seconds.** An exported nsec or ncryptsec left on the clipboard is now removed automatically. (#163)
- **Wallet view no longer flashes on zap; the composer background is stable across theme switches.** (#161)
- **Drag-to-reorder works at the top and bottom of the list.** (#160)
- **Relax exclusion is looser for replaceable kinds.** App-settings syncs, DM inbox loads and other background work that the user didn't initiate no longer prompt during a relax window, while notes, reactions and DMs still confirm. (#160)
- **Follow count and @-mention list now read the account's NIP-65 relays.** The profile's follow count and the follow list behind @-mentions were querying only the user's configured relays, missing the healthy kind:3 that lives on NIP-65 declared relays when a configured relay holds a stale or wiped copy. The same gap let a zero-follow event seed the destructive-guard baseline, which would have suppressed the wipe warning for the next real kind:3. (#172)

### Changed
- **Art Deco contrast fixed.** The gold accent ink was 1.67:1 as text on cream — the lightning address, the relax countdown, and the About links were effectively unreadable. The bright metallic is now fill-only; a deep bronze carries all text at 5.23:1. (#170)
- **Film Noir background reworked.** The Victorian filigree tile is replaced by venetian-blind stripes — the genre's own signature, rendered as one resolution-independent gradient. (#170)
- **Relax countdown dots are visible on light themes.** Both dot colors were tuned for dark surfaces and measured 1.28–1.74:1 on light theme status bars — invisible. Each light theme now uses its own success and warning values. (#170)

## [1.7.0] — 2026-07-29

### Added
- **Comment on any webpage.** A speech-bubble icon in the top bar opens a composer addressed to the page you're reading, publishing a kind 1111 comment (NIP-22) tagged with the page's URL (NIP-73). Mentions work — type `@` and tag someone the same way you do in a note; the person tagged gets a `p` tag and will be notified. A link card fetched from the page sits above the editor so you can always see what you're commenting on, and the review countdown (the same one notes use) fires before it goes out. Since almost nothing but Jumble renders a kind 1111 over a web target today, both links after posting — view your comment, and see all comments on the page — point there, named explicitly. (#156, #159)
- **Quick-start a Lightning wallet.** When you don't have a wallet connected, the wallet screen offers a quick start through Rizful: enter a one-time code, and Sidecar receives an NWC connection string — no separate app, no manual paste. A Lightning address comes back with it. For users who already have a wallet, the same screen still offers manual NWC entry and relay restore as before. (#152)
- **Historical price chart with hover.** The wallet's price chart now shows more than the last 24 hours, and a hover indicator tracks the price at any point along the curve. (#155)
- **Add an account from the dropdown.** The account switcher's dropdown now carries an "Add account" link alongside the accounts panel, so you don't have to navigate to settings to bring in a second identity. (#155)
- **Review countdown for comments.** Comments go through the same review window as notes — a ring counts down, with the page card and comment text visible for a last look. Reads the same "Review countdown before posting" setting; no separate toggle. (#159)
- **Tracker stripping for web comments.** The comment's target URL is normalized before tagging — fragment stripped, query sorted, host case-folded — so share links with different tracking parameters don't fork the same page into separate threads. The whole `utm_` family is matched by prefix (not just the common six), plus ~20 more exact params, and YouTube's share token `si` is stripped on YouTube only. (#159)
- **Comment drafts.** A stray click outside the modal no longer loses a half-written comment. The draft is held in memory, keyed by account and page URL, and restored when you reopen the modal on the same page. Nothing is written to disk — a comment belongs to a page you're looking at, not a permanent record. (#159)

### Fixed
- **Smarter wallet backup.** The check was a bare existence test — any backup event on your relays read as "Backed up ✓". Sidecar now decrypts the backup and compares it to the wallet actually connected, reporting four states: backed up, not backed up, a different wallet is backed up, or couldn't check. Both Back up and Restore warn before overwriting a different wallet, pointing at Restore (not Export) for recovery — Export reveals the *connected* wallet, so it would save the wrong string. (#158)
- **Restoring a wallet showed the previous wallet's balance.** The NWC client was cached under the account alone, so swapping wallets within one account (Restore, or connecting a different string) handed back a client still pointed at the wallet you'd just replaced. A restored wallet with 400 sats displayed 0 until you removed and re-imported the same string. Now keyed on the connection, fixed at the choke point so every writer path is covered. (#158)
- **Keystore lost-update race.** Concurrent writes to `chrome.storage` could silently overwrite each other — the last writer won, every time. The vault-import avatar bug (imported accounts showed no profile pictures until a reload) was the visible symptom: a profile write and an account-list write racing. All keystore writes are now serialized through a single promise chain. (#154)
- **Vault import loads profile pictures immediately.** The race above meant a freshly imported account's profile fetch landed and was stored, then got overwritten by the stale account list. Fixed by the serialization, plus a bounded retry on the profile fetch so a slow relay doesn't leave a placeholder name permanently. (#154)
- **Interface text is no longer selectable.** Dragging across the panel highlighted tab labels, headings and button text, reading as a web page rather than an app. Chrome is unselectable by default; content — identifiers, prose, form fields, balances — opts back in. (#157)

### Changed
- **Comment button icon.** Feather's message-square-with-dots replaced by message-circle, scaled 1.10× to match the optical weight of the neighboring search and help icons. The dots collapsed to a smudge at the topbar's 19px. (#159)
- **WALLET_BACKENDS.md** documents the public reasoning behind the wallet-backend decisions: Breez Spark ruled out (Firefox/11 MB/API key/CSP), Cashu/NIP-60 ruled out (no Lightning address, no zaps), Bitcoin Connect ruled out, and NWC-first with Rizful as the on-ramp. (#152)

## [1.6.0] — 2026-07-28

### Added
- **Zap animations.** A bolt of lightning strikes across the page whenever a payment goes out — procedurally drawn, never the same twice. It fires for zaps sent from a client's own UI as well as from Sidecar, and can be turned off in Settings.
- **Tap the balance to change units.** The wallet balance and the pinned balance bar cycle through sats, BTC, and your local currency on tap. Pick the currency in Settings or from the wallet screen; sixteen are supported, defaulting to USD.
- **24-hour bitcoin price chart.** A round button on the wallet card opens a gradient-filled chart of the last 24 hours against your chosen currency.
- **A warning before an app erases your data.** Follow lists, mute lists, and profiles are *replaceable* events: a new version wholly replaces the old one, with no merge and no undo, so a buggy or careless client can wipe years of follows in a single signature. Sidecar now compares what it's being asked to sign against what it last signed for you and stops to warn you — in plain language, naming what would be lost — before an event that would erase your follows, your mutes, or fields from your profile. The approval buttons stay disabled until you acknowledge it, a timed relax window can't wave it through, and the check is entirely local, so it costs no network time.
- **Auto Zaps now cover the whole zap.** Previously it never fired at all: it looked for the zap request inside the invoice's description, but NIP-57 issues description-*hash* invoices, so that field is empty on every spec-compliant zap. Sidecar now matches the payment against the zap request it signed for you moments earlier — same site, same account, same amount — and, when the amount is within your limits, signs and pays without a prompt or a payment card. Starts at 200 sats per zap and 20,000 per day, with a hard ceiling of 1,000 and 100,000 that holds whatever you type into the settings. When a zap is small enough to qualify, the payment card offers to switch Auto Zaps on — confirmed on Sidecar's own approval screen, never written on a page's say-so.
- **The Bitcoin Connect modal closes itself.** A zap paid from Sidecar's card settled with the page none the wiser — the invoice was read from the page and paid over NWC, so the client's modal sat spinning on an invoice that had already gone through. Sidecar now tells the modal its payment landed.
- **Refresh your profile from the Profile screen** — the circular arrow now actually re-fetches, for when a change made elsewhere hasn't reached Sidecar yet.
- **Search.** A magnifier in the top bar opens a search field: paste an `npub`, `note`, `nevent` or `naddr` and it opens in whichever client you've set as your preferred one, then closes itself. Type a name instead and it suggests people as you go — your follows first, then a wider search. A NIP-05 address (`name@domain`) resolves against that domain directly. Pasted client links work too, so a `njump.me` or `primal.net` link someone sent you reopens in the client you actually use. Identifiers are decoded locally, with no lookup service involved, so that path can't hang or leak what you searched for. Room for the icon came from dropping the account name out of the bar — it's in the chip's tooltip now, and the switcher still lists it. (#150)
- **Two new themes, bringing the total to five.** *Aegean* — whitewashed plaster, cobalt doors and sun-bleached stone, with the Greek key running behind the panel; Sidecar's second light theme after Art Deco. *Brownstone* — New York sandstone after dark: warm stone, lamplight gold, ivy green and black iron, over a tile of interlocking masonry courses. Both ship with matching palettes for the in-page payment card.

### Fixed
- **Notes could be signed, reported as posted, and published nowhere.** Two faults compounded: Sidecar published only to the write relays declared in your relay list, so if those lapsed or gated on a web of trust the note had nowhere else to go; and a relay that couldn't be reached was being counted as a successful publish, so no error was ever raised. Posts now go to those relays *and* the ones configured in Settings, and an unreachable relay is reported as the failure it is, naming each relay and why. The same faults affected profile edits, relay-list updates, and follow lists.
- **Payments could succeed while the page was told they failed** — or left waiting up to three minutes. Approving a payment canceled the keepalive at the moment the money moved, and a lost confirmation from the wallet was being read as a failed payment. Sidecar now holds itself awake for the whole payment and asks the wallet what actually happened rather than inferring it from silence, so the answer arrives in seconds and is the truth.
- **The approval popup no longer hides the PIN field, the auto-sign options, or the site asking.** On a long request the PIN scrolled out of view beneath the button demanding it — and because the field takes focus automatically, the popup opened scrolled to the bottom, pushing the site name and the multiple-accounts warning off-screen. Everything you act on now sits below the fold line, and a wrong-PIN message appears against the PIN field instead of down beside the buttons.
- **A hidden wallet balance no longer leaks its own size.** The mask drew one dot per character, so the number of dots told you the order of magnitude of the balance you'd just hidden. Every hidden balance now shows a fixed four, in the same color the number itself is drawn in for that theme.
- **The reload notice can be dismissed.** The banner asking you to reload the page after an account switch now carries an X.
- **Outgoing payment toasts name the amount** instead of a bare "Payment sent".
- **Repeated actions no longer stack duplicate toasts.**
- **Sidecar's own pages reuse their tab.** Clicking the help icon opened a second help tab with one already open; the same went for What's new, the switching guide, the welcome page, and the wallet guide.
- **Firefox Add-ons links point at the real listing.** (#133)

### Changed
- **Art Deco is gold and tan rather than purple.** The theme's accents, buttons and chart all pull from the same warm palette as its border; only the Sidecar logo keeps its original color.
- **Every theme's background pattern is centered** rather than anchored to the top-left, so the tile is no longer clipped along one edge.
- The help guide documents relax mode and the new data-erasure warning, with screenshots.
- The payment card's toggle now reads **"Don't show this prompt again"** and starts off, rather than "Show this automatically" starting on. Same setting, stated the way you'd actually think about it.

## [1.5.1] — 2026-07-24

### Added
- **Relax mode.** Timed auto-sign window (5, 15, or 30 minutes) for trusted sites. A persistent status bar counts down the remaining time with an End button to revoke early. Resolves the friction of approving every action during active sessions on shared hosts.
- **Pinned wallet balance bar.** Lightning balance is pinned to the panel and visible at all times, not just from the wallet section. Incoming payments update automatically via NIP-47 notifications (with a 30-second polling fallback) and trigger a gold glow pulse on the balance number. Appears immediately on wallet connect or restore. Unpin with a single click.

### Changed
- Tightened the switch-account tip and wallet onboarding copy for clarity.
- Shortened the shared-identity heads-up blurb shown during signing approvals.
- **Film Noir's balance numbers are now gold** (matching Speakeasy) instead of silver, so Lightning amounts read warm even in the monochrome theme.

## [1.5.0] — 2026-07-21

### Added
- **Firefox support.** The full signer — multi-account, NIP-07, the built-in Lightning wallet, and the approval flow — now runs on Firefox 128+ at parity with the Chrome build, from a single shared codebase. On Firefox, Sidecar lives in the sidebar rather than the side panel, and (because Firefox lets you decline site access at install) offers a one-click grant from the panel if you skipped it. Distributed through Firefox Add-ons (AMO).
- **Three themes, selectable in Settings.** **Speakeasy** (the original after-hours velvet) stays the default, joined by **Film Noir** (matte black-on-black with silver accents) and **Art Deco** (a daylight eggshell-and-bronze palette with a geometric pattern background). Your choice persists across sessions, and the injected "Pay with Sidecar" card on web pages adopts the same theme.

### Changed
- **Toasts now appear at the bottom** of the panel instead of dropping over the top menu, so a confirmation like "Unlocked" no longer covers the account switcher and toolbar for a few seconds.
- The follow-list recovery button is now labeled **"Follow List Recovery"**, matching what Mutable — the service that powers it — calls the feature.

### Fixed
- **Art Deco legibility pass.** On the light theme, several elements colored for a dark backdrop were washing out: the key-backup box and its warning text, the signing-approval event preview and caution banner, the wallet balance and transaction colors, the NIP-05 verification badges, and the "Pay with Sidecar" card's logo, error, and paid states. All now read clearly against the eggshell background.
- **The Close button on an expired standalone approval popup now works.** Previously, when a request timed out in the popup shown with the sidebar closed, "Close" did nothing — the request had already been purged, so the approval message had nothing to act on and the window never closed. Close now dismisses the popup directly.

## [1.4.1] — 2026-07-16

### Added
- **Eight new apps in the welcome directory** — Flotilla, Tunestr, Wavlake, WaveFunc Radio, Boost Me Bitch, Cordn, Imwald, and ContextVM — and every app description got a copy pass for a consistent, scannable length. The same directory (and the wallet guide) is now published on the web at [sidecar.top/apps](https://sidecar.top/apps) and [sidecar.top/wallets](https://sidecar.top/wallets), generated from the extension's own list so the two never drift.

### Changed
- **Auto-lock now surfaces in the UI.** When the idle timer fires, the panel drops straight to the unlock screen with a "Locked due to inactivity" notice, instead of staying on whatever was open (a composer, a modal) and only revealing the lock on the next action. Composer typing counts as activity so auto-lock can't fire mid-draft, and unlocking directly from a key-reveal or export prompt now proceeds in one step.
- Quoted-note notifications use a lighter ornamental quote mark; the previous speech-bubble emoji rendered nearly black on the dark panel.
- The About screen's Privacy Policy and Support links use the site's extensionless URLs.

### Security
- **Every step-up PIN prompt now shares the unlock screen's brute-force protection.** The reveal-key, reveal-wallet, and change-PIN prompts use the same persisted guard as unlocking — escalating delays between wrong attempts and the self-erase on the final strike.

## [1.4.0] — 2026-07-11

### Added
- **Expandable signing preview** — the approval prompt now shows event content in a compact, expandable pane with **Formatted / Raw / JSON** views and a Show more / less toggle in every view. "Formatted" renders a note the way a client would (mentions as @-names, media, and note/nevent/naddr embeds), so long content — like a repost whose content is an embedded event — no longer pushes the "Signing as" account card off-screen.
- **Wider event-kind recognition** — the signing prompt now labels roughly 40 more event kinds (Blossom upload authorization, polls, user status, zap goals, labels, communities, wiki articles, starter packs, voice messages, and many NIP-51 lists and sets), so routine actions no longer show the "unrecognized kind" caution. A **request to vanish** (kind 62) now carries a delete-style heads-up.
- **"Save your PIN" reminder** — right after creating a PIN, a one-time modal prompts you to write it down or store it in a password manager before moving on. There's no recovery if it's forgotten, so this is the one moment to make sure it's actually captured somewhere durable.
- **In-app release notes** — the help guide's new "What's new" section summarizes each release's highlights, linked from the help nav and from a new "What's new in this version" link in Settings → Updates.

### Changed
- **nostr-tools updated to 2.23.11** (from 2.16.2) — roughly a year of upstream fixes; the vendored bundle remains the byte-exact official npm artifact, and the app's relay-subscription call sites were adapted to the newer single-filter API. Cross-version interop (NIP-04/NIP-44 ciphertexts, event signatures) verified.
- **QR codes are now rendered by `qrcode-generator` (MIT)** with a small first-party canvas adapter, replacing the GPL-3.0-licensed QRious library and resolving a license conflict with the project's MIT terms. Every QR type the app shows (keys, ncryptsec, Lightning addresses, invoices, wallet strings) verified end-to-end: encoded, then scanned back with the same decoder the app uses.
- The standalone popup and the in-panel approval now share the same event-kind labels, so kinds — including the NIP-17 DM setup events — are recognized consistently in both places.
- **Readable identities** — approval prompts show the encrypt/decrypt counterparty by name with its npub kept beneath as a verifiable key (a display name alone is spoofable). Click the npub to reveal the full, untruncated key; the raw hex is on hover. Other pubkey fallbacks now use npubs, not hex.
- **Reject Primal's NWC string** — Primal's wallet is Spark-based and only works inside Primal's own apps, so its Nostr Wallet Connect string can't drive an external wallet. Sidecar now detects it and explains why, instead of hanging on connect.

### Security
- **Auto-lock now defaults to 15 minutes of inactivity**, instead of never. It only counts down when nothing has been signed, paid, or unlocked in that window, so active use is unaffected — this only shrinks the window a decrypted keystore is left exposed on an unattended browser. Still adjustable (including back to Never) in Settings, and anyone who's already chosen a value there keeps it. Existing users who'd never chosen a value get a one-time notice that auto-lock is now on — with a reminder that the unlock PIN is unrecoverable — the first time the panel opens unlocked.
- **Auto-lock changes apply immediately.** Changing the timer in Settings now re-arms (or clears) the countdown on the spot; previously the new value only took effect after the next sign, payment, or unlock — so enabling auto-lock and walking away would never actually lock.
- **Web pages can no longer read Sidecar's full settings.** The settings read available to visited pages is now clamped to the pay-card toggle, matching the existing clamp on writes — a page could previously see the auto-lock timing, budget, and auto-zap configuration.
- **Vendored-bundle provenance** (addresses the community audit in [#106](https://github.com/dmnyc/sidecar/issues/106)) — `VENDOR.md` now records the exact npm package, version, license, and SHA-256 of every bundled third-party file; `scripts/update-vendor.sh` regenerates all of them from official registry artifacts, including a byte-reproducible `nip49.js` build; and CI verifies the hashes on every push and pull request, so tampering with vendored code is mechanically detectable. Also fixes the version drift between `manifest.json` and `package.json` and removes the misleading `devDependencies` entry.

### Fixed
- The PIN/confirm fields on the "create a keystore" screen no longer show a stale green checkmark next to an empty box after a reset (erase-everything, or the 21-failed-unlock auto-wipe) — the validity indicators now recompute when the fields are cleared, instead of only on typing.
- Turning the on-page "Pay with Sidecar" card off now sticks across page loads — the content script was reading the saved setting from the wrong spot in the reply, so only the live toggle push ever applied.
- Resuming a saved composer draft that contains a mention now correctly re-renders it as the resolved @name — the Write tab and the "Resume your draft?" preview previously showed the raw `nostr:npub…` string instead.

## [1.3.0] — 2026-07-09

### Added
- **Help & guides page** — a built-in guide (one click from the top bar) covering accounts, how sites remember who you are, switching accounts, the client families, and the wallet.
- **Full encrypted vault backup** — export every account *and* wallet connection into a single password-encrypted file, and restore it on another device.
- **NIP-49 (`ncryptsec`) key import/export**, plus a consolidated tabbed per-account backup screen. Revealed keys and connection strings show a scannable QR with its own auto-hide countdown; for the long wallet string the QR and text are an either/or view.
- **NIP-05 verification** — check a profile's identifier against its `/.well-known/nostr.json`.
- **Clearer signing prompt** — human-readable event-kind labels and a heads-up on unusual or unrecognized kinds (including the NIP-17 DM setup kinds).
- **Connected Sites & Activity** split into sub-tabs, each filterable by site and ordered by most-recent use.
- **Auto-zap daily cap** — a rolling daily total across all sites, alongside the existing per-zap limit.
- Configurable post-review countdown, more "open notes in" clients, an option to reuse an open client tab, a refreshed in-panel app directory, and a "share Sidecar with a friend" flow.

### Changed
- **Multi-account signing** — on sites where you've signed in with more than one account (Jumble, YakiHonne, Primal, …), every content sign confirms who's posting, so a client's own account switcher can't silently sign as the wrong key. Smoother inline account switching on first login, and an offer to reload the open client after you switch.
- **Window-correct approvals** — a signing prompt now appears on the browser window the requesting page lives in, not wherever a pinned panel or the last-focused window happens to be.
- **Quieter approvals** — repetitive background app-data syncs and DM-inbox loads are handled without a prompt for each (kind-based auto-allow for app settings, and a single approval that covers a decrypt burst), while notes, reactions, and DMs still confirm.
- **Notifications** open instantly and reconcile in the background, live-append while the bell is open, and refresh the mute list on every open.

### Security
- **Wallet spend limits** — auto-zap now enforces a daily aggregate cap, and payments are serialized per account, so a signed-in site can't drain the wallet by firing many sub-cap zaps or a concurrent burst (this also closes a check-then-pay race in the per-site budgets).
- **Message origin gate** — control messages (unlock, key reveal, owner sign/encrypt/decrypt, NWC) are restricted to an extension-page origin as defense-in-depth.
- The keystore **auto-erases after 21 failed unlocks**, with escalating backoff between attempts.

### Fixed
- Numerous panel polish and robustness fixes: the approval popup keeps its action buttons in view, revealing a secret no longer collapses a long site list, list expansion and scroll position survive live re-renders, and button spacing across the reveal and vault screens.

## [1.2.0] — 2026-07-03

### Added
- Guided setup wizard for newly generated accounts, with a live PIN strength and match check.
- Lightning address receive (LNURL-pay), a wallet address card, and one-tap profile↔wallet address sync.
- Global @-mention search (via Nostr Archives), and rendered mentions/media inside quoted notes.
- Follow-list recovery (powered by Mutable), a NIP-65 outbox relay editor, following count on the profile, a client-tag toggle, and check-for-updates in Settings/About.

### Security
- Hardened NIP-42 auto-signing, PIN strength enforcement, and OG-fetch SSRF handling.

---

Earlier releases (v1.1.x and v1.0.x) predate this changelog — see the
[git tags](https://github.com/dmnyc/sidecar/tags) and commit history.
