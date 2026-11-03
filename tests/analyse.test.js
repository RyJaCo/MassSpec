'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const N = require('../js/analyse.js');

const exp = N.parseTable(fs.readFileSync(__dirname + '/../examples/stats_demo_experiment.csv', 'utf8'));
const wide = N.parseTable(fs.readFileSync(__dirname + '/../examples/stats_demo_paired.csv', 'utf8'));

test('reads CSV, semicolon / decimal-comma files and quoted cells', () => {
  assert.strictEqual(exp.nRows, 80);
  assert.ok(exp.columns.find((c) => c.name === 'Treatment').categorical);
  assert.ok(exp.columns.find((c) => c.name === 'ProteinX_intensity').numeric);
  const t = N.parseTable('sep=;\nGroup;Value\n"A; x";1,5\nB;2,25\n');
  assert.deepStrictEqual(Array.from(t.columns[1].num), [1.5, 2.25]);
  assert.strictEqual(t.columns[0].raw[0], 'A; x');
});

test('guesses the measurement type', () => {
  const g = (n) => N.guessOutcome(n, Array.from(exp.columns.find((c) => c.name === n).num));
  assert.strictEqual(g('ProteinX_intensity'), 'intensity');
  assert.strictEqual(g('Phospho_total_ratio'), 'ratio');
  assert.strictEqual(g('Viable_cells_pct'), 'proportion');
  assert.strictEqual(g('Foci_count'), 'count');
  assert.strictEqual(g('Body_weight_g'), 'continuous');
});

test('averages technical replicates and runs the recommended test', () => {
  const b = N.buildLong(exp, { outcome: 'ProteinX_intensity', group: 'Treatment', subject: 'Mouse', control: 'Vehicle' });
  assert.deepStrictEqual(b.n, [10, 10, 10, 10]);
  assert.strictEqual(b.names[0], 'Vehicle');
  const r = N.analyseCompare(b, { outcomeType: 'intensity', comparisons: 'control' });
  assert.strictEqual(r.used.key, 'log2');
  assert.ok(['anova', 'welch_anova'].includes(r.key));
  assert.ok(r.primary.p < 0.001);
  assert.strictEqual(r.posthoc.list.length, 3);
  const hi = r.posthoc.list.find((x) => x.a === 'High dose');
  assert.ok(hi.foldChange > 1.5 && hi.p < 0.05);
});

test('detects a paired design from the subject column and from wide format', () => {
  const r = N.analyseCompare(N.buildWide(wide, { columns: ['Baseline', 'Week_4', 'Week_12'], paired: true, control: 'Baseline' }), { outcomeType: 'continuous', comparisons: 'all' });
  assert.strictEqual(r.answers.design, 'paired');
  assert.ok(['rm_anova', 'friedman'].includes(r.key));
  const long = 'Patient,Time,Value\n' + wide.columns[0].raw.map((p, i) => ['Baseline', 'Week_4'].map((t) => `${p},${t},${wide.columns.find((c) => c.name === t).num[i]}`).join('\n')).join('\n');
  const b = N.buildLong(N.parseTable(long), { outcome: 'Value', group: 'Time', subject: 'Patient' });
  assert.strictEqual(b.design, 'paired'); assert.strictEqual(b.rows.length, 12);
  const r2 = N.analyseCompare(b, { outcomeType: 'continuous' });
  assert.ok(['paired_t', 'wilcoxon'].includes(r2.key));
});

test('ratios to their own control are tested against 0 on the log scale', () => {
  let csv = 'Exp,Cond,Ratio\n';
  [1.8, 2.1, 1.6, 2.4, 1.9].forEach((v, i) => { csv += `E${i},Control,1\nE${i},Treated,${v}\n`; });
  const b = N.buildLong(N.parseTable(csv), { outcome: 'Ratio', group: 'Cond', control: 'Control' });
  const r = N.analyseCompare(b, { outcomeType: 'ratio', ratioControl: 'perExperiment' });
  assert.strictEqual(r.key, 'one_sample_t');
  assert.ok(r.primary.foldChange > 1.8 && r.primary.foldChange < 2.1);
  assert.ok(r.primary.p < 0.001);
});

test('two-way ANOVA with simple effects', () => {
  const b = N.buildLong(exp, { outcome: 'ProteinX_intensity', group: 'Treatment', subject: 'Mouse', factor2: 'Genotype', control: 'Vehicle' });
  const r = N.analyseCompare(b, { outcomeType: 'intensity', comparisons: 'control', groupName: 'Treatment' });
  assert.strictEqual(r.key, 'two_way');
  assert.strictEqual(r.primary.table.length, 3);
  assert.strictEqual(r.posthoc.list.length, 6); // 3 vs control × 2 genotypes
});

test('relationships, contingency tables and one-sample tests', () => {
  const rel = N.analyseRelate(exp, 'ProteinX_intensity', 'ProteinY_intensity');
  assert.ok(rel.pearson.r > 0.8 && rel.logX && rel.logY);
  const as = N.analyseAssoc(exp, 'Treatment', 'Responder', { subject: 'Mouse' });
  assert.strictEqual(as.chisq.N, 40);
  assert.ok(as.monteCarlo && as.monteCarlo.p < 0.05);
  const os = N.analyseOneSample(exp, 'Phospho_total_ratio', 1, 'ratio', null, 'Mouse');
  assert.strictEqual(os.built.n[0], 40);
  assert.strictEqual(os.key, 'one_sample_t');
});

test('tiny samples fall back on the data type and warn about rank tests', () => {
  const b = { names: ['A', 'B'], groups: [[1200, 1500, 900], [3100, 2500, 4200]], rows: null, design: 'independent', notes: [], n: [3, 3] };
  const r = N.analyseCompare(b, { outcomeType: 'intensity' });
  assert.strictEqual(r.transforms.tooFew, true);
  assert.strictEqual(r.used.key, 'log2');
  assert.strictEqual(r.answers.n, 'lt5');
  assert.strictEqual(r.key, 'welch_t');
});
