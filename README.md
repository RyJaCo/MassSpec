# Peptide Detectability Explorer

A small, self-contained web tool for teaching bottom-up proteomics. It takes a protein sequence and

1. **digests it in silico** with one or more enzymes (trypsin by default),
2. marks which peptides fall inside an adjustable **detection window** (peptide length, default 6–30 residues),
3. and, once you upload a DIA-NN **`pr_matrix`**, shows which of those peptides were **actually detected and how intense each one was**.

The aim is to show students that peptides cut from one protein are present in equal molar amounts, yet their measured intensities still span orders of magnitude, and some are never seen at all.

Everything runs in the browser. Uploaded files are never sent anywhere.

## Running it

No build step and no dependencies. Either

- open `index.html` directly in a browser, or
- serve the folder (`python3 -m http.server`, then open http://localhost:8000), or
- publish it with GitHub Pages (Settings → Pages → deploy from branch, root folder).

## Using it

| Control | What it does |
|---|---|
| Protein sequence | Paste FASTA or a plain sequence, or open a `.fasta` file. Multi-entry FASTA files get an entry picker. |
| Enzyme | Trypsin, Trypsin/P, Lys-C, Lys-N, Arg-C, Asp-N, Glu-C (bicarbonate / phosphate), Chymotrypsin (high / low), Pepsin, Thermolysin, CNBr. Select several for a combined digest. Hover a chip for its rule. |
| Missed cleavages | 0–3. |
| Detectable length | Two-thumb slider (or type values) for the min/max peptide length. |
| Options | Fixed carbamidomethyl Cys, initiator-Met removal, and I/L equivalence when matching detected peptides. |
| Detected peptides | Upload a `pr_matrix`. Choose the mean, median or max across runs, or a single run. |

**Views**

- **Peptide map**: every peptide drawn along the protein, with cleavage sites. Peptides outside the window are grey; in-window peptides are blue, or, once a matrix is loaded, coloured by log intensity (outlined if not detected). Detected peptides that the current settings would *not* produce (extra missed cleavages, semi-specific ends) appear in a separate track.
- **Sequence coverage**: the sequence coloured residue by residue, with cut sites in orange.
- **Peptide abundance**: measured intensity per peptide on a log scale (dot plot with median line) or a linear scale (% of the most intense peptide). The linear view makes the point most forcefully.
- **Peptides table**: positions, length, missed cleavages, monoisotopic mass, m/z for 2+ and 3+, window status, intensity, relative intensity and number of runs. Sortable; copy or download as CSV.

The **GFP example** and **Load simulated GFP matrix** buttons load a demo. The demo matrix (`examples/demo_pr_matrix.tsv`) is **simulated**; regenerate it with `npm run demo`.

## Input file format

Built for DIA-NN's `report.pr_matrix.tsv`:

```
Protein.Group  Protein.Ids  ...  Stripped.Sequence  Modified.Sequence  Precursor.Charge  Precursor.Id  /path/run1.raw  /path/run2.raw ...
```

- The peptide sequence comes from `Stripped.Sequence` (falling back to `Modified.Sequence` / `Precursor.Id` with modifications stripped).
- Every numeric column that isn't an annotation (charge, proteotypic, index, …) is treated as one run. Empty cells mean "not detected".
- Charge states and modified forms of the same sequence are **summed** per run.
- Detected peptides are matched to the protein by sequence, so the file can contain the whole proteome. Only peptides found in the selected protein are used.

Other wide peptide tables also work if they have a sequence column (`Sequence`, `PEP.StrippedSequence`, `EG.StrippedSequence`, …) and one intensity column per sample. For MaxQuant `peptides.txt`, the `Intensity <sample>` (or `LFQ intensity <sample>`) columns are picked automatically. Tab-, comma- and semicolon-separated files are accepted, and large files are streamed.

## Simplifications

- Enzyme rules are the usual textbook rules. Pepsin and thermolysin specificity is approximate.
- The detection window is length only. Real detectability also depends on m/z range, hydrophobicity, charge and uniqueness, and that is the point the uploaded data makes.
- Masses are monoisotopic, with optional fixed carbamidomethylation. Peptides containing B, Z or X have no mass.

## Development

```
npm test        # node --test, no dependencies
npm run demo    # regenerate the simulated GFP matrix and js/demo.js
```

```
index.html          page
css/style.css       styles (light and dark)
js/digest.js        enzymes, digestion, masses, FASTA parsing (also runs in Node)
js/prmatrix.js      pr_matrix / peptide table reader (also runs in Node)
js/app.js           UI and rendering
js/demo.js          generated demo data
tools/make-demo.js  demo generator
tests/              unit tests
```
