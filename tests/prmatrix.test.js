'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const P = require('../js/prmatrix.js');

test('reads the DIA-NN demo matrix and sums precursors', () => {
  const m = P.parseText(fs.readFileSync(__dirname + '/../examples/demo_pr_matrix.tsv', 'utf8'));
  assert.strictEqual(m.sequenceColumn, 'Stripped.Sequence');
  assert.deepStrictEqual(m.runs.map((r) => r.name), ['GFP_digest_rep1', 'GFP_digest_rep2', 'GFP_digest_rep3']);
  const e = m.peptides.get('LPVPWPTLVTTFSYGVQCFSR');
  assert.strictEqual(e.precursors, 2);
  assert.ok(Math.abs(e.values[0] - (2.58758e7 + 9.50706e6)) < 1);
});

test('strips modifications', () => {
  assert.strictEqual(P.stripSequence('_(UniMod:1)AC(UniMod:4)DEM(UniMod:35)K_'), 'ACDEMK');
  assert.strictEqual(P.stripSequence('PEP[+15.995]TIDEK2'), 'PEPTIDEK');
});

test('falls back to Modified.Sequence and ignores annotation columns', () => {
  const t = 'Protein.Group\tModified.Sequence\tPrecursor.Charge\tProteotypic\tA.raw\tB.raw\n' +
    'P1\tAC(UniMod:4)K\t2\t1\t100\t\n' +
    'P1\tAC(UniMod:4)K\t3\t1\t50\t20\n' +
    'P1\tLLR\t2\t1\t\t\n';
  const m = P.parseText(t);
  assert.deepStrictEqual(m.runs.map((r) => r.name), ['A', 'B']);
  assert.deepStrictEqual([...m.peptides.get('ACK').values], [150, 20]);
  assert.ok(m.peptides.get('LLR').values.every(Number.isNaN));
});

test('MaxQuant style picks Intensity columns', () => {
  const t = 'Sequence,Length,Mass,Score,Intensity,Intensity S1,Intensity S2\nPEPTIDEK,8,900,100,30,10,20\n';
  const m = P.parseText(t);
  assert.deepStrictEqual(m.runs.map((r) => r.column), ['Intensity S1', 'Intensity S2']);
});

test('summarise modes', () => {
  const v = Float64Array.from([10, NaN, 30, 20]);
  assert.deepStrictEqual(P.summarise(v, 'mean'), { value: 20, nDetected: 3 });
  assert.strictEqual(P.summarise(v, 'median').value, 20);
  assert.strictEqual(P.summarise(v, 'max').value, 30);
  assert.ok(Number.isNaN(P.summarise(v, 1).value));
});

test('reports a clear error without a sequence column', () => {
  assert.throws(() => P.parseText('a\tb\n1\t2\n'), /No peptide sequence column/);
});
