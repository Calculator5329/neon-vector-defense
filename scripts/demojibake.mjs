// Repair double-encoded UTF-8 (mojibake) from earlier PowerShell Set-Content edits.
// Only the corrupted runs are reversed via a Windows-1252 table, so correctly-encoded
// characters elsewhere in the same file are left untouched. Also strips stray BOMs.
import { readFileSync, writeFileSync } from 'node:fs';

// Windows-1252 high range: Unicode codepoint -> byte (0x80..0x9F specials)
const CP1252 = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85,
  0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a,
  0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92,
  0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
  0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c,
  0x017e: 0x9e, 0x0178: 0x9f,
};
const toByte = (cp) => (cp <= 0xff ? cp : CP1252[cp]);

// A char that could be a mojibake'd byte (i.e. has a cp1252 byte) and is non-ASCII.
const isByteish = (ch) => { const b = toByte(ch.codePointAt(0)); return b !== undefined && b >= 0x80; };

function fixRun(run) {
  const bytes = [];
  for (const ch of run) { const b = toByte(ch.codePointAt(0)); if (b === undefined) return run; bytes.push(b); }
  try {
    const dec = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(bytes));
    return dec;
  } catch { return run; } // not valid UTF-8 -> leave as-is
}

function fixText(s) {
  let out = '';
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    // a mojibake run starts with a UTF-8 lead byte (0xC2..0xF4) and has >=1 more byteish char
    const cp = ch.codePointAt(0);
    const b = toByte(cp);
    if (b !== undefined && b >= 0xc2 && b <= 0xf4 && i + 1 < s.length && isByteish(s[i + 1])) {
      let j = i + 1;
      while (j < s.length && isByteish(s[j])) j++;
      const run = s.slice(i, j);
      const fixed = fixRun(run);
      out += fixed;
      i = j;
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}

const files = process.argv.slice(2);
for (const f of files) {
  let s = readFileSync(f, 'utf8');
  const before = s;
  s = s.replace(/﻿/g, ''); // strip BOM / zero-width no-break spaces
  s = fixText(s);
  if (s !== before) {
    writeFileSync(f, s, 'utf8');
    const left = (s.match(/[Â-ô][-ÿ]/g) || []).length;
    console.log(`fixed ${f}  (residual suspicious pairs: ${left})`);
  } else {
    console.log(`clean ${f}`);
  }
}
