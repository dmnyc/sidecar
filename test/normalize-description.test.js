'use strict';

// Unit coverage for normalizeDescription() in sidepanel.js.
//
// coinos NWC returns tx.description as a structured array
// ([["text/plain","…"],["text/identifier","…"]]) instead of a plain string.
// The normalizer extracts the text/plain value from either shape (array or
// JSON-stringified array) and leaves plain strings untouched.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');

// Extract normalizeDescription from sidepanel.js and eval it in isolation.
const source = fs.readFileSync(path.join(ROOT, 'sidepanel.js'), 'utf8');
const match = source.match(/function normalizeDescription\(desc\)\s*\{[\s\S]*?\n  \}/);
if (!match) throw new Error('Could not find normalizeDescription in sidepanel.js');

const ctx = {};
vm.createContext(ctx);
vm.runInContext(match[0], ctx);
const normalizeDescription = ctx.normalizeDescription;

test('returns empty string for null/undefined', () => {
  assert.equal(normalizeDescription(null), '');
  assert.equal(normalizeDescription(undefined), '');
});

test('passes through plain strings', () => {
  assert.equal(normalizeDescription('Paying alice@coinos.io'), 'Paying alice@coinos.io');
  assert.equal(normalizeDescription(''), '');
});

test('extracts text/plain from an array descriptor', () => {
  const arr = [['text/plain', 'Paying thedaniel@coinos.io'], ['text/identifier', 'thedaniel@coinos.io']];
  assert.equal(normalizeDescription(arr), 'Paying thedaniel@coinos.io');
});

test('extracts text/plain from a JSON-stringified array', () => {
  const json = JSON.stringify([['text/plain', 'Coffee tip'], ['text/identifier', 'barista@coinos.io']]);
  assert.equal(normalizeDescription(json), 'Coffee tip');
});

test('returns empty string when text/plain is absent', () => {
  const arr = [['text/identifier', 'someone@coinos.io']];
  assert.equal(normalizeDescription(arr), '');
});

test('handles array with empty text/plain value', () => {
  const arr = [['text/plain', ''], ['text/identifier', 'x@coinos.io']];
  assert.equal(normalizeDescription(arr), '');
});

test('does not misparse non-JSON strings starting with [', () => {
  assert.equal(normalizeDescription('[not json'), '[not json');
});

test('returns string representation for unexpected types', () => {
  assert.equal(normalizeDescription(42), '42');
  assert.equal(normalizeDescription(true), 'true');
});
