'use strict';
const test = require('node:test');
const assert = require('node:assert');
const A = require('../js/advisor.js');

const base = { goal: 'compare', factors: '1', replicates: 'biological', features: 'one', covariate: 'no', n: '5to15' };
const rec = (extra) => A.recommend(Object.assign({}, base, extra));

test('two independent normal groups -> Welch by default, Student when told variances are equal', () => {
  let r = rec({ outcome: 'continuous', groups: '2', design: 'independent', normal: 'yes', variance: 'unknown' });
  assert.strictEqual(r.key, 'welch_t'); assert.ok(r.complete); assert.strictEqual(r.posthoc, undefined);
  r = rec({ outcome: 'continuous', groups: '2', design: 'independent', normal: 'yes', variance: 'equal' });
  assert.strictEqual(r.key, 'student_t');
});

test('non-normal data that no transform fixes -> rank tests', () => {
  assert.strictEqual(rec({ outcome: 'continuous', groups: '2', design: 'independent', normal: 'no', transformHelps: 'no', variance: 'unknown' }).key, 'mwu');
  assert.strictEqual(rec({ outcome: 'continuous', groups: '2', design: 'paired', normal: 'no', transformHelps: 'no' }).key, 'wilcoxon');
  const r = rec({ outcome: 'continuous', groups: '3plus', design: 'independent', normal: 'no', transformHelps: 'no', variance: 'unknown', comparisons: 'control' });
  assert.strictEqual(r.key, 'kw'); assert.strictEqual(r.posthocKey, 'dunn_control');
});

test('post hoc follows the comparisons and the variance answer', () => {
  const k3 = { outcome: 'continuous', groups: '3plus', design: 'independent', normal: 'yes' };
  assert.strictEqual(rec(Object.assign({ variance: 'equal', comparisons: 'all' }, k3)).posthocKey, 'tukey');
  assert.strictEqual(rec(Object.assign({ variance: 'equal', comparisons: 'control' }, k3)).posthocKey, 'dunnett');
  const r = rec(Object.assign({ variance: 'unequal', comparisons: 'all' }, k3));
  assert.strictEqual(r.key, 'welch_anova'); assert.strictEqual(r.posthocKey, 'games_howell');
  assert.strictEqual(rec(Object.assign({ variance: 'equal', comparisons: 'omnibus' }, k3)).posthoc, undefined);
});

test('ratios are logged, and ratios to their own control become a one-sample / paired question', () => {
  let r = rec({ outcome: 'ratio', ratioControl: 'intrinsic', groups: '2', design: 'independent', normal: 'yes', variance: 'equal' });
  assert.match(r.transform.name, /log/);
  r = rec({ outcome: 'ratio', ratioControl: 'perExperiment', groups: '2', design: 'independent', normal: 'yes', variance: 'equal' });
  assert.strictEqual(r.key, 'one_sample_t'); assert.ok(r.complete);
  assert.strictEqual(r.answers.design, 'independent', 'the user’s own answers are reported unchanged');
  r = rec({ outcome: 'ratio', ratioControl: 'perExperiment', groups: '3plus', design: 'independent', normal: 'yes', variance: 'equal', comparisons: 'control' });
  assert.strictEqual(r.key, 'rm_anova');
});

test('special outcomes and designs', () => {
  assert.strictEqual(rec({ outcome: 'count', countSize: 'small', groups: '2', design: 'independent' }).key, 'glm_poisson');
  assert.strictEqual(rec({ outcome: 'proportion', propType: 'kofn', groups: '2', design: 'independent' }).key, 'glm_binomial');
  assert.strictEqual(rec({ outcome: 'ordinal', groups: '3plus', design: 'paired', comparisons: 'all' }).key, 'friedman');
  assert.strictEqual(rec({ outcome: 'intensity', groups: '2', design: 'independent', normal: 'unknown', variance: 'unknown', features: 'many' }).key, 'limma');
  assert.strictEqual(rec({ outcome: 'continuous', factors: '2', design: 'independent', normal: 'yes', variance: 'equal', comparisons: 'all' }).key, 'two_way');
  assert.strictEqual(rec({ outcome: 'continuous', factors: '2', design: 'mixed', normal: 'yes', comparisons: 'all' }).key, 'two_way_rm');
  assert.strictEqual(rec({ outcome: 'continuous', groups: '2', design: 'independent', covariate: 'yes', normal: 'yes', variance: 'equal' }).key, 'ancova');
});

test('warnings for tiny samples and technical replicates', () => {
  const r = rec({ outcome: 'intensity', groups: '2', design: 'independent', normal: 'unknown', variance: 'unknown', n: 'lt5', replicates: 'technical' });
  assert.ok(r.warnings.some((w) => /technical/i.test(w)));
  assert.ok(r.warnings.some((w) => /0\.10/.test(w)));
});

test('other goals', () => {
  assert.strictEqual(A.recommend({ goal: 'assoc', design: 'independent', tableSize: '2x2', expected: 'small' }).key, 'fisher');
  assert.strictEqual(A.recommend({ goal: 'assoc', design: 'paired', tableSize: '2x2' }).key, 'mcnemar');
  assert.strictEqual(A.recommend({ goal: 'agree', agreeType: 'continuous' }).key, 'bland_altman');
  assert.strictEqual(A.recommend({ goal: 'survival', groups: '2', covariateSurv: 'no' }).key, 'logrank');
  const rel = { goal: 'relate', replicates: 'biological', features: 'one', n: '15to30', relGoal: 'correlation' };
  assert.strictEqual(A.recommend(Object.assign({ relShape: 'linear', normal: 'yes' }, rel)).key, 'pearson');
  assert.strictEqual(A.recommend(Object.assign({ relShape: 'monotonic', normal: 'yes' }, rel)).key, 'spearman');
});

test('questions appear and disappear with the answers', () => {
  assert.strictEqual(A.nextQuestion({}).id, 'goal');
  assert.strictEqual(A.nextQuestion({ goal: 'compare' }).id, 'outcome');
  assert.ok(!A.visibleQuestions({ goal: 'compare', outcome: 'ordinal' }).some((q) => q.id === 'normal'));
  // switching the goal drops answers that no longer apply
  const pruned = A.prune({ goal: 'assoc', outcome: 'continuous', tableSize: '2x2' });
  assert.deepStrictEqual(pruned, { goal: 'assoc', tableSize: '2x2' });
  // every visible question's options are reachable and every complete path gives a test
  const walk = (ans, depth) => {
    const q = A.nextQuestion(ans);
    if (!q) { const r = A.recommend(ans); assert.ok(r.key, 'no test for ' + JSON.stringify(ans)); return 1; }
    if (depth > 25) throw new Error('loop');
    let n = 0; for (const o of A.visibleQuestions(ans).find((x) => x.id === q.id).options) n += walk(A.prune(Object.assign({}, ans, { [q.id]: o.value })), depth + 1);
    return n;
  };
  assert.ok(walk({}, 0) > 1000);
});
