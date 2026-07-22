# Manual reproduction — cross-window account signing mismatch

`owner-sign.test.js` unit-covers the signing guard (the actual defect). The full
symptom is a **two-window** staleness that spans two panel contexts and can't be
reduced to a single unit test — reproduce it by hand.

## Setup
- Two accounts in Sidecar, **A** and **B**. Ideally give them *different* Blossom
  server lists (kind:10063) so the upload target is visually distinguishable.
- Open Sidecar in **two separate browser windows**. Each window has its own side
  panel / sidebar instance with its own in-memory `state.activePubkey`; the
  keystore's active account (`sidecar_active_pubkey`) is shared between them.

## Reproduce (before the fix)
1. In **Window 1**, make **B** active. Both windows show B.
2. In **Window 2**, switch the active account to **A**. Window 2 shows A.
3. Return to **Window 1** — it still shows **B** (it was never notified).
4. In Window 1, open the composer (it reads "Posting as B"), attach an image, and post.

**Buggy result:** the image uploads authed as **A** and the note publishes under
**A**, even though Window 1 showed B throughout — often with a broken thumbnail
from the auth/owner/server mismatch.

## Expected (after the fix)
- **Panel sync:** Window 1's `storage.onChanged` sees the `sidecar_active_pubkey`
  change and refreshes, so after step 2 it updates to show **A** — the display no
  longer lies about the active account.
- **Fail-closed signing:** if a signature is attempted while the composer's
  expected account (B) no longer matches the keystore's active account (A),
  `KS.ownerSign` throws ("Active account changed — not signing …") instead of
  silently signing as A. The note/upload fails with a clear error rather than
  going out under the wrong account.

## Root cause (for reference)
- The panel's displayed `state.activePubkey` refreshed only on that panel's own
  account switch; nothing re-synced it when another view changed the shared
  keystore active account. `storage.onChanged` explicitly ignored
  `sidecar_active_pubkey`, and `KS.setActive` sent no panel notification.
- Owner-signing (`SIDECAR_OWNER_SIGN`) always signed with the keystore's live
  active account and took no account from the caller — so a composer showing B
  could sign as A with no signal.

## Fix scope
Composer note publish + image/Blossom uploads now pass `expectedPubkey`, and the
panel re-syncs on active-pubkey storage changes. The remaining owner-sign call
sites (profile / relay-list / backup publishes) share the class but weren't the
reported bug — apply the same `expectedPubkey` pattern to them as a follow-up.
