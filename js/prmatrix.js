/*
 * Reader for peptide/precursor quantity matrices, primarily DIA-NN's report.pr_matrix.tsv.
 * Also copes with other wide tables that have a peptide sequence column plus one
 * numeric intensity column per run (e.g. MaxQuant peptides.txt, Spectronaut exports).
 *
 * Precursors (charge states, modified forms) are summed per stripped sequence and run.
 */
(function (root) {
  'use strict';

  const SEQUENCE_COLUMNS = [
    'Stripped.Sequence', 'PEP.StrippedSequence', 'EG.StrippedSequence', 'Sequence',
    'Peptide.Sequence', 'PeptideSequence', 'Peptide', 'Modified.Sequence', 'Precursor.Id',
  ];
  const PROTEIN_COLUMNS = ['Protein.Group', 'Protein.Ids', 'Proteins', 'Leading razor protein', 'PG.ProteinGroups'];

  // Numeric columns that are annotations, not per-run quantities.
  const NOT_A_RUN = /^(precursor\.charge|charge|proteotypic|precursor\.lib\.index|.*\bindex|length|mass|missed cleavages|start position|end position|score|pep|q\.?value|.*\bq\.?value|id|unique.*|count.*|.*\bcount|retention.*|rt|msms.*|ms\/ms.*|.*\bids?)$/i;
  const MISSING = /^(|na|nan|n\/a|null|none|filtered|-)$/i;
  const SNIFF_ROWS = 500;

  /** "_(UniMod:1)AC(UniMod:4)DEK2" or "PEP[+16.0]TIDE" -> "ACDEK" / "PEPTIDE". */
  function stripSequence(s) {
    return String(s)
      .replace(/\([^)]*\)/g, '')
      .replace(/\[[^\]]*\]/g, '')
      .replace(/[^A-Za-z]/g, '')
      .toUpperCase();
  }

  function splitLine(line, delim) {
    if (delim === '\t' || line.indexOf('"') === -1) return line.split(delim);
    // Minimal quoted-CSV support.
    const out = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) {
        if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (c === '"') q = false;
        else cur += c;
      } else if (c === '"') q = true;
      else if (c === delim) { out.push(cur); cur = ''; }
      else cur += c;
    }
    out.push(cur);
    return out;
  }

  function shortRunName(col) {
    const base = col.split(/[\\/]/).pop();
    return base.replace(/\.(raw|d|wiff2?|mzml|dia|htrms)$/i, '') || col;
  }

  /**
   * Incremental parser. Feed it lines with push(line), then call finish().
   * Result: { runs: [{ column, name }], peptides: Map<seq, { values: Float64Array, precursors, proteins }>,
   *           sequenceColumn, rows, skipped }
   */
  function createParser() {
    let header = null;
    let delim = '\t';
    let seqIdx = -1;
    let protIdx = -1;
    let runIdx = [];
    let runs = [];
    let buffer = [];
    let rows = 0;
    let skipped = 0;
    let sequenceColumn = null;
    const peptides = new Map();

    function setupHeader(line) {
      delim = line.includes('\t') ? '\t' : line.includes(',') ? ',' : ';';
      header = splitLine(line, delim).map((h) => h.trim().replace(/^"|"$/g, ''));
      for (const name of SEQUENCE_COLUMNS) {
        const i = header.indexOf(name);
        if (i >= 0) { seqIdx = i; sequenceColumn = name; break; }
      }
      if (seqIdx < 0) {
        throw new Error('No peptide sequence column found. Expected one of: ' +
          SEQUENCE_COLUMNS.join(', ') + '.');
      }
      for (const name of PROTEIN_COLUMNS) {
        const i = header.indexOf(name);
        if (i >= 0) { protIdx = i; break; }
      }
    }

    // Decide which columns hold per-run quantities by looking at the first rows.
    function chooseRunColumns() {
      const sample = buffer.map((l) => splitLine(l, delim));
      const isNumericCol = (i) => {
        let seen = 0;
        for (const cells of sample) {
          const v = (cells[i] || '').trim();
          if (MISSING.test(v)) continue;
          if (!isFinite(Number(v))) return false;
          seen++;
        }
        return seen > 0;
      };
      const intensityLike = header
        .map((h, i) => [h, i])
        .filter(([h]) => /^(lfq )?intensity [^ ]/i.test(h));
      let candidates;
      if (intensityLike.length) {
        // MaxQuant style: prefer "Intensity <sample>" over everything else.
        const lfq = intensityLike.filter(([h]) => /^lfq/i.test(h));
        candidates = (lfq.length ? lfq : intensityLike).map(([, i]) => i);
      } else {
        candidates = header
          .map((h, i) => i)
          .filter((i) => i !== seqIdx && !NOT_A_RUN.test(header[i]) && isNumericCol(i));
      }
      runIdx = candidates;
      runs = runIdx.map((i) => ({ column: header[i], name: shortRunName(header[i]) }));
      if (!runs.length) {
        throw new Error('Found the sequence column "' + sequenceColumn +
          '" but no numeric intensity columns (one per run).');
      }
    }

    function consume(line) {
      const cells = splitLine(line, delim);
      const seq = stripSequence(cells[seqIdx] || '');
      if (!seq) { skipped++; return; }
      rows++;
      let entry = peptides.get(seq);
      if (!entry) {
        entry = { values: new Float64Array(runIdx.length).fill(NaN), precursors: 0,
          proteins: protIdx >= 0 ? (cells[protIdx] || '').trim() : '' };
        peptides.set(seq, entry);
      }
      entry.precursors++;
      for (let r = 0; r < runIdx.length; r++) {
        const raw = (cells[runIdx[r]] || '').trim();
        if (MISSING.test(raw)) continue;
        const v = Number(raw);
        if (!isFinite(v) || v <= 0) continue;
        entry.values[r] = isNaN(entry.values[r]) ? v : entry.values[r] + v;
      }
    }

    return {
      push(line) {
        if (line.endsWith('\r')) line = line.slice(0, -1);
        if (header === null) {
          if (!line.trim()) return;
          setupHeader(line.replace(/^﻿/, ''));
          return;
        }
        if (!line.trim()) return;
        if (buffer) {
          buffer.push(line);
          if (buffer.length >= SNIFF_ROWS) { chooseRunColumns(); buffer.forEach(consume); buffer = null; }
          return;
        }
        consume(line);
      },
      finish() {
        if (header === null) throw new Error('The file is empty.');
        if (buffer) { chooseRunColumns(); buffer.forEach(consume); buffer = null; }
        return { runs, peptides, sequenceColumn, rows, skipped };
      },
    };
  }

  function parseText(text) {
    const p = createParser();
    for (const line of text.split('\n')) p.push(line);
    return p.finish();
  }

  /** Stream a browser File through the parser so very large matrices don't need one giant string. */
  async function parseFile(file, onProgress) {
    if (!file.stream || typeof TextDecoderStream === 'undefined') return parseText(await file.text());
    const p = createParser();
    const reader = file.stream().pipeThrough(new TextDecoderStream()).getReader();
    let rest = '';
    let read = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      read += value.length;
      const chunk = rest + value;
      const lines = chunk.split('\n');
      rest = lines.pop();
      for (const line of lines) p.push(line);
      if (onProgress) onProgress(Math.min(1, read / file.size));
    }
    if (rest) p.push(rest);
    return p.finish();
  }

  /**
   * Collapse per-run values to one number per peptide.
   * mode: 'mean' | 'median' | 'max' | run index (number). Missing runs are ignored, so a
   * peptide seen in 1 of 6 runs reports that one value; `nDetected` says how many runs saw it.
   */
  function summarise(values, mode) {
    const present = [];
    for (const v of values) if (!isNaN(v)) present.push(v);
    const nDetected = present.length;
    if (typeof mode === 'number') return { value: values[mode], nDetected };
    if (!present.length) return { value: NaN, nDetected };
    if (mode === 'max') return { value: Math.max(...present), nDetected };
    if (mode === 'median') {
      present.sort((a, b) => a - b);
      const m = present.length >> 1;
      return { value: present.length % 2 ? present[m] : (present[m - 1] + present[m]) / 2, nDetected };
    }
    return { value: present.reduce((a, b) => a + b, 0) / present.length, nDetected };
  }

  const api = { createParser, parseText, parseFile, summarise, stripSequence, shortRunName };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PrMatrix = api;
})(typeof self !== 'undefined' ? self : this);
