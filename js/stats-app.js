/* Stats Test Advisor UI: the question guide and the data analyser. */
(function () {
  'use strict';
  const S = window.StatLib, A = window.Advisor, N = window.Analyse;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmtP = N.fmtP;
  function fmt(v, d) {
    if (!Number.isFinite(v)) return '–';
    const a = Math.abs(v);
    if (a !== 0 && (a >= 1e5 || a < 1e-3)) return v.toExponential(2);
    return String(+v.toPrecision(d || 3));
  }
  const pEq = (p) => { const f = fmtP(p); return f.startsWith('<') ? `p ${f}` : `p = ${f}`; };
  const pClass = (p) => (p < 0.05 ? 'sig' : 'ns');
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } },
  };

  // ------------------------------------------------------------------ tabs
  const tabs = [['tab-guide', 'pane-guide'], ['tab-data', 'pane-data']];
  function showTab(which) {
    for (const [t, p] of tabs) { const on = t === which; $(t).classList.toggle('on', on); $(t).setAttribute('aria-selected', on); $(p).hidden = !on; }
    store.set('stats-tab', which);
  }
  tabs.forEach(([t]) => $(t).addEventListener('click', () => showTab(t)));

  // ------------------------------------------------------------------ question guide
  let answers = store.get('stats-answers') || {};
  answers = A.prune(answers);
  const optLabel = (id, v) => { const q = A.QUESTIONS.find((x) => x.id === id); const o = q && q.options.find((x) => x.value === v); return o ? o.label : v; };
  const qLabel = (id, a) => { const q = A.visibleQuestions(a).find((x) => x.id === id) || A.QUESTIONS.find((x) => x.id === id); return q ? q.label : id; };

  function renderQuestions() {
    const vis = A.visibleQuestions(answers); const next = A.nextQuestion(answers);
    $('questions').innerHTML = vis.map((q, i) => {
      const val = answers[q.id] || ''; const sel = q.options.find((o) => o.value === val);
      return `<section class="q${next && next.id === q.id ? ' next' : ''}">
        <label for="q-${q.id}"><span class="qn">${i + 1}</span>${esc(q.label)}</label>
        <select id="q-${q.id}" data-q="${q.id}" class="${val ? '' : 'unset'}">
          <option value=""${val ? '' : ' selected'} disabled>Choose…</option>
          ${q.options.map((o) => `<option value="${o.value}"${o.value === val ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}
        </select>
        ${sel && sel.help ? `<p class="hint">${esc(sel.help)}</p>` : ''}
      </section>`;
    }).join('');
    const answered = vis.filter((q) => answers[q.id]).length;
    $('progress').textContent = `${answered} of ${vis.length} answered`;
  }
  $('questions').addEventListener('change', (e) => {
    const id = e.target.dataset.q; if (!id) return;
    answers[id] = e.target.value; answers = A.prune(answers); store.set('stats-answers', answers);
    renderGuide();
    const nq = A.nextQuestion(answers);
    if (nq) { const el = $('q-' + nq.id); if (el && window.matchMedia('(min-width: 901px)').matches) el.focus({ preventScroll: true }); }
  });
  $('reset').addEventListener('click', () => { answers = {}; store.set('stats-answers', answers); renderGuide(); });

  function renderGuide() {
    renderQuestions();
    const rec = A.recommend(answers);
    let html = '';
    if (!rec.complete) {
      const vis = A.visibleQuestions(answers); const nq = A.nextQuestion(answers);
      const done = vis.filter((q) => answers[q.id]).length;
      html += `<section class="panel"><div class="rec-kicker">${done ? 'Keep going' : 'Start here'}</div>
        <p class="next-q">${nq ? `Next question: <b>${esc(nq.label)}</b>` : 'Answer the questions on the left.'}</p>
        <div class="meter" aria-hidden="true"><span style="width:${Math.round(100 * done / Math.max(1, vis.length))}%"></span></div>
        <p class="hint" style="margin-top:8px">Questions appear as they become relevant, so the list changes as you answer.</p></section>`;
    } else html += recCard(rec);
    html += cheatSheet() + mistakes();
    $('guide-results').innerHTML = html;
  }

  function recCard(rec, extra) {
    extra = extra || {};
    const t = rec.test; if (!t) return '';
    const fam = rec.family === 'parametric' ? '<span class="pill parametric">parametric</span>' : rec.family === 'nonparametric' ? '<span class="pill nonparametric">rank-based</span>' : rec.family === 'glm' ? '<span class="pill family">model-based</span>' : '';
    const prov = rec.provisional ? '<span class="pill prov">check normality first</span>' : '';
    const k3 = rec.answers.groups === '3plus' || rec.answers.factors === '2';
    const postBox = rec.posthoc
      ? `<div class="box"><h3>Post hoc test</h3><p class="big">${esc(rec.posthoc.name)}</p><p>${esc(cap(rec.posthoc.reason))}.</p></div>`
      : k3 ? `<div class="box"><h3>Post hoc test</h3><p class="big">None needed</p><p>You only asked whether any group differs.</p></div>`
        : (rec.answers.goal === 'compare' ? '<div class="box"><h3>Post hoc test</h3><p class="big">None needed</p><p>With two groups the test itself is the comparison.</p></div>' : '');
    const alts = rec.alternatives.length ? `<div class="box"><h3>Alternatives</h3><div class="alts">${rec.alternatives.map((x) => `<div><b>${esc(x.name)}</b>: ${esc(x.when)}</div>`).join('')}</div></div>` : '';
    const assumptions = rec.assumptions.length ? `<div class="box"><h3>Check / remember</h3><ul class="list">${rec.assumptions.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : '';
    const code = [['R', t.r], ['Python', t.py]].concat(rec.posthoc ? [['Post hoc (R)', rec.posthoc.r], ['Post hoc (Python)', rec.posthoc.py]] : []).filter((x) => x[1]);
    return `<section class="panel rec">
      <div class="rec-head"><div class="rec-kicker">${esc(extra.kicker || 'Recommended test')}</div><h2 class="rec-name">${esc(t.name)}</h2>${fam}${prov}</div>
      ${extra.top || ''}
      ${rec.transform ? `<div class="box transform" style="margin-top:12px"><h3>Transform first</h3><p class="big">${esc(rec.transform.name)}</p><p>${esc(rec.transform.why)}</p></div>` : ''}
      <ol class="why">${rec.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
      ${rec.warnings.length ? `<div class="callouts">${rec.warnings.map((w) => `<div class="callout warn"><span>${esc(w)}</span></div>`).join('')}</div>` : ''}
      <div class="rec-grid">
        ${postBox}
        <div class="box"><h3>Effect size to report</h3><p>${esc(t.effect)}</p></div>
        ${assumptions}
        ${alts}
      </div>
      <div class="rec-grid">
        <div class="box"><h3>How to run it</h3>${code.map(([l, c]) => `<p style="margin-top:6px"><b>${esc(l)}</b></p><pre class="code">${esc(c)}</pre>`).join('')}</div>
        <div class="box"><h3>How to report it</h3><p class="report">${esc(rec.report || '')}</p>
          <p class="report" style="margin-top:6px">Report exact p-values (not just “p &lt; 0.05”), the effect with its confidence interval, and whether p-values were adjusted for multiple comparisons.</p></div>
      </div>
      ${extra.bottom || ''}
    </section>`;
  }
  const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '');

  function cheatSheet() {
    const rows = [
      ['Two independent groups', "Welch's t-test", 'Mann-Whitney U', '–'],
      ['Two paired / matched', 'Paired t-test', 'Wilcoxon signed-rank', '–'],
      ['3+ independent groups', "One-way ANOVA (Welch's if SDs differ)", 'Kruskal-Wallis', 'Tukey · Games-Howell · Dunnett ‖ Dunn'],
      ['3+ repeated / matched', 'Repeated-measures ANOVA (GG) or mixed model', 'Friedman', 'Paired t (Holm) ‖ Wilcoxon (Holm)'],
      ['Two factors', 'Two-way ANOVA (Type II/III)', 'Aligned Rank Transform ANOVA', 'Simple effects (Tukey / Šidák)'],
      ['One group vs a value', 'One-sample t-test', 'One-sample Wilcoxon', '–'],
      ['Two continuous variables', "Pearson's r / linear regression", "Spearman's ρ", '–'],
      ['Categories × categories', 'Chi-square', "Fisher's exact (small counts)", 'Standardised residuals'],
      ['Many features (omics)', 'limma moderated t / F, BH FDR', 'Rank test per feature, BH FDR', 'Moderated contrasts'],
    ];
    return `<section class="panel"><div class="panel-head"><h2>Quick reference</h2></div>
      <p class="panel-note">Parametric tests assume normal residuals (often after a log transform); rank-based tests do not, but have less power and answer a slightly different question.</p>
      <div class="table-wrap" style="max-height:none"><table class="cheat"><thead><tr><th class="l">Design</th><th class="l">Normal (parametric)</th><th class="l">Not normal (rank-based)</th><th class="l">Post hoc (parametric ‖ rank)</th></tr></thead>
      <tbody>${rows.map((r) => `<tr><td>${r[0]}</td><td>${r[1]}</td><td class="np">${r[2]}</td><td class="np">${r[3]}</td></tr>`).join('')}</tbody></table></div></section>`;
  }
  function mistakes() {
    const m = [
      ['Several t-tests instead of ANOVA + post hoc.', 'Three groups means three t-tests and a 14 % chance of at least one false positive. Use one test across all groups and a post hoc test that adjusts for the comparisons.'],
      ['Technical replicates counted as n.', 'Three injections of one sample are one biological replicate. Average them, or model them.'],
      ['A t-test on ratios with the control fixed at 1.', 'The control has no variance, so the test is invalid. Test log ratios against 0, or analyse the raw values paired by experiment.'],
      ['Testing normality of all values pooled together.', 'Group differences make pooled data look non-normal. Check the residuals (or each group, or the paired differences).'],
      ['Choosing the test that gives p < 0.05.', 'Decide the test from the design and the data type, ideally before seeing the results.'],
      ['Rank tests with n = 3.', 'Mann-Whitney with 3 vs 3 cannot reach p < 0.05 whatever the data.'],
      ['Correlation to show two methods agree.', 'Use Bland-Altman. A perfect correlation can hide a constant or proportional bias.'],
      ['“Not significant” read as “no difference”.', 'Absence of evidence is not evidence of absence. Report the effect and its CI.'],
      ['No multiple-testing correction for thousands of proteins.', 'Use Benjamini-Hochberg FDR. Bonferroni is too strict for discovery work; no correction is far too lenient.'],
      ['Error bars without a definition.', 'Say whether they are SD (spread of the data), SEM, or 95 % CI (precision of the mean).'],
    ];
    return `<section class="panel notes"><div class="panel-head"><h2>Common mistakes</h2></div>
      <ul>${m.map(([a, b]) => `<li><b>${esc(a)}</b> ${esc(b)}</li>`).join('')}</ul></section>`;
  }

  // ------------------------------------------------------------------ tooltip
  const tip = $('tip');
  document.addEventListener('mouseover', (e) => { const el = e.target.closest && e.target.closest('[data-tip]'); if (!el) { tip.hidden = true; return; } tip.innerHTML = el.getAttribute('data-tip'); tip.hidden = false; });
  document.addEventListener('mousemove', (e) => { if (tip.hidden) return; const w = tip.offsetWidth, h = tip.offsetHeight; let x = e.clientX + 14, y = e.clientY + 14; if (x + w > innerWidth - 8) x = e.clientX - w - 14; if (y + h > innerHeight - 8) y = e.clientY - h - 14; tip.style.left = x + 'px'; tip.style.top = y + 'px'; });

  // ------------------------------------------------------------------ charts
  const COLORS = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c5)', 'var(--c6)', 'var(--c7)', 'var(--c8)'];
  const colorOf = (i) => (i < 8 ? COLORS[i] : 'var(--ink-3)');
  function niceTicks(lo, hi, n) {
    if (lo === hi) { lo -= 1; hi += 1; }
    const step0 = (hi - lo) / (n || 5); const mag = Math.pow(10, Math.floor(Math.log10(step0)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) || 10 * mag;
    const out = []; for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(+v.toPrecision(10));
    return out;
  }
  function stripPlot(groups, names, o) {
    o = o || {};
    const W = Math.max(360, 90 + names.length * 86), H = 300, L = 62, R = 14, T = 14, B = 46;
    const all = [].concat(...groups); let lo = Math.min(...all), hi = Math.max(...all);
    if (o.ref !== undefined && Number.isFinite(o.ref)) { lo = Math.min(lo, o.ref); hi = Math.max(hi, o.ref); }
    const pad = (hi - lo) * 0.06 || 1; lo -= pad; hi += pad;
    const ticks = niceTicks(lo, hi, 5); const y = (v) => T + (H - T - B) * (1 - (v - lo) / (hi - lo));
    const bw = (W - L - R) / names.length;
    let s = `<svg viewBox="0 0 ${W} ${H}" width="${W}" role="img" aria-label="${esc(o.title || 'Values per group')}">`;
    for (const t of ticks) { if (t < lo || t > hi) continue; s += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/><text x="${L - 6}" y="${y(t) + 3.5}" text-anchor="end">${fmt(t)}</text>`; }
    s += `<line class="axis" x1="${L}" x2="${L}" y1="${T}" y2="${H - B}"/>`;
    if (o.ref !== undefined && Number.isFinite(o.ref)) s += `<line class="ref" x1="${L}" x2="${W - R}" y1="${y(o.ref)}" y2="${y(o.ref)}"/><text x="${W - R}" y="${y(o.ref) - 4}" text-anchor="end">reference</text>`;
    s += `<text x="14" y="${(H - B + T) / 2}" transform="rotate(-90 14 ${(H - B + T) / 2})" text-anchor="middle" class="lab">${esc(o.yLabel || '')}</text>`;
    const jx = (i, j) => L + bw * (i + 0.5) + ((j * 0.618034) % 1 - 0.5) * Math.min(44, bw * 0.55);
    if (o.paired) for (let j = 0; j < groups[0].length; j++) s += `<polyline fill="none" stroke="var(--line)" stroke-width="1" points="${groups.map((g, i) => `${jx(i, j).toFixed(1)},${y(g[j]).toFixed(1)}`).join(' ')}"/>`;
    groups.forEach((g, i) => {
      const cx = L + bw * (i + 0.5); const q1 = S.quantile(g, 0.25), q3 = S.quantile(g, 0.75), md = S.median(g); const bx = Math.min(30, bw * 0.3);
      s += `<rect class="box" x="${cx - bx}" y="${y(q3)}" width="${2 * bx}" height="${Math.max(1, y(q1) - y(q3))}" rx="2"/>`;
      s += `<line class="med" x1="${cx - bx}" x2="${cx + bx}" y1="${y(md)}" y2="${y(md)}"/>`;
      g.forEach((v, j) => {
        const jit = ((j * 0.618034) % 1 - 0.5) * Math.min(44, bw * 0.55);
        const raw = o.raw ? o.raw[i][j] : v;
        s += `<circle class="pt" cx="${(cx + jit).toFixed(1)}" cy="${y(v).toFixed(1)}" r="4.5" fill="${colorOf(i)}" data-tip="<b>${esc(names[i])}</b><br>${esc(fmt(raw, 4))}${o.raw ? ` <span class='t-k'>(${esc(fmt(v, 4))} on plot scale)</span>` : ''}"/>`;
      });
      s += `<text x="${cx}" y="${H - B + 16}" text-anchor="middle" class="lab">${esc(trunc(names[i], 14))}</text><text x="${cx}" y="${H - B + 30}" text-anchor="middle">n = ${g.length}</text>`;
    });
    return s + '</svg>';
  }
  const trunc = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
  function qqPlot(resid, label) {
    const n = resid.length; const m = S.mean(resid), sdv = S.sd(resid) || 1; const z = Array.from(resid, (r) => (r - m) / sdv).sort((a, b) => a - b);
    const th = z.map((_, i) => S.normInv((i + 1 - 0.375) / (n + 0.25)));
    const W = 340, H = 300, L = 46, R = 12, T = 12, B = 40;
    const lim = Math.max(3, Math.ceil(Math.max(...z.map(Math.abs), ...th.map(Math.abs))));
    const x = (v) => L + (W - L - R) * (v + lim) / (2 * lim), y = (v) => T + (H - T - B) * (1 - (v + lim) / (2 * lim));
    let s = `<svg viewBox="0 0 ${W} ${H}" width="${W}" role="img" aria-label="Normal Q-Q plot of residuals">`;
    for (let t = -lim; t <= lim; t++) { s += `<line class="grid" x1="${x(t)}" x2="${x(t)}" y1="${T}" y2="${H - B}"/><line class="grid" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/><text x="${x(t)}" y="${H - B + 14}" text-anchor="middle">${t}</text><text x="${L - 6}" y="${y(t) + 3.5}" text-anchor="end">${t}</text>`; }
    s += `<line class="ref" x1="${x(-lim)}" y1="${y(-lim)}" x2="${x(lim)}" y2="${y(lim)}"/>`;
    z.forEach((v, i) => { s += `<circle class="pt" cx="${x(th[i]).toFixed(1)}" cy="${y(v).toFixed(1)}" r="4" fill="var(--c1)" data-tip="theoretical ${fmt(th[i])}<br>observed ${fmt(v)} SD"/>`; });
    s += `<text x="${(L + W - R) / 2}" y="${H - 6}" text-anchor="middle" class="lab">Theoretical normal quantile</text><text x="12" y="${(H - B + T) / 2}" transform="rotate(-90 12 ${(H - B + T) / 2})" text-anchor="middle" class="lab">${esc(label || 'Standardised residual')}</text>`;
    return s + '</svg>';
  }
  function scatter(x, y, o) {
    const W = 520, H = 320, L = 62, R = 14, T = 14, B = 44;
    const pad = (a) => { const lo = Math.min(...a), hi = Math.max(...a); const p = (hi - lo) * 0.06 || 1; return [lo - p, hi + p]; };
    const [x0, x1] = pad(x), [y0, y1] = pad(y);
    const sx = (v) => L + (W - L - R) * (v - x0) / (x1 - x0), sy = (v) => T + (H - T - B) * (1 - (v - y0) / (y1 - y0));
    let s = `<svg viewBox="0 0 ${W} ${H}" width="${W}" role="img" aria-label="Scatter plot">`;
    for (const t of niceTicks(y0, y1, 5)) if (t >= y0 && t <= y1) s += `<line class="grid" x1="${L}" x2="${W - R}" y1="${sy(t)}" y2="${sy(t)}"/><text x="${L - 6}" y="${sy(t) + 3.5}" text-anchor="end">${fmt(t)}</text>`;
    for (const t of niceTicks(x0, x1, 6)) if (t >= x0 && t <= x1) s += `<text x="${sx(t)}" y="${H - B + 14}" text-anchor="middle">${fmt(t)}</text>`;
    s += `<line class="axis" x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}"/>`;
    if (o.fit) s += `<line class="fit" x1="${sx(x0)}" y1="${sy(o.fit.intercept + o.fit.slope * x0)}" x2="${sx(x1)}" y2="${sy(o.fit.intercept + o.fit.slope * x1)}"/>`;
    x.forEach((v, i) => { s += `<circle class="pt" cx="${sx(v).toFixed(1)}" cy="${sy(y[i]).toFixed(1)}" r="4.5" fill="var(--c1)" data-tip="${esc(o.xLabel)}: ${fmt(o.rawX[i], 4)}<br>${esc(o.yLabel)}: ${fmt(o.rawY[i], 4)}"/>`; });
    s += `<text x="${(L + W - R) / 2}" y="${H - 6}" text-anchor="middle" class="lab">${esc(o.xLabel)}</text><text x="14" y="${(H - B + T) / 2}" transform="rotate(-90 14 ${(H - B + T) / 2})" text-anchor="middle" class="lab">${esc(o.yLabel)}</text>`;
    return s + '</svg>';
  }

  // ------------------------------------------------------------------ data analyser
  const OUTCOME_LABELS = { continuous: 'Continuous', intensity: 'Intensity / abundance / concentration', ratio: 'Ratio / fold change', proportion: 'Proportion / percentage', count: 'Count', ordinal: 'Ordinal score' };
  const st = { table: null, name: '', analysis: 'long', outcomes: [], group: '', factor2: '', subject: '', control: '', wide: [], paired: false, one: '', ref: '', x: '', y: '', ra: '', rb: '', type: 'auto', ratioControl: 'intrinsic', comparisons: 'all', force: {}, detail: '' };
  const ID_RE = /subject|mouse|mice|patient|animal|donor|individual|participant|rat\b|plant|replicate|experiment|batch|pair|\bid\b|_id\b/i;

  function loadText(text, name) {
    $('file-error').hidden = true;
    let table; try { table = N.parseTable(text); } catch (e) { $('file-error').textContent = e.message; $('file-error').hidden = false; return; }
    st.table = table; st.name = name; st.force = {}; st.detail = '';
    const cols = table.columns; const num = cols.filter((c) => c.numeric && !(c.categorical && c.levels.length <= 3 && ID_RE.test(c.name)));
    const cat = cols.filter((c) => c.categorical && c.levels.length >= 2 && c.levels.length <= Math.max(2, table.nRows / 2));
    const ids = cols.filter((c) => ID_RE.test(c.name) && c.levels.length >= 2 && c.levels.length < table.nRows);
    const groupCol = cat.find((c) => !ID_RE.test(c.name) && c.levels.length <= 12 && !c.numeric) || cat.find((c) => !ID_RE.test(c.name));
    const measures = num.filter((c) => !c.categorical || c.levels.length > 12);
    st.group = groupCol ? groupCol.name : '';
    st.subject = ids.length && groupCol ? (ids.find((c) => c.name !== st.group && !c.numeric) || { name: '' }).name : '';
    // Only keep a subject column if the same subject appears in more than one group (paired) or repeats within a group (technical).
    if (st.subject) { const s = cols.find((c) => c.name === st.subject); const g = groupCol; const multi = s.levels.length < table.nRows; if (!multi || !g) st.subject = ''; }
    st.factor2 = ''; st.control = '';
    st.outcomes = measures.length ? [measures[0].name] : [];
    st.wide = num.map((c) => c.name).slice(0, 8);
    st.one = measures.length ? measures[0].name : (num[0] || {}).name || '';
    st.x = (measures[0] || num[0] || {}).name || ''; st.y = (measures[1] || num[1] || measures[0] || {}).name || '';
    const nonId = cat.filter((c) => !ID_RE.test(c.name) && c.levels.length <= 20);
    st.ra = (groupCol || nonId[0] || cat[0] || {}).name || '';
    st.rb = (nonId.filter((c) => c.name !== st.ra).sort((a, b) => a.levels.length - b.levels.length)[0] || cat.find((c) => c.name !== st.ra) || {}).name || '';
    st.analysis = groupCol && measures.length ? 'long' : 'wide';
    st.paired = st.analysis === 'wide' && cols.some((c) => !c.numeric && c.levels.length === table.nRows);
    $('analysis').value = st.analysis;
    $('file-info').textContent = `${name}: ${table.nRows} rows × ${cols.length} columns (${({ '\t': 'tab', ',': 'comma', ';': 'semicolon' })[table.delimiter]}-separated).`;
    $('data-controls').hidden = false;
    renderControls(); run();
  }
  $('file').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) f.text().then((t) => loadText(t, f.name)); e.target.value = ''; });
  const drop = $('drop');
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => { const f = e.dataTransfer.files[0]; if (f) f.text().then((t) => loadText(t, f.name)); });
  $('ex-long').addEventListener('click', () => { loadText(window.STATS_DEMO.experiment, 'stats_demo_experiment.csv (simulated)'); st.subject = 'Mouse'; st.control = 'Vehicle'; renderControls(); run(); });
  $('ex-wide').addEventListener('click', () => { loadText(window.STATS_DEMO.paired, 'stats_demo_paired.csv (simulated)'); st.analysis = 'wide'; $('analysis').value = 'wide'; st.paired = true; st.wide = ['Baseline', 'Week_4', 'Week_12']; st.control = 'Baseline'; renderControls(); run(); });
  $('analysis').addEventListener('change', (e) => { st.analysis = e.target.value; st.detail = ''; renderControls(); run(); });

  const colOptions = (list, val, allowNone) => (allowNone ? `<option value="">${allowNone}</option>` : '') + list.map((c) => `<option value="${esc(c.name)}"${c.name === val ? ' selected' : ''}>${esc(c.name)}</option>`).join('');
  function renderControls() {
    const t = st.table; if (!t) return; const cols = t.columns; const num = cols.filter((c) => c.numeric); const cat = cols.filter((c) => c.levels.length >= 2 && c.levels.length <= Math.max(2, t.nRows / 1.5));
    const guessType = (name) => { const c = cols.find((x) => x.name === name); return c ? N.guessOutcome(name, Array.from(c.num)) : 'continuous'; };
    let h = '<h2 class="ctl-title">3 · Columns</h2>';
    if (st.analysis === 'long') {
      const glevels = st.group ? cols.find((c) => c.name === st.group).levels : [];
      h += `<div class="field">Value column(s) <span class="hint">tick several to test each one (with FDR across them)</span>
        <div class="colpick" id="pick-outcomes">${num.map((c) => `<label class="check"><input type="checkbox" value="${esc(c.name)}"${st.outcomes.includes(c.name) ? ' checked' : ''}><span>${esc(c.name)}</span><span class="t">${esc(guessType(c.name))}</span></label>`).join('')}</div>
        <div class="mini-row"><button class="btn small" type="button" data-all="1">All</button><button class="btn small" type="button" data-all="0">None</button></div></div>
        <label class="field">Group column<select data-k="group">${colOptions(cat, st.group, 'Choose…')}</select></label>
        <label class="field">Control / reference group<select data-k="control"><option value="">(none)</option>${glevels.map((l) => `<option${l === st.control ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
        <label class="field">Subject / biological replicate ID (optional)<select data-k="subject">${colOptions(cols.filter((c) => c.name !== st.group), st.subject, '(none)')}</select>
          <span class="hint">Same ID in several groups → paired. Same ID repeated within a group → technical replicates, averaged.</span></label>
        <label class="field">Second factor (optional)<select data-k="factor2">${colOptions(cat.filter((c) => c.name !== st.group && c.name !== st.subject), st.factor2, '(none)')}</select></label>`;
    } else if (st.analysis === 'wide') {
      h += `<div class="field">Columns to compare (one per group)
        <div class="colpick" id="pick-wide">${num.map((c) => `<label class="check"><input type="checkbox" value="${esc(c.name)}"${st.wide.includes(c.name) ? ' checked' : ''}><span>${esc(c.name)}</span></label>`).join('')}</div></div>
        <label class="check"><input type="checkbox" id="paired"${st.paired ? ' checked' : ''}><span>Each row is the same subject (paired / repeated measures)</span></label>
        <label class="field">Control column<select data-k="control"><option value="">(none)</option>${st.wide.map((l) => `<option${l === st.control ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
    } else if (st.analysis === 'onesample') {
      const gt = st.type === 'auto' ? guessType(st.one) : st.type;
      const ref = st.ref !== '' ? st.ref : (gt === 'ratio' ? '1' : gt === 'proportion' ? '' : '0');
      h += `<label class="field">Column<select data-k="one">${colOptions(num, st.one)}</select></label>
        <label class="field">Subject / biological replicate ID (optional)<select data-k="subject">${colOptions(cols.filter((c) => c.name !== st.one), st.subject, '(none)')}</select>
          <span class="hint">Rows sharing an ID are averaged first, so n counts biological replicates.</span></label>
        <label class="field">Reference value<input class="numin" id="ref" type="number" step="any" value="${esc(ref)}"></label>
        <p class="hint">e.g. 1 for a fold change, 100 for % recovery, 0 for a difference.</p>`;
    } else if (st.analysis === 'relate') {
      h += `<label class="field">X (predictor)<select data-k="x">${colOptions(num, st.x)}</select></label><label class="field">Y (response)<select data-k="y">${colOptions(num, st.y)}</select></label>`;
    } else {
      h += `<label class="field">Rows<select data-k="ra">${colOptions(cat, st.ra)}</select></label><label class="field">Columns<select data-k="rb">${colOptions(cat, st.rb)}</select></label>
        <label class="field">Subject ID (optional)<select data-k="subject">${colOptions(cols.filter((c) => c.name !== st.ra && c.name !== st.rb), st.subject, '(none)')}</select>
          <span class="hint">Counts each subject once, so repeated rows (technical replicates) are not counted twice.</span></label>`;
    }
    $('cols').innerHTML = h;
    let o = '';
    if (['long', 'wide', 'onesample'].includes(st.analysis)) {
      const first = st.analysis === 'long' ? st.outcomes[0] : st.analysis === 'wide' ? st.wide[0] : st.one;
      const auto = first ? guessType(first) : 'continuous';
      o += `<h2 class="ctl-title">4 · Options</h2>
        <label class="field">Measurement type<select data-k="type"><option value="auto"${st.type === 'auto' ? ' selected' : ''}>Detect per column${first ? ` (${esc(first)}: ${esc(OUTCOME_LABELS[auto])})` : ''}</option>
        ${Object.entries(OUTCOME_LABELS).map(([k, v]) => `<option value="${k}"${st.type === k ? ' selected' : ''}>${esc(v)}</option>`).join('')}</select>
        <span class="hint">Sets the preferred transformation: log for intensities and ratios, logit for percentages.</span></label>`;
      const isRatio = st.type === 'ratio' || (st.type === 'auto' && auto === 'ratio');
      if (isRatio && st.analysis !== 'onesample') o += `<label class="field">How were the ratios made?<select data-k="ratioControl">
        <option value="intrinsic"${st.ratioControl === 'intrinsic' ? ' selected' : ''}>Measured in each sample (e.g. phospho / total)</option>
        <option value="controlMean"${st.ratioControl === 'controlMean' ? ' selected' : ''}>Divided by the control mean</option>
        <option value="perExperiment"${st.ratioControl === 'perExperiment' ? ' selected' : ''}>Divided by each experiment's own control (control = 1)</option></select></label>`;
      if (st.analysis !== 'onesample') o += `<label class="field">Comparisons you care about<select data-k="comparisons">
        ${['all', 'control', 'planned', 'trend', 'omnibus'].map((v) => `<option value="${v}"${st.comparisons === v ? ' selected' : ''}>${esc(optLabel('comparisons', v))}</option>`).join('')}</select>
        <span class="hint">Used when there are 3+ groups. “Against one control” uses the control chosen above (or the first group).</span></label>`;
    }
    $('opts').innerHTML = o; $('opts').hidden = !o;
  }
  function onCtl(e) {
    const k = e.target.dataset.k;
    if (k) {
      st[k] = e.target.value;
      if (k === 'group') { st.control = ''; st.factor2 = st.factor2 === st.group ? '' : st.factor2; }
      if (k === 'one' || k === 'type') st.ref = st.ref; // keep
      st.force = {}; renderControls(); run(); return;
    }
    if (e.target.closest('#pick-outcomes')) { st.outcomes = [...document.querySelectorAll('#pick-outcomes input:checked')].map((i) => i.value); if (!st.outcomes.includes(st.detail)) st.detail = ''; renderControls(); run(); return; }
    if (e.target.closest('#pick-wide')) { st.wide = [...document.querySelectorAll('#pick-wide input:checked')].map((i) => i.value); if (!st.wide.includes(st.control)) st.control = ''; st.force = {}; renderControls(); run(); return; }
    if (e.target.id === 'paired') { st.paired = e.target.checked; st.force = {}; run(); return; }
    if (e.target.id === 'ref') { st.ref = e.target.value; run(); }
  }
  $('cols').addEventListener('change', onCtl); $('opts').addEventListener('change', onCtl);
  $('cols').addEventListener('click', (e) => { const b = e.target.closest('[data-all]'); if (!b) return; const num = st.table.columns.filter((c) => c.numeric && !(c.categorical && c.levels.length <= 12)); st.outcomes = b.dataset.all === '1' ? num.map((c) => c.name) : []; renderControls(); run(); });

  function outcomeTypeFor(name) { if (st.type !== 'auto') return st.type; const c = st.table.columns.find((x) => x.name === name); return N.guessOutcome(name, Array.from(c.num)); }

  let lastAnswers = null;
  function run() {
    const out = $('data-results'); const t = st.table; if (!t) return;
    tip.hidden = true;
    try {
      if (st.analysis === 'long') out.innerHTML = runLong();
      else if (st.analysis === 'wide') out.innerHTML = runWide();
      else if (st.analysis === 'onesample') out.innerHTML = runOne();
      else if (st.analysis === 'relate') out.innerHTML = runRelate();
      else out.innerHTML = runAssoc();
    } catch (e) {
      console.error(e);
      out.innerHTML = `<section class="panel"><p class="error">Could not analyse this selection: ${esc(e.message)}</p></section>`;
    }
  }
  const emptyPanel = (msg) => `<section class="panel"><p class="empty">${esc(msg)}</p></section>`;

  function compareOne(name) {
    const built = N.buildLong(st.table, { outcome: name, group: st.group, subject: st.subject || null, factor2: st.factor2 || null, control: st.control || null });
    return N.analyseCompare(built, { outcomeType: outcomeTypeFor(name), comparisons: st.comparisons, ratioControl: st.ratioControl, nFeatures: st.outcomes.length, groupName: st.group, forceTransform: st.force[name] });
  }
  function runLong() {
    if (!st.group) return emptyPanel('Choose the column that holds the group names.');
    if (!st.outcomes.length) return emptyPanel('Tick at least one value column.');
    const results = st.outcomes.map((n) => [n, compareOne(n)]);
    let html = '';
    if (results.length > 1) html += summaryTable(results);
    const detail = results.find(([n]) => n === st.detail) || results[0];
    st.detail = detail[0];
    html += compareDetail(detail[0], detail[1]);
    return html;
  }
  function runWide() {
    if (st.wide.length < 2) return emptyPanel('Tick at least two columns to compare.');
    const built = N.buildWide(st.table, { columns: st.wide, paired: st.paired, control: st.control || null });
    const name = st.wide.join(' / ');
    const res = N.analyseCompare(built, { outcomeType: outcomeTypeFor(st.wide[0]), comparisons: st.comparisons, ratioControl: st.ratioControl, nFeatures: 1, forceTransform: st.force[name] });
    return compareDetail(name, res);
  }
  function mainP(res) { const r = res.primary; if (!r) return res.posthoc && res.posthoc.list ? Math.min(...res.posthoc.list.map((x) => x.p)) : NaN; if (r.table) return r.table[0].p; return r.pGG !== undefined ? r.pGG : r.p; }
  function summaryTable(results) {
    const ps = results.map(([, r]) => (r.error ? NaN : mainP(r))); const qs = S.adjust(ps, 'bh');
    return `<section class="panel"><div class="panel-head"><h2>${results.length} outcomes</h2></div>
      <p class="panel-note">One test per column, chosen from that column's data. q is the Benjamini-Hochberg adjusted p across these ${results.length} columns${results.length > 10 ? '; with this many features consider limma (see the recommendation)' : ''}. Click a row for details.</p>
      <div class="table-wrap"><table><thead><tr><th class="l">Outcome</th><th class="l">Type</th><th class="l">Scale</th><th class="l">Test run</th><th>p</th><th>q (BH)</th></tr></thead><tbody>
      ${results.map(([n, r], i) => `<tr class="clickable${n === st.detail ? ' on' : ''}" data-detail="${esc(n)}" tabindex="0"><td class="l">${esc(n)}</td><td class="l">${esc(r.outcomeType)}</td><td class="l">${r.error ? '–' : esc(r.used.label)}</td><td class="l">${r.error ? esc(r.error) : esc(r.primary ? r.primary.test : r.posthoc ? r.posthoc.name : '–')}</td><td class="${pClass(ps[i])}">${fmtP(ps[i])}</td><td class="${pClass(qs[i])}">${fmtP(qs[i])}</td></tr>`).join('')}
      </tbody></table></div></section>`;
  }
  $('data-results').addEventListener('click', (e) => {
    const r = e.target.closest('[data-detail]'); if (r) { st.detail = r.dataset.detail; run(); return; }
    const f = e.target.closest('[data-force]'); if (f) { const key = f.dataset.force, name = f.dataset.name; if (st.force[name] === key) delete st.force[name]; else st.force[name] = key; run(); return; }
    const g = e.target.closest('[data-to-guide]'); if (g && lastAnswers) { answers = A.prune(Object.assign({}, lastAnswers)); store.set('stats-answers', answers); renderGuide(); showTab('tab-guide'); window.scrollTo(0, 0); }
  });
  $('data-results').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.dataset && e.target.dataset.detail) { st.detail = e.target.dataset.detail; run(); } });

  function factsFor(res) {
    const a = res.answers; const b = res.built; const tr = res.transforms; const c = res.used || (tr && tr.chosen); const rows = [];
    rows.push(['Measurement type', OUTCOME_LABELS[res.outcomeType] + (st.type === 'auto' ? ' (detected from the name and values; change it under Options)' : '')]);
    if (b.design !== 'onesample') rows.push(['Groups', `${b.names.length}: ${b.names.map((n, i) => `${n} (n = ${b.n[i]})`).join(', ')}`]);
    else rows.push(['Values', `n = ${b.n[0]}, tested against ${res.reference}`]);
    rows.push(['Design', b.design === 'paired' ? `Paired: ${st.analysis === 'wide' ? 'each row is one subject' : `the same ${st.subject} appears in every group`} (${b.rows.length} complete subjects)` : b.design === 'mixed-or-rm' ? 'Two factors with repeated subjects' : b.design === 'onesample' ? 'One group' : 'Independent groups']);
    if (tr) rows.push(['Normality', tr.tooFew ? `Too few values to judge (${tr.nResid} residuals)` : `${c.label}: Shapiro-Wilk ${pEq(tr.chosen.sw.p)} on ${b.design === 'paired' && b.names.length === 2 ? 'the paired differences' : 'the residuals'}`]);
    if (tr && tr.chosen.lev) rows.push(['Spread', `Brown-Forsythe ${pEq(tr.chosen.lev.p)}; largest / smallest SD = ${fmt(tr.chosen.sdRatio)} → ${a.variance === 'equal' ? 'similar' : 'different'}`]);
    if (b.names.length > 2) rows.push(['Comparisons', optLabel('comparisons', a.comparisons) + (a.comparisons === 'control' ? ` (control: ${b.names[0]})` : '')]);
    return `<dl class="facts">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`;
  }

  function compareDetail(name, res) {
    if (res.error) return `<section class="panel"><div class="panel-head"><h2>${esc(name)}</h2></div><p class="error">${esc(res.error)}</p></section>`;
    lastAnswers = res.answers;
    const rec = res.recommendation; const b = res.built; const c = res.used; const chosen = res.transforms.chosen;
    let top = `<div class="box" style="margin-top:12px"><h3>What the data told us · ${esc(name)}</h3>${factsFor(res)}
      <div class="row" style="margin-top:8px"><button class="btn small" type="button" data-to-guide>Open these answers in the question guide</button></div></div>`;
    if (res.substituted) top += `<div class="callouts"><div class="callout info"><span><b>${esc(res.substituted.from)}</b> is the best choice here but needs a model fit (code below). ${res.substituted.to ? `The results below use <b>${esc(res.substituted.to)}</b>, the closest test this page can run.` : 'This page cannot run an equivalent, so only the checks are shown.'}</span></div></div>`;
    let html = recCard(rec, { kicker: 'Recommended for this data', top });
    // results
    const callouts = res.warnings.map((w) => `<div class="callout warn"><span>${esc(w)}</span></div>`).concat(res.notes.map((n) => `<div class="callout info"><span>${esc(n)}</span></div>`)).join('');
    html += `<section class="panel"><div class="panel-head"><h2>Results</h2></div>${callouts ? `<div class="callouts" style="margin:0 0 10px">${callouts}</div>` : ''}
      ${res.primary ? resultBlock(res.primary, b) : ''}
      ${res.posthoc ? posthocBlock(res.posthoc) : ''}
      ${res.sensitivity ? `<p class="hint" style="margin-top:12px"><b>Sensitivity check</b> with ${esc(res.sensitivity.test)}${res.sensitivity.scale !== c.label ? ` (${esc(res.sensitivity.scale)})` : ''}: ${pEq(res.sensitivity.pGG !== undefined ? res.sensitivity.pGG : res.sensitivity.p)}. If the two disagree, look at the plots before trusting either.</p>` : ''}
    </section>`;
    // plots
    const isRaw = c.key === 'none';
    html += `<section class="panel"><div class="panel-head"><h2>Data and residuals</h2></div>
      <div class="two-col"><div><div class="chart">${stripPlot(c.tg, b.names, { yLabel: isRaw ? name : `${name}, ${c.label}`, raw: isRaw ? null : b.groups, ref: b.design === 'onesample' ? c.f(res.reference) : undefined, paired: b.design === 'paired' })}</div>
        <p class="chart-note">Points are ${b.design === 'paired' ? 'subjects (grey lines join each subject)' : 'biological replicates'}; box = interquartile range, line = median. Scale: ${esc(c.label)}.</p></div>
      <div><div class="chart">${qqPlot(c.resid)}</div><p class="chart-note">Normal Q–Q plot of ${b.design === 'paired' && b.names.length === 2 ? 'paired differences' : 'residuals'} on the ${esc(c.label)} scale. Points on the dashed line = normal; a curve = skew; points off at the ends = heavy tails or outliers.</p></div></div>
    </section>`;
    html += transformPanel(name, res) + descriptives(res);
    return html;
  }

  function resultBlock(r, b) {
    let line = '', eff = '';
    const k = r.key;
    if (['student_t', 'welch_t', 'paired_t', 'one_sample_t'].includes(k)) line = `t(${fmt(r.df, 4)}) = ${fmt(r.t, 4)}, ${pEq(r.p)}`;
    else if (k === 'mwu') line = `U = ${fmt(r.U, 5)}, ${pEq(r.p)} (${r.method})`;
    else if (k === 'wilcoxon' || k === 'one_sample_wilcoxon') line = `V = ${fmt(r.V, 5)}, ${pEq(r.p)} (${r.method || ''}${r.zeros ? `, ${r.zeros} zero differences dropped` : ''})`;
    else if (k === 'anova' || k === 'welch_anova') line = `F(${fmt(r.df1, 3)}, ${fmt(r.df2, 4)}) = ${fmt(r.F, 4)}, ${pEq(r.p)}`;
    else if (k === 'kw') line = `H(${r.df}) = ${fmt(r.H, 4)}, ${pEq(r.p)}`;
    else if (k === 'friedman') line = `χ²(${r.df}) = ${fmt(r.Q, 4)}, ${pEq(r.p)}`;
    else if (k === 'rm_anova') line = `F(${r.df1}, ${r.df2}) = ${fmt(r.F, 4)}, uncorrected ${pEq(r.p)}; Greenhouse-Geisser ε = ${fmt(r.epsilon)}, corrected ${pEq(r.pGG)}`;
    if (r.effect) eff = `${r.effect.name} = ${fmt(r.effect.value)}`;
    let est = '';
    if (r.diff !== undefined && k !== 'kw') {
      const what = r.testedGroup ? `${r.testedGroup} vs control` : r.direction || (b.design === 'onesample' ? 'difference from reference' : '');
      if (r.foldChange !== undefined) est = `Fold change (${esc(what)}) = ${fmt(r.foldChange)}${r.foldCI ? ` (95% CI ${fmt(r.foldCI[0])} to ${fmt(r.foldCI[1])})` : ''}; difference in log₂ = ${fmt(r.diff)}`;
      else est = `${k === 'mwu' || k.includes('wilcoxon') ? 'Median difference' : 'Difference'} (${esc(what)}) = ${fmt(r.diff)}${r.ci ? ` (95% CI ${fmt(r.ci[0])} to ${fmt(r.ci[1])})` : ''}${r.scale && !/None/.test(r.scale) && !r.foldChange ? ` on the ${esc(r.scale)} scale` : ''}`;
    }
    if (k === 'two_way') {
      return `<p class="big" style="margin:0"><b>${esc(r.test)}</b> on ${esc(r.scale)}</p>
        <div class="table-wrap" style="margin-top:6px"><table><thead><tr><th class="l">Term</th><th>df</th><th>F</th><th>p</th><th>partial η²</th></tr></thead><tbody>
        ${r.table.map((x) => `<tr><td class="l">${esc(x.term)}</td><td>${x.df}</td><td>${fmt(x.F, 4)}</td><td class="${pClass(x.p)}">${fmtP(x.p)}</td><td>${fmt(x.partialEta2)}</td></tr>`).join('')}
        <tr class="dim"><td class="l">Residual</td><td>${r.dfRes}</td><td></td><td></td><td></td></tr></tbody></table></div>
        ${r.missingCells ? `<p class="error">${r.missingCells} combination(s) of the two factors have no data; Type III tests are not meaningful with empty cells.</p>` : ''}
        <p class="hint" style="margin-top:6px">${r.table[2].p < 0.05 ? 'The interaction is significant: interpret the simple effects below rather than the main effects.' : 'No evidence of an interaction: the main effects can be interpreted directly.'}</p>`;
    }
    return `<p class="big" style="margin:0"><b>${esc(r.test)}</b>${r.scale && r.scale !== 'None (raw values)' ? ` on ${esc(r.scale)}` : ''}</p>
      <div class="result-line">${esc(line)}${eff ? `<br>${esc(eff)}` : ''}${est ? `<br>${est}` : ''}</div>`;
  }
  function posthocBlock(ph) {
    if (ph.trend) { const t = ph.trend; return `<p class="big" style="margin:14px 0 0"><b>${esc(ph.name)}</b></p><div class="result-line">${t.statName} = ${fmt(t.stat, 4)}${t.df ? ` (df = ${fmt(t.df, 3)})` : ''}, ${pEq(t.p)}${t.slope !== undefined ? `; ${esc(t.note)} = ${fmt(t.slope)}` : ` (${esc(t.note)})`}</div>`; }
    const list = ph.list || []; const fc = list.some((x) => x.foldChange !== undefined); const within = list.some((x) => x.within);
    return `<p class="big" style="margin:14px 0 0"><b>Post hoc: ${esc(ph.name)}</b></p>
      <div class="table-wrap" style="margin-top:6px"><table><thead><tr>${within ? '<th class="l">Within</th>' : ''}<th class="l">Comparison</th><th>${list[0] && list[0].diffName ? esc(list[0].diffName) : 'Difference'}</th>${fc ? '<th>Fold change</th>' : ''}<th>${esc(list[0] ? list[0].statName : '')}</th><th>adjusted p</th></tr></thead><tbody>
      ${list.map((x) => `<tr>${within ? `<td class="l">${esc(x.within)}</td>` : ''}<td class="l">${esc(x.a)} vs ${esc(x.b)}</td><td>${fmt(x.diff)}</td>${fc ? `<td>${fmt(x.foldChange)}</td>` : ''}<td>${fmt(x.stat, 3)}</td><td class="${pClass(x.p)}">${fmtP(x.p)}</td></tr>`).join('')}
      </tbody></table></div><p class="hint" style="margin-top:4px">Difference = first group minus second${fc ? ', on the log₂ scale; fold change = 2^difference' : ''}.</p>`;
  }
  function transformPanel(name, res) {
    const tr = res.transforms; const forced = st.force[name];
    return `<section class="panel"><div class="panel-head"><h2>Which transformation?</h2></div>
      <p class="panel-note">${esc(forced ? `You chose ${tr.chosen.label}. Click it again to go back to the automatic choice.` : tr.reason)} Candidates are listed in order of preference for ${esc(OUTCOME_LABELS[res.outcomeType].toLowerCase())} data. Click a row to use that scale instead.</p>
      <div class="table-wrap"><table><thead><tr><th class="l">Transformation</th><th>Shapiro-Wilk W</th><th>SW p</th><th>Brown-Forsythe p</th><th>Skewness</th><th>SD ratio</th><th class="l">Normal?</th><th class="l">Equal spread?</th></tr></thead><tbody>
      ${tr.candidates.map((c) => `<tr class="clickable${c === tr.chosen ? ' chosen' : ''}" data-force="${c.key}" data-name="${esc(name)}"><td class="l">${esc(c.label)}${c === tr.chosen ? ' ✓' : ''}</td><td>${fmt(c.sw.W)}</td><td>${fmtP(c.sw.p)}</td><td>${c.lev ? fmtP(c.lev.p) : '–'}</td><td>${fmt(c.skew, 2)}</td><td>${fmt(c.sdRatio, 2)}</td><td class="l ${c.normalOK ? 'pass' : 'fail'}">${c.normalOK ? 'yes' : 'no'}</td><td class="l ${c.lev ? (c.varOK ? 'pass' : 'fail') : ''}">${c.lev ? (c.varOK ? 'yes' : 'no') : '–'}</td></tr>`).join('')}
      </tbody></table></div>
      <p class="hint" style="margin-top:6px">Normal = Shapiro-Wilk p ≥ 0.05 on the residuals (or |skew| &lt; 0.5 and |excess kurtosis| &lt; 1 with 100+ residuals). Equal spread = Brown-Forsythe p ≥ 0.05. Choose a transformation for scientific reasons where you can (log for intensities and ratios); trying many and keeping the one with the best p-value is a mild form of data dredging.</p></section>`;
  }
  function descriptives(res) {
    const b = res.built; const c = res.used; const log = c.key === 'log2';
    return `<section class="panel"><div class="panel-head"><h2>Descriptive statistics</h2></div>
      <div class="table-wrap"><table><thead><tr><th class="l">Group</th><th>n</th><th>Mean</th><th>SD</th><th>SEM</th><th>Median</th><th>Q1</th><th>Q3</th><th>Min</th><th>Max</th>${log ? '<th>Geometric mean</th>' : ''}</tr></thead><tbody>
      ${b.groups.map((g, i) => { const d = S.describe(g); return `<tr><td class="l"><span class="sw c" style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${colorOf(i)};margin-right:6px"></span>${esc(b.names[i])}</td><td>${d.n}</td><td>${fmt(d.mean, 4)}</td><td>${fmt(d.sd, 3)}</td><td>${fmt(d.se, 3)}</td><td>${fmt(d.median, 4)}</td><td>${fmt(d.q1, 4)}</td><td>${fmt(d.q3, 4)}</td><td>${fmt(d.min, 4)}</td><td>${fmt(d.max, 4)}</td>${log ? `<td>${fmt(Math.pow(2, S.mean(g.map(Math.log2))), 4)}</td>` : ''}</tr>`; }).join('')}
      </tbody></table></div><p class="hint" style="margin-top:6px">On the original scale. ${log ? 'After a log transform, report geometric means and fold changes rather than arithmetic means.' : ''}</p></section>`;
  }

  function runOne() {
    if (!st.one) return emptyPanel('Choose a column.');
    const type = outcomeTypeFor(st.one);
    const ref = st.ref !== '' ? Number(st.ref) : (type === 'ratio' ? 1 : 0);
    if (!Number.isFinite(ref)) return emptyPanel('Enter a reference value.');
    const res = N.analyseOneSample(st.table, st.one, ref, type, st.force[st.one], st.subject || null);
    return compareDetail(st.one, res);
  }

  function runRelate() {
    if (!st.x || !st.y) return emptyPanel('Choose two numeric columns.');
    if (st.x === st.y) return emptyPanel('Choose two different columns.');
    const r = N.analyseRelate(st.table, st.x, st.y);
    if (r.error) return emptyPanel(r.error);
    lastAnswers = r.answers;
    const xl = (r.logX ? 'log₂ ' : '') + st.x, yl = (r.logY ? 'log₂ ' : '') + st.y;
    const facts = `<div class="box" style="margin-top:12px"><h3>What the data told us</h3><dl class="facts">
      <dt>Pairs</dt><dd>${r.x.length}</dd>
      <dt>Normality</dt><dd>${esc(xl)}: SW ${pEq(r.swX.p)}; ${esc(yl)}: SW ${pEq(r.swY.p)}; residuals: SW ${pEq(r.swResid.p)}</dd>
      <dt>Shape</dt><dd>${r.answers.relShape === 'linear' ? 'Roughly linear (Pearson ≈ Spearman)' : 'Monotonic but curved (Spearman > Pearson)'}</dd>
      <dt>Outliers</dt><dd>${r.outliers ? r.outliers + ' far from the line' : 'none flagged'}</dd></dl>
      <div class="row" style="margin-top:8px"><button class="btn small" type="button" data-to-guide>Open these answers in the question guide</button></div></div>`;
    let html = recCard(r.recommendation, { kicker: 'Recommended for this data', top: facts });
    const p = r.pearson, s = r.spearman;
    const callouts = r.warnings.map((w) => `<div class="callout warn"><span>${esc(w)}</span></div>`).concat(r.notes.map((n) => `<div class="callout info"><span>${esc(n)}</span></div>`)).join('');
    html += `<section class="panel"><div class="panel-head"><h2>Results</h2></div>${callouts ? `<div class="callouts" style="margin:0 0 10px">${callouts}</div>` : ''}
      <div class="result-line">Pearson r = ${fmt(p.r)} (95% CI ${fmt(p.ci[0])} to ${fmt(p.ci[1])}), t(${p.df}) = ${fmt(p.t, 4)}, ${pEq(p.p)}; r² = ${fmt(p.r2)}<br>
      Spearman ρ = ${fmt(s.rho)}, ${pEq(s.p)}<br>Regression: ${esc(yl)} = ${fmt(p.intercept, 4)} + ${fmt(p.slope, 4)} × ${esc(xl)}</div>
      <div class="two-col" style="margin-top:12px"><div class="chart">${scatter(r.tx, r.ty, { fit: p, xLabel: xl, yLabel: yl, rawX: r.x, rawY: r.y })}</div>
      <div><div class="chart">${qqPlot(r.tx.map((v, i) => r.ty[i] - (p.intercept + p.slope * v)))}</div><p class="chart-note">Q–Q plot of the regression residuals.</p></div></div></section>`;
    return html;
  }

  function runAssoc() {
    if (!st.ra || !st.rb) return emptyPanel('Choose two categorical columns.');
    if (st.ra === st.rb) return emptyPanel('Choose two different columns.');
    const r = N.analyseAssoc(st.table, st.ra, st.rb, { subject: st.subject || null });
    if (r.error) return emptyPanel(r.error);
    lastAnswers = r.answers;
    const chi = r.chisq;
    const facts = `<div class="box" style="margin-top:12px"><h3>What the data told us</h3><dl class="facts">
      <dt>Table</dt><dd>${r.rowLevels.length} × ${r.colLevels.length}, N = ${chi.N}</dd>
      <dt>Expected counts</dt><dd>smallest ${fmt(chi.minExpected)}; ${Math.round(chi.fracSmall * 100)} % of cells below 5</dd></dl>
      <div class="row" style="margin-top:8px"><button class="btn small" type="button" data-to-guide>Open these answers in the question guide</button></div></div>`;
    let html = recCard(r.recommendation, { kicker: 'Recommended for this data', top: facts + r.notes.map((n) => `<div class="callouts"><div class="callout info"><span>${esc(n)}</span></div></div>`).join('') });
    const lines = [`${chi.test}: χ²(${chi.df}) = ${fmt(chi.X2, 4)}, ${pEq(chi.p)}; Cramér's V = ${fmt(chi.effect.value)}`];
    if (r.fisher) lines.push(`Fisher's exact test: ${pEq(r.fisher.p)}; odds ratio = ${fmt(r.fisher.oddsRatio)}`);
    if (r.monteCarlo) lines.push(`Monte Carlo (permutation) p for the chi-square statistic = ${fmtP(r.monteCarlo.p)} (${r.monteCarlo.B} permutations)`);
    html += `<section class="panel"><div class="panel-head"><h2>Results</h2></div><div class="result-line">${lines.map(esc).join('<br>')}</div>
      <p class="big" style="margin:14px 0 0"><b>Counts</b> <span class="hint">(standardised residual in brackets; beyond ±2 marks the cells that drive the association)</span></p>
      <div class="table-wrap" style="margin-top:6px"><table><thead><tr><th class="l">${esc(r.rowName)} \\ ${esc(r.colName)}</th>${r.colLevels.map((l) => `<th>${esc(l)}</th>`).join('')}<th>Total</th></tr></thead><tbody>
      ${r.table.map((row, i) => `<tr><td class="l">${esc(r.rowLevels[i])}</td>${row.map((v, j) => `<td class="${Math.abs(r.stdres[i][j]) > 2 ? 'sig' : ''}">${v} <span class="ns">(${fmt(r.stdres[i][j], 2)})</span></td>`).join('')}<td>${S.sum(row)}</td></tr>`).join('')}
      </tbody></table></div></section>`;
    return html;
  }

  // ------------------------------------------------------------------ start
  renderGuide();
  const savedTab = store.get('stats-tab'); if (savedTab === 'tab-data') showTab('tab-data');
})();
