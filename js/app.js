/* UI wiring and rendering for the Peptide Detectability Explorer. */
(function () {
  'use strict';
  const { ENZYMES, digest, parseFasta, mz } = window.Digest;
  const $ = (id) => document.getElementById(id);
  const STORE_KEY = 'peptide-explorer-settings-v1';

  const state = {
    entries: [], entryIndex: 0,
    enzymes: ['trypsin'], missed: 0, minLen: 6, maxLen: 30,
    cam: true, metLoss: true, il: true,
    matrix: null, matrixName: '', runMode: 'mean',
    scale: 'log', sort: 'pos', filter: 'all',
    tableSort: { key: 'start', dir: 1 },
    result: null,
  };

  // ---------- helpers ----------
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmtInt = (v) => (isFinite(v) ? Math.round(v).toLocaleString('en-US') : '–');
  const fmtSci = (v) => {
    if (!isFinite(v)) return '–';
    const e = Math.floor(Math.log10(v));
    return (v / Math.pow(10, e)).toFixed(2) + 'e' + e;
  };
  const fmtFold = (v) => (v >= 100 ? Math.round(v).toLocaleString('en-US') : v.toFixed(1)) + '×';
  const sup = (n) => String(n).replace(/[-0-9]/g, (c) => '⁻⁰¹²³⁴⁵⁶⁷⁸⁹'['-0123456789'.indexOf(c)]);
  const norm = (s) => (state.il ? s.replace(/I/g, 'L') : s);

  function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  let rampStops = [];
  function readRamp() {
    rampStops = cssVar('--seq-stops').split(',').map((h) => {
      h = h.trim().replace('#', '');
      return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
    });
  }
  function ramp(t) {
    t = Math.max(0, Math.min(1, t));
    const x = t * (rampStops.length - 1);
    const i = Math.min(rampStops.length - 2, Math.floor(x));
    const f = x - i;
    const c = rampStops[i].map((a, k) => Math.round(a + (rampStops[i + 1][k] - a) * f));
    return 'rgb(' + c.join(',') + ')';
  }
  function rampLuma(t) {
    const m = ramp(t).match(/\d+/g).map(Number);
    return (0.299 * m[0] + 0.587 * m[1] + 0.114 * m[2]) / 255;
  }
  function rampCss() {
    return 'linear-gradient(90deg,' + rampStops.map((c) => 'rgb(' + c.join(',') + ')').join(',') + ')';
  }

  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        enzymes: state.enzymes, missed: state.missed, minLen: state.minLen, maxLen: state.maxLen,
        cam: state.cam, metLoss: state.metLoss, il: state.il, scale: state.scale, fasta: $('fasta').value,
      }));
    } catch (e) { /* storage unavailable */ }
  }
  function load() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch (e) { return null; }
  }

  // ---------- analysis ----------
  function analyse() {
    const entry = state.entries[state.entryIndex];
    if (!entry || !state.enzymes.length) { state.result = null; return; }
    const protein = entry.seq;
    const { peptides, sites } = digest(protein, {
      enzymes: state.enzymes, missed: state.missed, minLen: state.minLen, maxLen: state.maxLen,
      metLoss: state.metLoss, carbamidomethyl: state.cam,
    });
    const siteSet = new Set(sites);
    const extras = [];
    let matchedRows = 0;

    if (state.matrix) {
      const bySeq = new Map();
      for (const p of peptides) {
        const k = norm(p.seq);
        if (!bySeq.has(k)) bySeq.set(k, []);
        bySeq.get(k).push(p);
      }
      const nProt = norm(protein);
      const matches = [];
      for (const [seq, entryData] of state.matrix.peptides) {
        const k = norm(seq);
        const theo = bySeq.get(k);
        const pos = theo ? -1 : nProt.indexOf(k);
        if (!theo && pos < 0) continue;
        matches.push({ k, theo, pos, entryData });
      }
      matchedRows = matches.length;
      if (state.runMode === 'auto') state.runMode = String(pickSample(entry, matches));
      const mode = state.runMode === 'mean' || state.runMode === 'median' || state.runMode === 'max'
        ? state.runMode : Number(state.runMode);
      for (const { k, theo, pos, entryData } of matches) {
        const s = window.PrMatrix.summarise(entryData.values, mode);
        const det = { intensity: s.value, nRuns: s.nDetected, precursors: entryData.precursors, values: entryData.values };
        if (theo) { theo.forEach((p) => Object.assign(p, det, { detected: isFinite(s.value) })); continue; }
        // Detected, but not produced by the current enzyme / missed-cleavage settings.
        const start = pos + 1;
        const end = pos + k.length;
        const pseq = protein.slice(pos, end);
        const startOk = siteSet.has(pos) || (pos === 1 && protein[0] === 'M');
        const endOk = siteSet.has(end);
        let internal = 0;
        for (const b of sites) if (b > pos && b < end) internal++;
        const reason = startOk && endOk ? internal + ' missed cleavage' + (internal === 1 ? '' : 's')
          : startOk || endOk ? 'semi-specific' : 'non-specific';
        const status = pseq.length < state.minLen ? 'short' : pseq.length > state.maxLen ? 'long' : 'window';
        extras.push(Object.assign({
          seq: pseq, start, end, length: pseq.length, missed: internal,
          mass: window.Digest.peptideMass(pseq, { carbamidomethyl: state.cam }),
          status, inWindow: status === 'window', extra: true, reason, detected: isFinite(s.value),
        }, det));
      }
    }

    const all = peptides.concat(extras);
    const detected = all.filter((p) => p.detected);
    const maxI = detected.reduce((m, p) => Math.max(m, p.intensity), 0);
    const minI = detected.reduce((m, p) => Math.min(m, p.intensity), Infinity);
    const logMin = detected.length ? Math.log10(minI) : 0;
    const logMax = detected.length ? Math.log10(maxI) : 1;
    for (const p of all) {
      p.rel = p.detected ? (100 * p.intensity) / maxI : NaN;
      p.t = p.detected ? (logMax > logMin ? (Math.log10(p.intensity) - logMin) / (logMax - logMin) : 1) : NaN;
    }

    // Residue-level coverage
    const L = protein.length;
    const cover = { window: new Uint8Array(L), det: new Float64Array(L).fill(NaN) };
    for (const p of all) {
      for (let i = p.start - 1; i < p.end; i++) {
        if (p.inWindow && !p.extra) cover.window[i] = 1;
        if (p.detected && !(cover.det[i] >= p.t)) cover.det[i] = p.t;
      }
    }
    const pct = (n) => (100 * n) / L;
    const bySample = state.matrix ? sampleSummary(all, L) : null;
    state.result = {
      bySample,
      entry, protein, peptides, extras, all, sites, cover, maxI, minI, logMin, logMax, matchedRows,
      nWindow: peptides.filter((p) => p.inWindow).length,
      nWindowDetected: peptides.filter((p) => p.inWindow && p.detected).length,
      nOutsideDetected: peptides.filter((p) => !p.inWindow && p.detected).length,
      coverWindow: pct(cover.window.reduce((a, b) => a + b, 0)),
      coverDet: pct(cover.det.reduce((a, b) => a + (isNaN(b) ? 0 : 1), 0)),
    };
  }

  /**
   * Default sample for a protein when the file has one sample per column: the sample whose
   * name matches the protein (e.g. "Phytoglobin"), otherwise the one where most of its peptides were seen.
   */
  function pickSample(entry, matches) {
    const runs = state.matrix.runs;
    const simple = (x) => String(x).toLowerCase().replace(/[^a-z0-9]/g, '');
    const id = simple(entry.id);
    const header = simple(entry.header);
    const byName = runs.findIndex((r) => {
      const l = simple(r.label || '');
      return l.length >= 3 && (header.includes(l) || (id.length >= 3 && l.includes(id)));
    });
    if (byName >= 0) return byName;
    let best = 0, bestN = -1;
    runs.forEach((r, i) => {
      const n = matches.filter((m) => !isNaN(m.entryData.values[i])).length;
      if (n > bestN) { best = i; bestN = n; }
    });
    return best;
  }

  // Per-sample detection for the current protein, on one log scale shared by all samples.
  function sampleSummary(all, L) {
    const runs = state.matrix.runs;
    const cols = all.filter((p) => (p.inWindow && !p.extra) || (p.values && p.values.some((v) => !isNaN(v))));
    let lo = Infinity, hi = -Infinity;
    for (const p of cols) if (p.values) for (const v of p.values) if (v > 0) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    const scale = (v) => (hi > lo ? (Math.log10(v) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo)) : 1);
    const nWindow = all.filter((p) => p.inWindow && !p.extra).length;
    const rows = runs.map((run, r) => {
      const covered = new Uint8Array(L);
      let nWin = 0, nOther = 0, sum = 0;
      for (const p of cols) {
        const v = p.values ? p.values[r] : NaN;
        if (isNaN(v)) continue;
        if (p.inWindow && !p.extra) nWin++; else nOther++;
        sum += v;
        for (let i = p.start - 1; i < p.end; i++) covered[i] = 1;
      }
      return { run, index: r, nWin, nOther, sum, coverage: (100 * covered.reduce((a, b) => a + b, 0)) / L };
    });
    const maxSum = Math.max(0, ...rows.map((x) => x.sum));
    return { cols, rows, scale, nWindow, maxSum };
  }

  // ---------- rendering ----------
  function render() {
    analyse();
    renderStats();
    renderSamples();
    renderMap();
    renderSeq();
    renderAbundance();
    renderTable();
    updateMatrixInfo();
  }

  function stat(k, v, s, muted) {
    return '<div class="stat' + (muted ? ' muted' : '') + '"><span class="k">' + k + '</span><span class="v">' + v +
      '</span><span class="s">' + (s || '&nbsp;') + '</span></div>';
  }

  function renderStats() {
    const r = state.result;
    const el = $('stats');
    if (!r) { el.innerHTML = stat('Peptides', '–', state.enzymes.length ? 'Enter a sequence' : 'Select an enzyme', true); return; }
    const sites = r.sites.length - 2;
    let html = stat('Cleavage sites', sites, r.protein.length + ' residues') +
      stat('Peptides produced', r.peptides.length, state.missed ? 'up to ' + state.missed + ' missed cleavage' + (state.missed > 1 ? 's' : '') : 'complete digest') +
      stat('In detection window', r.nWindow, state.minLen + '–' + state.maxLen + ' aa · ' + r.coverWindow.toFixed(0) + '% coverage possible');
    if (state.matrix) {
      const extra = r.extras.filter((p) => p.detected).length + r.nOutsideDetected;
      html += stat('Detected', r.nWindowDetected + ' / ' + r.nWindow,
        (r.nWindow ? Math.round((100 * r.nWindowDetected) / r.nWindow) + '% of window' : '') + (extra ? ' · +' + extra + ' other' : '') +
        '<br>in ' + esc(currentSampleName()));
      html += stat('Observed coverage', r.coverDet.toFixed(0) + '%', 'vs ' + r.coverWindow.toFixed(0) + '% from in-window peptides at these settings');
      const fold = r.maxI / r.minI;
      html += r.minI < Infinity && r.maxI > 0
        ? stat('Intensity spread', fmtFold(fold), (Math.log10(fold)).toFixed(1) + ' orders of magnitude between equimolar peptides')
        : stat('Intensity spread', '–', 'No peptides from this protein were found in the matrix', true);
    } else {
      html += stat('Detected', '–', 'Upload a pr_matrix to compare', true);
    }
    el.innerHTML = html;
  }

  function currentSampleName() {
    const m = state.matrix;
    if (!m) return '';
    if (state.runMode === 'mean') return 'mean of runs where detected';
    if (state.runMode === 'median') return 'median of runs where detected';
    if (state.runMode === 'max') return 'maximum across runs';
    const run = m.runs[Number(state.runMode)];
    return run ? run.name : '';
  }

  function renderSamples() {
    const panel = $('samples-panel');
    const r = state.result;
    if (!r || !state.matrix || state.matrix.runs.length < 2) { panel.hidden = true; return; }
    panel.hidden = false;
    $('run').value = state.runMode;
    const bs = r.bySample;
    $('sample-current').textContent = currentSampleName();
    const sel = Number(state.runMode);
    let html = '<table class="samples"><thead><tr><th class="l">Sample</th><th>Detected</th><th>Coverage</th><th>Total intensity</th>' +
      '<th class="l">Peptides along the sequence (log intensity, shared scale)</th></tr></thead><tbody>';
    for (const row of bs.rows) {
      const on = row.index === sel;
      html += '<tr class="srow' + (on ? ' on' : '') + (row.nWin + row.nOther ? '' : ' none') + '" data-run="' + row.index + '" tabindex="0" aria-selected="' + on + '">' +
        '<td class="l sname">' + esc(row.run.name) + '</td>' +
        '<td>' + row.nWin + ' / ' + bs.nWindow + (row.nOther ? ' <span class="plus">+' + row.nOther + '</span>' : '') + '</td>' +
        '<td>' + row.coverage.toFixed(0) + '%</td>' +
        '<td class="tot"><span class="cell-bar" style="width:' + (bs.maxSum ? Math.max(row.sum ? 2 : 0, (60 * row.sum) / bs.maxSum) : 0) + 'px;background:var(--accent)"></span>' + (row.sum ? fmtSci(row.sum) : '–') + '</td>' +
        '<td class="l"><span class="strip">' + bs.cols.map((p) => {
          const v = p.values ? p.values[row.index] : NaN;
          const tip = esc(p.seq) + ' ' + p.start + '–' + p.end + ': ' + (isNaN(v) ? 'not detected' : fmtSci(v));
          return isNaN(v)
            ? '<i class="hc nd' + (p.inWindow && !p.extra ? '' : ' x') + '" title="' + tip + '"></i>'
            : '<i class="hc" style="background:' + ramp(bs.scale(v)) + '" title="' + tip + '"></i>';
        }).join('') + '</span></td></tr>';
    }
    $('samples').innerHTML = html + '</tbody></table>';
  }

  function legendHtml(withDetect) {
    const parts = [];
    if (withDetect) {
      parts.push('<span class="key"><span class="ramp-l">low</span><span class="ramp" style="background:' + rampCss() + '"></span><span class="ramp-l">high</span>&nbsp;detected (log intensity)</span>');
      parts.push('<span class="key"><span class="sw win"></span>in window, not detected</span>');
    } else {
      parts.push('<span class="key"><span class="sw det"></span>in detection window</span>');
    }
    parts.push('<span class="key"><span class="sw out"></span>too short / too long</span>');
    parts.push('<span class="key"><span class="sw cut"></span>cleavage site</span>');
    return parts.join('');
  }

  function packLanes(peps) {
    const laneEnds = [];
    const lanes = peps.map((p) => {
      let l = laneEnds.findIndex((e) => e < p.start);
      if (l < 0) { l = laneEnds.length; laneEnds.push(0); }
      laneEnds[l] = p.end;
      return l;
    });
    return { lanes, count: laneEnds.length };
  }

  function pepFill(p) {
    if (p.detected) return { fill: ramp(p.t), stroke: 'none' };
    if (!p.inWindow) return { fill: 'var(--out)', stroke: 'none' };
    if (state.matrix) return { fill: 'var(--surface)', stroke: 'var(--accent)' };
    return { fill: 'var(--accent)', stroke: 'none' };
  }

  function renderMap() {
    const r = state.result;
    const wrap = $('map');
    $('map-legend').innerHTML = legendHtml(!!state.matrix);
    if (!r) { wrap.innerHTML = '<p class="empty">Nothing to show yet.</p>'; return; }
    const W = Math.max(560, wrap.clientWidth);
    const padL = 12, padR = 12, laneH = 12, laneGap = 4;
    const L = r.protein.length;
    const x = (pos) => padL + ((pos) / L) * (W - padL - padR); // pos = residue boundary 0..L
    const groups = [{ title: null, peps: r.peptides }];
    const extraDet = r.extras.filter((p) => p.detected);
    if (extraDet.length) groups.push({ title: 'Detected, but not produced by the current enzyme settings', peps: extraDet });

    let y = 30;
    let body = '';
    // Axis
    const step = niceStep(L);
    let axis = '<line x1="' + x(0) + '" x2="' + x(L) + '" y1="18" y2="18" stroke="var(--line)"/>';
    for (let p = 0; p <= L; p += step) {
      const pos = Math.max(p, 1);
      axis += '<line x1="' + x(pos - 0.5) + '" x2="' + x(pos - 0.5) + '" y1="14" y2="18" stroke="var(--ink-3)"/>' +
        '<text x="' + x(pos - 0.5) + '" y="10" text-anchor="middle">' + pos + '</text>';
    }
    for (const s of r.sites.slice(1, -1)) {
      axis += '<line x1="' + x(s) + '" x2="' + x(s) + '" y1="18" y2="26" stroke="var(--cut)" stroke-width="1.5"/>';
    }

    groups.forEach((g, gi) => {
      if (g.title) {
        y += 10;
        body += '<text class="grp" x="' + padL + '" y="' + (y + 10) + '">' + esc(g.title) + '</text>';
        y += 18;
      }
      const { lanes, count } = packLanes(g.peps);
      g.peps.forEach((p, i) => {
        const x0 = x(p.start - 1);
        const w = Math.max(1.5, x(p.end) - x0 - 1);
        const f = pepFill(p);
        const idx = r.all.indexOf(p);
        body += '<rect class="pep" data-i="' + idx + '" x="' + (x0 + 0.5).toFixed(1) + '" y="' + (y + lanes[i] * (laneH + laneGap)) +
          '" width="' + w.toFixed(1) + '" height="' + laneH + '" rx="2" fill="' + f.fill + '"' +
          (f.stroke !== 'none' ? ' stroke="' + f.stroke + '" stroke-width="1.25"' : '') + '/>';
      });
      y += count * (laneH + laneGap);
    });
    const H = y + 6;
    wrap.innerHTML = '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Peptides along the protein sequence">' + axis + body + '</svg>';
  }

  function niceStep(L) {
    for (const s of [10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000]) if (L / s <= 12) return s;
    return 5000;
  }

  function renderSeq() {
    const r = state.result;
    const el = $('seqmap');
    $('seq-legend').innerHTML = legendHtml(!!state.matrix);
    if (!r) { el.innerHTML = ''; return; }
    const cutAfter = new Set(r.sites.slice(1, -1).map((b) => b - 1));
    const per = 50;
    let html = '';
    for (let rowStart = 0; rowStart < r.protein.length; rowStart += per) {
      html += '<div class="seq-row"><span class="seq-num">' + (rowStart + 1) + '</span>';
      for (let b = rowStart; b < Math.min(rowStart + per, r.protein.length); b += 10) {
        html += '<span class="seq-block">';
        for (let i = b; i < Math.min(b + 10, r.protein.length); i++) {
          const t = r.cover.det[i];
          let cls = 'aa';
          let style = '';
          if (!isNaN(t)) {
            cls += ' det' + (rampLuma(t) > 0.55 ? ' lt' : '');
            style = ' style="background:' + ramp(t) + '"';
          } else if (r.cover.window[i]) cls += ' win';
          if (cutAfter.has(i)) cls += ' cut';
          html += '<span class="' + cls + '"' + style + ' data-r="' + i + '">' + r.protein[i] + '</span>';
        }
        html += '</span>';
      }
      html += '</div>';
    }
    el.innerHTML = html;
  }

  function abundanceRows() {
    const r = state.result;
    const rows = r.all.filter((p) => p.inWindow || p.detected);
    if (state.sort === 'int') {
      rows.sort((a, b) => (b.detected ? b.intensity : -1) - (a.detected ? a.intensity : -1) || a.start - b.start);
    } else rows.sort((a, b) => a.start - b.start || a.end - b.end);
    return rows;
  }

  function renderAbundance() {
    const r = state.result;
    const el = $('abundance');
    const note = $('abundance-note');
    $('scale-log').classList.toggle('on', state.scale === 'log');
    $('scale-lin').classList.toggle('on', state.scale === 'lin');
    $('sort-pos').classList.toggle('on', state.sort === 'pos');
    $('sort-int').classList.toggle('on', state.sort === 'int');
    if (!r || !state.matrix) {
      note.textContent = 'Every peptide from one protein molecule is present in equal molar amounts, so in an ideal world every bar here would be the same height. Upload a pr_matrix (or load the simulated GFP matrix) to see the measured intensities.';
      el.innerHTML = '';
      return;
    }
    const det = r.all.filter((p) => p.detected);
    if (!det.length) {
      note.textContent = '';
      el.innerHTML = '<p class="empty">None of the ' + state.matrix.peptides.size.toLocaleString('en-US') +
        ' peptide sequences in the matrix occur in this protein. Check that the FASTA matches a protein in the file.</p>';
      return;
    }
    const sorted = det.map((p) => p.intensity).sort((a, b) => a - b);
    const median = sorted[sorted.length >> 1];
    note.innerHTML = 'Equimolar in the sample, but the most intense peptide gives <b>' + fmtFold(r.maxI / r.minI) +
      '</b> the signal of the weakest. ' + (state.scale === 'log'
      ? 'Log scale: each gridline is a 10-fold step. Dashed line = median.'
      : 'Linear scale, as % of the most intense peptide. Most of the protein is nearly invisible next to its best peptide.');

    let lo, hi, xPct, ticks;
    if (state.scale === 'log') {
      lo = Math.floor(r.logMin - 0.25);
      hi = Math.ceil(r.logMax + 0.05);
      if (hi - lo < 2) hi = lo + 2;
      xPct = (v) => (100 * (Math.log10(v) - lo)) / (hi - lo);
      ticks = [];
      for (let e = lo; e <= hi; e++) ticks.push({ at: (100 * (e - lo)) / (hi - lo), label: '10' + sup(e) });
    } else {
      xPct = (v) => (100 * v) / r.maxI;
      ticks = [0, 25, 50, 75, 100].map((v) => ({ at: v, label: v + '%' }));
    }
    const grid = ticks.map((t) => '<span class="grid" style="left:' + t.at + '%"></span>').join('');
    let html = '<div class="ab"><div></div><div class="ab-axis">' +
      ticks.map((t) => '<span style="left:' + t.at + '%">' + t.label + '</span>').join('') + '</div>';
    for (const p of abundanceRows()) {
      const idx = r.all.indexOf(p);
      const tag = p.extra ? '<span class="tag">' + esc(p.reason) + '</span>' : !p.inWindow ? '<span class="tag">' + p.status + '</span>' : '';
      html += '<div class="ab-label" data-i="' + idx + '"><span class="pos">' + p.start + '–' + p.end + '</span><span class="sq">' + esc(p.seq) + '</span>' + tag + '</div>';
      html += '<div class="ab-track" data-i="' + idx + '">' + grid;
      if (!p.detected) html += '<span class="nd">not detected</span>';
      else if (state.scale === 'log') {
        const xp = xPct(p.intensity);
        html += '<span class="stem" style="width:' + xp + '%"></span><span class="dot" style="left:' + xp + '%;background:' + ramp(p.t) + '"></span>';
      } else {
        html += '<span class="bar" style="width:' + Math.max(0.4, xPct(p.intensity)) + '%;background:' + ramp(p.t) + '"></span>';
      }
      if (state.scale === 'log') html += '<span class="ref" style="left:' + xPct(median) + '%"></span>';
      html += '</div>';
    }
    if (state.scale === 'log') {
      html += '<div></div><div class="ab-ref-label"><span style="left:' + xPct(median) + '%">median ' + fmtSci(median) + '</span></div>';
    }
    el.innerHTML = html + '</div>';
  }

  const COLS = [
    { key: 'start', label: 'Start' },
    { key: 'end', label: 'End' },
    { key: 'seq', label: 'Sequence', cls: 'l' },
    { key: 'length', label: 'Length' },
    { key: 'missed', label: 'Missed' },
    { key: 'mass', label: 'Mono. mass' },
    { key: 'mz2', label: 'm/z 2+' },
    { key: 'mz3', label: 'm/z 3+' },
    { key: 'status', label: 'Window', cls: 'l' },
    { key: 'intensity', label: 'Intensity', matrix: true },
    { key: 'rel', label: 'Relative', matrix: true, cls: 'l' },
    { key: 'nRuns', label: 'Runs', matrix: true },
  ];

  function tableRows() {
    const r = state.result;
    if (!r) return [];
    let rows = r.all.slice();
    if (state.filter === 'window') rows = rows.filter((p) => p.inWindow && !p.extra);
    if (state.filter === 'detected') rows = rows.filter((p) => p.detected);
    const { key, dir } = state.tableSort;
    const val = (p) => (key === 'mz2' ? mz(p.mass, 2) : key === 'mz3' ? mz(p.mass, 3) : p[key]);
    rows.sort((a, b) => {
      let va = val(a), vb = val(b);
      if (typeof va === 'string' || typeof vb === 'string') return dir * String(va).localeCompare(String(vb));
      va = isFinite(va) ? va : -Infinity; vb = isFinite(vb) ? vb : -Infinity;
      return dir * (va - vb) || a.start - b.start;
    });
    return rows;
  }

  function statusLabel(p) {
    if (p.extra) return { cls: 'extra', text: p.reason };
    return { cls: p.status, text: p.status === 'window' ? 'in window' : p.status === 'short' ? 'too short' : 'too long' };
  }

  function renderTable() {
    document.querySelectorAll('[data-filter]').forEach((b) => b.classList.toggle('on', b.dataset.filter === state.filter));
    const r = state.result;
    const t = $('table');
    if (!r) { t.innerHTML = ''; return; }
    const cols = COLS.filter((c) => !c.matrix || state.matrix);
    const nRuns = state.matrix ? state.matrix.runs.length : 0;
    let html = '<thead><tr>' + cols.map((c) => {
      const s = state.tableSort.key === c.key ? (state.tableSort.dir > 0 ? 'ascending' : 'descending') : 'none';
      return '<th data-k="' + c.key + '" class="' + (c.cls || '') + '" aria-sort="' + s + '">' + c.label + '</th>';
    }).join('') + '</tr></thead><tbody>';
    for (const p of tableRows()) {
      const st = statusLabel(p);
      html += '<tr data-i="' + r.all.indexOf(p) + '" class="' + (p.inWindow || p.detected ? '' : 'dim') + '">' +
        '<td>' + p.start + '</td><td>' + p.end + '</td><td class="sq">' + esc(p.seq) + '</td><td>' + p.length +
        '</td><td>' + p.missed + '</td><td>' + (isFinite(p.mass) ? p.mass.toFixed(4) : '–') +
        '</td><td>' + (isFinite(p.mass) ? mz(p.mass, 2).toFixed(4) : '–') + '</td><td>' + (isFinite(p.mass) ? mz(p.mass, 3).toFixed(4) : '–') +
        '</td><td class="l"><span class="pill ' + st.cls + '">' + esc(st.text) + '</span></td>';
      if (state.matrix) {
        html += '<td>' + (p.detected ? fmtSci(p.intensity) : '–') + '</td><td class="l">' +
          (p.detected ? '<span class="cell-bar" style="width:' + Math.max(1, p.rel * 0.6) + 'px;background:' + ramp(p.t) + '"></span>' + p.rel.toFixed(p.rel < 10 ? 1 : 0) + '%' : '') +
          '</td><td>' + (p.nRuns != null ? p.nRuns + '/' + nRuns : '0/' + nRuns) + '</td>';
      }
      html += '</tr>';
    }
    t.innerHTML = html + '</tbody>';
  }

  function tableAsDelimited(sep) {
    const r = state.result;
    if (!r) return '';
    const head = ['start', 'end', 'sequence', 'length', 'missed_cleavages', 'mono_mass', 'mz_2plus', 'mz_3plus', 'status'];
    if (state.matrix) head.push('intensity', 'relative_pct', 'runs_detected');
    const lines = [head.join(sep)];
    for (const p of tableRows()) {
      const row = [p.start, p.end, p.seq, p.length, p.missed, p.mass.toFixed(5), mz(p.mass, 2).toFixed(5), mz(p.mass, 3).toFixed(5), statusLabel(p).text];
      if (state.matrix) row.push(p.detected ? p.intensity : '', p.detected ? p.rel.toFixed(2) : '', p.nRuns || 0);
      lines.push(row.join(sep));
    }
    return lines.join('\n') + '\n';
  }

  // ---------- tooltip ----------
  const tip = $('tip');
  function showTip(p, ev) {
    const nRuns = state.matrix ? state.matrix.runs.length : 0;
    let h = '<span class="t-seq">' + esc(p.seq) + '</span>' +
      '<span class="t-k">Residues</span> ' + p.start + '–' + p.end + ' · ' + p.length + ' aa' +
      (p.missed ? ' · ' + p.missed + ' missed' : '') + '<br>' +
      '<span class="t-k">[M]</span> ' + (isFinite(p.mass) ? p.mass.toFixed(4) : '–') +
      ' · <span class="t-k">m/z 2+</span> ' + (isFinite(p.mass) ? mz(p.mass, 2).toFixed(4) : '–') + '<br>' +
      '<span class="t-k">Status</span> ' + esc(statusLabel(p).text) + (p.nTermMetLoss ? ' (initiator Met removed)' : '');
    if (state.matrix) {
      h += '<br>' + (p.detected
        ? '<span class="t-k">Intensity</span> ' + fmtSci(p.intensity) + ' · ' + p.rel.toFixed(1) + '% of max<br><span class="t-k">Seen in</span> ' +
          p.nRuns + '/' + nRuns + ' runs · ' + p.precursors + ' precursor' + (p.precursors > 1 ? 's' : '')
        : '<span class="t-k">Not detected</span>');
    }
    tip.innerHTML = h;
    tip.hidden = false;
    moveTip(ev);
  }
  function moveTip(ev) {
    const pad = 14;
    const w = tip.offsetWidth, hgt = tip.offsetHeight;
    let left = ev.clientX + pad, top = ev.clientY + pad;
    if (left + w > window.innerWidth - 8) left = ev.clientX - w - pad;
    if (top + hgt > window.innerHeight - 8) top = ev.clientY - hgt - pad;
    tip.style.left = Math.max(8, left) + 'px';
    tip.style.top = Math.max(8, top) + 'px';
  }
  function hideTip() { tip.hidden = true; }

  function bindHover(container, selector) {
    container.addEventListener('mouseover', (ev) => {
      const t = ev.target.closest(selector);
      if (!t || !state.result) return;
      const p = state.result.all[Number(t.dataset.i)];
      if (p) showTip(p, ev);
    });
    container.addEventListener('mousemove', (ev) => { if (!tip.hidden) moveTip(ev); });
    container.addEventListener('mouseout', (ev) => {
      if (!ev.relatedTarget || !ev.relatedTarget.closest || !ev.relatedTarget.closest(selector)) hideTip();
    });
  }

  // ---------- inputs ----------
  function setFasta(text) {
    $('fasta').value = text;
    parseProtein();
  }
  // New protein + one-sample-per-column file: jump to the sample that matches it.
  let lastProteinId = null;
  function autoPickOnProteinChange() {
    const e = state.entries[state.entryIndex];
    const id = e ? e.id + ':' + e.seq.length : null;
    if (id !== lastProteinId && samplesAreDistinct()) state.runMode = 'auto';
    lastProteinId = id;
  }

  function parseProtein() {
    state.entries = parseFasta($('fasta').value);
    const sel = $('entry');
    $('entry-wrap').hidden = state.entries.length < 2;
    sel.innerHTML = state.entries.map((e, i) => '<option value="' + i + '">' + esc(e.id) + ' (' + e.seq.length + ' aa)</option>').join('');
    state.entryIndex = Math.min(state.entryIndex, Math.max(0, state.entries.length - 1));
    sel.value = String(state.entryIndex);
    updateProteinInfo();
    autoPickOnProteinChange();
    render();
    save();
  }
  function updateProteinInfo() {
    const e = state.entries[state.entryIndex];
    const info = $('protein-info');
    if (!e) { info.textContent = 'Paste a FASTA entry or a plain amino-acid sequence.'; return; }
    const mass = window.Digest.peptideMass(e.seq, {});
    info.innerHTML = '<b>' + esc(e.id) + '</b> · ' + e.seq.length + ' aa' + (isFinite(mass) ? ' · ' + (mass / 1000).toFixed(1) + ' kDa' : '') +
      (e.invalid.length ? '<br><span class="error">Ambiguous or unknown residues: ' + esc(e.invalid.join(', ')) + ' (no mass for peptides containing them)</span>' : '');
  }

  function buildEnzymes() {
    $('enzymes').innerHTML = ENZYMES.map((e) =>
      '<label class="chip" title="' + esc(e.rule) + '"><input type="checkbox" value="' + e.id + '"' +
      (state.enzymes.includes(e.id) ? ' checked' : '') + '><span>' + esc(e.name) + '</span></label>').join('');
    $('enzymes').addEventListener('change', () => {
      state.enzymes = [...$('enzymes').querySelectorAll('input:checked')].map((i) => i.value);
      render(); save();
    });
  }

  function syncLength(source) {
    let lo = Number(source === 'n' ? $('len-min-n').value : $('len-min').value);
    let hi = Number(source === 'n' ? $('len-max-n').value : $('len-max').value);
    lo = Math.max(1, Math.min(60, lo || 1));
    hi = Math.max(1, Math.min(60, hi || 1));
    if (lo > hi) { if (source === 'lo') hi = lo; else lo = hi; }
    state.minLen = lo; state.maxLen = hi;
    $('len-min').value = lo; $('len-max').value = hi;
    $('len-min-n').value = lo; $('len-max-n').value = hi;
    const pct = (v) => ((v - 1) / 59) * 100;
    $('len-fill').style.left = pct(lo) + '%';
    $('len-fill').style.width = (pct(hi) - pct(lo)) + '%';
  }

  async function loadMatrixFile(file) {
    $('pr-error').hidden = true;
    $('pr-info').textContent = 'Reading ' + file.name + '…';
    $('pr-status').hidden = false;
    try {
      const m = await window.PrMatrix.parseFile(file, (f) => { $('pr-info').textContent = 'Reading ' + file.name + '… ' + Math.round(f * 100) + '%'; });
      setMatrix(m, file.name);
    } catch (err) {
      showMatrixError(err);
    }
  }
  function showMatrixError(err) {
    $('pr-status').hidden = !state.matrix;
    $('pr-error').textContent = 'Could not read that file. ' + (err && err.message ? err.message : String(err));
    $('pr-error').hidden = false;
  }
  function setMatrix(m, name) {
    state.matrix = m;
    state.matrixName = name;
    $('pr-error').hidden = true;
    $('pr-status').hidden = false;
    const runOptions = m.runs.map((r, i) => '<option value="' + i + '">' + esc(r.name) + '</option>').join('');
    $('run').innerHTML = m.runs.length > 1
      ? '<optgroup label="One sample">' + runOptions + '</optgroup>' +
        '<optgroup label="Combine runs (replicates only)"><option value="mean">Mean of runs where detected</option>' +
        '<option value="median">Median of runs where detected</option><option value="max">Maximum across runs</option></optgroup>'
      : runOptions;
    // Labelled columns are different samples: show one at a time. Unlabelled runs are treated as replicates.
    state.runMode = m.runs.length < 2 ? '0' : samplesAreDistinct() ? 'auto' : 'mean';
    render();
  }
  function samplesAreDistinct() {
    return !!state.matrix && state.matrix.runs.length > 1 && state.matrix.runs.some((r) => r.label);
  }

  function updateMatrixInfo() {
    const m = state.matrix;
    if (!m) return;
    const r = state.result;
    $('pr-info').innerHTML = '<b>' + esc(state.matrixName) + '</b><br>' + m.rows.toLocaleString('en-US') + ' precursors · ' +
      m.peptides.size.toLocaleString('en-US') + ' peptides · ' + m.runs.length + ' run' + (m.runs.length > 1 ? 's' : '') +
      (r ? '<br>' + r.matchedRows + ' peptide' + (r.matchedRows === 1 ? '' : 's') + ' map to ' + esc(r.entry.id) : '') +
      '<br><span title="Charge states and modified forms of the same sequence are summed">Precursors summed per sequence.</span>';
  }

  // ---------- init ----------
  function init() {
    readRamp();
    const saved = load();
    if (saved) Object.assign(state, {
      enzymes: Array.isArray(saved.enzymes) && saved.enzymes.length ? saved.enzymes : state.enzymes,
      missed: saved.missed ?? state.missed, minLen: saved.minLen ?? state.minLen, maxLen: saved.maxLen ?? state.maxLen,
      cam: saved.cam ?? state.cam, metLoss: saved.metLoss ?? state.metLoss, il: saved.il ?? state.il, scale: saved.scale || state.scale,
    });
    buildEnzymes();
    $('missed').value = state.missed; $('missed-out').value = state.missed;
    $('len-min').value = state.minLen; $('len-max').value = state.maxLen;
    $('len-min-n').value = state.minLen; $('len-max-n').value = state.maxLen;
    syncLength('n');
    $('opt-cam').checked = state.cam; $('opt-met').checked = state.metLoss; $('opt-il').checked = state.il;

    let typing;
    $('fasta').addEventListener('input', () => { clearTimeout(typing); typing = setTimeout(parseProtein, 250); });
    $('fasta-file').addEventListener('change', async (ev) => {
      const f = ev.target.files[0];
      if (f) { state.entryIndex = 0; setFasta(await f.text()); }
      ev.target.value = '';
    });
    $('load-gfp').addEventListener('click', () => { state.entryIndex = 0; setFasta(window.DEMO.fasta); });
    $('entry').addEventListener('change', (ev) => { state.entryIndex = Number(ev.target.value); updateProteinInfo(); autoPickOnProteinChange(); render(); });
    $('missed').addEventListener('input', (ev) => { state.missed = Number(ev.target.value); $('missed-out').value = state.missed; render(); save(); });
    $('len-min').addEventListener('input', () => { syncLength('lo'); render(); save(); });
    $('len-max').addEventListener('input', () => { syncLength('hi'); render(); save(); });
    $('len-min-n').addEventListener('change', () => { syncLength('n'); render(); save(); });
    $('len-max-n').addEventListener('change', () => { syncLength('n'); render(); save(); });
    $('opt-cam').addEventListener('change', (ev) => { state.cam = ev.target.checked; render(); save(); });
    $('opt-met').addEventListener('change', (ev) => { state.metLoss = ev.target.checked; render(); save(); });
    $('opt-il').addEventListener('change', (ev) => { state.il = ev.target.checked; render(); save(); });

    $('pr-file').addEventListener('change', (ev) => { const f = ev.target.files[0]; if (f) loadMatrixFile(f); ev.target.value = ''; });
    const drop = $('drop');
    drop.addEventListener('dragover', (ev) => { ev.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (ev) => {
      ev.preventDefault(); drop.classList.remove('over');
      const f = ev.dataTransfer.files[0];
      if (f) loadMatrixFile(f);
    });
    $('load-demo').addEventListener('click', () => {
      if (!state.entries.length || state.entries[state.entryIndex].id !== 'P42212') { state.entryIndex = 0; setFasta(window.DEMO.fasta); }
      try { setMatrix(window.PrMatrix.parseText(window.DEMO.prMatrix), window.DEMO.prMatrixName); } catch (e) { showMatrixError(e); }
    });
    $('run').addEventListener('change', (ev) => { state.runMode = ev.target.value; render(); });
    const chooseSample = (ev) => {
      const row = ev.target.closest('tr[data-run]');
      if (!row) return;
      state.runMode = row.dataset.run;
      render();
      const again = $('samples').querySelector('tr[data-run="' + row.dataset.run + '"]');
      if (again && ev.type === 'keydown') again.focus();
    };
    $('samples').addEventListener('click', chooseSample);
    $('samples').addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); chooseSample(ev); } });
    $('combine-runs').addEventListener('click', () => { state.runMode = 'mean'; render(); });
    $('pr-clear').addEventListener('click', () => {
      state.matrix = null; $('pr-status').hidden = true; $('pr-error').hidden = true;
      if (state.filter === 'detected') state.filter = 'all';
      render();
    });

    $('scale-log').addEventListener('click', () => { state.scale = 'log'; renderAbundance(); save(); });
    $('scale-lin').addEventListener('click', () => { state.scale = 'lin'; renderAbundance(); save(); });
    $('sort-pos').addEventListener('click', () => { state.sort = 'pos'; renderAbundance(); });
    $('sort-int').addEventListener('click', () => { state.sort = 'int'; renderAbundance(); });
    document.querySelectorAll('[data-filter]').forEach((b) => b.addEventListener('click', () => { state.filter = b.dataset.filter; renderTable(); }));
    $('table').addEventListener('click', (ev) => {
      const th = ev.target.closest('th');
      if (!th) return;
      const k = th.dataset.k;
      state.tableSort = { key: k, dir: state.tableSort.key === k ? -state.tableSort.dir : (k === 'intensity' || k === 'rel' ? -1 : 1) };
      renderTable();
    });
    $('copy-tsv').addEventListener('click', async (ev) => {
      const btn = ev.currentTarget;
      try { await navigator.clipboard.writeText(tableAsDelimited('\t')); btn.textContent = 'Copied'; }
      catch (e) { btn.textContent = 'Copy blocked'; }
      setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
    });
    $('dl-csv').addEventListener('click', () => {
      const blob = new Blob([tableAsDelimited(',')], { type: 'text/csv' });
      const a = document.createElement('a');
      const id = state.result ? state.result.entry.id : 'protein';
      a.href = URL.createObjectURL(blob);
      a.download = id.replace(/[^\w.-]+/g, '_') + '_peptides.csv';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });

    bindHover($('map'), '.pep');
    bindHover($('abundance'), '[data-i]');
    bindHover($('table'), 'tr[data-i]');
    $('abundance').addEventListener('mouseover', (ev) => {
      const t = ev.target.closest('[data-i]');
      $('abundance').querySelectorAll('.ab-row-hover').forEach((e) => e.classList.remove('ab-row-hover'));
      if (t) $('abundance').querySelectorAll('[data-i="' + t.dataset.i + '"]').forEach((e) => e.classList.add('ab-row-hover'));
    });
    $('seqmap').addEventListener('mouseover', (ev) => {
      const t = ev.target.closest('.aa');
      if (!t || !state.result) return;
      const i = Number(t.dataset.r);
      const covering = state.result.all.filter((p) => p.start - 1 <= i && p.end - 1 >= i && (p.inWindow || p.detected));
      t.title = state.result.protein[i] + (i + 1) + (covering.length ? ' · in ' + covering.map((p) => p.seq).join(', ') : ' · not in any detectable peptide');
    });

    let resizeTimer;
    window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(renderMap, 120); });
    const rerenderTheme = () => { readRamp(); render(); };
    if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', rerenderTheme);
    new MutationObserver(rerenderTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    setFasta(saved && saved.fasta && saved.fasta.trim() ? saved.fasta : window.DEMO.fasta);
  }

  init();
})();
