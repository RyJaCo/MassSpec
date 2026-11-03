# MassSpec teaching tools

Two self-contained browser tools (no build step, no dependencies, nothing uploaded):

- **[Peptide Detectability Explorer](index.html)**: in-silico digestion and DIA-NN `pr_matrix` overlay (below).
- **[Stats Test Advisor](stats.html)**: which statistical test to use, and why ([details](#stats-test-advisor)).

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
| Detected peptides | Upload a `pr_matrix`, then pick the sample (one column of the matrix) to show. The mean, median or max across runs is offered for files whose runs are replicates. |

**Views**

- **Detection by sample** (files with more than one run): one row per sample with the number of this protein's peptides detected, coverage, total intensity, and a strip of squares, one per peptide, coloured on a shared log scale. Click a row to show that sample in every other view. When the matrix has a row of sample names above the header, each column is treated as a different sample. The tool then opens on the sample whose name matches the protein (e.g. a FASTA header containing "Phytoglobin" opens the Phytoglobin sample), or failing that the sample where most of its peptides were seen. Without sample names, runs are treated as replicates and averaged.

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

Other wide peptide tables also work if they have a sequence column (`Sequence`, `PEP.StrippedSequence`, `EG.StrippedSequence`, …) and one intensity column per sample. For MaxQuant `peptides.txt`, the `Intensity <sample>` (or `LFQ intensity <sample>`) columns are picked automatically. **CSV is supported** as well as TSV. The separator (tab, comma or semicolon) is detected from the header row, so a `pr_matrix` opened and re-saved from Excel works. This includes:

- quoted cells, such as protein descriptions containing commas
- thousands separators (`1,234,567`)
- European-locale files that use `;` with decimal commas (`1234,5`) and a leading `sep=;` line
- Excel error cells (`#N/A`), which count as missing
- extra rows above the header. A row of sample names typed above the run columns is used to label the runs, e.g. `NutriGFP (milla043506)`
- column names in any case or punctuation (`stripped_sequence` matches `Stripped.Sequence`)

Large files are streamed.

## Simplifications

- Enzyme rules are the usual textbook rules. Pepsin and thermolysin specificity is approximate.
- The detection window is length only. Real detectability also depends on m/z range, hydrophobicity, charge and uniqueness, and that is the point the uploaded data makes.
- Masses are monoisotopic, with optional fixed carbamidomethylation. Peptides containing B, Z or X have no mass.

# Stats Test Advisor

`stats.html` helps you choose a statistical test, and explains the choice.

**Choose a test.** A question guide with drop-down menus. Questions appear only when they apply to your earlier answers:

- what you want to find out (compare groups, compare to a fixed value, relationship, association, agreement, survival)
- the kind of measurement (continuous, intensity/abundance, ratio or fold change, proportion, count, ordinal, yes/no)
- how ratios were made (each divided by its own control, by the control mean, or measured in each sample)
- number of factors and groups, independent vs paired / repeated measures / mixed
- technical vs biological replicates, one outcome vs many (omics), covariates, sample size
- normality, whether a transformation helps, equal spread
- which comparisons matter (all pairs, against a control, planned, a trend, or only the overall test)

The result gives the recommended test, the transformation to apply first, the post hoc test, a numbered list of reasons,
warnings (pseudoreplication, n too small for rank tests, ratios fixed at 1, multiple testing), assumptions to check,
alternatives, the effect size to report, R and Python code, and a reporting sentence. A quick-reference table and a list of
common mistakes sit below.

**Analyse my data.** Open a CSV / TSV file (or one of the two simulated examples) and pick columns:

| Analysis | Columns |
|---|---|
| Compare groups | one or more value columns, a group column, optional subject ID (same ID in several groups makes the design paired; repeated within a group means technical replicates, which are averaged), optional second factor, optional control group |
| Compare columns | wide format, one column per group; tick “each row is the same subject” for paired data |
| One column vs a reference | e.g. fold change against 1 |
| Relationship | X and Y columns |
| Association | two categorical columns, optional subject ID |

For each value column the analyser:

1. guesses the measurement type from the column name and values (you can override it);
2. tries the transformations that suit that type (none, log₂, log₂(x+1), √x, 1/x, logit, Box-Cox), checking the residuals with Shapiro-Wilk, the spreads with Brown-Forsythe, the skewness and the SD ratio. The scale the data type calls for (log for intensities and ratios) is kept unless the data clearly contradict it, because picking whichever transform gives the best p-value is a form of data dredging. Click a row to use a different scale;
3. fills in the question guide's answers from the data and runs the same decision rules;
4. runs the recommended test and post hoc test, plus the parametric / rank-based counterpart as a sensitivity check, and shows a strip plot, a normal Q–Q plot of the residuals, and descriptive statistics (with geometric means on the log scale);
5. with several value columns, lists one test per column with Benjamini-Hochberg q-values.

Tests implemented in the browser (`js/statlib.js`): Shapiro-Wilk, Brown-Forsythe, Student / Welch / paired / one-sample t,
Mann-Whitney U (exact when there are no ties), Wilcoxon signed-rank, one-way and Welch ANOVA, Kruskal-Wallis, repeated-measures
ANOVA with Greenhouse-Geisser, Friedman, two-way ANOVA (Type III), Pearson, Spearman, chi-square, Fisher's exact,
and the post hoc tests Tukey-Kramer, Games-Howell, Dunnett, Dunn, Holm-adjusted pairwise tests, simple effects, linear trend,
Jonckheere-Terpstra and Page. Results are tested against SciPy, statsmodels and pingouin (`tests/statlib.test.js`).
Where the best method needs a model the page does not fit (limma, negative binomial or logistic regression, mixed models,
ANCOVA), the page says so, shows the R / Python code, and runs the closest test it can.

To publish it as a single-file Claude artifact, run `npm run artifact`; it writes `dist/stats-advisor.html` with the CSS and scripts inlined.

The example tables (`examples/stats_demo_*.csv`) are **simulated**; regenerate them with `npm run stats-demo`.

## Development

```
npm test        # node --test, no dependencies
npm run demo    # regenerate the simulated GFP matrix and js/demo.js
npm run stats-demo  # regenerate the simulated stats example tables and js/stats-demo.js
```

```
index.html          page
css/style.css       styles (light and dark)
js/digest.js        enzymes, digestion, masses, FASTA parsing (also runs in Node)
js/prmatrix.js      pr_matrix / peptide table reader (also runs in Node)
js/app.js           UI and rendering
js/demo.js          generated demo data
stats.html          Stats Test Advisor page
css/stats.css       its extra styles
js/statlib.js       distributions, tests, post hoc tests, transformations (also runs in Node)
js/advisor.js       question tree and decision rules (also runs in Node)
js/analyse.js       table reader, transformation choice, runs the tests (also runs in Node)
js/stats-app.js     Stats Test Advisor UI and charts
js/stats-demo.js    generated example tables
tools/make-demo.js  demo generator
tools/make-stats-demo.js  stats example generator
tools/build-stats-artifact.js  bundles the Stats Test Advisor into one file for a Claude artifact
tests/              unit tests
```
