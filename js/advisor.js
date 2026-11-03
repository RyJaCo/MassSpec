/*
 * Stats Test Advisor: the question tree and the rules that turn answers into a recommendation.
 * Pure logic, no DOM; used by the question guide and by the data analyser (which fills the
 * answers in from the data). Runs in Node for tests.
 */
(function (root) {
  'use strict';

  const NUMERIC_OUTCOMES = ['continuous', 'intensity', 'ratio', 'proportion', 'count'];
  const isCompare = (a) => a.goal === 'compare' || a.goal === 'onesample';
  const numericOutcome = (a) => NUMERIC_OUTCOMES.includes(a.outcome);
  // Outcomes where the normal / transform questions make sense.
  const canBeParametric = (a) => numericOutcome(a) && !(a.outcome === 'count' && a.countSize === 'small') &&
    !(a.outcome === 'proportion' && a.propType === 'kofn');

  // ------------------------------------------------------------------ questions
  const QUESTIONS = [
    { id: 'goal', label: 'What do you want to find out?', options: [
      { value: 'compare', label: 'Whether groups / conditions differ', help: 'e.g. control vs treated, WT vs KO, before vs after, several doses' },
      { value: 'onesample', label: 'Whether one group differs from a fixed value', help: 'e.g. is the fold change different from 1, is recovery different from 100%' },
      { value: 'relate', label: 'Whether two measurements are related', help: 'correlation, regression, standard curves' },
      { value: 'assoc', label: 'Whether categories are associated', help: 'counts in a table: e.g. responder / non-responder by genotype' },
      { value: 'agree', label: 'Whether two methods or raters agree', help: 'method comparison, repeatability, inter-rater scoring' },
      { value: 'survival', label: 'How long until an event happens', help: 'time to death, relapse, flowering; some subjects never have the event' },
    ] },
    { id: 'outcome', label: 'What kind of measurement is the outcome?', show: isCompare, options: [
      { value: 'continuous', label: 'Continuous measurement', help: 'length, weight, temperature, a score that can take any value' },
      { value: 'intensity', label: 'Intensity, abundance or concentration', help: 'always positive, usually right-skewed: MS intensities, ELISA, qPCR quantities, enzyme activity' },
      { value: 'ratio', label: 'Ratio, fold change or % of control', help: 'treated / control, phospho / total, SILAC H/L, normalised expression' },
      { value: 'proportion', label: 'Proportion or percentage of a whole', help: 'bounded 0–1 or 0–100 %: % viable cells, % area, fraction labelled' },
      { value: 'count', label: 'Counts', help: 'number of cells, colonies, events, spectral counts (whole numbers ≥ 0)' },
      { value: 'ordinal', label: 'Ordered categories or a rating scale', help: 'histology grade, Likert 1–5, disease score' },
      { value: 'binary', label: 'Yes / no for each subject', help: 'survived, responded, infected' },
    ] },
    { id: 'ratioControl', label: 'How were the ratios made?', show: (a) => isCompare(a) && a.outcome === 'ratio', options: [
      { value: 'perExperiment', label: 'Each value divided by its own matched control', help: 'control = 1 (or 100 %) by definition in every experiment, so the control has no spread' },
      { value: 'controlMean', label: 'Every value (controls too) divided by the mean of the controls', help: 'controls scatter around 1' },
      { value: 'intrinsic', label: 'The ratio is measured in each sample', help: 'phospho / total, heavy / light, 260 / 280, two channels in one sample' },
    ] },
    { id: 'propType', label: 'Where do the proportions come from?', show: (a) => isCompare(a) && a.outcome === 'proportion', options: [
      { value: 'kofn', label: 'Counting k out of n per sample', help: 'e.g. 37 of 200 cells were positive; you know both numbers' },
      { value: 'continuous', label: 'A continuous fraction', help: 'e.g. % area stained, % of total signal; no underlying count' },
    ] },
    { id: 'countSize', label: 'How large are the counts?', show: (a) => isCompare(a) && a.outcome === 'count', options: [
      { value: 'small', label: 'Mostly small (under ~10), with zeros', help: '' },
      { value: 'large', label: 'Mostly large (tens or more)', help: '' },
    ] },
    { id: 'factors', label: 'How many grouping factors?', show: (a) => a.goal === 'compare' && a.outcome !== 'binary', options: [
      { value: '1', label: 'One', help: 'e.g. treatment only' },
      { value: '2', label: 'Two (crossed)', help: 'e.g. genotype × treatment, time × dose. Every combination is a group.' },
    ] },
    { id: 'groups', label: 'How many groups are you comparing?', show: (a) => (a.goal === 'compare' && a.factors !== '2') || a.goal === 'survival', options: [
      { value: '2', label: 'Two', help: '' },
      { value: '3plus', label: 'Three or more', help: '' },
    ] },
    { id: 'design', label: 'Are the groups independent or matched?', show: (a) => a.goal === 'compare' || a.goal === 'assoc', options: [
      { value: 'independent', label: 'Independent', help: 'different subjects / samples in each group' },
      { value: 'paired', label: 'Paired / repeated measures', help: 'the same subjects measured in every condition, before/after, or matched pairs (e.g. same experiment day)' },
      { value: 'mixed', label: 'Mixed', help: 'one factor between subjects, the other within (e.g. genotype × time)', show: (a) => a.factors === '2' && a.goal === 'compare' },
    ] },
    { id: 'replicates', label: 'What are your replicates?', show: (a) => isCompare(a) || a.goal === 'relate', options: [
      { value: 'biological', label: 'Independent biological replicates', help: 'different animals, patients, cultures or plants' },
      { value: 'technical', label: 'Some are technical replicates', help: 'repeat injections, wells or measurements of the same biological sample' },
    ] },
    { id: 'features', label: 'How many outcomes are you testing?', show: (a) => isCompare(a) || a.goal === 'relate', options: [
      { value: 'one', label: 'One (or a few planned ones)', help: '' },
      { value: 'many', label: 'Many at once', help: 'proteomics, metabolomics, transcriptomics: hundreds to thousands of features' },
    ] },
    { id: 'covariate', label: 'Do you need to adjust for a continuous covariate?', show: (a) => a.goal === 'compare' && numericOutcome(a), options: [
      { value: 'no', label: 'No', help: '' },
      { value: 'yes', label: 'Yes', help: 'e.g. age, body weight, baseline value, protein load' },
    ] },
    { id: 'n', label: 'Sample size per group (biological replicates)?', show: (a) => isCompare(a) || a.goal === 'relate', options: [
      { value: 'lt5', label: 'Fewer than 5', help: '' },
      { value: '5to15', label: '5 – 15', help: '' },
      { value: '15to30', label: '15 – 30', help: '' },
      { value: 'gt30', label: 'More than 30', help: '' },
    ] },
    { id: 'relGoal', label: 'What is the question about the relationship?', show: (a) => a.goal === 'relate', options: [
      { value: 'correlation', label: 'How strongly do they move together?', help: 'neither variable is the cause; correlation' },
      { value: 'regression', label: 'Predict Y from X', help: 'regression, dose–response, standard curve' },
    ] },
    { id: 'relShape', label: 'What does the scatter plot look like?', show: (a) => a.goal === 'relate', options: [
      { value: 'linear', label: 'Roughly a straight line', help: '' },
      { value: 'monotonic', label: 'Always up (or down) but curved', help: 'e.g. saturating' },
      { value: 'curved', label: 'Goes up then down (or a sigmoid)', help: '' },
      { value: 'unknown', label: 'Not plotted yet', help: '' },
    ] },
    { id: 'normal', labelFn: (a) => normalQuestion(a), show: (a) => (isCompare(a) && canBeParametric(a)) || (a.goal === 'relate' && a.relShape !== 'curved'), options: [
      { value: 'yes', label: 'Yes, roughly normal', help: 'points follow the line in a Q–Q plot; no strong skew' },
      { value: 'no', label: 'No, clearly skewed or with outliers', help: '' },
      { value: 'unknown', label: "Don't know / haven't checked", help: '' },
    ] },
    { id: 'transformHelps', label: 'Does a transformation make it normal?', show: (a) => ((isCompare(a) && canBeParametric(a)) || a.goal === 'relate') && a.normal === 'no', options: [
      { value: 'yes', label: 'Yes (e.g. after log)', help: '' },
      { value: 'no', label: 'No, still not normal', help: '' },
      { value: 'untried', label: "Haven't tried", help: '' },
    ] },
    { id: 'variance', label: 'Are the spreads (SDs) similar across groups?', show: (a) => a.goal === 'compare' && a.design === 'independent' && canBeParametric(a), options: [
      { value: 'equal', label: 'Yes, similar', help: 'largest SD less than about 2× the smallest' },
      { value: 'unequal', label: 'No, clearly different', help: '' },
      { value: 'unknown', label: "Don't know", help: '' },
    ] },
    { id: 'comparisons', label: 'Which comparisons matter to you?', show: (a) => a.goal === 'compare' && (a.groups === '3plus' || a.factors === '2') && a.outcome !== 'binary', options: [
      { value: 'all', label: 'Every group against every other', help: '' },
      { value: 'control', label: 'Each group against one control', help: '' },
      { value: 'planned', label: 'A few specific comparisons chosen in advance', help: '' },
      { value: 'trend', label: 'A trend across ordered groups', help: 'e.g. increasing dose or time' },
      { value: 'omnibus', label: 'Only whether there is any difference', help: '' },
    ] },
    { id: 'tableSize', label: 'How big is the table?', show: (a) => a.goal === 'assoc', options: [
      { value: '2x2', label: '2 × 2', help: 'two groups, two outcomes' },
      { value: 'larger', label: 'Larger', help: 'more groups or more categories' },
    ] },
    { id: 'expected', label: 'Are the counts large?', show: (a) => a.goal === 'assoc' && a.design !== 'paired', options: [
      { value: 'ok', label: 'Yes, every expected count is 5 or more', help: 'expected = row total × column total / grand total' },
      { value: 'small', label: 'No, some cells are small', help: '' },
      { value: 'unknown', label: "Don't know", help: '' },
    ] },
    { id: 'ordered', label: 'Are the categories ordered?', show: (a) => a.goal === 'assoc' && a.tableSize === 'larger' && a.design !== 'paired', options: [
      { value: 'no', label: 'No', help: '' },
      { value: 'yes', label: 'Yes, one variable is ordered', help: 'e.g. dose levels, grade' },
    ] },
    { id: 'agreeType', label: 'What is being measured?', show: (a) => a.goal === 'agree', options: [
      { value: 'continuous', label: 'A continuous value', help: 'two assays, two instruments' },
      { value: 'categorical', label: 'Categories', help: 'two raters assigning classes' },
      { value: 'ordinal', label: 'Ordered scores', help: 'two raters grading 0–3' },
    ] },
    { id: 'covariateSurv', label: 'Do you need to adjust for other variables?', show: (a) => a.goal === 'survival', options: [
      { value: 'no', label: 'No', help: '' },
      { value: 'yes', label: 'Yes', help: 'age, sex, stage…' },
    ] },
  ];
  function normalQuestion(a) {
    if (a.goal === 'relate') return 'Are both variables (or the residuals) roughly normal?';
    if (a.goal === 'onesample') return 'Are the values roughly normal?';
    if (a.design === 'paired' && a.factors !== '2') return 'Are the paired differences roughly normal?';
    return 'Are the residuals (values minus their group mean) roughly normal?';
  }
  const optionVisible = (o, a) => !o.show || o.show(a);
  /** Questions that apply to the current answers, in order, with labels resolved. */
  function visibleQuestions(a) {
    return QUESTIONS.filter((q) => !q.show || q.show(a)).map((q) => Object.assign({}, q, {
      label: q.labelFn ? q.labelFn(a) : q.label, options: q.options.filter((o) => optionVisible(o, a)),
    }));
  }
  /** Drops answers to questions that are no longer shown or options no longer offered. */
  function prune(a) {
    let out = Object.assign({}, a); let changed = true;
    while (changed) {
      changed = false;
      const vis = visibleQuestions(out); const ids = new Set(vis.map((q) => q.id));
      for (const k of Object.keys(out)) {
        const q = vis.find((x) => x.id === k);
        if (!ids.has(k) || (q && !q.options.some((o) => o.value === out[k]))) { delete out[k]; changed = true; }
      }
    }
    return out;
  }
  /** The first visible question without an answer, or null when the tree is complete. */
  function nextQuestion(a) { return visibleQuestions(a).find((q) => !a[q.id]) || null; }

  // ------------------------------------------------------------------ test catalogue
  // r / py: how to run it. Keep them short and correct.
  const T = {
    student_t: { name: "Student's t-test", r: 't.test(y ~ group, data = d, var.equal = TRUE)', py: 'scipy.stats.ttest_ind(a, b)', effect: "Mean difference with 95% CI; Cohen's d / Hedges' g" },
    welch_t: { name: "Welch's t-test", r: 't.test(y ~ group, data = d)  # Welch is R\'s default', py: 'scipy.stats.ttest_ind(a, b, equal_var=False)', effect: "Mean difference with 95% CI; Hedges' g" },
    paired_t: { name: 'Paired t-test', r: 't.test(d$after, d$before, paired = TRUE)', py: 'scipy.stats.ttest_rel(after, before)', effect: "Mean of the differences with 95% CI; Cohen's d_z" },
    one_sample_t: { name: 'One-sample t-test', r: 't.test(y, mu = ref)', py: 'scipy.stats.ttest_1samp(y, ref)', effect: "Mean difference from the reference with 95% CI; Cohen's d" },
    mwu: { name: 'Mann-Whitney U test (Wilcoxon rank-sum)', r: 'wilcox.test(y ~ group, data = d)', py: 'scipy.stats.mannwhitneyu(a, b)', effect: 'Rank-biserial correlation; Hodges-Lehmann shift with CI' },
    wilcoxon: { name: 'Wilcoxon signed-rank test', r: 'wilcox.test(d$after, d$before, paired = TRUE)', py: 'scipy.stats.wilcoxon(after, before)', effect: 'Median difference; matched-pairs rank-biserial r' },
    one_sample_wilcoxon: { name: 'One-sample Wilcoxon signed-rank test', r: 'wilcox.test(y, mu = ref)', py: 'scipy.stats.wilcoxon(y - ref)', effect: 'Median difference from the reference; rank-biserial r' },
    anova: { name: 'One-way ANOVA', r: 'summary(aov(y ~ group, data = d))', py: 'scipy.stats.f_oneway(*groups)', effect: 'ω² (less biased than η²)' },
    welch_anova: { name: "Welch's ANOVA", r: 'oneway.test(y ~ group, data = d)', py: 'pingouin.welch_anova(d, dv="y", between="group")', effect: 'ω² (approximate)' },
    kw: { name: 'Kruskal-Wallis test', r: 'kruskal.test(y ~ group, data = d)', py: 'scipy.stats.kruskal(*groups)', effect: 'ε² (epsilon squared)' },
    rm_anova: { name: 'Repeated-measures ANOVA (Greenhouse-Geisser corrected)', r: 'afex::aov_ez("subject", "y", d, within = "condition")', py: 'pingouin.rm_anova(d, dv="y", within="condition", subject="subject", correction=True)', effect: 'partial η² or generalised η²' },
    mixed_model: { name: 'Linear mixed-effects model', r: 'lme4::lmer(y ~ condition + (1 | subject), data = d)  # + emmeans for contrasts', py: 'statsmodels.formula.api.mixedlm("y ~ condition", d, groups="subject").fit()', effect: 'Estimated differences (emmeans) with CI' },
    friedman: { name: 'Friedman test', r: 'friedman.test(y ~ condition | subject, data = d)', py: 'scipy.stats.friedmanchisquare(*conditions)', effect: "Kendall's W" },
    two_way: { name: 'Two-way ANOVA', r: 'car::Anova(lm(y ~ A * B, data = d, contrasts = list(A = contr.sum, B = contr.sum)), type = 3)', py: 'statsmodels: anova_lm(ols("y ~ C(A, Sum) * C(B, Sum)", d).fit(), typ=3)', effect: 'partial η² per term' },
    two_way_rm: { name: 'Two-way repeated-measures / mixed ANOVA, or a mixed-effects model', r: 'afex::aov_ez("subject", "y", d, within = "time", between = "genotype")\n# or lme4::lmer(y ~ genotype * time + (1 | subject), d)', py: 'pingouin.mixed_anova(d, dv="y", within="time", between="genotype", subject="subject")', effect: 'partial η² per term; estimated marginal means' },
    art: { name: 'Aligned Rank Transform (ART) ANOVA', r: 'ARTool::art(y ~ A * B, data = d) |> anova()', py: '(no standard package; use R ARTool)', effect: 'partial η² on aligned ranks' },
    ancova: { name: 'ANCOVA (linear model with covariate)', r: 'car::Anova(lm(y ~ group + covariate, data = d), type = 2)  # + emmeans', py: 'pingouin.ancova(d, dv="y", covar="covariate", between="group")', effect: 'Covariate-adjusted mean differences with CI; partial η²' },
    limma: { name: 'Moderated t-test (limma) with Benjamini-Hochberg FDR', r: 'fit <- limma::eBayes(limma::lmFit(log2mat, design)); limma::topTable(fit, coef = 2, number = Inf)', py: '(use R limma via rpy2, or inmoose.limma)', effect: 'log₂ fold change with CI; volcano plot' },
    limma_f: { name: 'limma moderated F-test, then contrasts, with BH FDR', r: 'fit <- limma::eBayes(limma::contrasts.fit(limma::lmFit(log2mat, design), contrasts)); limma::topTable(fit, number = Inf)', py: '(use R limma via rpy2, or inmoose.limma)', effect: 'log₂ fold changes per contrast' },
    glm_poisson: { name: 'Negative binomial (or Poisson) regression', r: 'MASS::glm.nb(count ~ group, data = d)  # + offset(log(area)) if exposure differs', py: 'statsmodels.formula.api.glm("count ~ group", d, family=sm.families.NegativeBinomial()).fit()', effect: 'Rate ratio with 95% CI' },
    glm_binomial: { name: 'Logistic (binomial) regression', r: 'glm(cbind(k, n - k) ~ group, family = binomial, data = d)  # or quasibinomial / glmer for overdispersion', py: 'statsmodels.formula.api.glm("k + nk ~ group", d, family=sm.families.Binomial()).fit()', effect: 'Odds ratio with 95% CI' },
    pearson: { name: "Pearson's correlation", r: 'cor.test(d$x, d$y)', py: 'scipy.stats.pearsonr(x, y)', effect: 'r with 95% CI (and r²)' },
    spearman: { name: "Spearman's rank correlation", r: 'cor.test(d$x, d$y, method = "spearman")', py: 'scipy.stats.spearmanr(x, y)', effect: 'ρ (rho)' },
    kendall: { name: "Kendall's tau", r: 'cor.test(d$x, d$y, method = "kendall")', py: 'scipy.stats.kendalltau(x, y)', effect: 'τ (tau)' },
    linreg: { name: 'Linear regression', r: 'summary(lm(y ~ x, data = d)); plot(lm(y ~ x, data = d))', py: 'statsmodels.formula.api.ols("y ~ x", d).fit().summary()', effect: 'Slope with 95% CI; R²' },
    nonlinreg: { name: 'Non-linear regression (e.g. 4-parameter logistic)', r: 'drc::drm(y ~ x, data = d, fct = drc::LL.4())', py: 'scipy.optimize.curve_fit(model, x, y)', effect: 'Fitted parameters (EC50, Hill slope) with CI' },
    chisq: { name: "Pearson's chi-square test of independence", r: 'chisq.test(table(d$a, d$b))', py: 'scipy.stats.chi2_contingency(table)', effect: "Cramér's V (or odds ratio for 2 × 2)" },
    fisher: { name: "Fisher's exact test", r: 'fisher.test(table(d$a, d$b))', py: 'scipy.stats.fisher_exact(table)  # 2 × 2', effect: 'Odds ratio with 95% CI' },
    fisher_rxc: { name: 'Fisher-Freeman-Halton exact test (or Monte Carlo chi-square)', r: 'fisher.test(tab, simulate.p.value = TRUE, B = 1e5)', py: 'scipy.stats.chi2_contingency(tab)  # then permutation test for the p-value', effect: "Cramér's V" },
    trend_ca: { name: 'Cochran-Armitage test for trend', r: 'prop.trend.test(successes, totals)', py: 'statsmodels Table(tab).test_ordinal_association()', effect: 'Slope of the proportion across levels' },
    mcnemar: { name: "McNemar's test", r: 'mcnemar.test(tab)', py: 'statsmodels.stats.contingency_tables.mcnemar(tab, exact=True)', effect: 'Ratio of discordant pairs (odds ratio)' },
    bowker: { name: 'Stuart-Maxwell / Bowker test of symmetry', r: 'mcnemar.test(tab)  # Bowker for k × k', py: 'statsmodels SquareTable(tab).symmetry()', effect: 'Discordant proportions' },
    cochran_q: { name: "Cochran's Q test", r: 'RVAideMemoire::cochran.qtest(y ~ condition | subject, d)', py: 'statsmodels.stats.contingency_tables.cochrans_q(x)', effect: 'Differences in proportion' },
    bland_altman: { name: 'Bland-Altman analysis + ICC (or Lin\'s CCC)', r: 'BlandAltmanLeh::bland.altman.plot(m1, m2); irr::icc(cbind(m1, m2), model = "twoway", type = "agreement")', py: 'pingouin.plot_blandaltman(m1, m2); pingouin.intraclass_corr(...)', effect: 'Bias and 95% limits of agreement; ICC with CI' },
    kappa: { name: "Cohen's kappa (Fleiss' kappa for 3+ raters)", r: 'irr::kappa2(cbind(r1, r2))', py: 'sklearn.metrics.cohen_kappa_score(r1, r2)', effect: 'κ with CI' },
    wkappa: { name: "Weighted kappa", r: 'irr::kappa2(cbind(r1, r2), weight = "squared")', py: 'sklearn.metrics.cohen_kappa_score(r1, r2, weights="quadratic")', effect: 'Weighted κ with CI' },
    logrank: { name: 'Kaplan-Meier curves with the log-rank test', r: 'survival::survdiff(Surv(time, event) ~ group, data = d)', py: 'lifelines.statistics.logrank_test(...)', effect: 'Median survival per group; hazard ratio' },
    cox: { name: 'Cox proportional hazards regression', r: 'survival::coxph(Surv(time, event) ~ group + age, data = d); cox.zph(fit)', py: 'lifelines.CoxPHFitter().fit(d, "time", "event")', effect: 'Hazard ratio with 95% CI' },
  };
  const P = {
    tukey: { name: 'Tukey HSD (Tukey-Kramer for unequal n)', r: 'TukeyHSD(aov(y ~ group, d))', py: 'scipy.stats.tukey_hsd(*groups)' },
    games_howell: { name: 'Games-Howell', r: 'rstatix::games_howell_test(d, y ~ group)', py: 'pingouin.pairwise_gameshowell(d, dv="y", between="group")' },
    dunnett: { name: "Dunnett's test", r: 'emmeans::contrast(emmeans(fit, "group"), "trt.vs.ctrl")', py: 'scipy.stats.dunnett(*treated, control=ctrl)' },
    welch_control: { name: "Welch t-tests against the control, Holm-adjusted (or Dunnett's T3)", r: 'pairwise.t.test(d$y, d$group, pool.sd = FALSE, p.adjust = "holm")', py: 'pingouin.pairwise_tests(d, dv="y", between="group", correction=False, padjust="holm")' },
    planned: { name: 'Planned contrasts with Holm (or Šidák) adjustment', r: 'emmeans::contrast(emmeans(fit, "group"), list(...), adjust = "holm")', py: 'statsmodels t_test on the fitted model, then multipletests(method="holm")' },
    trend: { name: 'Linear trend contrast (or regression on dose)', r: 'emmeans::contrast(emmeans(fit, "dose"), "poly")', py: 'statsmodels ols("y ~ dose_numeric", d)' },
    dunn: { name: "Dunn's test with Holm adjustment", r: 'FSA::dunnTest(y ~ group, data = d, method = "holm")', py: 'scikit_posthocs.posthoc_dunn(d, "y", "group", p_adjust="holm")' },
    dunn_control: { name: "Dunn's test against the control, Holm-adjusted", r: 'FSA::dunnTest(...)  # keep only the comparisons with control', py: 'scikit_posthocs.posthoc_dunn(...)' },
    jt: { name: 'Jonckheere-Terpstra trend test', r: 'clinfun::jonckheere.test(d$y, d$dose)', py: '(scipy has no JT; use R clinfun)' },
    paired_holm: { name: 'Pairwise paired t-tests, Holm-adjusted', r: 'pairwise.t.test(d$y, d$condition, paired = TRUE, p.adjust = "holm")', py: 'pingouin.pairwise_tests(d, dv="y", within="condition", subject="subject", padjust="holm")' },
    paired_control: { name: 'Paired t-tests against the control, Holm-adjusted (or Dunnett on a mixed model)', r: 'emmeans::contrast(emmeans(lmer_fit, "condition"), "trt.vs.ctrl")', py: 'pingouin.pairwise_tests(...)  # keep the control comparisons' },
    rm_trend: { name: 'Polynomial (linear) contrast in the repeated-measures model', r: 'emmeans::contrast(emmeans(fit, "time"), "poly")', py: 'statsmodels mixedlm with numeric time' },
    wilcoxon_holm: { name: 'Pairwise Wilcoxon signed-rank tests, Holm-adjusted', r: 'pairwise.wilcox.test(d$y, d$condition, paired = TRUE, p.adjust = "holm")', py: 'pingouin.pairwise_tests(d, dv="y", within="condition", subject="subject", parametric=False, padjust="holm")' },
    page: { name: "Page's trend test", r: 'crank::page.trend.test(mat)', py: 'scipy.stats.page_trend_test(mat)' },
    simple_effects: { name: 'Simple effects: compare levels of one factor within each level of the other (Tukey or Šidák/Holm)', r: 'emmeans::emmeans(fit, pairwise ~ A | B, adjust = "tukey")', py: 'pingouin.pairwise_tests(d, dv="y", between=["B", "A"], padjust="holm")' },
    main_effects: { name: 'Main-effect comparisons on marginal means (Tukey)', r: 'emmeans::emmeans(fit, pairwise ~ A)', py: 'pingouin.pairwise_tests(d, dv="y", between="A")' },
    ancova_posthoc: { name: 'Pairwise comparisons of adjusted means (emmeans, Tukey or Dunnett)', r: 'emmeans::emmeans(fit, pairwise ~ group)', py: 'statsmodels t_test_pairwise on the fitted model' },
    chisq_resid: { name: 'Standardised residuals per cell, or pairwise 2 × 2 Fisher tests with Holm', r: 'chisq.test(tab)$stdres; rcompanion::pairwiseNominalIndependence(tab)', py: 'statsmodels Table(tab).standardized_resids' },
    lsmeans_binary: { name: 'Pairwise comparisons of proportions, Holm-adjusted', r: 'pairwise.prop.test(successes, totals, p.adjust = "holm")', py: 'statsmodels proportions_ztest per pair + multipletests' },
    glm_posthoc: { name: 'Pairwise contrasts on the model (emmeans), Holm or Tukey', r: 'emmeans::emmeans(fit, pairwise ~ group, type = "response")', py: 'statsmodels t_test_pairwise on the fitted model' },
    limma_contrasts: { name: 'Moderated contrasts, BH across features', r: 'limma::contrasts.fit(fit, makeContrasts(...))', py: '' },
  };

  // ------------------------------------------------------------------ the rules
  function recommend(a0) {
    const orig = prune(a0 || {});
    const a = Object.assign({}, orig); // the rules below may rewrite the design (e.g. ratios to own control)
    const out = { _orig: orig, complete: !nextQuestion(a), steps: [], warnings: [], assumptions: [], alternatives: [], transform: null };
    const why = (s) => out.steps.push(s);
    const warn = (s) => out.warnings.push(s);
    const alt = (key, when) => out.alternatives.push(Object.assign({ key, when }, T[key] || P[key]));
    const pick = (key) => { out.key = key; Object.assign(out, { test: T[key] }); };
    const post = (key, reason) => { out.posthocKey = key; out.posthoc = Object.assign({ reason }, P[key]); };
    if (!a.goal) return out;

    if (a.goal === 'relate') return relate(a, out, why, warn, alt, pick);
    if (a.goal === 'assoc') return assoc(a, out, why, warn, alt, pick, post);
    if (a.goal === 'agree') return agree(a, out, why, warn, alt, pick);
    if (a.goal === 'survival') return survival(a, out, why, warn, alt, pick);
    if (a.outcome === 'binary') return binaryCompare(a, out, why, warn, alt, pick, post);
    if (!a.outcome) return out;

    commonWarnings(a, warn, why);

    // --- scale: which transformation does the data type call for?
    const o = a.outcome; let parametric = null; let reasonP = '';
    if (o === 'ratio') {
      out.transform = { name: 'log₂', why: 'Ratios are asymmetric on the raw scale: a 2-fold increase is +1.0 but a 2-fold decrease is only −0.5. On a log scale both are ±1, the spread becomes symmetric and the mean of the logs back-transforms to a geometric mean fold change.' };
      why('Ratios and fold changes are analysed on a log scale (log₂ is easiest to read: 1 = doubling).');
      if (a.ratioControl === 'perExperiment') {
        why('Because every value was divided by its own control, the control column is exactly 1 with no variance. A t-test or ANOVA that includes it as a group is invalid (it assumes the control has spread like the others).');
        why('Instead treat each experiment as a matched set: test log₂(ratio) against 0 with a one-sample test, or, better, analyse the un-normalised values on a log scale with experiment as the pairing / blocking factor. These are the same test, and the second keeps the control variability in the analysis.');
        a.design = a.goal === 'onesample' ? a.design : 'paired';
        if (a.goal === 'compare' && a.groups === '2' && a.factors !== '2') a.goal = 'onesample-ratio';
      } else if (a.ratioControl === 'controlMean') {
        why('Dividing everything by the control mean only rescales the data; the controls keep their spread, so analyse the log-ratios like any other measurement.');
      }
    } else if (o === 'intensity') {
      out.transform = { name: 'log (log₂ or log₁₀)', why: 'Intensities and concentrations are usually log-normal: multiplicative errors, a long right tail and spread that grows with the mean. Logging fixes all three, and differences on the log scale are fold changes.' };
      why('Intensity / abundance data are almost always log-normal, so log-transform first (this is standard in proteomics, metabolomics and qPCR).');
    } else if (o === 'proportion' && a.propType === 'continuous') {
      out.transform = { name: 'logit (if many values are near 0 or 1)', why: 'Proportions are bounded, so the spread shrinks near 0 % and 100 %. Between about 20 % and 80 % they usually behave well untransformed; near the bounds use logit = log(p / (1 − p)) or beta regression. Arcsine-square-root is outdated.' };
      why('Continuous percentages are bounded at 0 and 100 %; check whether values pile up near either bound.');
    } else if (o === 'count' && a.countSize === 'large') {
      out.transform = { name: '√x or log(x + 1)', why: 'Count variance rises with the mean (Poisson-like). A square-root or log transform stabilises it; a negative binomial model is the more principled option.' };
      why('Large counts behave nearly continuously; a square-root or log transform usually makes the variance even across groups.');
    }

    // --- model-based outcomes that are better served by a GLM
    if (o === 'count' && a.countSize === 'small') {
      why('Small counts with zeros are discrete and skewed; no transformation makes them normal, and log(x + 1) is biased. A count model handles them directly.');
      pick('glm_poisson'); out.family = 'glm';
      out.assumptions.push('Use negative binomial when the variance is larger than the mean (it nearly always is with biological replicates).', 'Add an offset if the area / volume / time observed differs between samples.');
      alt(a.design === 'paired' ? 'wilcoxon' : (a.groups === '3plus' ? 'kw' : 'mwu'), 'a simpler rank test if you cannot fit a model');
      if (a.groups === '3plus' || a.factors === '2') post('glm_posthoc', 'pairwise comparisons on the fitted model');
      if (a.design === 'paired') why('With paired / repeated samples add a random effect for subject (lme4::glmer.nb).');
      return finish(a, out);
    }
    if (o === 'proportion' && a.propType === 'kofn') {
      why('When you know the k and the n behind each proportion, model the counts directly with logistic (binomial) regression. It weights each sample by how many units were counted, which a t-test on percentages cannot.');
      pick('glm_binomial'); out.family = 'glm';
      out.assumptions.push('Biological replicates usually vary more than binomial: use quasibinomial or a mixed model with a sample-level random effect (glmer).');
      alt(a.design === 'paired' ? 'paired_t' : (a.groups === '3plus' ? 'anova' : 'welch_t'), 'on logit-transformed proportions, if the counts per sample are large and similar');
      if (a.groups === '3plus' || a.factors === '2') post('glm_posthoc', 'pairwise comparisons of the fitted proportions');
      if (a.design === 'paired') why('With paired / repeated samples add a random effect for subject (lme4::glmer).');
      return finish(a, out);
    }

    // --- parametric or not?
    if (o === 'ordinal') {
      parametric = false; reasonP = 'Ordinal scores have ranks but not equal spacing, so means are not meaningful: use a rank-based test.';
    } else if (a.normal === 'yes') {
      parametric = true; reasonP = 'The data (residuals) look normal, so a parametric test is valid and has the most power.';
    } else if (a.normal === 'no') {
      if (a.transformHelps === 'yes') { parametric = true; reasonP = 'The transformed data are normal, so run the parametric test on the transformed values and back-transform the estimates when reporting.'; if (!out.transform) out.transform = { name: 'the one that worked', why: 'Report results on the back-transformed scale (e.g. geometric means and fold changes after log).' }; }
      else if (a.transformHelps === 'untried' && (o === 'intensity' || o === 'ratio' || o === 'continuous' || o === 'count')) {
        parametric = true; reasonP = 'Skewed positive data very often become normal after a log (or square-root) transform. Try that first: if it works, use the parametric test below on the transformed data; if not, use the rank-based alternative.';
        out.provisional = true;
      } else if (a.n === 'gt30' && a.design !== 'paired') { parametric = true; reasonP = 'The data are not normal, but with more than 30 per group the means are close to normal (central limit theorem), so the parametric test is robust. A rank test is a fine alternative.'; }
      else { parametric = false; reasonP = 'The data are not normal and a transformation does not fix it, so use a rank-based (non-parametric) test.'; }
    } else { // unknown
      if (a.n === 'lt5') { parametric = true; reasonP = 'With fewer than 5 per group you cannot check normality from the data, and rank tests have almost no power (see warnings). Base the choice on what is known about this kind of data (e.g. intensities are log-normal), transform accordingly, and use the parametric test.'; }
      else if (a.n === 'gt30') { parametric = true; reasonP = 'With more than 30 per group, parametric tests are robust to moderate non-normality. Still look at a Q–Q plot for gross skew or outliers.'; }
      else { parametric = true; out.provisional = true; reasonP = 'Check normality before deciding: make a Q–Q plot of the residuals (or use the data analyser on the right-hand tab). If they look normal, use the test below; if not, try a transformation, then fall back to the rank-based alternative.'; }
    }
    why(reasonP);
    out.family = parametric ? 'parametric' : 'nonparametric';

    // --- many features (omics)
    if (a.features === 'many' && a.goal !== 'onesample') {
      why('With many features tested at once, use a method that borrows information across features (empirical-Bayes moderated statistics) and control the false discovery rate with Benjamini-Hochberg.');
      const multi = a.groups === '3plus' || a.factors === '2';
      pick(multi ? 'limma_f' : 'limma');
      if (multi) post('limma_contrasts', 'one moderated contrast per comparison of interest');
      out.assumptions.push('Run it on log-transformed intensities.', 'Decide how to handle missing values first: filter features by valid values per group; impute only with a method suited to the missingness (values missing because they are below detection are not missing at random).', 'Add the pairing / batch factor to the design matrix if the samples are paired or run in batches.');
      if (!parametric) why('limma is robust to moderate non-normality because the per-feature variance is shrunk towards a common value; rank tests per feature have very little power at typical omics sample sizes.');
      alt(multi ? (a.design === 'paired' ? 'friedman' : 'kw') : (a.design === 'paired' ? 'wilcoxon' : 'mwu'), 'per feature, then BH across features; only with large n');
      return finish(a, out);
    }

    // --- covariate
    if (a.covariate === 'yes' && a.goal === 'compare') {
      why('Adjusting for a covariate (ANCOVA) removes variation it explains and gives covariate-adjusted group means.');
      pick('ancova');
      out.assumptions.push('The covariate–outcome slope is similar in every group (test the group × covariate interaction).', 'The covariate was not affected by the treatment.', 'Residuals roughly normal with similar spread.');
      if (a.groups === '3plus' || a.factors === '2') post('ancova_posthoc', 'compare the adjusted means');
      if (!parametric) alt('kw', 'or Quade’s rank ANCOVA if residuals stay non-normal; better: transform the outcome');
      return finish(a, out);
    }

    // --- one-sample (including ratio-to-own-control with two groups)
    if (a.goal === 'onesample' || a.goal === 'onesample-ratio') {
      const ratioPaired = a.goal === 'onesample-ratio';
      if (parametric) { pick('one_sample_t'); alt('one_sample_wilcoxon', 'if the (log) values are clearly not normal'); }
      else { pick('one_sample_wilcoxon'); alt('one_sample_t', 'if a transformation makes the values normal'); }
      if (ratioPaired) { why('Test log₂(treated / control) against 0. Equivalent: a ratio paired t-test, i.e. a paired t-test on the logged raw values.'); alt('paired_t', 'on log(raw values), pairing each treated sample with its own control (identical result, clearer)'); }
      else why(o === 'ratio' ? 'Test the log₂ ratios against log₂(reference), i.e. 0 for a fold change of 1.' : 'Test the values against the reference value.');
      out.assumptions.push(parametric ? 'Values (or log values) are roughly normal and independent.' : 'Differences from the reference are roughly symmetric.');
      return finish(a, out);
    }

    // --- two factors
    if (a.factors === '2') {
      if (a.design === 'independent') {
        if (parametric) { pick('two_way'); why('Two crossed factors: a two-way ANOVA tests each factor and their interaction (does the effect of one factor depend on the other?).'); alt('art', 'if residuals remain non-normal after transformation'); }
        else { pick('art'); why('Two factors with non-normal data: the Aligned Rank Transform keeps the interaction test valid (ranking the raw data does not).'); alt('two_way', 'on transformed data, if a transformation works'); }
        out.assumptions.push('Unbalanced designs: use Type II sums of squares when there is no interaction, Type III (with sum-to-zero contrasts) when there is one. R’s default aov() is Type I and order-dependent.');
      } else {
        pick('two_way_rm'); why(a.design === 'mixed' ? 'One factor is between subjects and the other within: a mixed ANOVA, or a linear mixed model with a random intercept per subject.' : 'Both factors are measured within the same subjects: a two-way repeated-measures ANOVA, or a linear mixed model with subject as a random effect.');
        alt('mixed_model', 'preferable when any values are missing, the design is unbalanced, or time points are unevenly spaced');
        if (!parametric) alt('art', 'ART with a subject error term (ARTool supports Error(subject)) for non-normal data');
      }
      why('Look at the interaction first. If it is significant, the main effects are hard to interpret on their own; compare levels of one factor within each level of the other (simple effects).');
      if (a.comparisons === 'omnibus') { out.posthoc = null; why('You only need the ANOVA table, so no post hoc test.'); }
      else if (a.comparisons === 'trend') post('trend', 'test the trend across the ordered factor (within each level of the other if they interact)');
      else post('simple_effects', a.comparisons === 'control' ? 'within each level of the other factor, compare each level to the control (Dunnett)' : 'within each level of the other factor; use Tukey for all pairs, Šidák/Holm for a few planned ones');
      return finish(a, out);
    }

    // --- one factor
    const k3 = a.groups === '3plus'; const paired = a.design === 'paired';
    if (!a.groups || !a.design) return finish(a, out);
    if (!k3 && !paired) {
      if (parametric) {
        if (a.variance === 'equal') { pick('student_t'); why('Two independent groups with similar spread: Student’s t-test. (Welch’s gives almost the same answer here and is a safe default.)'); alt('welch_t', 'safe default whenever spreads or sample sizes differ'); }
        else { pick('welch_t'); why('Two independent groups: Welch’s t-test does not assume equal variances and loses almost nothing when they are equal, so it is the recommended default.'); alt('student_t', 'only if spreads and sample sizes are similar'); }
        alt('mwu', 'if the (transformed) data are clearly non-normal');
      } else {
        pick('mwu'); why('Two independent groups, non-normal: the Mann-Whitney U test compares ranks.');
        out.assumptions.push('It tests whether values in one group tend to be larger than in the other. It only tests medians if both groups have the same shape and spread.');
        if (a.variance === 'unequal') alt('welch_t', 'on transformed data; or the Brunner-Munzel test, which tolerates unequal spreads');
        else alt('welch_t', 'on transformed data, if a transformation makes them normal');
      }
    } else if (!k3 && paired) {
      if (parametric) { pick('paired_t'); why('Two matched measurements per subject: the paired t-test analyses the within-subject differences, removing between-subject variation.'); out.assumptions.push('The differences (not the raw values) are roughly normal.'); alt('wilcoxon', 'if the differences are clearly non-normal'); }
      else { pick('wilcoxon'); why('Two matched measurements, non-normal differences: the Wilcoxon signed-rank test.'); out.assumptions.push('The differences are roughly symmetric around their median; if not, use the sign test.'); alt('paired_t', 'if a transformation makes the differences normal'); }
    } else if (k3 && !paired) {
      if (parametric) {
        const eq = a.variance === 'equal';
        pick(eq ? 'anova' : 'welch_anova');
        why(eq ? 'Three or more independent groups with similar spread: one-way ANOVA.' : 'Three or more independent groups whose spread may differ: Welch’s ANOVA keeps the false-positive rate correct when variances are unequal, and loses little when they are equal.');
        if (eq) alt('welch_anova', 'if spreads differ (largest SD > ~2× smallest), especially with unequal group sizes');
        alt('kw', 'if the (transformed) residuals are clearly non-normal');
        const c = a.comparisons;
        if (c === 'all') post(eq ? 'tukey' : 'games_howell', eq ? 'all pairwise comparisons with equal variances' : 'all pairwise comparisons without assuming equal variances');
        else if (c === 'control') post(eq ? 'dunnett' : 'welch_control', 'only comparisons with the control: fewer tests than all pairs, so more power');
        else if (c === 'planned') { post('planned', 'test only the comparisons you planned; with few planned comparisons the omnibus ANOVA is not required first'); }
        else if (c === 'trend') post('trend', 'for ordered groups a trend test has far more power than pairwise tests');
        else if (c === 'omnibus') why('You only need to know whether any group differs, so no post hoc test.');
      } else {
        pick('kw'); why('Three or more independent groups, non-normal: the Kruskal-Wallis test compares ranks.');
        alt('welch_anova', 'on transformed data, if a transformation makes them normal');
        const c = a.comparisons;
        if (c === 'all' || c === 'planned') post('dunn', c === 'planned' ? 'Dunn’s test on just the planned pairs' : 'all pairwise comparisons on the ranks');
        else if (c === 'control') post('dunn_control', 'only comparisons with the control');
        else if (c === 'trend') post('jt', 'for ordered groups');
        else if (c === 'omnibus') why('You only need to know whether any group differs, so no post hoc test.');
        out.assumptions.push('Mann-Whitney tests run pairwise after Kruskal-Wallis use different rankings from the omnibus test; Dunn’s test uses the same ranks and is the usual follow-up.');
      }
    } else {
      if (parametric) {
        pick('rm_anova'); why('Three or more conditions measured on the same subjects: repeated-measures ANOVA. Apply the Greenhouse-Geisser correction by default rather than relying on a sphericity test.');
        alt('mixed_model', 'preferable if any subject has missing values (RM ANOVA drops the whole subject)');
        alt('friedman', 'if residuals are clearly non-normal');
        const c = a.comparisons;
        if (c === 'all' || c === 'planned') post('paired_holm', 'pairwise paired comparisons, each using its own differences');
        else if (c === 'control') post('paired_control', 'each condition against the control');
        else if (c === 'trend') post('rm_trend', 'for ordered conditions (e.g. time)');
        else if (c === 'omnibus') why('You only need to know whether any condition differs, so no post hoc test.');
      } else {
        pick('friedman'); why('Three or more conditions on the same subjects, non-normal: the Friedman test ranks within each subject.');
        alt('rm_anova', 'on transformed data, if a transformation works');
        const c = a.comparisons;
        if (c === 'all' || c === 'planned' || c === 'control') post('wilcoxon_holm', c === 'control' ? 'Wilcoxon signed-rank tests against the control only, Holm-adjusted' : 'pairwise Wilcoxon signed-rank tests');
        else if (c === 'trend') post('page', 'for ordered conditions');
        else if (c === 'omnibus') why('You only need to know whether any condition differs, so no post hoc test.');
      }
    }
    if (out.key && ['anova', 'welch_anova', 'student_t', 'welch_t', 'rm_anova'].includes(out.key)) out.assumptions.push('Independent observations: each biological replicate counted once.', 'Residuals roughly normal (check a Q–Q plot rather than relying only on a normality test).');
    if (out.key === 'anova' || out.key === 'student_t') out.assumptions.push('Similar spread in every group.');
    return finish(a, out);
  }

  function commonWarnings(a, warn, why) {
    if (a.replicates === 'technical') warn('Technical replicates are not independent. Average them within each biological sample first (or fit a mixed model with sample as a random effect); n is the number of biological replicates. Treating technical replicates as n is pseudoreplication and gives falsely small p-values.');
    if (a.n === 'lt5') {
      warn('With fewer than 5 per group, rank tests cannot reach significance: a Mann-Whitney test with 3 vs 3 can never give p below 0.10, and 4 vs 4 never below 0.029. Normality tests are meaningless at this size.');
      warn('Report effect sizes with confidence intervals and treat the results as exploratory; consider a power calculation for the next experiment.');
    }
    if (a.n === 'gt30' && a.normal !== 'yes') warn('With large samples, normality tests flag trivial deviations. Judge normality from a Q–Q plot and the skewness, not the Shapiro-Wilk p-value alone.');
    if (a.features === 'many') warn('With many features, unadjusted p < 0.05 gives ~5 % false positives among all null features (50 out of 1000). Report BH-adjusted q-values.');
  }

  function relate(a, out, why, warn, alt, pick) {
    if (a.replicates === 'technical') warn('Average technical replicates before correlating; repeated points from one sample inflate n.');
    if (a.relShape === 'curved') {
      pick('nonlinreg'); why('A non-monotonic or sigmoidal relationship is not summarised by any correlation coefficient. Fit a model of the right shape (polynomial, 4-parameter logistic, Michaelis-Menten…).');
      out.assumptions.push('Residuals scatter evenly around the curve.');
      return finish(a, out);
    }
    const normal = a.normal === 'yes' || a.transformHelps === 'yes' || (a.normal === 'unknown' && a.n === 'gt30');
    if (a.relGoal === 'regression') {
      if (a.relShape === 'monotonic') { pick('nonlinreg'); why('To predict Y from a curved relationship, fit the curve (or transform X / Y so it becomes straight, e.g. log–log).'); alt('linreg', 'after a linearising transformation'); }
      else { pick('linreg'); why('To predict Y from X along a straight line, use linear regression. The assumptions concern the residuals, not X or Y themselves.'); }
      out.assumptions.push('Residuals roughly normal with constant spread (plot residuals against fitted values).', 'For standard curves whose spread grows with concentration, use weighted regression (1/x or 1/x²), and do not extrapolate beyond the standards.', 'X is measured with little error; if both variables have similar error (method comparison), use Deming or Passing-Bablok regression.');
      if (a.normal === 'no' && a.transformHelps !== 'yes') alt('spearman', 'to describe a monotonic association without a model');
    } else {
      if (a.relShape === 'linear' && normal) { pick('pearson'); why('A straight-line relationship between roughly normal variables: Pearson’s r.'); alt('spearman', 'if there are outliers or skew'); }
      else {
        pick('spearman');
        why(a.relShape === 'monotonic' ? 'A monotonic but curved relationship: Spearman’s ρ measures it without assuming a straight line.' : 'The variables are not (known to be) normal or the relationship may not be straight: Spearman’s ρ uses ranks and resists outliers.');
        if (a.n === 'lt5' || a.n === '5to15') alt('kendall', 'Kendall’s τ behaves better than Spearman with small n or many ties');
        alt('pearson', 'if both variables are normal (after transformation) and the relationship is straight');
      }
      out.assumptions.push('Pairs are independent (one point per subject).', 'Correlation is not agreement: two methods can correlate perfectly and still disagree. For method comparison choose “agree”.');
    }
    if (a.features === 'many') { warn('Correlating many features: adjust p-values with Benjamini-Hochberg.'); }
    if (a.n === 'lt5') warn('With fewer than 5 points a correlation is almost meaningless: with n = 4, |r| must exceed 0.95 to reach p < 0.05.');
    return finish(a, out);
  }

  function assoc(a, out, why, warn, alt, pick, post) {
    if (a.design === 'paired') {
      if (a.tableSize === '2x2') { pick('mcnemar'); why('The same subjects classified twice (before/after, two tests on one sample): McNemar’s test uses only the discordant pairs.'); }
      else { pick('bowker'); why('Paired categorical data with more than two categories: the Stuart-Maxwell / Bowker test.'); alt('cochran_q', 'for a binary outcome measured in 3+ conditions on the same subjects'); }
      return finish(a, out);
    }
    if (!a.tableSize) return finish(a, out);
    if (a.tableSize === '2x2') {
      if (a.expected === 'ok') { pick('chisq'); why('A 2 × 2 table with all expected counts ≥ 5: the chi-square test is fine. Fisher’s exact test is equally valid and common.'); alt('fisher', 'always valid; required when expected counts are small'); }
      else { pick('fisher'); why('A 2 × 2 table with small (or unknown) expected counts: Fisher’s exact test does not rely on a large-sample approximation.'); alt('chisq', 'when all expected counts are at least 5'); }
      out.assumptions.push('Each subject appears in exactly one cell.');
    } else {
      if (a.ordered === 'yes') { pick('trend_ca'); why('With an ordered variable (e.g. dose), a trend test asks the specific question “does the proportion rise with dose?” and has far more power than an overall chi-square.'); alt('chisq', 'for any association, ignoring the order'); }
      else if (a.expected === 'ok') { pick('chisq'); why('A larger table with all expected counts ≥ 5: the chi-square test of independence.'); }
      else { pick('fisher_rxc'); why('A larger table with small expected counts: use an exact (Fisher-Freeman-Halton) or Monte Carlo p-value, or merge sparse categories if that makes scientific sense.'); }
      post('chisq_resid', 'find which cells drive the association');
      out.assumptions.push('Rule of thumb for chi-square: no expected count below 1 and no more than 20 % below 5.');
    }
    return finish(a, out);
  }
  function agree(a, out, why, warn, alt, pick) {
    if (a.agreeType === 'continuous') { pick('bland_altman'); why('Agreement is not correlation: methods can be perfectly correlated and still differ by a constant or a proportion. Bland-Altman shows the bias and the range within which 95 % of differences fall; the ICC (absolute agreement) summarises it in one number.'); out.assumptions.push('If the difference grows with the magnitude, analyse ratios (log-transform) instead.'); alt('linreg', 'Deming or Passing-Bablok regression to separate constant and proportional bias'); warn('Do not use a paired t-test or Pearson’s r to claim agreement.'); }
    else if (a.agreeType === 'ordinal') { pick('wkappa'); why('Ordered scores: weighted kappa gives partial credit for near misses.'); }
    else if (a.agreeType === 'categorical') { pick('kappa'); why('Agreement on categories beyond what chance would give: Cohen’s kappa (two raters) or Fleiss’ kappa (more).'); }
    return finish(a, out);
  }
  function survival(a, out, why, warn, alt, pick) {
    if (a.covariateSurv === 'yes') { pick('cox'); why('Time-to-event data with censoring and covariates: Cox proportional hazards regression.'); out.assumptions.push('Proportional hazards: check with cox.zph / Schoenfeld residuals.'); alt('logrank', 'for an unadjusted comparison plus Kaplan-Meier plot'); }
    else if (a.covariateSurv === 'no') { pick('logrank'); why('Time-to-event data where some subjects never had the event (censored): Kaplan-Meier curves and the log-rank test. Do not compare mean survival times with a t-test.'); alt('cox', 'to estimate a hazard ratio or adjust for covariates'); if (a.groups === '3plus') warn('With 3+ groups, follow a significant log-rank test with pairwise log-rank tests, Holm-adjusted.'); }
    return finish(a, out);
  }
  function binaryCompare(a, out, why, warn, alt, pick, post) {
    if (a.goal === 'onesample') { out.key = 'binom'; out.test = { name: 'Exact binomial test', r: 'binom.test(k, n, p = p0)', py: 'scipy.stats.binomtest(k, n, p0)', effect: 'Proportion with exact (Clopper-Pearson) CI' }; why('A yes/no outcome against a known proportion: the exact binomial test.'); return finish(a, out); }
    if (!a.design) return finish(a, out);
    if (a.design === 'paired') {
      if (a.groups === '3plus') { pick('cochran_q'); why('A yes/no outcome measured in 3+ conditions on the same subjects: Cochran’s Q.'); }
      else { pick('mcnemar'); why('A yes/no outcome measured twice on the same subjects: McNemar’s test.'); }
    } else {
      if (a.covariate === 'yes') { pick('glm_binomial'); why('Yes/no outcome with covariates: logistic regression.'); }
      else { pick('fisher'); why('A yes/no outcome in independent groups is a contingency table: Fisher’s exact test (or chi-square when all expected counts are ≥ 5).'); alt('chisq', 'with large counts'); alt('glm_binomial', 'to adjust for covariates'); if (a.groups === '3plus') post('lsmeans_binary', 'which groups differ'); }
    }
    return finish(a, out);
  }

  function finish(a, out) {
    const orig = out._orig || a; delete out._orig;
    out.answers = orig;
    out.complete = !nextQuestion(orig) && !!out.key;
    if (out.key && out.test) out.report = reportTemplate(out);
    return out;
  }
  function reportTemplate(out) {
    const tr = out.transform ? ` on ${out.transform.name.replace(/ \(.*/, '')}-transformed data` : '';
    const ph = out.posthoc ? `, followed by ${out.posthoc.name.split(' (')[0]}` : '';
    const verb = { relate: 'The relationship was assessed with', assoc: 'Association was tested with', agree: 'Agreement was assessed with', survival: 'Survival was compared with', onesample: 'The values were compared with the reference value using' }[out.answers.goal] || 'Groups were compared with';
    return `${verb} ${out.test.name.replace(/ \(.*/, '')}${tr}${ph}. State n per group (biological replicates), the effect size (${out.test.effect}) and exact p-values; define what error bars show.`;
  }

  const api = { QUESTIONS, TESTS: T, POSTHOC: P, visibleQuestions, nextQuestion, prune, recommend };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Advisor = api;
})(typeof self !== 'undefined' ? self : this);
