'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { englishI18n } = require('./helpers/i18n');

const background = fs.readFileSync(require.resolve('../background'), 'utf8');
const panel = fs.readFileSync(require.resolve('../sidepanel'), 'utf8');
const payment = background.slice(background.indexOf('async function notifyPaymentSent('), background.indexOf('// Tell a tab a page invoice was paid'));
const scrub = panel.slice(panel.indexOf('  function fmtScrubTime('), panel.indexOf('  // Hand-rolled SVG sparkline'));

test('payment notification waits for the worker locale and formats the amount in that locale', async () => {
  const I18N = englishI18n();
  await I18N.ready;
  let release;
  const ready = new Promise(resolve => { release = resolve; });
  const messages = [];
  const ctx = { self: { SidecarI18n: { ...I18N, ready } }, notify: message => messages.push(message) };
  vm.createContext(ctx);
  vm.runInContext(payment, ctx);
  const pending = ctx.notifyPaymentSent(12345);
  assert.deepEqual(messages, []);
  I18N.setLocale('de', [{ 'Payment sent — {{amount}} sats': 'Gesendet: {{amount}} Sats', 'Payment sent': 'Gesendet' }]);
  release();
  await pending;
  assert.deepEqual(messages, ['Gesendet: 12.345 Sats']);
  await ctx.notifyPaymentSent(null);
  await ctx.notifyPaymentSent(0);
  assert.deepEqual(messages.slice(1), ['Gesendet', 'Gesendet: 0 Sats']);
});

test('chart scrub timestamps follow the selected locale for every range', async () => {
  const I18N = englishI18n();
  await I18N.ready;
  I18N.setLocale('de', []);
  const ctx = { I18N };
  vm.createContext(ctx);
  vm.runInContext(scrub, ctx);
  const date = new Date('2026-10-07T14:32:00Z');
  for (const [range, options] of [
    ['24h', { hour: 'numeric', minute: '2-digit' }],
    ['7d', { weekday: 'short', hour: 'numeric' }],
    ['30d', { month: 'short', day: 'numeric' }],
    ['1y', { month: 'short', day: 'numeric', year: 'numeric' }],
    ['all', { month: 'short', year: 'numeric' }],
  ]) {
    assert.equal(ctx.fmtScrubTime(date.getTime(), range), new Intl.DateTimeFormat('de', options).format(date), range);
  }
});

test('payment failure notifications translate known errors and preserve unknown details as data', async () => {
  const I18N = englishI18n(); await I18N.ready;
  I18N.setLocale('de', [{
    'You rejected this payment': 'Zahlung abgelehnt',
    'Payment failed': 'Zahlung fehlgeschlagen',
    'Payment failed: {{reason}}': 'Zahlung fehlgeschlagen: {{reason}}',
  }]);
  const messages = [];
  const ctx = { self: { SidecarI18n: I18N }, notify: message => messages.push(message) };
  vm.createContext(ctx); vm.runInContext(payment, ctx);
  const error = new Error('You rejected this payment');
  await ctx.notifyPaymentFailure(error);
  assert.equal(error.message, 'You rejected this payment', 'protocol error is not modified');
  await ctx.notifyPaymentFailure(new Error('Wallet relay unavailable'));
  await ctx.notifyPaymentFailure(null);
  assert.deepEqual(messages, ['Zahlung abgelehnt', 'Zahlung fehlgeschlagen: Wallet relay unavailable', 'Zahlung fehlgeschlagen']);
});

test('every context-menu label waits for the locale, including the unsupported-scheme fallback', async () => {
  const I18N = englishI18n(); await I18N.ready;
  let release; const ready = new Promise(resolve => { release = resolve; });
  const created = [];
  const ctx = { self: { SidecarI18n: { ...I18N, ready } }, chrome: {
    runtime: {}, contextMenus: {
      removeAll: callback => callback(),
      create: (props, callback) => {
        if (props.targetUrlPatterns) throw new Error('Unsupported scheme');
        created.push(props); callback();
      },
    },
  } };
  const menu = background.slice(background.indexOf('function createPayMenu()'), background.indexOf('// ---- highlights (NIP-84)'));
  vm.createContext(ctx); vm.runInContext(menu, ctx); ctx.createPayMenu();
  assert.deepEqual(created, []);
  I18N.setLocale('de', [{
    'Pay this invoice with Sidecar': 'Invoice translated',
    'Pay Lightning invoice with Sidecar': 'Selection translated',
    'Pay QR code with Sidecar': 'QR translated',
    'Highlight with Sidecar': 'Highlight translated',
  }]);
  release(); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(created.map(item => item.title), ['Invoice translated', 'Selection translated', 'QR translated', 'Highlight translated']);
  assert.deepEqual(created.map(item => item.id), ['sidecar-pay-link', 'sidecar-pay-selection', 'sidecar-pay-qr', 'sidecar-highlight']);
});
