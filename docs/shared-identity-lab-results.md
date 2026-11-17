# Shared-identity lab: results, and the errors that shaped the fixes

This records the last stretch of the graduated-approvals branch: what was wrong on a site where two of your accounts are signed in, how each problem was found, what was decided, and how it was checked. The lab that ran the cases ships with the branch at `test/manual/shared-identity-lab.html`, so any case here can be rerun.

Run on November 16, 2026, in an unpacked build, with two throwaway accounts on `pick.localhost`. **Every case that was judged passes, and the page recorded no wrong-signer hits.** Case 0.1 was left unticked; its three logins ran as intended (see the report below).

## The rule the branch now holds

On a site where both accounts are signed in, every sign card says “Confirm who’s posting each time.” and lets you pick the account from the capsule. A pick names the signer for **that one signature**. Nothing else moves: not Sidecar’s active account, not the account the site is pinned to. The next card opens as the account you came in with. Logging in is the one exception, where a pick is how the site learns who you are.

The row (“You’ve signed … 3 times in a row”) and the quiet hint (“Keep signing as …?”) offer a 30-minute window. They belong to the account the card opened as, because that account earned the count. A card showing a picked account carries neither, and picking back restores both.

## Errors found along the way, and what each decided

1. **`decision is not defined` on every shared-identity sign.** The one-shot change read `decision.switchToPubkey` at the end of `handleNostrRpc`, but `decision` is a `const` inside an earlier block. Found when the real-Chrome browser test failed with exactly that message; the previous session had died on a usage limit while chasing it. Fix: a request-level `pickedSwitch` flag, set where the pick is honored. Using the honored switch, not the raw pick, means a pick that was ignored (same account, or not in the pool) still counts as a confirmed default.
2. **Two source-text tests pinned the old condition.** One was already stale before this work; the other asserted that a pick rebinds the site, which is the opposite of one-shot. Both were rewritten, and a new test proves a pick moves neither the binding nor any window. The browser test now asserts the behavior itself (the follow-up card opens as the account you came in with) and fails on the old sticky code.
3. **The popup kept the wrong name.** Reading `prompt.js` to decide how the row and hint should react to a pick showed that the popup never redrew either after a pick, so it said “Keep signing as A?” on a card that would sign as B. The panel renamed them; the popup did nothing. Decision below.
4. **Forget site did not clear the approval count.** Two earlier commit titles claimed it, but neither handler did it. Found while writing the lab’s Forget case, which asks for exactly that. Left alone, the first card after a Forget would carry the earned row for a wiped site, and on a one-account host that row offers “Always sign”. Both “Forget site” and “Forget all sites” now clear it, and the handler tests fail without the calls.
5. **The approval lab described the old behavior.** Its case 3.6 said Sidecar’s active account becomes the picked one, and 3.7 started from “3.6 switched it”. A shared card defaults to Sidecar’s active account, not the site’s binding, so only the wording needed to change.
6. **“Missing host”.** A lab page opened as a file has no host, and Sidecar refuses every request from one instantly (the `<all_urls>` content script still injects `window.nostr`, so the page looks fine). The lab now shows a banner with the commands to serve it.

## Decisions

- **A pick is one-shot.** The user asked for it directly: choosing an account in the picker must not deposit them on a different account after a one-off signing. The login card keeps its sticky pick, because there the choice is the identity.
- **A pick hides the row and the hint; it does not rename them.** Renaming would offer the picked account a 30-minute window on a count it never earned, and a one-off pick is not the moment to open one. Hiding also fixes the popup bug with one rule on both surfaces, and it needs no extra data from the background.
- **A card that only asks Sign or Reject stays that way on a pick.** B’s own count still grows when B signs, so B earns its row at its own third signature, as the card’s default.

## What this changes for existing users

Nothing stored changes shape. The branch does not touch the permission, kind-grant or Auto-sign window stores, the keystore or the manifest, so there is no migration.

- **Unchanged:** the tier rule (trusted signs, blocked refuses, ask asks), standing kind grants, running windows, site bindings. The approval count lives in session storage, so nobody carries one in.
- **Changed:** a sign card on an “ask” site no longer has the scope row or the Trust button. The way to Trust all kinds from a card is gone; Trust remains in Activity → Connected sites and on login, decrypt and encrypt cards. A shared host can no longer create a new “Always sign” grant (an existing one still works). A pick on a shared card no longer moves Sidecar’s active account or the site’s binding. Forget now clears the count.

## Not covered

The lab times requests and checks signers, but cannot read a card, so the content checks are judged by hand. The en-XA pseudo-locale and the light theme were not run against the new cards.

## The lab report

```
Shared-identity lab · pick.localhost · 11/16/2026, 10:12:37 PM
Accounts: A (01f4345e), B (f373a78f)
Wrong-signer hits: 0

0.1 Sign in with both accounts, and finish on A: not judged
    9:54:58 PM  log in: ok in 2.04 s (card answered) · pubkey A (01f4345e)
    9:55:04 PM  log in: ok in 1.94 s (card answered) · pubkey B (f373a78f)
    9:55:30 PM  log in: ok in 6.98 s (card answered) · pubkey A (01f4345e)
1.1 The card confirms who is posting: PASS
    9:59:56 PM  note: ok in 2.20 s (card answered) · signed as A (01f4345e)   ✓ as expected
1.2 Picking B signs as B: PASS
    10:00:44 PM  note (pick B in the card): ok in 35.35 s (card answered) · signed as B (f373a78f)   ✓ as expected
1.3 After the pick, nothing has moved: PASS
    10:01:26 PM  note (no pick): ok in 2.29 s (card answered) · signed as A (01f4345e)   ✓ as expected
1.4 Every name stays on its own npub: PASS
    10:01:58 PM  note (read, then Reject): rejected in 19.98 s · You rejected this request   ✓ as expected
    10:02:14 PM  note (read, then Reject): rejected in 8.78 s · You rejected this request   ✓ as expected
2.1 The popup’s pick is one-shot too: PASS
    10:02:33 PM  note (pick B, popup): ok in 8.31 s (card answered) · signed as B (f373a78f)   ✓ as expected
2.2 The popup’s next card opens as A: PASS
    10:02:52 PM  note (no pick, popup): ok in 9.20 s (card answered) · signed as A (01f4345e)   ✓ as expected
2.3 The popup’s names stay on their own npub: PASS
    10:03:39 PM  note (read, then Reject, popup): rejected in 33.84 s · You rejected this request   ✓ as expected
3.1 Encrypt and login never carry the hint or the row: PASS
    10:05:20 PM  nip44.encrypt 1: rejected in 1.24 s · You rejected this request   ✓ as expected
    10:05:21 PM  nip44.encrypt 2: rejected in 0.88 s · You rejected this request   ✓ as expected
    10:05:22 PM  nip44.encrypt 3: rejected in 0.75 s · You rejected this request   ✓ as expected
    10:05:23 PM  nip44.encrypt 4: rejected in 1.03 s · You rejected this request   ✓ as expected
    10:05:26 PM  log in: ok in 1.54 s (card answered) · pubkey A (01f4345e)   ✓ as expected
3.2 The row arrives on the fourth reaction, and offers only the window: PASS
    10:05:38 PM  reaction 1: ok in 2.01 s (card answered) · signed as A (01f4345e)   ✓ as expected
    10:05:40 PM  reaction 2: ok in 2.35 s (card answered) · signed as A (01f4345e)   ✓ as expected
    10:05:42 PM  reaction 3: ok in 1.58 s (card answered) · signed as A (01f4345e)   ✓ as expected
    10:05:52 PM  reaction 4 (the row): ok in 7.33 s (card answered) · signed as A (01f4345e)   ✓ as expected
3.3 A pick hides the row, and picking back restores it: PASS
    10:06:18 PM  reaction (read, then Reject): rejected in 16.14 s · You rejected this request   ✓ as expected
3.4 The row’s window opens, and announces itself: PASS
    10:06:35 PM  reaction (30 min): ok in 4.85 s (card answered) · signed as A (01f4345e)   ✓ as expected
    10:06:41 PM  reaction 1: ok in 0.01 s (no card) · signed as A (01f4345e)   ✓ as expected
    10:06:41 PM  reaction 2: ok in 0.01 s (no card) · signed as A (01f4345e)   ✓ as expected
    10:06:41 PM  reaction 3: ok in 0.01 s (no card) · signed as A (01f4345e)   ✓ as expected
3.5 The quiet hint opens the same window: PASS
    10:07:04 PM  reaction 1: ok in 2.04 s (card answered) · signed as A (01f4345e)   ✓ as expected
    10:07:13 PM  reaction 2 (the hint): ok in 4.90 s (card answered) · signed as A (01f4345e)   ✓ as expected
    10:07:16 PM  reaction 1: ok in 0.00 s (no card) · signed as A (01f4345e)   ✓ as expected
    10:07:16 PM  reaction 2: ok in 0.01 s (no card) · signed as A (01f4345e)   ✓ as expected
4.1 Forget site starts the count over: PASS
    10:10:17 PM  note before Forget (read, then Reject): rejected in 1.63 s · You rejected this request   ✓ as expected
    10:10:28 PM  log in: ok in 1.16 s (card answered) · pubkey A (01f4345e)
    10:10:42 PM  note after Forget: ok in 1.58 s (card answered) · signed as A (01f4345e)   ✓ as expected
    10:10:56 PM  log in: ok in 2.14 s (card answered) · pubkey B (f373a78f)
5.1 A pick on a login card sticks: PASS
    10:11:24 PM  log in (pick B): ok in 4.55 s (card answered) · pubkey B (f373a78f)   ✓ as expected
    10:11:47 PM  log in (restore A): ok in 1.47 s (card answered) · pubkey A (01f4345e)   ✓ as expected
```
