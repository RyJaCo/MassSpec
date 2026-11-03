'use strict';
// Reference values are from SciPy 1.18 / statsmodels / pingouin unless noted.
const test = require('node:test');
const assert = require('node:assert');
const S = require('../js/statlib.js');

const close = (a, b, rel, msg) => assert.ok(Math.abs(a - b) <= (rel || 1e-4) * Math.max(Math.abs(b), 1e-12) + 1e-12, `${msg || ''} ${a} vs ${b}`);
const a = [5.1, 4.9, 6.2, 5.8, 6.0, 5.5, 4.7, 5.9], b = [6.8, 7.1, 6.0, 7.5, 6.9, 8.2, 7.0], c = [5.0, 5.3, 4.8, 6.1, 5.6, 5.2];
const d = [9.1, 3.2, 12.5, 4.4, 20.1, 6.6, 2.2, 8.8, 30.5, 5.0, 1.1, 7.7];

test('Shapiro-Wilk matches scipy.stats.shapiro', () => {
  let r = S.shapiroWilk(a); close(r.W, 0.9285950308, 1e-6); close(r.p, 0.5033764492, 1e-4);
  r = S.shapiroWilk(d); close(r.W, 0.8205302637, 1e-6); close(r.p, 0.0161907414, 1e-4);
  r = S.shapiroWilk([1, 2, 4]); close(r.W, 0.9642857143, 1e-6); close(r.p, 0.6368868450, 1e-4);
  const big = Array.from({ length: 200 }, (_, i) => Math.exp(Math.sin(i * 1.7) * 1.3));
  r = S.shapiroWilk(big); close(r.W, 0.8448678926, 1e-6); close(r.p, 2.4396787e-13, 1e-3);
});

test('t-tests', () => {
  let r = S.tTest(a, b); close(r.t, -4.857527003); close(r.p, 0.00042239205); close(r.df, 11.70357293);
  close(r.ci[0], -2.260145379); close(r.ci[1], -0.857711764);
  r = S.tTest(a, b, { welch: false }); close(r.t, -4.924844783); close(r.p, 0.00027755848);
  r = S.pairedTTest(a.slice(0, 6), c); close(r.t, 0.9460380895); close(r.p, 0.3875693849);
});

test('rank tests', () => {
  let r = S.mannWhitney([1.1, 2.3, 3.2, 4.5, 5.1], [3.3, 6.2, 7.4, 8.1, 9.9, 10.2]);
  assert.strictEqual(r.U, 2); assert.strictEqual(r.method, 'exact'); close(r.p, 0.017316017316);
  r = S.mannWhitney([1, 2, 2, 3, 4, 5], [3, 3, 4, 6, 7, 8, 9]); close(r.U, 6.5); close(r.p, 0.0437278599);
  r = S.wilcoxonSignedRank([1.1, 2.5, 3.9, 4.2, 5.8, 6.1, 7.7], [1.0, 3.1, 3.2, 5.5, 4.0, 8.3, 9.9]); close(r.p, 0.46875);
  r = S.wilcoxonSignedRank([1, 2, 3, 4, 5, 6, 7, 8], [1.5, 2, 2, 5, 4, 8, 9, 9]); close(r.p, 0.2623135752);
  r = S.kruskalWallis([a, b, c]); close(r.H, 12.16826789); close(r.p, 0.00227873698);
  r = S.friedman([[1, 2, 3], [2, 3, 1], [1, 3, 2], [1, 2, 3], [2, 3, 4], [1.5, 3, 2.5]]); close(r.Q, 6.333333333); close(r.p, 0.0421438435);
  close(S.mwuMinP(3, 3), 0.1); close(S.mwuMinP(4, 4), 2 / 70);
});

test('ANOVA family', () => {
  let r = S.oneWayAnova([a, b, c]); close(r.F, 19.09653969); close(r.p, 3.5506434e-5);
  r = S.welchAnova([a, b, c]); close(r.F, 15.72584648); close(r.p, 0.00048348149);
  r = S.levene([a, b, c]); close(r.F, 0.2354347987); close(r.p, 0.7926226266);
  const rm = S.rmAnova([[1, 2, 3], [2, 3.5, 1], [1, 3, 2], [1, 2, 3.2], [2, 3, 4], [1.5, 3, 2.5]]); // pingouin.rm_anova
  close(rm.F, 5.144876); close(rm.p, 0.029081, 1e-3); close(rm.epsilon, 0.536538, 1e-4); close(rm.pGG, 0.06781, 1e-3);
  const tw = S.twoWayAnova([1, 2, 3, 4, 5, 6, 7, 8, 9, 10.5, 3, 4], 'xxxxyyyyzzzz'.split(''), 'ppqqpqqqppqp'.split('')); // statsmodels typ=3
  [2.8908439490, 0.0434279097, 2.8105891720].forEach((F, i) => close(tw.table[i].F, F));
  [0.1320782206, 0.8418158311, 0.1376268763].forEach((p, i) => close(tw.table[i].p, p));
});

test('post hoc tests', () => {
  const names = ['a', 'b', 'c'];
  S.tukeyHSD([a, b, c], names).forEach((r, i) => close(r.p, [1.5479989e-4, 0.8336054813, 1.0252487e-4][i], 1e-3));
  S.gamesHowell([a, b, c], names).forEach((r, i) => close(r.p, [0.0011324697, 0.7915641123, 5.829279e-4][i], 1e-3));
  // Dunnett: SciPy's value comes from randomised QMC; ours converges to the Monte Carlo value 1.0645e-4 ± 1.2e-6.
  const dn = S.dunnett([a, b, c], names, 0); close(dn[0].p, 1.0717e-4, 3e-2); close(dn[1].p, 0.7948, 1e-3);
  const dn4 = S.dunnett([a, b, c, d.slice(0, 5)], ['a', 'b', 'c', 'd'], 0);
  dn4.forEach((r, i) => close(r.p, [0.63511, 0.99906, 0.04594][i], 3e-3));
});

test('studentized range distribution', () => {
  close(S.ptukey(3.5, 3, 10), 0.9228966892, 1e-6); close(S.ptukey(2, 5, 4), 0.3484899415, 1e-6);
  close(S.ptukey(4, 10, 200), 0.8658638530, 1e-6); close(S.ptukey(3, 2, 1000), 0.9658596561, 1e-6);
});

test('correlation and contingency tables', () => {
  const p = S.pearson(a.slice(0, 7), b); close(p.r, -0.2411192654); close(p.p, 0.6024578347); close(p.ci[0], -0.8413988490); close(p.ci[1], 0.6255185035);
  const s = S.spearman(a.slice(0, 7), b); close(s.rho, -0.3214285714); close(s.p, 0.4820720383);
  let r = S.chiSquare([[10, 20, 30], [25, 15, 12]]); close(r.X2, 14.35897436); close(r.p, 7.620585e-4);
  r = S.chiSquare([[10, 20], [25, 15]]); close(r.X2, 4.725); close(r.p, 0.0297271833);
  close(S.fisherExact([[3, 9], [10, 4]]).p, 0.0471799704);
});

test('p-value adjustment', () => {
  const p = [0.01, 0.04, 0.03, 0.2, 0.001];
  assert.deepStrictEqual(S.adjust(p, 'bh').map((x) => +x.toFixed(6)), [0.025, 0.05, 0.05, 0.2, 0.005]);
  assert.deepStrictEqual(S.adjust(p, 'holm').map((x) => +x.toFixed(6)), [0.04, 0.09, 0.09, 0.2, 0.005]);
  assert.deepStrictEqual(S.adjust(p, 'bonferroni').map((x) => +x.toFixed(6)), [0.05, 0.2, 0.15, 1, 0.005]);
});

test('Box-Cox lambda', () => { close(S.boxCoxLambda([d]), 0.0913, 0.15); });
