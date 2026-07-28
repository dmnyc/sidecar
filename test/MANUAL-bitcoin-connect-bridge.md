# Manual verification — Bitcoin Connect settlement bridge

The bridge in `nostr-provider.js` closes a payment modal that Sidecar paid from
outside the page. It works by replaying what Bitcoin Connect's own `setPaid()`
does, and **that is an internal detail of the library, not published API**. If
Alby renames the event or restructures the element, the bridge silently stops
firing and the modal goes back to spinning — the same place it is without the
bridge, so nothing breaks, but nothing helps either. Re-check this after a
Bitcoin Connect version bump on any client you care about.

## What the bridge depends on

From `@getalby/bitcoin-connect@3.12.3`, `launchPaymentModal` deminified:

```js
window.addEventListener("bc:onpaid", (e) => { paid = true; onPaid?.(e.detail); });
...
return { setPaid: (detail) => {
  payment.setAttribute("paid", "paid");
  payment.dispatchEvent(new CustomEvent("bc:onpaid", {bubbles:true, composed:true, detail}));
}};
```

Three things must stay true:
1. The listener is on `window`, for the event name `bc:onpaid`.
2. The invoice element is `<bc-payment>` with the bolt11 in an `invoice` attribute.
3. `onPaid` receives the event `detail`, and reads `preimage` off it.

**Point 2 is load-bearing twice over.** The bridge requires an exact match between
the `invoice` attribute and the invoice Sidecar paid — a modal it cannot verify is
left alone rather than told a payment settled, since a false "paid" is the one
direction a payment UI must not fail in. So if the bolt11 ever moves off that
attribute, the bridge stops firing entirely rather than resolving the wrong modal.

**Unverified assumption — check this first.** `document.querySelector('bc-payment')`
does not reach inside a shadow root. If Bitcoin Connect renders the modal within one,
the bridge silently does nothing and the console check below is what will tell you.

## Reproduce end to end

1. Connect a wallet in Sidecar (NWC) and sign into a Bitcoin Connect client —
   jumble.social is the reference case. Do **not** connect a wallet inside the
   client's own Bitcoin Connect modal; the bridge is only for the path where the
   client has no provider and falls back to showing a QR.
2. Zap a note. The client puts up the Bitcoin Connect modal with a QR.
3. Sidecar's "Pay with Sidecar" card appears over it. Pay.

**Expected:** the card flashes Paid, and the Bitcoin Connect modal underneath
closes on its own instead of spinning on an invoice that already settled.

**Without the bridge:** the card says Paid, the lightning strike fires, and the
modal is still sitting there showing the QR.

## Checking the mechanism without a wallet

The dependencies above can be checked directly, no payment needed. With a
Bitcoin Connect modal open on any page, run in the page console:

```js
const el = document.querySelector('bc-payment');
el.setAttribute('paid', 'paid');
el.dispatchEvent(new CustomEvent('bc:onpaid',
  { bubbles: true, composed: true, detail: { preimage: 'deadbeef' } }));
```

If the modal resolves, the bridge's assumptions still hold. If it doesn't,
compare the current bundle against the three points above.
