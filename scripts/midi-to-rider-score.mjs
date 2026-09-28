#!/usr/bin/env node
// MIDI in, relay-rider-score.js out. Dev-time only; nothing here ships.
//
// Relay Rider's soundtrack is Scott Joplin's "The Strenuous Life" (1902), a ragtime
// two-step, from the Mutopia Project's public-domain typesetting (Mutopia-2008/09/19-1542,
// Benjamin Bloomfield; composition and engraving both public domain). The piece is not
// keyed in from memory: the LilyPond source is rendered to MIDI with its repeats unfolded
// and reduced here, so the tune on the road is the tune on the page.
//
// The game plays two oscillators, so the piano has to become two voices. LilyPond writes
// one MIDI track per staff, which makes the split a matter of reading the staves rather
// than guessing registers: the lead is the highest note sounding at each sixteenth in the
// right hand, the bass the lowest in the left. That keeps the oom-pah of the left hand,
// bass note then chord, which is what makes it ragtime and not a scale exercise.
//
// A note is a new note when its pitch changes OR when the same pitch is struck again. A
// plain run-length encoding merges "g8 g8" into one g4, and the melody of a rag is
// mostly repeated notes with syncopation between them; lose the re-strikes and you lose
// the rag.
//
// To regenerate (LilyPond 2.24+ from PyPI: `pip install lilypond`):
//
//   convert-ly -e TheStrenuousLife.ly
//   # replace the \score blocks with a MIDI-only one, so repeats are played out:
//   #   \score { \unfoldRepeats \new PianoStaff <<
//   #     \new Staff = "upper" \upper  \new Staff = "lower" \lower >> \midi { } }
//   lilypond -s TheStrenuousLife.ly
//   node scripts/midi-to-rider-score.mjs TheStrenuousLife.midi > relay-rider-score.js

import { readFileSync } from 'node:fs';

const BPM = 88;   // quarter notes. Joplin marks it "Not fast."; this is a rider's not fast.

function parse(path) {
  const b = readFileSync(path);
  let p = 8 + b.readUInt32BE(4);
  const tracks = b.readUInt16BE(10);
  const division = b.readUInt16BE(12);
  const vlq = () => { let v = 0; for (;;) { const c = b[p++]; v = (v << 7) | (c & 0x7f); if (!(c & 0x80)) return v; } };
  const out = [];
  for (let t = 0; t < tracks; t++) {
    if (b.toString('ascii', p, p + 4) !== 'MTrk') break;
    const end = p + 8 + b.readUInt32BE(p + 4);
    p += 8;
    const notes = [];
    const open = new Map();
    let tick = 0, running = 0;
    while (p < end) {
      tick += vlq();
      let status = b[p];
      if (status & 0x80) p++; else status = running;
      running = status;
      const type = status & 0xf0;
      // Measured before it is added: `p += vlq()` reads p before vlq() has moved it.
      if (status === 0xff) { p++; const l = vlq(); p += l; }
      else if (status === 0xf0 || status === 0xf7) { const l = vlq(); p += l; }
      else if (type === 0x90 || type === 0x80) {
        const note = b[p++], vel = b[p++];
        if (type === 0x90 && vel > 0) {
          if (!open.has(note)) open.set(note, []);
          open.get(note).push(tick);
        } else {
          const st = open.get(note);
          if (st && st.length) notes.push({ note, start: st.shift(), end: tick });
        }
      } else if (type === 0xc0 || type === 0xd0) p += 1;
      else p += 2;
    }
    p = end;
    if (notes.length) out.push(notes);
  }
  return { division, tracks: out };
}

// One voice from one staff: at each sixteenth, the highest (or lowest) note sounding,
// and whether it was struck on that sixteenth.
function voice(notes, per16, steps, pick) {
  const pitch = new Array(steps).fill(0);
  const struck = new Array(steps).fill(false);
  for (const n of notes) {
    const a = Math.round(n.start / per16);
    const z = Math.max(a + 1, Math.round(n.end / per16));
    for (let s = a; s < Math.min(z, steps); s++) {
      if (!pitch[s] || pick(n.note, pitch[s])) { pitch[s] = n.note; struck[s] = s === a; }
    }
  }
  const out = [];
  for (let s = 0; s < steps; s++) {
    if (!pitch[s]) continue;
    const last = out[out.length - 1];
    if (last && last.at + last.len === s && last.pitch === pitch[s] && !struck[s]) last.len++;
    else out.push({ at: s, pitch: pitch[s], len: 1 });
  }
  return out;
}

const [file] = process.argv.slice(2);
if (!file) { console.error('usage: midi-to-rider-score.mjs <file.midi>'); process.exit(1); }
const { division, tracks } = parse(file);
if (tracks.length !== 2) { console.error('expected two staves, found ' + tracks.length); process.exit(1); }
const per16 = division / 4;
// Treble first: LilyPond writes the staves in score order, and the check keeps a
// reordered source from quietly swapping the tune into the bass.
const mean = (ns) => ns.reduce((a, n) => a + n.note, 0) / ns.length;
const [upper, lower] = mean(tracks[0]) > mean(tracks[1]) ? tracks : [tracks[1], tracks[0]];
const steps = Math.ceil(Math.max(...[...upper, ...lower].map((n) => n.end)) / per16);
const lead = voice(upper, per16, steps, (a, b) => a > b);
const bass = voice(lower, per16, steps, (a, b) => a < b);
// Round the loop up to a whole 2/4 bar, so the repeat lands on a downbeat.
const length = Math.ceil(steps / 8) * 8;

const flat = (v) => {
  const nums = v.flatMap((n) => [n.at, n.pitch, n.len]);
  const lines = [];
  for (let i = 0; i < nums.length; i += 24) lines.push('    ' + nums.slice(i, i + 24).join(', ') + ',');
  return lines.join('\n');
};

console.error(`${steps} sixteenths, lead ${lead.length} notes, bass ${bass.length} notes`);
process.stdout.write(`'use strict';

// GENERATED by scripts/midi-to-rider-score.mjs. Do not edit by hand; regenerate.
//
// The Strenuous Life, a ragtime two-step. Scott Joplin, 1902 (John Stark & Son).
// Public domain. Typeset for the Mutopia Project by Benjamin Bloomfield
// (Mutopia-2008/09/19-1542), and that engraving is itself placed in the public domain.
//
// Two voices, each a flat run of [startSixteenth, midiNote, lengthInSixteenths].

window.RelayRiderScore = {
  bpm: ${BPM},
  length: ${length},
  lead: [
${flat(lead)}
  ],
  bass: [
${flat(bass)}
  ],
};
`);
