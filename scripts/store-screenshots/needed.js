#!/usr/bin/env node
'use strict';
// Does the store gallery need a new pass? Lists the interface files that changed since the last
// release, and exits 1 when there are any, so a release checklist can run it.
//
//   node scripts/store-screenshots/needed.js [TAG]      (default: the latest v* tag)
//
// "Interface" is anything the gallery can show: the panel, its styles and themes, the pages that sit
// beside it, the approval card, and the icons and fonts they draw. A change in one of these does not
// always change a picture, so a hit means "regenerate the set and look", not "the gallery is wrong".

const { execFileSync } = require('node:child_process');
const path = require('node:path');

const INTERFACE = [
  /^sidepanel\.(html|js)$/,
  /^styles\.css$/,
  /^(welcome|wallets|prompt|compose|thread|highlight)\.(html|css|js)$/,
  /^themes\//,
  /^icons\//,
  /^fonts\//,
];

const interfaceFiles = (files) => files.filter((f) => INTERFACE.some((re) => re.test(f)));

function git(args) {
  return execFileSync('git', args, { cwd: path.resolve(__dirname, '..', '..'), encoding: 'utf8' }).trim();
}

function main() {
  const tag = process.argv[2] || git(['describe', '--tags', '--abbrev=0', '--match', 'v*']);
  const changed = git(['diff', '--name-only', tag + '..HEAD']).split('\n').filter(Boolean);
  const hits = interfaceFiles(changed);
  if (!hits.length) {
    console.log('No interface files changed since ' + tag + '. The live gallery still shows the product.');
    return;
  }
  console.log('Interface files changed since ' + tag + ' (' + hits.length + '):\n  ' + hits.join('\n  '));
  console.log('\nThe store gallery needs a pass: regenerate the set, look at every image, and upload what changed.');
  process.exitCode = 1;
}

if (require.main === module) main();
module.exports = { interfaceFiles, INTERFACE };
