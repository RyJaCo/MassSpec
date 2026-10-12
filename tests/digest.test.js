'use strict';
const test = require('node:test');
const assert = require('node:assert');
const D = require('../js/digest.js');

const GFP = D.parseFasta(require('fs').readFileSync(__dirname + '/../examples/GFP_P42212.fasta', 'utf8'))[0].seq;

test('trypsin obeys the proline rule', () => {
  const { peptides } = D.digest('AAKPAARBBK'.replace(/B/g, 'G'), { enzymes: ['trypsin'], minLen: 1 });
  assert.deepStrictEqual(peptides.map((p) => p.seq), ['AAKPAAR', 'GGK']);
  const p2 = D.digest('AAKPAARGGK', { enzymes: ['trypsinp'], minLen: 1 }).peptides;
  assert.deepStrictEqual(p2.map((p) => p.seq), ['AAK', 'PAAR', 'GGK']);
});

test('N-terminal enzymes cut before the residue', () => {
  const { peptides } = D.digest('AAADBBBDCC'.replace(/B/g, 'G'), { enzymes: ['aspn'], minLen: 1 });
  assert.deepStrictEqual(peptides.map((p) => p.seq), ['AAA', 'DGGG', 'DCC']);
});

test('combined enzymes pool cleavage sites', () => {
  const seq = 'AAKPGGRFLLW';
  const p = D.digest(seq, { enzymes: ['trypsin', 'lysc'], minLen: 1 }).peptides;
  assert.deepStrictEqual(p.map((x) => x.seq), ['AAK', 'PGGR', 'FLLW']);
});

test('missed cleavages and length window', () => {
  const { peptides } = D.digest('AAAAAAKBBBBBBBRCC'.replace(/B/g, 'G'), { enzymes: ['trypsin'], missed: 1, minLen: 6, maxLen: 14 });
  const bySeq = Object.fromEntries(peptides.map((p) => [p.seq, p]));
  assert.strictEqual(bySeq.AAAAAAK.status, 'window');
  assert.strictEqual(bySeq.CC.status, 'short');
  assert.strictEqual(bySeq.AAAAAAKGGGGGGGR.status, 'long');
  assert.strictEqual(bySeq.GGGGGGGRCC.missed, 1);
  assert.strictEqual(peptides.length, 5);
});

test('GFP tryptic digest', () => {
  const { peptides, sites } = D.digest(GFP, { enzymes: ['trypsin'] });
  assert.strictEqual(GFP.length, 238);
  assert.strictEqual(peptides.length, 26);
  assert.strictEqual(sites.length - 2, 25);
  assert.strictEqual(peptides.filter((p) => p.inWindow).length, 12);
  assert.strictEqual(peptides.map((p) => p.seq).join(''), GFP);
});

test('initiator Met removal adds the N-terminal variant', () => {
  const p = D.digest(GFP, { enzymes: ['trypsin'], metLoss: true, minLen: 1 }).peptides;
  assert.ok(p.some((x) => x.seq === 'SK' && x.start === 2 && x.nTermMetLoss));
});

test('monoisotopic masses', () => {
  // Angiotensin II DRVYIHPF [M] = 1045.5345
  assert.ok(Math.abs(D.peptideMass('DRVYIHPF') - 1045.5345) < 1e-3);
  // Carbamidomethyl Cys adds 57.0215
  assert.ok(Math.abs(D.peptideMass('ACK', { carbamidomethyl: true }) - D.peptideMass('ACK') - 57.0215) < 1e-3);
  assert.ok(Number.isNaN(D.peptideMass('PEPXK')));
  assert.ok(Math.abs(D.mz(1045.5345, 2) - 523.7745) < 1e-3);
});

test('FASTA parsing', () => {
  const e = D.parseFasta('>sp|P1|A_HUMAN desc\nMKV\nLL*\n>tr|Q2|B second\nmkr 12\n');
  assert.deepStrictEqual(e.map((x) => [x.id, x.seq]), [['P1', 'MKVLL'], ['Q2', 'MKR']]);
  assert.deepStrictEqual(D.parseFasta('MKV LLR\nGGK')[0].seq, 'MKVLLRGGK');
  assert.deepStrictEqual(D.parseFasta('MKBX')[0].invalid, ['B', 'X']);
});
