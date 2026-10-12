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

test('reads the demo matrix saved as CSV from a spreadsheet', () => {
  const tsv = fs.readFileSync(__dirname + '/../examples/demo_pr_matrix.tsv', 'utf8');
  const quote = (c) => (/[",]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c);
  const csv = '﻿' + tsv.trim().split('\n').map((l) => l.split('\t').map(quote).join(',')).join('\r\n');
  const a = P.parseText(tsv);
  const b = P.parseText(csv);
  assert.deepStrictEqual(b.runs, a.runs);
  assert.strictEqual(b.peptides.size, a.peptides.size);
  for (const [k, v] of a.peptides) assert.deepStrictEqual([...b.peptides.get(k).values], [...v.values]);
});

test('comma CSV with quoted descriptions and thousands separators', () => {
  const t = 'Protein.Group,First.Protein.Description,Stripped.Sequence,Precursor.Charge,run_A,run_B\n' +
    'P1,"Kinase, putative; isoform 2",PEPTIDEK,2,"1,234,567",#N/A\n';
  const m = P.parseText(t);
  assert.deepStrictEqual(m.runs.map((r) => r.name), ['run_A', 'run_B']);
  const v = m.peptides.get('PEPTIDEK').values;
  assert.strictEqual(v[0], 1234567);
  assert.ok(Number.isNaN(v[1]));
});

test('semicolon CSV with decimal commas and a sep= line (European Excel)', () => {
  const t = 'sep=;\r\nProtein.Group;Stripped.Sequence;Precursor.Charge;S1;S2\r\n' +
    'P1;PEPTIDEK;2;1234,5;1.234.567,8\r\nP1;LLR;2;2,5E+06;\r\n';
  const m = P.parseText(t);
  assert.deepStrictEqual(m.runs.map((r) => r.name), ['S1', 'S2']);
  assert.deepStrictEqual([...m.peptides.get('PEPTIDEK').values], [1234.5, 1234567.8]);
  assert.strictEqual(m.peptides.get('LLR').values[0], 2.5e6);
});

test('header names match regardless of case and punctuation', () => {
  const m = P.parseText('protein_group,stripped_sequence,run1\nP1,PEPTIDEK,10\n');
  assert.strictEqual(m.sequenceColumn, 'stripped_sequence');
  assert.strictEqual(m.peptides.get('PEPTIDEK').values[0], 10);
});

test('delimiter sniffing ignores separators inside quotes', () => {
  assert.strictEqual(P.sniffDelimiter('a;"b,c,d";e'), ';');
  assert.strictEqual(P.sniffDelimiter('a\tb,c\td'), '\t');
});

test('skips a sample-label row above the header and uses it for run names', () => {
  const t = ',,,,Control,Treated\r\n' +
    'extraProteins,Protein.Group,Stripped.Sequence,Precursor.Charge,C:\\data\\s01.raw,C:\\data\\s02.raw\r\n' +
    'x,P1,PEPTIDEK,2,3.70E+06,\r\n' +
    ',P2,LLR,2,,455816\r\n';
  const m = P.parseText(t);
  assert.deepStrictEqual(m.runs.map((r) => r.name), ['Control (s01)', 'Treated (s02)']);
  assert.strictEqual(m.peptides.get('PEPTIDEK').values[0], 3.7e6);
  assert.strictEqual(m.peptides.get('LLR').values[1], 455816);
});
