#!/usr/bin/env python3
"""Builds models/nspam.bin, the reply-spam model Sidecar's bell scores with.

    python3 scripts/build-nspam-model.py

Downloads the nspam model (https://huggingface.co/barrydeen/nspam, MIT) at a pinned revision,
checks every file against the SHA-256 recorded below, and packs its LightGBM trees and its
calibration into a compact little-endian file that nspam.js reads. The published model.txt is
9 MB, most of it the names of 262,167 hashed columns; the trees themselves are under 1 MB.

It also copies the model's reference cases into test/fixtures/nspam/, which test/nspam.test.js
runs the JavaScript port against: a port that differs from the trained pipeline fails there.

Layout of models/nspam.bin (all little-endian):
    'NSPM'  u32 format (1)  u32 trees  u32 knots
    f64 calib_x[knots]  f64 calib_y[knots]
    per tree: u32 leaves, then for its leaves - 1 splits:
        i32 feature[]  f64 threshold[]  i32 left[]  i32 right[]
    then f64 leaf_value[leaves]
A child index below zero is a leaf: ~index. Every split in this model is numeric with no
missing-value handling (decision_type 2), which the script checks rather than assumes.
"""
import hashlib, io, json, os, struct, sys, urllib.request

import numpy as np

REPO = 'barrydeen/nspam'
REVISION = '29f76c80010554f64ef385608b20aad50ea0498e'  # v2.4, 2026-08-30
FILES = {
    'v2.4/model.txt': '0c6e63604b78a668b8bd282d5bc5ad07e54331dd27a6c3f5c06113b8b2c84960',
    'v2.4/calibration.npz': '62653a59086ae153f70ca4efc15d6d89d2ea4658c6fae962fdc4c74172358c3b',
    'v2.4/config.json': '4c1d0412748e63f105892a4301bbf7979f8a864756582b1af2426b566edbb847',
    'v2.4/parity_fixtures.jsonl': '315c99e3aab9136746659e2839d2e1089d0a6cc5c98b97436d7b1d50f8dab725',
    'v2.4/hash_fixtures.jsonl': 'ca6c32f409cb233256d8732f5c22c016337751528b2895e9ef8aa964c9aecd09',
}
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def fetch(name):
    url = f'https://huggingface.co/{REPO}/resolve/{REVISION}/{name}'
    with urllib.request.urlopen(url) as res:
        body = res.read()
    got = hashlib.sha256(body).hexdigest()
    if got != FILES[name]:
        sys.exit(f'{name}: SHA-256 {got} is not the pinned {FILES[name]}')
    return body


def parse_trees(text):
    trees = []
    for block in text.split('\nTree=')[1:]:
        block = block.split('\n\n')[0]
        kv = dict(line.split('=', 1) for line in block.split('\n')[1:] if '=' in line)
        leaves = int(kv['num_leaves'])
        values = [float(v) for v in kv['leaf_value'].split()]
        if leaves == 1:
            trees.append(([], [], [], [], values))
            continue
        if set(kv['decision_type'].split()) != {'2'}:
            sys.exit('a split is not plain numeric (decision_type 2); nspam.js would score it wrong')
        if int(kv.get('num_cat', '0')) or kv.get('is_linear', '0') != '0':
            sys.exit('categorical or linear trees are not supported by nspam.js')
        trees.append((
            [int(v) for v in kv['split_feature'].split()],
            [float(v) for v in kv['threshold'].split()],
            [int(v) for v in kv['left_child'].split()],
            [int(v) for v in kv['right_child'].split()],
            values,
        ))
    return trees


def main():
    model = fetch('v2.4/model.txt').decode('utf-8')
    head = model.split('\nTree=')[0]
    if 'objective=binary sigmoid:1' not in head:
        sys.exit('the objective is not binary sigmoid:1, which nspam.js assumes')
    trees = parse_trees(model)
    calib = np.load(io.BytesIO(fetch('v2.4/calibration.npz')), allow_pickle=False)
    cx = [float(v) for v in calib['calib_x']]
    cy = [float(v) for v in calib['calib_y']]
    config = json.loads(fetch('v2.4/config.json'))
    assert config['model_type'] == 'lightgbm' and config['n_features_char'] == 131072

    out = bytearray(b'NSPM')
    out += struct.pack('<III', 1, len(trees), len(cx))
    out += struct.pack(f'<{len(cx)}d', *cx) + struct.pack(f'<{len(cy)}d', *cy)
    for feature, threshold, left, right, values in trees:
        n = len(values)
        out += struct.pack('<I', n)
        if n > 1:
            out += struct.pack(f'<{n - 1}i', *feature)
            out += struct.pack(f'<{n - 1}d', *threshold)
            out += struct.pack(f'<{n - 1}i', *left)
            out += struct.pack(f'<{n - 1}i', *right)
        out += struct.pack(f'<{n}d', *values)
    os.makedirs(os.path.join(ROOT, 'models'), exist_ok=True)
    with open(os.path.join(ROOT, 'models', 'nspam.bin'), 'wb') as f:
        f.write(out)

    fixtures = os.path.join(ROOT, 'test', 'fixtures', 'nspam')
    os.makedirs(fixtures, exist_ok=True)
    for name in ('parity_fixtures.jsonl', 'hash_fixtures.jsonl'):
        with open(os.path.join(fixtures, name), 'wb') as f:
            f.write(fetch('v2.4/' + name))
    print(f'models/nspam.bin: {len(trees)} trees, {len(cx)} calibration knots, {len(out):,} bytes')


if __name__ == '__main__':
    main()
