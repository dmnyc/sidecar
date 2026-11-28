'use strict';

// Which relay addresses from someone else's list this browser is not sent to: private and
// shared-address IPs, localhost, .local and .onion names, and anything not wss://. Public
// wss:// relays, by name or by public IP, are untouched.

const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../relay-policy.js');
const { isPrivateAddress } = globalThis.SidecarRelayPolicy;

test('private, local, onion and unencrypted addresses are caught', () => {
  for (const u of [
    'ws://100.91.242.134:4848/', 'wss://100.64.0.1', 'wss://100.127.255.255',
    'wss://10.0.0.5', 'wss://172.16.0.1', 'wss://172.31.9.9', 'wss://192.168.1.20:7777',
    'wss://127.0.0.1', 'wss://169.254.1.1', 'wss://0.0.0.0',
    'wss://localhost:7777', 'wss://relay.localhost', 'wss://pi.local', 'wss://box.lan', 'wss://nas.home.arpa',
    'ws://dn3b4y7sbo3u7lrnceeks6y3udjbja55r5sm7k3s22qoum3p5y56o6id.onion:4869/', 'wss://abc.onion',
    'wss://[::1]', 'wss://[fd00::1]', 'wss://[fe80::1]', 'wss://[::ffff:10.0.0.1]',
    'ws://relay.example.com', 'http://relay.example.com', 'https://relay.example.com',
  ]) assert.equal(isPrivateAddress(u), true, u);
});

test('public wss:// relays are left alone', () => {
  for (const u of [
    'wss://relay.example.com', 'wss://relay.example.com/', 'wss://relay.example.com:443/path',
    'wss://100.63.0.1', 'wss://100.128.0.1', 'wss://172.15.0.1', 'wss://172.32.0.1', 'wss://8.8.8.8',
    'wss://[2001:db8::1]', 'wss://local.example.com', 'wss://onion.example.com',
  ]) assert.equal(isPrivateAddress(u), false, u);
});

test('junk is not called private: it never connects either way', () => {
  assert.equal(isPrivateAddress('not a url'), false);
  assert.equal(isPrivateAddress(''), false);
});
