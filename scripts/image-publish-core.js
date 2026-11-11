'use strict';
// Core of scripts/publish-images.mjs: put an image on a Blossom server and on
// nostr.build under one Nostr key, and keep a local catalog of where each one went.
//
// Dev-only, like the rest of scripts/ (package.sh strips the directory). No
// dependencies: signing and ncryptsec decryption come from the vendored
// nostr-tools.js and nip49.js, the same files the extension ships, so there is one
// copy of the crypto to audit.
//
// KEY HANDLING. The key arrives as a NIP-49 ncryptsec in the environment and is
// opened with a password typed at a hidden prompt. The decrypted key lives in memory
// for one batch and is zeroed after. Nothing here writes a key, a password or an
// ncryptsec to disk: the catalog holds public URLs and the public key only.

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

const NCRYPTSEC_ENV = 'SIDECAR_NCRYPTSEC';
const BLOSSOM_ENV = 'SIDECAR_BLOSSOM_SERVER';
const CATALOG_ENV = 'SIDECAR_IMAGE_CATALOG';
const NOSTR_BUILD_URL = 'https://nostr.build/api/v2/upload/files';
const MAX_IMAGE_BYTES = 100 * 1024 * 1024;
const AUTH_LIFETIME_SECONDS = 300;

const MIME_TYPES = {
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

// The vendored bundles are browser scripts that assign a global. They run in this
// realm, not a separate vm context: nostr-tools checks events with `instanceof Object`,
// which a plain object from another realm fails.
let tools;
function loadCrypto() {
  if (tools) return tools;
  if (!globalThis.self) globalThis.self = globalThis;
  for (const file of ['nostr-tools.js', 'nip49.js']) {
    vm.runInThisContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), { filename: file });
  }
  const nt = globalThis.NostrTools;
  const n49 = globalThis.SidecarNip49;
  tools = {
    finalizeEvent: nt.finalizeEvent,
    getPublicKey: nt.getPublicKey,
    verifyEvent: nt.verifyEvent,
    encrypt: n49.encrypt,
    decrypt: n49.decrypt,
  };
  return tools;
}

function catalogPath(env = process.env) {
  if (env[CATALOG_ENV]) return path.resolve(env[CATALOG_ENV]);
  const dataHome = env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
  return path.join(dataHome, 'sidecar-images', 'uploads.jsonl');
}

// A server that takes uploads must be reached over HTTPS. Plain HTTP is allowed on
// loopback only, so a test server works and a typo cannot send a signed token in the clear.
function normalizeServer(value) {
  const server = new URL(value);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(server.hostname);
  if (server.protocol !== 'https:' && !(server.protocol === 'http:' && loopback)) {
    throw new Error('A server must use HTTPS (HTTP is allowed only on loopback, for testing)');
  }
  if (server.username || server.password || server.search || server.hash) {
    throw new Error('A server URL cannot carry credentials, a query or a fragment');
  }
  server.pathname = server.pathname.replace(/\/+$/, '');
  return server;
}

function imageMimeType(file) {
  const ext = path.extname(file).toLowerCase();
  const type = MIME_TYPES[ext];
  if (!type) throw new Error('Unsupported image extension: ' + (ext || '(none)'));
  return type;
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function authorizationHeader(event) {
  return 'Nostr ' + Buffer.from(JSON.stringify(event)).toString('base64url');
}

// BUD-11: a short-lived kind 24242 event scoped to one blob and one server.
function blossomAuthorization(hash, server, secretKey, now = Math.floor(Date.now() / 1000)) {
  return loadCrypto().finalizeEvent({
    kind: 24242,
    created_at: now,
    content: 'Upload image',
    tags: [
      ['t', 'upload'],
      ['expiration', String(now + AUTH_LIFETIME_SECONDS)],
      ['server', server.hostname.toLowerCase()],
      ['x', hash],
    ],
  }, secretKey);
}

// NIP-98: a kind 27235 event bound to the exact URL and method.
function httpAuthorization(url, method, secretKey, now = Math.floor(Date.now() / 1000)) {
  return loadCrypto().finalizeEvent({
    kind: 27235,
    created_at: now,
    content: '',
    tags: [['u', url], ['method', method]],
  }, secretKey);
}

// What the server says it stored must be what was sent: same hash, same size, and a
// URL that names that hash. A server that answers with another blob's address is
// refused rather than recorded.
function parseBlossomDescriptor(value, expectedHash, expectedSize) {
  const ok = value && typeof value === 'object'
    && typeof value.url === 'string'
    && value.sha256 === expectedHash
    && value.size === expectedSize;
  if (!ok) throw new Error('The server returned an invalid or mismatched blob descriptor');
  let name = '';
  try { name = new URL(value.url).pathname.split('/').pop() || ''; } catch (_) { /* fall through */ }
  if (!name.toLowerCase().startsWith(expectedHash)) {
    throw new Error('The server returned a URL for a different blob');
  }
  return { url: value.url, sha256: value.sha256, size: value.size, type: String(value.type || '') };
}

function readImage(file) {
  const localPath = path.resolve(file);
  const size = fs.statSync(localPath).size;
  if (size > MAX_IMAGE_BYTES) {
    throw new Error('Image exceeds the ' + MAX_IMAGE_BYTES / 1024 / 1024 + ' MiB upload limit');
  }
  const bytes = fs.readFileSync(localPath);
  return { localPath, bytes, hash: sha256(bytes), type: imageMimeType(localPath) };
}

async function failure(response, what) {
  const reason = response.headers.get('x-reason');
  const body = (await response.text()).trim();
  const detail = reason || body.slice(0, 300);
  return new Error(what + ' failed (' + response.status + ')' + (detail ? ': ' + detail : ''));
}

async function uploadToBlossom({ image, secretKey, server, fetchImpl = fetch }) {
  const event = blossomAuthorization(image.hash, server, secretKey);
  const response = await fetchImpl(new URL('/upload', server), {
    method: 'PUT',
    redirect: 'error',
    headers: {
      Authorization: authorizationHeader(event),
      'Content-Length': String(image.bytes.byteLength),
      'Content-Type': image.type,
      'X-SHA-256': image.hash,
    },
    body: image.bytes,
  });
  if (!response.ok) throw await failure(response, 'Blossom upload');
  let value;
  try { value = await response.json(); } catch (_) { throw new Error('The server returned a non-JSON response'); }
  const blob = parseBlossomDescriptor(value, image.hash, image.bytes.byteLength);
  return { target: 'blossom', server: server.origin, url: blob.url, verified: true };
}

async function uploadToNostrBuild({ image, secretKey, fetchImpl = fetch }) {
  const event = httpAuthorization(NOSTR_BUILD_URL, 'POST', secretKey);
  const form = new FormData();
  form.append('file', new Blob([image.bytes], { type: image.type }), path.basename(image.localPath));
  const response = await fetchImpl(NOSTR_BUILD_URL, {
    method: 'POST',
    redirect: 'error',
    headers: { Authorization: authorizationHeader(event) },
    body: form,
  });
  if (!response.ok) throw await failure(response, 'nostr.build upload');
  let json;
  try { json = await response.json(); } catch (_) { throw new Error('nostr.build returned a non-JSON response'); }
  const data = json && json.data;
  const url = data && (Array.isArray(data) ? data[0] && data[0].url : data.url);
  if (typeof url !== 'string' || !/^https:\/\//.test(url)) throw new Error('nostr.build returned no URL');
  // nostr.build does not echo a hash, so fetch what it is serving and compare. A host
  // that re-encodes an image is worth knowing about before the URL goes in a listing.
  let verified = false;
  try {
    const back = await fetchImpl(url, { redirect: 'follow' });
    if (back.ok) verified = sha256(Buffer.from(await back.arrayBuffer())) === image.hash;
  } catch (_) { /* unverified, not failed */ }
  return { target: 'nostr-build', server: 'https://nostr.build', url, verified };
}

function recordFor(image, result, pubkey) {
  return {
    ...result,
    sha256: image.hash,
    size: image.bytes.byteLength,
    type: image.type,
    localPath: image.localPath,
    fileName: path.basename(image.localPath),
    pubkey,
    recordedAt: new Date().toISOString(),
  };
}

function appendRecord(file, record) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.appendFileSync(file, JSON.stringify(record) + '\n', { encoding: 'utf8', mode: 0o600 });
}

function readRecords(file, warn = console.warn) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) {
    if (e && e.code === 'ENOENT') return [];
    throw e;
  }
  const records = [];
  text.split('\n').forEach((line, i) => {
    if (!line) return;
    try {
      const r = JSON.parse(line);
      if (!r || typeof r.url !== 'string' || !/^[0-9a-f]{64}$/.test(r.sha256 || '')) throw new Error('shape');
      records.push(r);
    } catch (_) {
      warn('Skipping an invalid catalog entry on line ' + (i + 1) + ' of ' + file);
    }
  });
  return records;
}

// ---- hidden password prompt ----

// One keypress in, the next state out. Kept pure so it can be tested without a terminal.
function applyPasswordKey(password, character, key) {
  if (key.ctrl && (key.name === 'c' || key.name === 'd')) return { type: 'cancel' };
  if (key.ctrl && key.name === 'u') return { type: 'continue', password: '' };
  if (key.name === 'return' || key.name === 'enter') return { type: 'submit', password };
  if (key.name === 'backspace') return { type: 'continue', password: password.slice(0, -1) };
  if (!character || key.ctrl || character.startsWith('\x1b') || /\p{C}/u.test(character)) {
    return { type: 'continue', password };
  }
  return { type: 'continue', password: password + character };
}

function promptPassword(prompt) {
  const readline = require('node:readline');
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return Promise.reject(new Error('A terminal is required for the hidden password prompt'));
  }
  return new Promise((resolve, reject) => {
    let password = '';
    let finished = false;
    const restore = () => {
      if (finished) return;
      finished = true;
      process.stdin.removeListener('keypress', onKeypress);
      process.removeListener('exit', restore);
      if (process.stdin.isRaw) process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write('\n');
    };
    const onKeypress = (character, key) => {
      const action = applyPasswordKey(password, character, key || {});
      if (action.type === 'cancel') { restore(); reject(new Error('Canceled')); }
      else if (action.type === 'submit') { restore(); resolve(action.password); }
      else password = action.password;
    };
    try {
      readline.emitKeypressEvents(process.stdin);
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.on('keypress', onKeypress);
      process.once('exit', restore);
      process.stdout.write(prompt);
    } catch (e) { restore(); reject(e); }
  });
}

module.exports = {
  NCRYPTSEC_ENV, BLOSSOM_ENV, CATALOG_ENV, NOSTR_BUILD_URL, MAX_IMAGE_BYTES,
  loadCrypto, catalogPath, normalizeServer, imageMimeType, sha256, authorizationHeader,
  blossomAuthorization, httpAuthorization, parseBlossomDescriptor, readImage,
  uploadToBlossom, uploadToNostrBuild, recordFor, appendRecord, readRecords,
  applyPasswordKey, promptPassword,
};
