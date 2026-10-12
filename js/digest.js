/*
 * In-silico digestion, peptide masses and FASTA parsing.
 * Plain script: exposes `Digest` on window in the browser and module.exports in Node.
 */
(function (root) {
  'use strict';

  // Each rule answers: does the enzyme cut between seq[i] and seq[i + 1]?
  // `after` = residues cut C-terminal to, `before` = residues cut N-terminal to,
  // `notBefore` = the cut is blocked when the next residue is one of these (the proline rule).
  const ENZYMES = [
    { id: 'trypsin', name: 'Trypsin', after: 'KR', notBefore: 'P',
      rule: 'C-term to K/R, not before P' },
    { id: 'trypsinp', name: 'Trypsin/P', after: 'KR',
      rule: 'C-term to K/R, ignores the proline rule' },
    { id: 'lysc', name: 'Lys-C', after: 'K',
      rule: 'C-term to K' },
    { id: 'lysn', name: 'Lys-N', before: 'K',
      rule: 'N-term to K' },
    { id: 'argc', name: 'Arg-C', after: 'R', notBefore: 'P',
      rule: 'C-term to R, not before P' },
    { id: 'aspn', name: 'Asp-N', before: 'D',
      rule: 'N-term to D' },
    { id: 'gluc', name: 'Glu-C (bicarbonate)', after: 'E',
      rule: 'C-term to E' },
    { id: 'glucp', name: 'Glu-C (phosphate)', after: 'DE',
      rule: 'C-term to D/E' },
    { id: 'chymo', name: 'Chymotrypsin (high)', after: 'FYW', notBefore: 'P',
      rule: 'C-term to F/Y/W, not before P' },
    { id: 'chymolow', name: 'Chymotrypsin (low)', after: 'FYWLM', notBefore: 'P',
      rule: 'C-term to F/Y/W/L/M, not before P' },
    { id: 'pepsin', name: 'Pepsin (pH 1.3)', after: 'FL',
      rule: 'C-term to F/L (simplified)' },
    { id: 'thermolysin', name: 'Thermolysin', before: 'AFILMV',
      rule: 'N-term to A/F/I/L/M/V (simplified)' },
    { id: 'cnbr', name: 'CNBr', after: 'M',
      rule: 'C-term to M (chemical)' },
  ];

  const ENZYME_BY_ID = Object.fromEntries(ENZYMES.map((e) => [e.id, e]));

  // Monoisotopic residue masses (Da).
  const RESIDUE_MASS = {
    G: 57.02146, A: 71.03711, S: 87.03203, P: 97.05276, V: 99.06841,
    T: 101.04768, C: 103.00919, L: 113.08406, I: 113.08406, N: 114.04293,
    D: 115.02694, Q: 128.05858, K: 128.09496, E: 129.04259, M: 131.04049,
    H: 137.05891, F: 147.06841, R: 156.10111, Y: 163.06333, W: 186.07931,
    U: 150.95364, O: 237.14773,
  };
  const WATER = 18.010565;
  const PROTON = 1.007276;
  const CARBAMIDOMETHYL = 57.021464;

  function cutsAt(enzyme, seq, i) {
    const here = seq[i];
    const next = seq[i + 1];
    if (next === undefined) return false;
    if (enzyme.after && enzyme.after.includes(here)) {
      return !(enzyme.notBefore && enzyme.notBefore.includes(next));
    }
    if (enzyme.before && enzyme.before.includes(next)) return true;
    return false;
  }

  /**
   * Cleavage positions for the union of the given enzymes.
   * Returns sorted boundaries including 0 and seq.length; a boundary b means a cut
   * between residue b-1 and residue b (0-based).
   */
  function cleavageSites(seq, enzymeIds) {
    const enzymes = enzymeIds.map((id) => ENZYME_BY_ID[id]).filter(Boolean);
    const sites = [0];
    for (let i = 0; i < seq.length - 1; i++) {
      if (enzymes.some((e) => cutsAt(e, seq, i))) sites.push(i + 1);
    }
    sites.push(seq.length);
    return sites;
  }

  function peptideMass(seq, opts) {
    const fixedCys = opts && opts.carbamidomethyl;
    let m = WATER;
    for (const aa of seq) {
      const r = RESIDUE_MASS[aa];
      if (r === undefined) return NaN; // B, Z, X: ambiguous residue
      m += r;
      if (aa === 'C' && fixedCys) m += CARBAMIDOMETHYL;
    }
    return m;
  }

  function mz(mass, z) {
    return (mass + z * PROTON) / z;
  }

  /**
   * Digest a protein. Options:
   *   enzymes: array of enzyme ids
   *   missed: max missed cleavages
   *   minLen, maxLen: detection window
   *   metLoss: also emit N-terminal peptides with the initiator Met removed
   *   carbamidomethyl: fixed +57 on Cys
   * Each peptide: { seq, start, end (1-based, inclusive), length, missed, mass, inWindow, status, nTermMetLoss }
   */
  function digest(protein, opts) {
    const o = Object.assign({ enzymes: ['trypsin'], missed: 0, minLen: 6, maxLen: 30,
      metLoss: false, carbamidomethyl: true }, opts);
    const sites = cleavageSites(protein, o.enzymes);
    const out = [];
    const seen = new Set();
    const add = (s, e, missed, metLoss) => {
      const key = s + ':' + e;
      if (e <= s || seen.has(key)) return;
      seen.add(key);
      const seq = protein.slice(s, e);
      const length = seq.length;
      const status = length < o.minLen ? 'short' : length > o.maxLen ? 'long' : 'window';
      out.push({
        seq, start: s + 1, end: e, length, missed,
        mass: peptideMass(seq, o), inWindow: status === 'window', status,
        nTermMetLoss: !!metLoss,
      });
    };
    for (let a = 0; a < sites.length - 1; a++) {
      for (let k = 0; k <= o.missed && a + k + 1 < sites.length; k++) {
        add(sites[a], sites[a + k + 1], k, false);
        if (o.metLoss && a === 0 && protein[0] === 'M') {
          add(1, sites[a + k + 1], k, true);
        }
      }
    }
    out.sort((p, q) => p.start - q.start || p.end - q.end);
    return { peptides: out, sites };
  }

  /** Parse FASTA (or a bare sequence) into [{ id, header, seq }]. */
  function parseFasta(text) {
    const entries = [];
    let cur = null;
    for (const raw of String(text).split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      if (line.startsWith('>')) {
        cur = { header: line.slice(1).trim(), seq: '' };
        entries.push(cur);
      } else if (!line.startsWith(';')) {
        if (!cur) { cur = { header: 'Pasted sequence', seq: '' }; entries.push(cur); }
        cur.seq += line;
      }
    }
    return entries
      .map((e) => {
        const seq = e.seq.toUpperCase().replace(/[^A-Z]/g, '');
        return { header: e.header, id: fastaId(e.header), seq,
          invalid: [...new Set(seq.replace(/[ACDEFGHIKLMNPQRSTVWYUO]/g, ''))] };
      })
      .filter((e) => e.seq.length > 0);
  }

  // ">sp|P42212|GFP_AEQVI Green..." -> "P42212"; otherwise first word.
  function fastaId(header) {
    const first = header.split(/\s+/)[0] || header;
    const parts = first.split('|');
    return parts.length >= 2 && /^(sp|tr|ref|gb|emb|dbj)$/.test(parts[0]) ? parts[1] : first;
  }

  const api = { ENZYMES, ENZYME_BY_ID, RESIDUE_MASS, WATER, PROTON,
    cleavageSites, digest, peptideMass, mz, parseFasta, fastaId };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Digest = api;
})(typeof self !== 'undefined' ? self : this);
