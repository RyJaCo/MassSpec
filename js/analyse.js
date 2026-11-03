/*
 * Data analyser for the Stats Test Advisor: reads a CSV/TSV table, works out what kind of data each
 * column holds, picks a transformation, answers the advisor's questions from the data, and runs the
 * recommended test and post hoc test. Depends on StatLib and Advisor; runs in Node for tests.
 */
(function (root) {
  'use strict';
  const S = typeof module !== 'undefined' && module.exports ? require('./statlib.js') : root.StatLib;
  const A = typeof module !== 'undefined' && module.exports ? require('./advisor.js') : root.Advisor;

  const MISSING = /^(|na|nan|n\/a|#n\/a|#value!|#div\/0!|#num!|null|none|-|\.)$/i;

  // ------------------------------------------------------------------ table reading
  function splitLine(line, d) {
    if (line.indexOf('"') === -1) return line.split(d);
    const out = []; let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
      else if (c === '"') q = true; else if (c === d) { out.push(cur); cur = ''; } else cur += c;
    }
    out.push(cur); return out;
  }
  function sniff(line) {
    const counts = { '\t': 0, ',': 0, ';': 0 }; let q = false;
    for (const c of line) { if (c === '"') q = !q; else if (!q && c in counts) counts[c]++; }
    const best = Object.keys(counts).reduce((a, b) => (counts[b] > counts[a] ? b : a), '\t');
    return counts[best] ? best : '\t';
  }
  function parseNumber(raw, decimalComma) {
    let v = String(raw).trim();
    if (MISSING.test(v)) return NaN;
    v = v.replace(/[\s  ']/g, '').replace(/%$/, '');
    if (decimalComma) { if (/^-?\d{1,3}(\.\d{3})+(,\d*)?$/.test(v)) v = v.replace(/\./g, ''); v = v.replace(',', '.'); }
    else if (/^-?\d{1,3}(,\d{3})+(\.\d*)?([eE][-+]?\d+)?$/.test(v)) v = v.replace(/,/g, '');
    if (!/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(v)) return NaN;
    return Number(v);
  }
  /** Parses delimited text into { columns: [{ name, raw[], num: Float64Array, ...info }], nRows, delimiter }. */
  function parseTable(text) {
    let lines = text.replace(/^﻿/, '').split(/\r\n|\n|\r/);
    let delim = null;
    if (/^sep=(.)\s*$/i.test(lines[0])) { delim = lines[0][4]; lines = lines.slice(1); }
    while (lines.length && !lines[0].trim()) lines.shift();
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    if (!lines.length) throw new Error('The file is empty.');
    delim = delim || sniff(lines[0]);
    const header = splitLine(lines[0], delim).map((h, i) => h.trim() || `Column ${i + 1}`);
    const seen = new Map();
    const names = header.map((h) => { const c = (seen.get(h) || 0) + 1; seen.set(h, c); return c > 1 ? `${h} (${c})` : h; });
    const rows = lines.slice(1).filter((l) => l.trim()).map((l) => splitLine(l, delim));
    if (!rows.length) throw new Error('The file has a header row but no data rows.');
    const decimalComma = delim === ';' && rows.slice(0, 50).some((r) => r.some((c) => /^\s*-?\d+,\d+\s*$/.test(c)));
    const columns = names.map((name, j) => {
      const raw = rows.map((r) => (r[j] === undefined ? '' : r[j].trim()));
      const num = Float64Array.from(raw, (v) => parseNumber(v, decimalComma));
      return Object.assign({ name, raw, num }, columnInfo(name, raw, num));
    });
    return { columns, nRows: rows.length, delimiter: delim };
  }
  function columnInfo(name, raw, num) {
    const present = raw.filter((v) => !MISSING.test(v)); const nums = Array.from(num).filter(Number.isFinite);
    const numeric = present.length > 0 && nums.length >= 0.9 * present.length;
    const levels = [...new Set(present)];
    const integer = numeric && nums.every((v) => Number.isInteger(v));
    // A grouping column: text, or a handful of repeated integer codes.
    const categorical = !numeric || (integer && levels.length <= Math.max(2, Math.min(12, present.length / 3)));
    return { numeric, categorical, levels, nPresent: present.length, nMissing: raw.length - present.length, integer,
      min: nums.length ? Math.min(...nums) : NaN, max: nums.length ? Math.max(...nums) : NaN };
  }

  /** Best guess of the measurement type (an Advisor `outcome` value) for numeric values and a column name. */
  function guessOutcome(name, values) {
    const v = values.filter(Number.isFinite); if (!v.length) return 'continuous';
    const min = Math.min(...v), max = Math.max(...v); const n = String(name).toLowerCase();
    if (/(^|[^a-z])log|ln\(|\blg\b/.test(n) || min < 0) return 'continuous';
    if (/ratio|fold|(^|[^a-z])fc([^a-z]|$)|relative|normali[sz]ed|norm\b|%\s*(of\s*)?(ctrl|control)|vs\.?\s*control|\/ ?(ctrl|control)/.test(n)) return 'ratio';
    if (/%|pct|percent|fraction|proportion|viab/.test(n) && max <= 100) return 'proportion';
    if (min >= 0 && max <= 1 && !v.every(Number.isInteger)) return 'proportion';
    if (v.every(Number.isInteger) && min >= 0 && (/count|number|^n[_ ]|cells|colon|events|spectr|psm|foci|plaques/.test(n) || max <= 200)) return 'count';
    if (min > 0 && (/intens|abund|area|conc|lfq|signal|quant|expression|tic|ibaq|ng|ug|µg|mm\b|nm\b|um\b/.test(n) || max / min > 30)) return 'intensity';
    return 'continuous';
  }

  // ------------------------------------------------------------------ building groups
  /**
   * Long format. opts: { outcome, group, subject?, factor2?, control? }.
   * Returns { names, groups[][], rows?: matched rows (subjects × conditions), design, notes[], factor2? }.
   */
  function buildLong(table, opts) {
    const col = (n) => table.columns.find((c) => c.name === n);
    const y = col(opts.outcome), g = col(opts.group), s = opts.subject ? col(opts.subject) : null, f2 = opts.factor2 ? col(opts.factor2) : null;
    const notes = [];
    let recs = [];
    for (let i = 0; i < table.nRows; i++) {
      const v = y.num[i], gl = g.raw[i];
      if (!Number.isFinite(v) || MISSING.test(gl)) continue;
      if (f2 && MISSING.test(f2.raw[i])) continue;
      recs.push({ v, g: gl, s: s ? s.raw[i] : null, f: f2 ? f2.raw[i] : null });
    }
    const dropped = table.nRows - recs.length;
    if (dropped) notes.push(`${dropped} row${dropped > 1 ? 's' : ''} with a missing value or group skipped.`);
    let names = [...new Set(recs.map((r) => r.g))];
    if (opts.control && names.includes(opts.control)) names = [opts.control, ...names.filter((n) => n !== opts.control)];
    let design = 'independent'; let rows = null;
    if (s) {
      // Several rows for one subject in one group = technical replicates: average them.
      const key = (r) => r.s + '\u0001' + r.g + '\u0001' + (r.f || '');
      const by = new Map(); for (const r of recs) { const k = key(r); if (!by.has(k)) by.set(k, []); by.get(k).push(r); }
      const nTech = recs.length - by.size;
      if (nTech > 0) notes.push(`Averaged ${recs.length} rows into ${by.size} biological measurements (rows sharing ${opts.subject} and group were treated as technical replicates).`);
      recs = [...by.values()].map((list) => Object.assign({}, list[0], { v: S.mean(list.map((r) => r.v)) }));
      const groupsPerSubject = new Map(); for (const r of recs) { if (!groupsPerSubject.has(r.s)) groupsPerSubject.set(r.s, new Set()); groupsPerSubject.get(r.s).add(r.g); }
      const repeated = [...groupsPerSubject.values()].filter((set) => set.size > 1).length;
      if (repeated >= Math.max(2, groupsPerSubject.size / 2) && !f2) {
        design = 'paired';
        const subj = [...groupsPerSubject.keys()].filter((k) => names.every((n) => groupsPerSubject.get(k).has(n)));
        const lookup = new Map(recs.map((r) => [r.s + '\u0001' + r.g, r.v]));
        rows = subj.map((k) => names.map((n) => lookup.get(k + '\u0001' + n)));
        const lost = groupsPerSubject.size - subj.length;
        if (lost) notes.push(`${lost} ${opts.subject} value${lost > 1 ? 's' : ''} without a measurement in every group dropped from the paired analysis (a mixed model would keep them).`);
      } else if (repeated > 0 && f2) {
        design = 'mixed-or-rm';
      }
    }
    const groups = names.map((n) => recs.filter((r) => r.g === n).map((r) => r.v));
    const out = { names, groups, rows, design, notes, n: groups.map((x) => x.length) };
    if (design === 'paired') { out.groups = names.map((_, j) => rows.map((r) => r[j])); out.n = out.groups.map((x) => x.length); }
    if (f2) { out.factor2 = { name: opts.factor2, y: recs.map((r) => r.v), a: recs.map((r) => r.g), b: recs.map((r) => r.f), levelsB: [...new Set(recs.map((r) => r.f))] }; }
    return out;
  }
  /** Wide format: each selected column is a group; paired = rows are the same subject. */
  function buildWide(table, opts) {
    const cols = opts.columns.map((n) => table.columns.find((c) => c.name === n)); const notes = [];
    let names = cols.map((c) => c.name);
    let order = names.map((_, i) => i);
    if (opts.control && names.includes(opts.control)) { const ci = names.indexOf(opts.control); order = [ci, ...order.filter((i) => i !== ci)]; }
    names = order.map((i) => names[i]);
    if (opts.paired) {
      const rows = [];
      for (let i = 0; i < table.nRows; i++) { const r = order.map((j) => cols[j].num[i]); if (r.every(Number.isFinite)) rows.push(r); }
      const lost = table.nRows - rows.length; if (lost) notes.push(`${lost} row${lost > 1 ? 's' : ''} with a missing value dropped (paired tests need every column).`);
      return { names, rows, groups: names.map((_, j) => rows.map((r) => r[j])), design: 'paired', notes, n: names.map(() => rows.length) };
    }
    const groups = order.map((j) => Array.from(cols[j].num).filter(Number.isFinite));
    return { names, groups, rows: null, design: 'independent', notes, n: groups.map((g) => g.length) };
  }

  // ------------------------------------------------------------------ transformations
  const PRIORS = {
    ratio: ['log2', 'none', 'sqrt', 'boxcox', 'recip'],
    intensity: ['log2', 'none', 'boxcox', 'sqrt', 'recip'],
    proportion: ['none', 'logit', 'logitPct', 'sqrt'],
    count: ['none', 'sqrt', 'log2p1', 'log2', 'boxcox'],
    continuous: ['none', 'log2', 'sqrt', 'log2p1', 'boxcox', 'recip', 'logit', 'logitPct'],
    ordinal: ['none'],
  };
  function residualsFor(tg, design, rows) {
    if (design === 'paired' && rows) {
      const k = rows[0].length; const n = rows.length;
      if (k === 2) return rows.map((r) => r[1] - r[0]);
      const cm = Array.from({ length: k }, (_, j) => S.mean(rows.map((r) => r[j]))); const gm = S.mean(cm); const out = [];
      rows.forEach((r) => { const rm = S.mean(r); r.forEach((v, j) => out.push(v - rm - cm[j] + gm)); });
      return out.slice(0, n * k);
    }
    // Groups with no spread (e.g. a control fixed at 1) carry no information about the error distribution.
    const out = []; for (const g of tg) { if (!(S.sd(g) > 0)) continue; const m = S.mean(g); for (const v of g) out.push(v - m); } return out;
  }
  /**
   * Tries each sensible transformation. Returns { candidates[], chosen, reason }.
   * A candidate passes when residuals look normal (Shapiro-Wilk p >= 0.05, or modest skew/kurtosis with n >= 100)
   * and spreads look equal (Brown-Forsythe p >= 0.05; independent groups only).
   */
  function evaluateTransforms(built, outcomeType, factor2, force) {
    const all = [].concat(...built.groups); const info = S.transformInfo(all);
    const list = PRIORS[outcomeType] || PRIORS.continuous;
    const candidates = [];
    for (const key of list) {
      const T = S.TRANSFORMS[key]; if (!T.ok(info)) continue;
      const params = Object.assign({}, info);
      if (key === 'boxcox') {
        params.lambda = S.boxCoxLambda(built.groups);
        if (Math.abs(params.lambda) < 0.2 || Math.abs(params.lambda - 1) < 0.2 || Math.abs(params.lambda - 0.5) < 0.1) continue; // ~ log / none / sqrt
      }
      const f = (v) => T.f(v, params);
      const tg = built.groups.map((g) => g.map(f)); const rows = built.rows ? built.rows.map((r) => r.map(f)) : null;
      if (tg.some((g) => g.some((v) => !Number.isFinite(v)))) continue;
      let resid = residualsFor(tg, built.design, rows);
      if (factor2) resid = S.twoWayResiduals(factor2.y.map(f), factor2.a, factor2.b);
      const sw = resid.length >= 3 ? S.shapiroWilk(resid) : { p: NaN, W: NaN };
      const varied = tg.filter((g) => g.length >= 2 && S.sd(g) > 0);
      const lev = built.design === 'independent' && varied.length > 1 ? S.levene(varied) : null;
      const skew = S.skewness(resid), kurt = S.kurtosis(resid);
      const sds = varied.map((g) => S.sd(g));
      const sdRatio = sds.length > 1 ? Math.max(...sds) / Math.min(...sds) : NaN;
      const bigN = resid.length >= 100;
      const normalOK = Number.isFinite(sw.p) && (sw.p >= 0.05 || (bigN && Math.abs(skew) < 0.5 && Math.abs(kurt) < 1));
      const varOK = !lev || !Number.isFinite(lev.p) || lev.p >= 0.05;
      candidates.push({ key, label: key === 'boxcox' ? `Box-Cox (λ = ${params.lambda})` : T.label, params, f, tg, rows, resid, sw, lev, skew, kurt, sdRatio, normalOK, varOK, pass: normalOK && varOK });
    }
    const nResid = candidates.length ? candidates[0].resid.length : 0;
    let chosen = null, reason = '';
    const tooFew = nResid < 8;
    const forced = force && candidates.find((c) => c.key === force);
    if (forced) {
      chosen = forced; reason = `You chose ${forced.label}.`;
    } else if (tooFew) {
      chosen = candidates[0];
      reason = `Only ${nResid} residuals: too few to judge normality from the data, so the transformation follows the data type (${chosen.label}).`;
    } else if (candidates[0].key !== 'none' && candidates[0].sw.p >= 0.01 && (!candidates[0].lev || !(candidates[0].lev.p < 0.01))) {
      // The scale the data type calls for (log for intensities and ratios) is kept unless the data clearly
      // contradict it: hunting for the transform with the best p-value is itself a form of data dredging.
      chosen = candidates[0]; chosen.normalOK = true;
      reason = `${chosen.label} is the standard scale for this kind of data, and the data do not contradict it (Shapiro-Wilk p = ${fmtP(chosen.sw.p)}${chosen.lev ? `, Brown-Forsythe p = ${fmtP(chosen.lev.p)}` : ''}).` +
        (chosen.varOK ? '' : ' The spreads differ somewhat between groups, so a test that does not assume equal variances is used.');
    } else {
      chosen = candidates.find((c) => c.pass);
      if (chosen) {
        const first = candidates[0];
        reason = chosen === first ? (chosen.key === 'none' ? 'The raw values already pass the normality and equal-spread checks, so no transformation is needed.'
          : `${chosen.label} is the natural scale for this kind of data, and it passes the normality and equal-spread checks.`)
          : `${chosen.label} is the first transformation (in order of simplicity for this data type) whose residuals pass the normality and equal-spread checks; ${candidates.slice(0, candidates.indexOf(chosen)).map((c) => c.label).join(', ')} did not.`;
      } else {
        const norm = candidates.find((c) => c.normalOK);
        if (norm) { chosen = norm; reason = `${norm.label} makes the residuals normal but the spreads still differ between groups, so a test that allows unequal variances is used.`; }
        else {
          chosen = candidates.slice().sort((a, b) => (b.sw.p || 0) - (a.sw.p || 0))[0];
          reason = `No transformation makes the residuals normal (best: ${chosen.label}, Shapiro-Wilk p = ${fmtP(chosen.sw.p)}), so a rank-based test is used.`;
        }
      }
    }
    return { candidates, chosen, reason, tooFew, nResid };
  }

  // ------------------------------------------------------------------ the analysis
  function nBand(nmin) { return nmin < 5 ? 'lt5' : nmin <= 15 ? '5to15' : nmin <= 30 ? '15to30' : 'gt30'; }
  /**
   * Compare groups. built from buildLong / buildWide. opts: { outcomeType, comparisons, nFeatures }.
   */
  function analyseCompare(built, opts) {
    const outcomeType = opts.outcomeType || 'continuous';
    const k = built.groups.length; const nmin = Math.min(...built.n);
    const res = { built, outcomeType, warnings: [], notes: built.notes.slice() };
    if (k < 2) { res.error = 'Need at least two groups with data.'; return res; }
    if (built.groups.some((g) => g.length < 2)) { res.error = 'Every group needs at least two values.'; return res; }
    const f2 = built.factor2 && built.design !== 'mixed-or-rm' ? built.factor2 : null;
    const tr = evaluateTransforms(built, outcomeType === 'ordinal' ? 'ordinal' : outcomeType, f2, opts.forceTransform);
    res.transforms = tr;
    const c = tr.chosen;
    const answers = {
      goal: 'compare', outcome: outcomeType, factors: built.factor2 ? '2' : '1', groups: k > 2 ? '3plus' : '2',
      design: built.design === 'mixed-or-rm' ? 'mixed' : built.design, replicates: 'biological',
      features: opts.nFeatures > 10 ? 'many' : 'one', covariate: 'no', n: nBand(nmin),
      comparisons: opts.comparisons || 'all',
    };
    if (outcomeType === 'ratio') answers.ratioControl = opts.ratioControl || 'intrinsic';
    if (outcomeType === 'proportion') answers.propType = 'continuous';
    if (outcomeType === 'count') answers.countSize = opts.countSize || (S.median([].concat(...built.groups)) >= 10 ? 'large' : 'small');
    if (tr.tooFew) answers.normal = 'unknown';
    else if (c.normalOK) { answers.normal = c.key === 'none' ? 'yes' : 'no'; if (c.key !== 'none') answers.transformHelps = 'yes'; }
    else { answers.normal = 'no'; answers.transformHelps = 'no'; }
    // An equal-variance test with tiny groups has no power, so 'passing' it says nothing: stay with Welch.
    answers.variance = !tr.tooFew && c.lev && Number.isFinite(c.lev.p) ? (c.lev.p >= 0.05 && c.sdRatio < 3 ? 'equal' : 'unequal') : 'unknown';
    // Ordinal or GLM paths: the rules decide; with features 'many' run per-column tests anyway.
    const rec = A.recommend(answers);
    res.answers = rec.answers; res.recommendation = rec;
    let key = rec.key; let phKey = rec.posthocKey;
    // Tests we can't fit here: run the closest test we can, and say so.
    const substitutes = {
      limma: (built.design === 'paired' ? (c.normalOK || tr.tooFew ? 'paired_t' : 'wilcoxon') : (c.normalOK || tr.tooFew ? 'welch_t' : 'mwu')),
      limma_f: built.design === 'paired' ? (c.normalOK || tr.tooFew ? 'rm_anova' : 'friedman') : (c.normalOK || tr.tooFew ? 'welch_anova' : 'kw'),
      glm_poisson: k > 2 ? (built.design === 'paired' ? 'friedman' : 'kw') : (built.design === 'paired' ? 'wilcoxon' : 'mwu'),
      glm_binomial: k > 2 ? 'welch_anova' : 'welch_t',
      art: 'two_way', two_way_rm: null, ancova: null, mixed_model: null,
    };
    if (key in substitutes) {
      const sub = substitutes[key];
      res.substituted = { from: rec.test.name, to: sub ? A.TESTS[sub].name : null };
      if (key === 'limma' || key === 'limma_f') { phKey = k > 2 ? ({ welch_anova: 'games_howell', kw: 'dunn', rm_anova: 'paired_holm', friedman: 'wilcoxon_holm' })[sub] : null; if (opts.comparisons === 'control' && phKey) phKey = ({ games_howell: 'welch_control', dunn: 'dunn_control', paired_holm: 'paired_control', wilcoxon_holm: 'wilcoxon_holm' })[phKey]; }
      if (key === 'glm_poisson') phKey = k > 2 ? (built.design === 'paired' ? 'wilcoxon_holm' : opts.comparisons === 'control' ? 'dunn_control' : 'dunn') : null;
      if (key === 'glm_binomial') phKey = k > 2 ? (opts.comparisons === 'control' ? 'welch_control' : 'games_howell') : null;
      if (key === 'art') phKey = 'simple_effects';
      key = sub;
    }
    // Which transformed data the test runs on: rank tests and GLM substitutes use the raw values.
    const rankTests = ['mwu', 'wilcoxon', 'kw', 'friedman', 'one_sample_wilcoxon'];
    let use = c;
    if (rankTests.includes(key)) use = tr.candidates.find((x) => x.key === 'none') || c;
    if (outcomeType === 'ratio' && answers.ratioControl === 'perExperiment' && key === 'one_sample_t') {
      // control column is constant 1: test the other column's log ratios against 0
      res.notes.push('The control is 1 in every experiment, so the treated log-ratios are tested against 0 (equivalent to a ratio paired t-test).');
    }
    res.used = use; res.key = key; res.posthocKey = phKey;
    if (outcomeType === 'ratio' && answers.ratioControl === 'perExperiment' && k > 2) {
      const parametric = !rankTests.includes(key) && key !== 'friedman';
      const fn = parametric ? (v) => S.oneSampleT(v, 0) : (v) => S.wilcoxonSignedRank(v);
      const list = built.names.slice(1).map((n, i) => { const r = fn(use.tg[i + 1]); return { a: n, b: built.names[0] + ' (= 1)', diff: r.diff, stat: r.t ?? r.V, statName: parametric ? 't' : 'V', pRaw: r.p, foldChange: parametric && isLog(use) ? Math.pow(2, r.diff) : undefined }; });
      const adj = S.adjust(list.map((x) => x.pRaw), 'holm'); list.forEach((x, i) => { x.p = adj[i]; });
      res.key = null; res.posthoc = { name: `${parametric ? 'One-sample t-tests' : 'One-sample Wilcoxon tests'} of each group's log₂ ratio against 0, Holm-adjusted`, list };
      res.notes.push('The control is 1 in every experiment, so it cannot be a group in an ANOVA. Each treated group is tested against 0 on the log₂ scale instead. With the raw (un-normalised) values, a repeated-measures ANOVA on log values with experiment as subject is the better analysis.');
      return finishWarnings(res, built, key, use, nmin, k, rankTests);
    }
    if (key) {
      res.primary = runTest(key, use, built, opts, answers);
      if (phKey && k > 2) res.posthoc = runPosthoc(phKey, use, built, opts);
      // Sensitivity: the other family on the same question.
      const altKey = ({ welch_t: 'mwu', student_t: 'mwu', mwu: 'welch_t', paired_t: 'wilcoxon', wilcoxon: 'paired_t', anova: 'kw', welch_anova: 'kw', kw: 'welch_anova', rm_anova: 'friedman', friedman: 'rm_anova', one_sample_t: 'one_sample_wilcoxon', one_sample_wilcoxon: 'one_sample_t' })[key];
      if (altKey) { const altUse = rankTests.includes(altKey) ? (tr.candidates.find((x) => x.key === 'none') || c) : c; res.sensitivity = runTest(altKey, altUse, built, opts, answers); }
    } else res.notes.push('This design needs a model the browser does not fit (see the recommendation for R / Python code). The checks above still apply.');
    return finishWarnings(res, built, key, use, nmin, k, rankTests);
  }
  function finishWarnings(res, built, key, use, nmin, k, rankTests) {
    // Warnings that come from the numbers.
    if (k === 2 && built.design === 'independent' && rankTests.includes(key)) { const mp = S.mwuMinP(built.n[0], built.n[1]); if (mp > 0.01) res.warnings.push(`With ${built.n[0]} vs ${built.n[1]} values the smallest p a Mann-Whitney test can give is ${fmtP(mp)}.`); }
    if (nmin < 3) res.warnings.push('Some groups have fewer than 3 values: any test here has very little power.');
    if (Math.max(...built.n) / nmin > 2) res.warnings.push('Group sizes are very unequal; prefer tests that do not assume equal variances (Welch / Games-Howell).');
    const outl = use.resid.length >= 8 ? outliers(use.resid) : 0; if (outl) res.warnings.push(`${outl} residual${outl > 1 ? 's are' : ' is'} more than 3.5 robust SDs from the centre on the ${use.label} scale. Check ${outl > 1 ? 'them' : 'it'} for errors; do not delete values only because they are extreme.`);
    return res;
  }
  function outliers(resid) {
    const med = S.median(resid); const mad = S.median(resid.map((r) => Math.abs(r - med))) * 1.4826;
    if (!(mad > 0)) return 0; return resid.filter((r) => Math.abs(r - med) / mad > 3.5).length;
  }

  function isLog(c) { return c.key === 'log2' || (c.key === 'boxcox' && Math.abs(c.params.lambda) < 1e-8); }
  function runTest(key, c, built, opts, answers) {
    const g = c.tg, rows = c.rows, names = built.names; let r;
    const ref = opts.reference !== undefined ? c.f(opts.reference) : 0;
    switch (key) {
      case 'student_t': r = S.tTest(g[1], g[0], { welch: false }); break;
      case 'welch_t': r = S.tTest(g[1], g[0]); break;
      case 'mwu': r = S.mannWhitney(g[1], g[0]); break;
      case 'paired_t': r = S.pairedTTest(rows.map((x) => x[1]), rows.map((x) => x[0])); break;
      case 'wilcoxon': r = S.wilcoxonSignedRank(rows.map((x) => x[1]), rows.map((x) => x[0])); break;
      case 'one_sample_t': {
        if (answers.ratioControl === 'perExperiment' && g.length === 2) { r = S.oneSampleT(g[1], 0); r.testedGroup = names[1]; }
        else { r = S.oneSampleT(g[0], ref); }
        break;
      }
      case 'one_sample_wilcoxon': {
        const v = answers.ratioControl === 'perExperiment' && g.length === 2 ? g[1] : g[0];
        const rf = answers.ratioControl === 'perExperiment' && g.length === 2 ? 0 : ref;
        r = S.wilcoxonSignedRank(v.map((x) => x - rf)); r.diff = S.median(v) - rf; r.test = 'One-sample Wilcoxon signed-rank test'; break;
      }
      case 'anova': r = S.oneWayAnova(g); break;
      case 'welch_anova': r = S.welchAnova(g); break;
      case 'kw': r = S.kruskalWallis(g); break;
      case 'rm_anova': r = S.rmAnova(rows); break;
      case 'friedman': r = S.friedman(rows); break;
      case 'two_way': { const f = built.factor2; r = S.twoWayAnova(f.y.map(c.f), f.a, f.b); r.table[0].term = opts.groupName || 'A'; r.table[1].term = f.name; r.table[2].term = `${opts.groupName || 'A'} × ${f.name}`; break; }
      default: return null;
    }
    r.key = key; r.scale = c.label;
    if (r.diff !== undefined && isLog(c) && key !== 'mwu' && key !== 'wilcoxon') {
      r.foldChange = Math.pow(2, r.diff); if (r.ci) r.foldCI = r.ci.map((x) => Math.pow(2, x));
    }
    if (g.length === 2 && built.design !== 'paired') r.direction = `${names[1]} − ${names[0]}`;
    if (built.design === 'paired' && g.length === 2) r.direction = `${names[1]} − ${names[0]} (within subject)`;
    return r;
  }
  function runPosthoc(key, c, built, opts) {
    const g = c.tg, rows = c.rows, names = built.names; const ctrl = 0; let list, name = A.POSTHOC[key] ? A.POSTHOC[key].name : key;
    const onlyControl = opts.comparisons === 'control';
    switch (key) {
      case 'tukey': list = S.tukeyHSD(g, names); break;
      case 'games_howell': list = S.gamesHowell(g, names); break;
      case 'dunnett': list = S.dunnett(g, names, ctrl); break;
      case 'welch_control': list = S.pairwise(g, names, (a, b) => S.tTest(a, b), 'holm', ctrl); name = 'Welch t-tests vs control, Holm-adjusted'; break;
      case 'planned': list = S.pairwise(g, names, (a, b) => S.tTest(a, b), 'holm'); name = 'Welch t-tests for every pair, Holm-adjusted (keep only your planned pairs and re-adjust over those)'; break;
      case 'dunn': list = S.dunn(g, names, 'holm'); break;
      case 'dunn_control': list = S.dunn(g, names, 'holm', ctrl); break;
      case 'paired_holm': list = S.pairwise(rowsAsGroups(rows), names, (a, b) => S.pairedTTest(a, b), 'holm'); break;
      case 'paired_control': list = S.pairwise(rowsAsGroups(rows), names, (a, b) => S.pairedTTest(a, b), 'holm', ctrl); name = 'Paired t-tests vs control, Holm-adjusted'; break;
      case 'wilcoxon_holm': list = S.pairwise(rowsAsGroups(rows), names, (a, b) => S.wilcoxonSignedRank(a, b), 'holm', onlyControl ? ctrl : undefined); break;
      case 'trend': return { name: 'Linear trend across groups (in the order listed)', trend: trendTest(g) };
      case 'jt': return { name: 'Jonckheere-Terpstra trend test (groups in the order listed)', trend: jonckheere(g) };
      case 'rm_trend': return { name: 'Linear trend within subjects (per-subject slope, tested against 0)', trend: rmTrend(rows) };
      case 'page': return { name: "Page's L trend test (conditions in the order listed)", trend: pageTest(rows) };
      case 'simple_effects': return simpleEffects(c, built, opts);
      default: return null;
    }
    if (isLog(c)) list.forEach((x) => { if (x.diffName === undefined && Number.isFinite(x.diff)) x.foldChange = Math.pow(2, x.diff); });
    return { name, list };
  }
  const rowsAsGroups = (rows) => rows[0].map((_, j) => rows.map((r) => r[j]));
  function trendTest(g) { const x = [], y = []; g.forEach((grp, i) => grp.forEach((v) => { x.push(i); y.push(v); })); const r = S.pearson(x, y); return { stat: r.t, statName: 't', df: r.df, p: r.p, slope: r.slope, note: 'slope per step between consecutive groups' }; }
  function jonckheere(g) {
    let J = 0; for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) for (const a of g[i]) for (const b of g[j]) J += b > a ? 1 : b === a ? 0.5 : 0;
    const n = g.map((x) => x.length), N = S.sum(n);
    const mu = (N * N - S.sum(n.map((v) => v * v))) / 4;
    const v = (N * N * (2 * N + 3) - S.sum(n.map((x) => x * x * (2 * x + 3)))) / 72;
    const z = (J - mu) / Math.sqrt(v); return { stat: z, statName: 'z', J, p: 2 * S.normSf(Math.abs(z)), note: 'normal approximation, no tie correction' };
  }
  function rmTrend(rows) { const k = rows[0].length; const xs = Array.from({ length: k }, (_, j) => j); const slopes = rows.map((r) => S.pearson(xs, r).slope); const t = S.oneSampleT(slopes, 0); return { stat: t.t, statName: 't', df: t.df, p: t.p, slope: S.mean(slopes), note: 'mean per-subject slope per step' }; }
  function pageTest(rows) {
    const n = rows.length, k = rows[0].length; let L = 0; const rs = new Float64Array(k);
    for (const r of rows) { const rk = S.rank(r).ranks; for (let j = 0; j < k; j++) rs[j] += rk[j]; }
    for (let j = 0; j < k; j++) L += (j + 1) * rs[j];
    const mu = n * k * (k + 1) * (k + 1) / 4, v = n * k * k * (k + 1) * (k * k - 1) / 144; const z = (L - mu) / Math.sqrt(v);
    return { stat: z, statName: 'z', L, p: 2 * S.normSf(Math.abs(z)), note: 'normal approximation' };
  }
  function simpleEffects(c, built, opts) {
    const f = built.factor2; const y = f.y.map(c.f); const fit = S.twoWayAnova(y, f.a, f.b);
    const out = []; const namesA = built.names;
    for (const lb of f.levelsB) {
      const grp = namesA.map((la) => y.filter((_, i) => f.a[i] === la && f.b[i] === lb));
      const idx = namesA.map((_, i) => i).filter((i) => grp[i].length > 0);
      for (let x = 0; x < idx.length; x++) for (let z = x + 1; z < idx.length; z++) {
        const i = idx[x], j = idx[z]; if (opts.comparisons === 'control' && i !== 0) continue;
        const d = S.mean(grp[j]) - S.mean(grp[i]); const se = Math.sqrt(fit.mse * (1 / grp[i].length + 1 / grp[j].length)); const t = d / se;
        out.push({ a: `${namesA[j]}`, b: `${namesA[i]}`, within: `${f.name} = ${lb}`, diff: d, stat: t, statName: 't', pRaw: S.tTwoSided(t, fit.dfRes) });
      }
    }
    const adj = S.adjust(out.map((r) => r.pRaw), 'holm'); out.forEach((r, i) => { r.p = adj[i]; if (isLog(c)) r.foldChange = Math.pow(2, r.diff); });
    return { name: `Simple effects of ${opts.groupName || 'the first factor'} within each level of ${f.name} (pooled-SD t, Holm-adjusted)`, list: out };
  }

  /** One column against a reference value. */
  function analyseOneSample(table, colName, reference, outcomeType, force, subjectName) {
    const col = table.columns.find((c) => c.name === colName); let v = Array.from(col.num).filter(Number.isFinite);
    const notes = [];
    if (subjectName) {
      const sc = table.columns.find((c) => c.name === subjectName); const by = new Map();
      for (let i = 0; i < table.nRows; i++) { if (!Number.isFinite(col.num[i]) || MISSING.test(sc.raw[i])) continue; const k = sc.raw[i]; if (!by.has(k)) by.set(k, []); by.get(k).push(col.num[i]); }
      const nRows = [...by.values()].reduce((a, l) => a + l.length, 0);
      v = [...by.values()].map((l) => S.mean(l));
      if (nRows > v.length) notes.push(`Averaged ${nRows} rows into ${v.length} values, one per ${subjectName}.`);
    }
    const built = { names: [colName], groups: [v], rows: null, design: 'onesample', notes, n: [v.length] };
    const res = { built, outcomeType, warnings: [], notes: notes.slice(), reference };
    if (v.length < 3) { res.error = 'Need at least 3 values.'; return res; }
    const tr = evaluateTransforms(built, outcomeType, null, force); res.transforms = tr;
    let c = tr.chosen;
    if (!Number.isFinite(c.f(reference))) { c = tr.candidates.find((x) => x.key === 'none'); res.notes.push(`The reference ${reference} cannot be transformed with ${tr.chosen.label}, so raw values are used.`); }
    const answers = { goal: 'onesample', outcome: outcomeType, replicates: 'biological', features: 'one', n: nBand(v.length) };
    if (outcomeType === 'ratio') answers.ratioControl = 'intrinsic';
    if (outcomeType === 'proportion') answers.propType = 'continuous';
    if (outcomeType === 'count') answers.countSize = S.median(v) >= 10 ? 'large' : 'small';
    if (tr.tooFew) answers.normal = 'unknown'; else if (c.normalOK) { answers.normal = c.key === 'none' ? 'yes' : 'no'; if (c.key !== 'none') answers.transformHelps = 'yes'; } else { answers.normal = 'no'; answers.transformHelps = 'no'; }
    const rec = A.recommend(answers); res.answers = rec.answers; res.recommendation = rec;
    let key = rec.key; if (!['one_sample_t', 'one_sample_wilcoxon'].includes(key)) { res.substituted = { from: rec.test.name, to: A.TESTS.one_sample_wilcoxon.name }; key = 'one_sample_wilcoxon'; }
    const use = key === 'one_sample_wilcoxon' ? (tr.candidates.find((x) => x.key === 'none') || c) : c;
    res.used = use; res.key = key;
    res.primary = runTest(key, use, built, { reference }, answers);
    res.sensitivity = runTest(key === 'one_sample_t' ? 'one_sample_wilcoxon' : 'one_sample_t', key === 'one_sample_t' ? (tr.candidates.find((x) => x.key === 'none') || c) : c, built, { reference }, answers);
    return res;
  }

  // ------------------------------------------------------------------ relationships and tables
  function analyseRelate(table, xName, yName) {
    const X = table.columns.find((c) => c.name === xName), Y = table.columns.find((c) => c.name === yName);
    const x = [], y = []; for (let i = 0; i < table.nRows; i++) if (Number.isFinite(X.num[i]) && Number.isFinite(Y.num[i])) { x.push(X.num[i]); y.push(Y.num[i]); }
    const res = { x, y, xName, yName, warnings: [], notes: [] };
    if (x.length < 4) { res.error = 'Need at least 4 complete pairs.'; return res; }
    const choose = (v, name) => { const ot = guessOutcome(name, v); const raw = S.shapiroWilk(v); const canLog = Math.min(...v) > 0; const lg = canLog ? S.shapiroWilk(v.map(Math.log2)) : null; const useLog = canLog && (ot === 'intensity' || ot === 'ratio' || (lg.p > 0.05 && raw.p < 0.05 && lg.p > raw.p)); return { raw, lg, useLog, type: ot }; };
    const cx = choose(x, xName), cy = choose(y, yName);
    const tx = cx.useLog ? x.map(Math.log2) : x, ty = cy.useLog ? y.map(Math.log2) : y;
    res.tx = tx; res.ty = ty; res.logX = cx.useLog; res.logY = cy.useLog;
    const p = S.pearson(tx, ty), s = S.spearman(x, y);
    const resid = tx.map((v, i) => ty[i] - (p.intercept + p.slope * v));
    const swR = S.shapiroWilk(resid); const swX = S.shapiroWilk(tx), swY = S.shapiroWilk(ty);
    const out = outliers(resid);
    const normalBoth = swX.p >= 0.05 && swY.p >= 0.05; const linearish = Math.abs(p.r) >= Math.abs(s.rho) - 0.1;
    const answers = { goal: 'relate', replicates: 'biological', features: 'one', n: nBand(x.length), relGoal: 'correlation',
      relShape: linearish ? 'linear' : 'monotonic', normal: normalBoth && !out ? 'yes' : (x.length < 8 ? 'unknown' : 'no') };
    if (answers.normal === 'no') answers.transformHelps = 'no';
    res.answers = answers; res.recommendation = A.recommend(answers);
    res.pearson = p; res.spearman = s; res.swResid = swR; res.swX = swX; res.swY = swY; res.outliers = out;
    if (out) res.warnings.push(`${out} point${out > 1 ? 's lie' : ' lies'} far from the line; Pearson's r is sensitive to ${out > 1 ? 'them' : 'it'}.`);
    if (!linearish) res.notes.push(`Spearman's ρ (${s.rho.toFixed(2)}) is clearly stronger than Pearson's r (${p.r.toFixed(2)}): the relationship is monotonic but not straight.`);
    if (cx.useLog || cy.useLog) res.notes.push(`Pearson / regression computed on ${[cx.useLog ? 'log₂ ' + xName : '', cy.useLog ? 'log₂ ' + yName : ''].filter(Boolean).join(' and ')} (positive, skewed data).`);
    return res;
  }
  function analyseAssoc(table, aName, bName, opts) {
    const A1 = table.columns.find((c) => c.name === aName), B1 = table.columns.find((c) => c.name === bName);
    const subj = opts && opts.subject ? table.columns.find((c) => c.name === opts.subject) : null;
    const pairsAB = []; const seenS = new Map(); let conflicts = 0;
    for (let i = 0; i < table.nRows; i++) {
      if (MISSING.test(A1.raw[i]) || MISSING.test(B1.raw[i])) continue;
      if (subj) { const k = subj.raw[i]; const v = A1.raw[i] + '\u0001' + B1.raw[i]; if (seenS.has(k)) { if (seenS.get(k) !== v) conflicts++; continue; } seenS.set(k, v); }
      pairsAB.push([A1.raw[i], B1.raw[i]]);
    }
    const la = [...new Set(pairsAB.map((p) => p[0]))], lb = [...new Set(pairsAB.map((p) => p[1]))];
    const tab = la.map(() => lb.map(() => 0)); for (const [a, b] of pairsAB) tab[la.indexOf(a)][lb.indexOf(b)]++;
    const res = { table: tab, rowLevels: la, colLevels: lb, rowName: aName, colName: bName, warnings: [], notes: [] };
    if (subj) res.notes.push(`One count per ${opts.subject} (${pairsAB.length} subjects).` + (conflicts ? ` ${conflicts} repeated rows disagreed with the first row for their subject and were ignored.` : ''));
    if (la.length < 2 || lb.length < 2) { res.error = 'Each variable needs at least two categories.'; return res; }
    if (la.length * lb.length > 400) { res.error = 'Too many categories for a contingency table; choose categorical columns.'; return res; }
    const chi = S.chiSquare(tab); res.chisq = chi;
    const is2 = la.length === 2 && lb.length === 2; const small = chi.minExpected < 5;
    const answers = { goal: 'assoc', design: 'independent', tableSize: is2 ? '2x2' : 'larger', expected: small ? 'small' : 'ok' };
    if (!is2) answers.ordered = 'no';
    res.answers = answers; res.recommendation = A.recommend(answers);
    if (is2) res.fisher = S.fisherExact(tab);
    else if (small) res.monteCarlo = permutationChi(pairsAB, la, lb, chi.X2, (opts && opts.B) || 5000);
    const N = chi.N; const rs = tab.map(S.sum), cs = lb.map((_, j) => S.sum(tab.map((r) => r[j])));
    res.stdres = tab.map((r, i) => r.map((o, j) => { const E = rs[i] * cs[j] / N; return (o - E) / Math.sqrt(E * (1 - rs[i] / N) * (1 - cs[j] / N)); }));
    return res;
  }
  function permutationChi(pairsAB, la, lb, obs, B) {
    let seed = 12345; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const a = pairsAB.map((p) => la.indexOf(p[0])), b = pairsAB.map((p) => lb.indexOf(p[1])); let hits = 0;
    for (let k = 0; k < B; k++) {
      for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = b[i]; b[i] = b[j]; b[j] = t; }
      const tab = la.map(() => lb.map(() => 0)); for (let i = 0; i < a.length; i++) tab[a[i]][b[i]]++;
      let x2; const rs = tab.map(S.sum), cs = lb.map((_, j) => S.sum(tab.map((r) => r[j]))), N = a.length; x2 = 0;
      tab.forEach((r, i) => r.forEach((o, j) => { const E = rs[i] * cs[j] / N; if (E > 0) x2 += (o - E) ** 2 / E; }));
      if (x2 >= obs - 1e-9) hits++;
    }
    return { p: (hits + 1) / (B + 1), B };
  }

  function fmtP(p) {
    if (!Number.isFinite(p)) return '–';
    if (p < 0.0001) return '< 0.0001';
    if (p < 0.001) return p.toFixed(4);
    if (p < 0.01) return p.toFixed(3);
    return p.toFixed(p < 0.1 ? 3 : 2);
  }

  const api = { parseTable, parseNumber, columnInfo, guessOutcome, buildLong, buildWide, evaluateTransforms, analyseCompare, analyseOneSample, analyseRelate, analyseAssoc, fmtP };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Analyse = api;
})(typeof self !== 'undefined' ? self : this);
