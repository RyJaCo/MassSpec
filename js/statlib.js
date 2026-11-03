/*
 * Small statistics library for the Stats Test Advisor. No dependencies; runs in the browser and in Node.
 *
 * Distributions: normal, t, F, chi-square, studentized range (Tukey), Dunnett (many-to-one).
 * Tests: Shapiro-Wilk (Royston 1995), Brown-Forsythe/Levene, t-tests (Student, Welch, paired, one-sample),
 * Mann-Whitney U, Wilcoxon signed-rank, one-way / Welch ANOVA, Kruskal-Wallis, Friedman,
 * repeated-measures ANOVA (Greenhouse-Geisser), two-way ANOVA (Type III, unbalanced OK),
 * Pearson / Spearman, chi-square, Fisher's exact (2x2).
 * Post hoc: Tukey-Kramer, Games-Howell, Dunnett, Dunn, pairwise t / Wilcoxon with p-adjustment.
 * Multiple testing: Bonferroni, Holm, Benjamini-Hochberg.
 *
 * Numerics follow the standard references (R's nmath for ptukey, AS R94 for Shapiro-Wilk) and are
 * checked against SciPy in tests/statlib.test.js.
 */
(function (root) {
  'use strict';

  // ---------------------------------------------------------------- basic helpers
  const sum = (a) => { let s = 0; for (const v of a) s += v; return s; };
  const mean = (a) => sum(a) / a.length;
  function variance(a, m) {
    if (a.length < 2) return NaN;
    if (m === undefined) m = mean(a);
    let s = 0; for (const v of a) s += (v - m) * (v - m);
    return s / (a.length - 1);
  }
  const sd = (a) => Math.sqrt(variance(a));
  const sorted = (a) => Float64Array.from(a).sort();
  function quantile(a, p) { // type 7 (R / Excel default)
    const s = sorted(a); const n = s.length;
    if (!n) return NaN;
    const h = (n - 1) * p; const lo = Math.floor(h); const hi = Math.min(lo + 1, n - 1);
    return s[lo] + (h - lo) * (s[hi] - s[lo]);
  }
  const median = (a) => quantile(a, 0.5);
  function skewness(a) { // adjusted Fisher-Pearson (G1), as Excel SKEW
    const n = a.length; if (n < 3) return NaN;
    const m = mean(a); let m2 = 0, m3 = 0;
    for (const v of a) { const d = v - m; m2 += d * d; m3 += d * d * d; }
    m2 /= n; m3 /= n;
    if (m2 === 0) return 0;
    return (m3 / Math.pow(m2, 1.5)) * Math.sqrt(n * (n - 1)) / (n - 2);
  }
  function kurtosis(a) { // excess kurtosis (G2), as Excel KURT
    const n = a.length; if (n < 4) return NaN;
    const m = mean(a); let m2 = 0, m4 = 0;
    for (const v of a) { const d = v - m; m2 += d * d; m4 += d * d * d * d; }
    m2 /= n; m4 /= n;
    if (m2 === 0) return 0;
    const g2 = m4 / (m2 * m2) - 3;
    return ((n - 1) / ((n - 2) * (n - 3))) * ((n + 1) * g2 + 6);
  }
  function describe(a) {
    const n = a.length;
    return {
      n, mean: n ? mean(a) : NaN, sd: sd(a), median: median(a),
      q1: quantile(a, 0.25), q3: quantile(a, 0.75),
      min: n ? Math.min(...a) : NaN, max: n ? Math.max(...a) : NaN,
      se: sd(a) / Math.sqrt(n), skew: skewness(a), kurt: kurtosis(a),
    };
  }

  /** Average ranks (1-based) with ties; returns { ranks, tieTerm = sum(t^3 - t) }. */
  function rank(a) {
    const n = a.length;
    const idx = Array.from({ length: n }, (_, i) => i).sort((i, j) => a[i] - a[j]);
    const r = new Float64Array(n); let tie = 0;
    for (let i = 0; i < n;) {
      let j = i; while (j + 1 < n && a[idx[j + 1]] === a[idx[i]]) j++;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) r[idx[k]] = avg;
      const t = j - i + 1; if (t > 1) tie += t * t * t - t;
      i = j + 1;
    }
    return { ranks: r, tieTerm: tie };
  }

  // ---------------------------------------------------------------- special functions
  const LANCZOS = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  function lnGamma(x) {
    if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lnGamma(1 - x);
    x -= 1; let a = LANCZOS[0]; const t = x + 7.5;
    for (let i = 1; i < 9; i++) a += LANCZOS[i] / (x + i);
    return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
  }
  function betacf(a, b, x) {
    const FPMIN = 1e-300; let qab = a + b, qap = a + 1, qam = a - 1, c = 1, d = 1 - qab * x / qap;
    if (Math.abs(d) < FPMIN) d = FPMIN; d = 1 / d; let h = d;
    for (let m = 1; m <= 3000; m++) {
      const m2 = 2 * m;
      let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
      d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN; c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d; h *= d * c;
      aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
      d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN; c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d; const del = d * c; h *= del;
      if (Math.abs(del - 1) < 1e-15) break;
    }
    return h;
  }
  /** Regularized incomplete beta I_x(a, b). */
  function ibeta(x, a, b) {
    if (x <= 0) return 0; if (x >= 1) return 1;
    const bt = Math.exp(lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
    if (x < (a + 1) / (a + b + 2)) return bt * betacf(a, b, x) / a;
    return 1 - bt * betacf(b, a, 1 - x) / b;
  }
  /** Regularized upper incomplete gamma Q(a, x). */
  function gammaQ(a, x) {
    if (x <= 0) return 1;
    if (x < a + 1) { // series for P
      let ap = a, s = 1 / a, del = s;
      for (let n = 0; n < 5000; n++) { ap++; del *= x / ap; s += del; if (Math.abs(del) < Math.abs(s) * 1e-16) break; }
      return 1 - s * Math.exp(-x + a * Math.log(x) - lnGamma(a));
    }
    const FPMIN = 1e-300; let b = x + 1 - a, c = 1 / FPMIN, d = 1 / b, h = d;
    for (let i = 1; i < 5000; i++) {
      const an = -i * (i - a); b += 2;
      d = an * d + b; if (Math.abs(d) < FPMIN) d = FPMIN;
      c = b + an / c; if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d; const del = d * c; h *= del;
      if (Math.abs(del - 1) < 1e-16) break;
    }
    return Math.exp(-x + a * Math.log(x) - lnGamma(a)) * h;
  }

  // ---------------------------------------------------------------- distributions
  /** Upper tail of the standard normal, accurate far into the tail (Hart 1968 / West 2005). */
  function normSf(x) {
    const z = Math.abs(x); let c;
    if (z > 37) c = 0;
    else {
      const e = Math.exp(-z * z / 2);
      if (z < 7.07106781186547) {
        let n = 3.52624965998911e-02 * z + 0.700383064443688; n = n * z + 6.37396220353165; n = n * z + 33.912866078383;
        n = n * z + 112.079291497871; n = n * z + 221.213596169931; n = n * z + 220.206867912376;
        let d = 8.83883476483184e-02 * z + 1.75566716318264; d = d * z + 16.064177579207; d = d * z + 86.7807322029461;
        d = d * z + 296.564248779674; d = d * z + 637.333633378831; d = d * z + 793.826512519948; d = d * z + 440.413735824752;
        c = e * n / d;
      } else {
        let b = z + 0.65; b = z + 4 / b; b = z + 3 / b; b = z + 2 / b; b = z + 1 / b;
        c = e / b / 2.506628274631;
      }
    }
    return x > 0 ? c : 1 - c;
  }
  const normCdf = (x) => normSf(-x);
  const normPdf = (x) => Math.exp(-x * x / 2) / 2.5066282746310002;
  /** Inverse normal CDF (Acklam) with one Halley refinement. */
  function normInv(p) {
    if (p <= 0) return -Infinity; if (p >= 1) return Infinity;
    const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
    const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
    const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
    const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
    let x;
    if (p < 0.02425) {
      const q = Math.sqrt(-2 * Math.log(p));
      x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    } else if (p <= 1 - 0.02425) {
      const q = p - 0.5, r = q * q;
      x = (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
    } else {
      const q = Math.sqrt(-2 * Math.log(1 - p));
      x = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    }
    const e = normCdf(x) - p; const u = e * 2.5066282746310002 * Math.exp(x * x / 2);
    return x - u / (1 + x * u / 2);
  }
  /** Upper tail P(T > t) of Student's t. */
  function tSf(t, df) {
    if (!isFinite(df) || df > 1e7) return normSf(t);
    const x = df / (df + t * t); const tail = 0.5 * ibeta(x, df / 2, 0.5);
    return t > 0 ? tail : 1 - tail;
  }
  const tCdf = (t, df) => tSf(-t, df);
  const tTwoSided = (t, df) => Math.min(1, 2 * tSf(Math.abs(t), df));
  function tInv(p, df) { // quantile, by bisection on the CDF (only used for confidence intervals)
    if (p === 0.5) return 0;
    let lo = -1e3, hi = 1e3;
    for (let i = 0; i < 200; i++) { const m = (lo + hi) / 2; if (tCdf(m, df) < p) lo = m; else hi = m; if (hi - lo < 1e-12) break; }
    return (lo + hi) / 2;
  }
  /** Upper tail of F(d1, d2). */
  function fSf(f, d1, d2) { if (f <= 0) return 1; return ibeta(d2 / (d2 + d1 * f), d2 / 2, d1 / 2); }
  /** Upper tail of chi-square(k). */
  const chi2Sf = (x, k) => gammaQ(k / 2, x / 2);

  // Studentized range, ported from R nmath ptukey.c (Copenhaver & Holland 1988).
  function wprob(w, rr, cc) {
    const nleg = 12, ihalf = 6, C1 = -30, C3 = 60, bb = 8, wlar = 3, wincr1 = 2, wincr2 = 3;
    const xleg = [0.981560634246719250690549090149, 0.904117256370474856678465866119, 0.769902674194304687036893833213,
      0.587317954286617447296702418941, 0.367831498998180193752691536644, 0.125233408511468915472441369464];
    const aleg = [0.047175336386511827194615961485, 0.106939325995318430960254718194, 0.160078328543346226334652529543,
      0.203167426723065921749064455810, 0.233492536538354808760849898925, 0.249147045813402785000562436043];
    const qsqz = w * 0.5;
    if (qsqz >= bb) return 1;
    let prW = 2 * normCdf(qsqz) - 1;
    prW = prW >= 1 ? 1 : Math.pow(prW, cc);
    const wincr = w > wlar ? wincr1 : wincr2;
    let blb = qsqz; const binc = (bb - qsqz) / wincr; let bub = blb + binc; let einsum = 0; const cc1 = cc - 1;
    for (let wi = 1; wi <= wincr; wi++) {
      let elsum = 0; const a = 0.5 * (bub + blb), b = 0.5 * (bub - blb);
      for (let jj = 1; jj <= nleg; jj++) {
        let j, xx;
        if (ihalf < jj) { j = nleg - jj + 1; xx = xleg[j - 1]; } else { j = jj; xx = -xleg[j - 1]; }
        const c = b * xx, ac = a + c, qexpo = ac * ac;
        if (qexpo > C3) break;
        const pplus = 2 * normCdf(ac), pminus = 2 * normCdf(ac - w);
        let rinsum = pplus * 0.5 - pminus * 0.5;
        if (rinsum >= Math.exp(C1 / cc1)) { rinsum = aleg[j - 1] * Math.exp(-0.5 * qexpo) * Math.pow(rinsum, cc1); elsum += rinsum; }
      }
      elsum *= (2 * b) * cc / Math.sqrt(2 * Math.PI);
      einsum += elsum; blb = bub; bub += binc;
    }
    prW += einsum;
    if (prW <= Math.exp(C1 / rr)) return 0;
    prW = Math.pow(prW, rr);
    return prW >= 1 ? 1 : prW;
  }
  /** P(Q <= q) for the studentized range with `k` means and `df` error df. */
  function ptukey(q, k, df) {
    if (q <= 0) return 0;
    const rr = 1, cc = k;
    if (df > 25000) return wprob(q, rr, cc);
    const nlegq = 16, ihalfq = 8, eps1 = -30, eps2 = 1e-14;
    const xlegq = [0.989400934991649932596154173450, 0.944575023073232576077988415535, 0.865631202387831743880467897712,
      0.755404408355003033895101194847, 0.617876244402643748446671764049, 0.458016777657227386342419442984,
      0.281603550779258913230460501460, 0.950125098376374401853193354250e-1];
    const alegq = [0.271524594117540948517805724560e-1, 0.622535239386478928628438369944e-1, 0.951585116824927848099251076022e-1,
      0.124628971255533872052476282192, 0.149595988816576732081501730547, 0.169156519395002538189312079030,
      0.182603415044923588866763667969, 0.189450610455068496285396723208];
    const f2 = df * 0.5;
    let f2lf = f2 * Math.log(df) - df * Math.LN2 - lnGamma(f2);
    const f21 = f2 - 1, ff4 = df * 0.25;
    const ulen = df <= 100 ? 1 : df <= 800 ? 0.5 : df <= 5000 ? 0.25 : 0.125;
    f2lf += Math.log(ulen);
    let ans = 0;
    for (let i = 1; i <= 50; i++) {
      let otsum = 0; const twa1 = (2 * i - 1) * ulen;
      for (let jj = 1; jj <= nlegq; jj++) {
        let j, t1;
        if (ihalfq < jj) { j = jj - ihalfq - 1; t1 = f2lf + f21 * Math.log(twa1 + xlegq[j] * ulen) - (xlegq[j] * ulen + twa1) * ff4; }
        else { j = jj - 1; t1 = f2lf + f21 * Math.log(twa1 - xlegq[j] * ulen) + (xlegq[j] * ulen - twa1) * ff4; }
        if (t1 >= eps1) {
          const qsqz = ihalfq < jj ? q * Math.sqrt((xlegq[j] * ulen + twa1) * 0.5) : q * Math.sqrt((-(xlegq[j] * ulen) + twa1) * 0.5);
          otsum += wprob(qsqz, rr, cc) * alegq[j] * Math.exp(t1);
        }
      }
      if (i * ulen >= 1 && otsum <= eps2) break;
      ans += otsum;
    }
    return Math.min(1, ans);
  }
  const tukeySf = (q, k, df) => Math.max(0, 1 - ptukey(q, k, df));

  /**
   * Two-sided Dunnett adjusted p: P(max_i |T_i| >= c) for k comparisons with a shared control,
   * correlation rho_ij = lambda_i * lambda_j, lambda_i = sqrt(n_i / (n_i + n_0)), and df error df.
   * Integrates over the shared normal (z) and the pooled-SD scale (s) numerically.
   */
  function dunnettSf(c, lambdas, df) {
    const zN = 160, zLo = -8, zHi = 8, hz = (zHi - zLo) / zN;
    const sq = lambdas.map((l) => Math.sqrt(1 - l * l));
    function inner(cs) { // P(all |Z_i| <= cs) for standard normal Z_i with product correlation
      let acc = 0;
      for (let i = 0; i <= zN; i++) {
        const z = zLo + i * hz; let prod = normPdf(z);
        for (let j = 0; j < lambdas.length && prod > 0; j++) {
          prod *= normCdf((cs - lambdas[j] * z) / sq[j]) - normCdf((-cs - lambdas[j] * z) / sq[j]);
        }
        acc += prod * (i === 0 || i === zN ? 1 : i % 2 ? 4 : 2);
      }
      return acc * hz / 3;
    }
    if (!isFinite(df) || df > 5000) return Math.max(0, 1 - inner(c));
    // density of s = sqrt(chi2_df / df)
    const logK = (df / 2) * Math.log(df) - (df / 2 - 1) * Math.LN2 - lnGamma(df / 2);
    const sHi = 1 + 14 / Math.sqrt(df) + (df < 4 ? 10 : 0);
    const sN = 240, hs = sHi / sN; let acc = 0;
    for (let i = 1; i <= sN; i++) {
      const s = i * hs;
      const dens = Math.exp(logK + (df - 1) * Math.log(s) - df * s * s / 2);
      if (dens < 1e-14 && s > 1) continue;
      acc += dens * inner(c * s) * (i === sN ? 1 : i % 2 ? 4 : 2);
    }
    // s = 0 endpoint contributes inner(0) = 0
    return Math.min(1, Math.max(0, 1 - acc * hs / 3));
  }

  // ---------------------------------------------------------------- multiple testing
  function adjust(ps, method) {
    const m = ps.length; const out = new Array(m);
    const order = Array.from({ length: m }, (_, i) => i).filter((i) => isFinite(ps[i]));
    const k = order.length;
    if (method === 'none') return ps.slice();
    if (method === 'bonferroni') return ps.map((p) => (isFinite(p) ? Math.min(1, p * k) : NaN));
    for (let i = 0; i < m; i++) out[i] = NaN;
    if (method === 'holm') {
      order.sort((a, b) => ps[a] - ps[b]); let run = 0;
      order.forEach((idx, r) => { run = Math.max(run, Math.min(1, (k - r) * ps[idx])); out[idx] = run; });
      return out;
    }
    if (method === 'bh' || method === 'fdr') {
      order.sort((a, b) => ps[b] - ps[a]); let run = 1;
      order.forEach((idx, r) => { const rankAsc = k - r; run = Math.min(run, ps[idx] * k / rankAsc); out[idx] = Math.min(1, run); });
      return out;
    }
    throw new Error('Unknown adjustment ' + method);
  }

  // ---------------------------------------------------------------- normality and variance
  function poly(cc, x) { let r = 0; for (let i = cc.length - 1; i >= 0; i--) r = r * x + cc[i]; return r; }
  /** Shapiro-Wilk W and p (Royston 1995, AS R94), 3 <= n <= 5000. */
  function shapiroWilk(data) {
    const x = sorted(data); const n = x.length;
    if (n < 3) return { W: NaN, p: NaN, n, note: 'needs at least 3 values' };
    if (x[n - 1] - x[0] < 1e-12 * Math.max(1, Math.abs(x[0]))) return { W: NaN, p: NaN, n, note: 'all values identical' };
    const nn2 = Math.floor(n / 2); const a = new Float64Array(nn2 + 1);
    const g = [-2.273, 0.459];
    const c1 = [0, 0.221157, -0.147981, -2.07119, 4.434685, -2.706056];
    const c2 = [0, 0.042981, -0.293762, -1.752461, 5.682633, -3.582633];
    const c3 = [0.544, -0.39978, 0.025054, -6.714e-4];
    const c4 = [1.3822, -0.77857, 0.062767, -0.0020322];
    const c5 = [-1.5861, -0.31082, -0.083751, 0.0038915];
    const c6 = [-0.4803, -0.082676, 0.0030302];
    if (n === 3) a[1] = Math.SQRT1_2;
    else {
      const an25 = n + 0.25; const m = new Float64Array(nn2 + 1); let summ2 = 0;
      for (let i = 1; i <= nn2; i++) { m[i] = normInv((i - 0.375) / an25); summ2 += m[i] * m[i]; }
      summ2 *= 2; const ssumm2 = Math.sqrt(summ2); const rsn = 1 / Math.sqrt(n);
      const a1 = poly(c1, rsn) - m[1] / ssumm2;
      let i1, fac;
      if (n > 5) {
        i1 = 3; const a2 = -m[2] / ssumm2 + poly(c2, rsn);
        fac = Math.sqrt((summ2 - 2 * m[1] * m[1] - 2 * m[2] * m[2]) / (1 - 2 * a1 * a1 - 2 * a2 * a2));
        a[2] = a2;
      } else {
        i1 = 2; fac = Math.sqrt((summ2 - 2 * m[1] * m[1]) / (1 - 2 * a1 * a1));
      }
      a[1] = a1;
      for (let i = i1; i <= nn2; i++) a[i] = -m[i] / fac;
    }
    const mu = mean(x); let ss = 0; for (const v of x) ss += (v - mu) * (v - mu);
    let num = 0; for (let i = 1; i <= nn2; i++) num += a[i] * (x[n - i] - x[i - 1]);
    let W = Math.min(1, num * num / ss);
    let p;
    if (n === 3) {
      p = Math.max(0, (6 / Math.PI) * (Math.asin(Math.sqrt(W)) - Math.PI / 3));
    } else {
      let w1 = Math.log(1 - W); const xx = Math.log(n); let m, s;
      if (n <= 11) {
        const gamma = poly(g, n);
        if (w1 >= gamma) return { W, p: 1e-99, n };
        w1 = -Math.log(gamma - w1); m = poly(c3, n); s = Math.exp(poly(c4, n));
      } else { m = poly(c5, xx); s = Math.exp(poly(c6, xx)); }
      p = normSf((w1 - m) / s);
    }
    return { W, p, n, note: n > 5000 ? 'p-value approximate above n = 5000' : '' };
  }

  /** One-way ANOVA core; groups = array of arrays. */
  function anovaCore(groups) {
    const all = [].concat(...groups.map((g) => Array.from(g)));
    const N = all.length, k = groups.length, gm = mean(all);
    let ssb = 0, ssw = 0;
    for (const g of groups) { const m = mean(g); ssb += g.length * (m - gm) * (m - gm); for (const v of g) ssw += (v - m) * (v - m); }
    const dfb = k - 1, dfw = N - k;
    const F = (ssb / dfb) / (ssw / dfw);
    return { F, df1: dfb, df2: dfw, p: fSf(F, dfb, dfw), ssb, ssw, sst: ssb + ssw, msw: ssw / dfw, N, k };
  }
  /** Brown-Forsythe (median-centred Levene) test for equal variances. */
  function levene(groups, center) {
    const dev = groups.map((g) => { const c = center === 'mean' ? mean(g) : median(g); return Array.from(g, (v) => Math.abs(v - c)); });
    if (dev.every((d) => d.every((v) => v === 0))) return { F: NaN, p: NaN };
    const r = anovaCore(dev);
    return { F: r.F, df1: r.df1, df2: r.df2, p: r.p };
  }

  // ---------------------------------------------------------------- two-sample and one-sample tests
  function hedgesCorrection(df) { return 1 - 3 / (4 * df - 1); }

  function tTest(a, b, opts) {
    const welch = !opts || opts.welch !== false;
    const na = a.length, nb = b.length, ma = mean(a), mb = mean(b), va = variance(a), vb = variance(b);
    const sp2 = ((na - 1) * va + (nb - 1) * vb) / (na + nb - 2);
    let se, df;
    if (welch) {
      se = Math.sqrt(va / na + vb / nb);
      df = Math.pow(va / na + vb / nb, 2) / (Math.pow(va / na, 2) / (na - 1) + Math.pow(vb / nb, 2) / (nb - 1));
    } else { se = Math.sqrt(sp2 * (1 / na + 1 / nb)); df = na + nb - 2; }
    const diff = ma - mb, t = diff / se, tc = tInv(0.975, df);
    const d = diff / Math.sqrt(sp2);
    return {
      test: welch ? "Welch's t-test" : "Student's t-test", t, df, p: tTwoSided(t, df), diff,
      ci: [diff - tc * se, diff + tc * se],
      effect: { name: "Hedges' g", value: d * hedgesCorrection(na + nb - 2), cohenD: d },
    };
  }
  function pairedTTest(a, b) {
    const d = Array.from(a, (v, i) => v - b[i]);
    const r = oneSampleT(d, 0);
    return Object.assign(r, { test: 'Paired t-test', effect: { name: "Cohen's d_z", value: mean(d) / sd(d) } });
  }
  function oneSampleT(a, mu0) {
    const n = a.length, m = mean(a), s = sd(a), se = s / Math.sqrt(n), df = n - 1, t = (m - mu0) / se, tc = tInv(0.975, df);
    return { test: 'One-sample t-test', t, df, p: tTwoSided(t, df), diff: m - mu0, ci: [m - mu0 - tc * se, m - mu0 + tc * se],
      effect: { name: "Cohen's d", value: (m - mu0) / s } };
  }

  // Exact null distribution of Mann-Whitney U (no ties): counts of U = 0..n1*n2.
  function mwuCounts(n1, n2) {
    // f[m][n][u] via DP over the largest element; store as rolling arrays keyed by (m,n).
    const memo = new Map();
    function f(m, n) {
      const key = m * 1000 + n; if (memo.has(key)) return memo.get(key);
      let res;
      if (m === 0 || n === 0) { res = [1]; }
      else {
        const A = f(m - 1, n), B = f(m, n - 1); const len = m * n + 1; res = new Array(len).fill(0);
        // largest element from sample 1 -> adds n to U (beats all n of sample 2)
        for (let u = 0; u < A.length; u++) res[u + n] += A[u];
        for (let u = 0; u < B.length; u++) res[u] += B[u];
      }
      memo.set(key, res); return res;
    }
    return f(n1, n2);
  }
  function mannWhitney(a, b) {
    const n1 = a.length, n2 = b.length;
    const { ranks, tieTerm } = rank([...a, ...b]);
    let r1 = 0; for (let i = 0; i < n1; i++) r1 += ranks[i];
    const U1 = r1 - n1 * (n1 + 1) / 2, U2 = n1 * n2 - U1, mu = n1 * n2 / 2;
    let p, method;
    if (tieTerm === 0 && n1 + n2 <= 50 && n1 * n2 <= 1600) {
      const counts = mwuCounts(n1, n2); const total = counts.reduce((s, v) => s + v, 0);
      const u = Math.min(U1, U2); let c = 0; for (let i = 0; i <= u; i++) c += counts[i];
      p = Math.min(1, 2 * c / total); method = 'exact';
    } else {
      const N = n1 + n2; const sigma = Math.sqrt(n1 * n2 / 12 * ((N + 1) - tieTerm / (N * (N - 1))));
      const z = (Math.abs(U1 - mu) - 0.5) / sigma; p = Math.min(1, 2 * normSf(Math.max(z, 0))); method = 'normal approximation, tie- and continuity-corrected';
    }
    return { test: 'Mann-Whitney U test', U: U1, p, method, effect: { name: 'rank-biserial r', value: 1 - 2 * U2 / (n1 * n2) },
      diff: median(a) - median(b) };
  }
  /** Smallest two-sided p a Mann-Whitney test can give for these sample sizes (no ties). */
  function mwuMinP(n1, n2) {
    let c = 1; for (let i = 0; i < Math.min(n1, n2); i++) c = c * (n1 + n2 - i) / (i + 1);
    return Math.min(1, 2 / c);
  }
  function wilcoxonSignedRank(a, b) {
    const dAll = b ? Array.from(a, (v, i) => v - b[i]) : Array.from(a);
    const d = dAll.filter((v) => v !== 0); const n = d.length; const zeros = dAll.length - n;
    if (n === 0) return { test: 'Wilcoxon signed-rank test', p: 1, V: 0, n, zeros, effect: { name: 'matched-pairs rank-biserial r', value: 0 } };
    const { ranks, tieTerm } = rank(d.map(Math.abs));
    let Vp = 0; for (let i = 0; i < n; i++) if (d[i] > 0) Vp += ranks[i];
    const T = n * (n + 1) / 2; let p, method;
    if (tieTerm === 0 && zeros === 0 && n <= 50) {
      const counts = new Float64Array(T + 1); counts[0] = 1;
      for (let k = 1; k <= n; k++) for (let s = T; s >= k; s--) counts[s] += counts[s - k];
      const total = Math.pow(2, n); const v = Math.min(Vp, T - Vp); let c = 0; for (let s = 0; s <= v; s++) c += counts[s];
      p = Math.min(1, 2 * c / total); method = 'exact';
    } else {
      const mu = T / 2; const sigma = Math.sqrt(n * (n + 1) * (2 * n + 1) / 24 - tieTerm / 48);
      const z = (Math.abs(Vp - mu) - 0.5) / sigma; p = Math.min(1, 2 * normSf(Math.max(0, z))); method = 'normal approximation, tie- and continuity-corrected';
    }
    return { test: 'Wilcoxon signed-rank test', V: Vp, p, n, zeros, method,
      effect: { name: 'matched-pairs rank-biserial r', value: (2 * Vp - T) / T }, diff: median(dAll) };
  }

  // ---------------------------------------------------------------- k-sample tests
  function oneWayAnova(groups) {
    const r = anovaCore(groups);
    const eta2 = r.ssb / r.sst, omega2 = (r.ssb - r.df1 * r.msw) / (r.sst + r.msw);
    return Object.assign(r, { test: 'One-way ANOVA', effect: { name: 'ω² (omega squared)', value: omega2, eta2 } });
  }
  function welchAnova(groups) {
    const k = groups.length; const n = groups.map((g) => g.length), m = groups.map(mean), v = groups.map((g) => variance(g));
    const w = n.map((ni, i) => ni / v[i]); const W = sum(w); const mw = sum(w.map((wi, i) => wi * m[i])) / W;
    const A = sum(w.map((wi, i) => wi * (m[i] - mw) * (m[i] - mw))) / (k - 1);
    const tmp = sum(w.map((wi, i) => Math.pow(1 - wi / W, 2) / (n[i] - 1)));
    const B = 1 + 2 * (k - 2) / (k * k - 1) * tmp;
    const F = A / B, df1 = k - 1, df2 = (k * k - 1) / (3 * tmp);
    const base = anovaCore(groups);
    return { test: "Welch's ANOVA", F, df1, df2, p: fSf(F, df1, df2), msw: base.msw,
      effect: { name: 'ω² (omega squared, from Welch F)', value: Math.max(0, (df1 * (F - 1)) / (df1 * (F - 1) + base.N)) } };
  }
  function kruskalWallis(groups) {
    const all = [].concat(...groups.map((g) => Array.from(g))); const N = all.length, k = groups.length;
    const { ranks, tieTerm } = rank(all); let H = 0, off = 0; const meanRanks = [];
    for (const g of groups) { let r = 0; for (let i = 0; i < g.length; i++) r += ranks[off + i]; off += g.length; H += r * r / g.length; meanRanks.push(r / g.length); }
    H = 12 / (N * (N + 1)) * H - 3 * (N + 1);
    const C = 1 - tieTerm / (N * N * N - N); H /= C;
    return { test: 'Kruskal-Wallis test', H, df: k - 1, p: chi2Sf(H, k - 1), meanRanks, tieTerm, N,
      effect: { name: 'ε² (epsilon squared)', value: H / ((N * N - 1) / (N + 1)) } };
  }
  /** Friedman test; rows = subjects (array of arrays, one value per condition). */
  function friedman(rows) {
    const n = rows.length, k = rows[0].length; const rs = new Float64Array(k); let tieSum = 0;
    for (const row of rows) { const { ranks, tieTerm } = rank(row); for (let j = 0; j < k; j++) rs[j] += ranks[j]; tieSum += tieTerm; }
    let s = 0; for (let j = 0; j < k; j++) s += rs[j] * rs[j];
    let Q = 12 / (n * k * (k + 1)) * s - 3 * n * (k + 1);
    Q /= 1 - tieSum / (n * (k * k * k - k));
    return { test: 'Friedman test', Q, df: k - 1, p: chi2Sf(Q, k - 1), effect: { name: "Kendall's W", value: Q / (n * (k - 1)) } };
  }
  /** One-way repeated-measures ANOVA with Greenhouse-Geisser correction; rows = subjects. */
  function rmAnova(rows) {
    const n = rows.length, k = rows[0].length; const all = [].concat(...rows); const gm = mean(all);
    const cm = Array.from({ length: k }, (_, j) => mean(rows.map((r) => r[j]))); const sm = rows.map(mean);
    let ssc = 0, sss = 0, sst = 0;
    for (let j = 0; j < k; j++) ssc += n * (cm[j] - gm) ** 2;
    for (let i = 0; i < n; i++) sss += k * (sm[i] - gm) ** 2;
    for (const v of all) sst += (v - gm) ** 2;
    const sse = sst - ssc - sss; const df1 = k - 1, df2 = (k - 1) * (n - 1);
    const F = (ssc / df1) / (sse / df2);
    // GG epsilon from the double-centred covariance matrix of conditions.
    const S = Array.from({ length: k }, () => new Float64Array(k));
    for (let a = 0; a < k; a++) for (let b = 0; b < k; b++) { let c = 0; for (let i = 0; i < n; i++) c += (rows[i][a] - cm[a]) * (rows[i][b] - cm[b]); S[a][b] = c / (n - 1); }
    const rowMean = S.map((r) => mean(r)); const tot = mean(rowMean);
    let trace = 0, sq = 0;
    for (let a = 0; a < k; a++) for (let b = 0; b < k; b++) { const d = S[a][b] - rowMean[a] - rowMean[b] + tot; if (a === b) trace += d; sq += d * d; }
    const eps = Math.min(1, Math.max(1 / (k - 1), (trace * trace) / ((k - 1) * sq)));
    return { test: 'Repeated-measures ANOVA', F, df1, df2, p: fSf(F, df1, df2), epsilon: eps,
      pGG: fSf(F, df1 * eps, df2 * eps), dfGG: [df1 * eps, df2 * eps], mse: sse / df2,
      effect: { name: 'partial η²', value: ssc / (ssc + sse) } };
  }

  // ---------------------------------------------------------------- post hoc
  function pairs(k) { const out = []; for (let i = 0; i < k; i++) for (let j = i + 1; j < k; j++) out.push([i, j]); return out; }
  function tukeyHSD(groups, names) {
    const r = anovaCore(groups); const k = groups.length; const m = groups.map(mean);
    return pairs(k).map(([i, j]) => {
      const se = Math.sqrt(r.msw / 2 * (1 / groups[i].length + 1 / groups[j].length));
      const q = Math.abs(m[i] - m[j]) / se;
      return { a: names[i], b: names[j], diff: m[i] - m[j], stat: q, statName: 'q', p: tukeySf(q, k, r.df2) };
    });
  }
  function gamesHowell(groups, names) {
    const k = groups.length; const m = groups.map(mean), v = groups.map((g) => variance(g)), n = groups.map((g) => g.length);
    return pairs(k).map(([i, j]) => {
      const a = v[i] / n[i], b = v[j] / n[j]; const se = Math.sqrt(a + b);
      const df = (a + b) ** 2 / (a * a / (n[i] - 1) + b * b / (n[j] - 1));
      const q = Math.abs(m[i] - m[j]) / se * Math.SQRT2;
      return { a: names[i], b: names[j], diff: m[i] - m[j], stat: q, statName: 'q', df, p: tukeySf(q, k, df) };
    });
  }
  function dunnett(groups, names, control) {
    const r = anovaCore(groups); const m = groups.map(mean); const n0 = groups[control].length;
    const others = groups.map((_, i) => i).filter((i) => i !== control);
    const lambdas = others.map((i) => Math.sqrt(groups[i].length / (groups[i].length + n0)));
    return others.map((i) => {
      const se = Math.sqrt(r.msw * (1 / groups[i].length + 1 / n0)); const t = (m[i] - m[control]) / se;
      return { a: names[i], b: names[control], diff: m[i] - m[control], stat: t, statName: 't', p: dunnettSf(Math.abs(t), lambdas, r.df2) };
    });
  }
  function dunn(groups, names, method, control) {
    const kw = kruskalWallis(groups); const N = kw.N;
    const varBase = (N * (N + 1)) / 12 - kw.tieTerm / (12 * (N - 1));
    const list = control === undefined ? pairs(groups.length) : groups.map((_, i) => [i, control]).filter(([i]) => i !== control);
    const rows = list.map(([i, j]) => {
      const z = (kw.meanRanks[i] - kw.meanRanks[j]) / Math.sqrt(varBase * (1 / groups[i].length + 1 / groups[j].length));
      return { a: names[i], b: names[j], diff: kw.meanRanks[i] - kw.meanRanks[j], diffName: 'mean-rank difference', stat: z, statName: 'z', pRaw: 2 * normSf(Math.abs(z)) };
    });
    const adj = adjust(rows.map((r) => r.pRaw), method || 'holm'); rows.forEach((r, i) => { r.p = adj[i]; });
    return rows;
  }
  /** Pairwise two-sample tests with p-adjustment. fn(a, b) -> {p, diff, ...}. */
  function pairwise(groups, names, fn, method, control) {
    const list = control === undefined ? pairs(groups.length) : groups.map((_, i) => [i, control]).filter(([i]) => i !== control);
    const rows = list.map(([i, j]) => { const r = fn(groups[i], groups[j]); return { a: names[i], b: names[j], diff: r.diff, stat: r.t ?? r.U ?? r.V, statName: r.t !== undefined ? 't' : r.U !== undefined ? 'U' : 'V', pRaw: r.p }; });
    const adj = adjust(rows.map((r) => r.pRaw), method || 'holm'); rows.forEach((r, i) => { r.p = adj[i]; });
    return rows;
  }

  // ---------------------------------------------------------------- linear models (two-way ANOVA)
  function solveLS(X, y) { // normal equations with Gaussian elimination; returns RSS
    const p = X[0].length, n = y.length; const A = Array.from({ length: p }, () => new Float64Array(p + 1));
    for (let i = 0; i < n; i++) { const xi = X[i]; for (let a = 0; a < p; a++) { A[a][p] += xi[a] * y[i]; for (let b = 0; b < p; b++) A[a][b] += xi[a] * xi[b]; } }
    const beta = new Float64Array(p); const used = new Array(p).fill(true);
    for (let c = 0; c < p; c++) {
      let piv = c; for (let r = c + 1; r < p; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
      if (Math.abs(A[piv][c]) < 1e-10) { used[c] = false; continue; }
      [A[c], A[piv]] = [A[piv], A[c]];
      for (let r = 0; r < p; r++) if (r !== c) { const f = A[r][c] / A[c][c]; for (let k2 = c; k2 <= p; k2++) A[r][k2] -= f * A[c][k2]; }
    }
    for (let c = 0; c < p; c++) beta[c] = used[c] && A[c][c] ? A[c][p] / A[c][c] : 0;
    let rss = 0; for (let i = 0; i < n; i++) { let f = 0; for (let a = 0; a < p; a++) f += X[i][a] * beta[a]; rss += (y[i] - f) ** 2; }
    return { rss, rank: used.filter(Boolean).length };
  }
  /** Two-way ANOVA with interaction, Type III sums of squares (sum-to-zero coding). */
  function twoWayAnova(y, fa, fb) {
    const la = [...new Set(fa)], lb = [...new Set(fb)];
    const code = (lev, v) => lev.slice(0, -1).map((l) => (v === l ? 1 : v === lev[lev.length - 1] ? -1 : 0));
    const rowsA = fa.map((v) => code(la, v)), rowsB = fb.map((v) => code(lb, v));
    const rowsAB = rowsA.map((ra, i) => { const o = []; for (const p1 of ra) for (const p2 of rowsB[i]) o.push(p1 * p2); return o; });
    const build = (useA, useB, useAB) => y.map((_, i) => [1, ...(useA ? rowsA[i] : []), ...(useB ? rowsB[i] : []), ...(useAB ? rowsAB[i] : [])]);
    const full = solveLS(build(1, 1, 1), y); const dfRes = y.length - full.rank; const mse = full.rss / dfRes;
    const term = (name, X, df) => { const r = solveLS(X, y); const ss = r.rss - full.rss; const F = (ss / df) / mse; return { term: name, ss, df, F, p: fSf(F, df, dfRes), partialEta2: ss / (ss + full.rss) }; };
    const dfA = la.length - 1, dfB = lb.length - 1;
    const cells = new Set(fa.map((a, i) => a + '\u0001' + fb[i]));
    const missingCells = la.length * lb.length - cells.size;
    return {
      test: 'Two-way ANOVA (Type III SS)', levelsA: la, levelsB: lb, dfRes, mse, missingCells,
      table: [term('A', build(0, 1, 1), dfA), term('B', build(1, 0, 1), dfB), term('A×B', build(1, 1, 0), dfA * dfB)],
      residuals: twoWayResiduals(y, fa, fb),
    };
  }
  function twoWayResiduals(y, fa, fb) {
    const cellMeans = new Map(); fa.forEach((a, i) => { const k = a + '\u0001' + fb[i]; if (!cellMeans.has(k)) cellMeans.set(k, []); cellMeans.get(k).push(y[i]); });
    for (const [k, v] of cellMeans) cellMeans.set(k, mean(v));
    return y.map((v, i) => v - cellMeans.get(fa[i] + '\u0001' + fb[i]));
  }

  // ---------------------------------------------------------------- correlation and categorical
  function pearson(x, y) {
    const n = x.length, mx = mean(x), my = mean(y); let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < n; i++) { const dx = x[i] - mx, dy = y[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
    const r = sxy / Math.sqrt(sxx * syy); const df = n - 2; const t = r * Math.sqrt(df / Math.max(1e-300, 1 - r * r));
    const z = Math.atanh(Math.max(-0.9999999, Math.min(0.9999999, r))), se = 1 / Math.sqrt(n - 3);
    const slope = sxy / sxx;
    return { test: "Pearson's correlation", r, t, df, n, p: tTwoSided(t, df), ci: n > 3 ? [Math.tanh(z - 1.959964 * se), Math.tanh(z + 1.959964 * se)] : [NaN, NaN],
      slope, intercept: my - slope * mx, r2: r * r, effect: { name: 'r', value: r } };
  }
  function spearman(x, y) {
    const rx = rank(x).ranks, ry = rank(y).ranks; const r = pearson(Array.from(rx), Array.from(ry));
    return { test: "Spearman's rank correlation", rho: r.r, n: r.n, p: r.p, t: r.t, df: r.df, effect: { name: 'ρ (rho)', value: r.r } };
  }
  function chiSquare(table) {
    const R = table.length, C = table[0].length; const rs = table.map(sum); const cs = table[0].map((_, j) => sum(table.map((r) => r[j]))); const N = sum(rs);
    let X2 = 0, minE = Infinity, small = 0; const yates = R === 2 && C === 2;
    for (let i = 0; i < R; i++) for (let j = 0; j < C; j++) {
      const E = rs[i] * cs[j] / N; minE = Math.min(minE, E); if (E < 5) small++;
      const d = yates ? Math.max(0, Math.abs(table[i][j] - E) - 0.5) : table[i][j] - E; X2 += d * d / E;
    }
    const df = (R - 1) * (C - 1);
    return { test: "Pearson's chi-square test" + (yates ? ' (Yates-corrected)' : ''), X2, df, p: chi2Sf(X2, df), minExpected: minE, fracSmall: small / (R * C), N,
      effect: { name: "Cramér's V", value: Math.sqrt((yates ? chiSquareRaw(table) : X2) / (N * (Math.min(R, C) - 1))) } };
  }
  function chiSquareRaw(table) {
    const rs = table.map(sum), cs = table[0].map((_, j) => sum(table.map((r) => r[j]))), N = sum(rs); let X2 = 0;
    table.forEach((r, i) => r.forEach((o, j) => { const E = rs[i] * cs[j] / N; X2 += (o - E) ** 2 / E; })); return X2;
  }
  const lnFact = (n) => lnGamma(n + 1);
  function fisherExact(t) {
    const [[a, b], [c, d]] = t; const r1 = a + b, r2 = c + d, c1 = a + c, N = r1 + r2;
    const lp = (x) => lnFact(r1) + lnFact(r2) + lnFact(c1) + lnFact(N - c1) - lnFact(N) - lnFact(x) - lnFact(r1 - x) - lnFact(c1 - x) - lnFact(r2 - c1 + x);
    const obs = lp(a); let p = 0;
    for (let x = Math.max(0, c1 - r2); x <= Math.min(r1, c1); x++) { const l = lp(x); if (l <= obs + 1e-7) p += Math.exp(l); }
    const or = (a * d) / (b * c);
    return { test: "Fisher's exact test", p: Math.min(1, p), oddsRatio: or, effect: { name: 'odds ratio (sample)', value: or } };
  }

  // ---------------------------------------------------------------- transformations
  const TRANSFORMS = {
    none: { label: 'None (raw values)', ok: () => true, f: (v) => v },
    log2: { label: 'log₂(x)', ok: (s) => s.min > 0, f: (v) => Math.log2(v) },
    log2p1: { label: 'log₂(x + 1)', ok: (s) => s.min >= 0 && s.min === 0, f: (v) => Math.log2(v + 1) },
    sqrt: { label: '√x', ok: (s) => s.min >= 0, f: (v) => Math.sqrt(v) },
    recip: { label: '1 / x', ok: (s) => s.min > 0, f: (v) => 1 / v },
    logit: { label: 'logit (proportion)', ok: (s) => s.min >= 0 && s.max <= 1 && s.max > 0, f: (v, s) => { const e = s.eps; const p = Math.min(1 - e, Math.max(e, v)); return Math.log(p / (1 - p)); } },
    logitPct: { label: 'logit (percentage)', ok: (s) => s.max > 1 && s.min >= 0 && s.max <= 100, f: (v, s) => { const e = s.eps; const p = Math.min(1 - e, Math.max(e, v / 100)); return Math.log(p / (1 - p)); } },
    boxcox: { label: 'Box-Cox', ok: (s) => s.min > 0, f: (v, s) => (Math.abs(s.lambda) < 1e-8 ? Math.log(v) : (Math.pow(v, s.lambda) - 1) / s.lambda) },
  };
  /** Profile-likelihood Box-Cox lambda for data grouped by `groups` (array of arrays), searched on [-3, 3]. */
  function boxCoxLambda(groups) {
    const all = [].concat(...groups.map((g) => Array.from(g))); const N = all.length; const sumLog = sum(all.map(Math.log));
    const ll = (lam) => {
      let ss = 0;
      for (const g of groups) { const t = Array.from(g, (v) => (Math.abs(lam) < 1e-8 ? Math.log(v) : (Math.pow(v, lam) - 1) / lam)); const m = mean(t); for (const v of t) ss += (v - m) ** 2; }
      return -N / 2 * Math.log(ss / N) + (lam - 1) * sumLog;
    };
    let lo = -3, hi = 3; const gr = (Math.sqrt(5) - 1) / 2;
    let c = hi - gr * (hi - lo), d = lo + gr * (hi - lo);
    for (let i = 0; i < 80; i++) { if (ll(c) > ll(d)) hi = d; else lo = c; c = hi - gr * (hi - lo); d = lo + gr * (hi - lo); }
    const lam = (lo + hi) / 2;
    return Math.round(lam * 100) / 100;
  }
  function transformInfo(values) {
    let min = Infinity, max = -Infinity, minPos = Infinity;
    for (const v of values) { if (v < min) min = v; if (v > max) max = v; if (v > 0 && v < minPos) minPos = v; }
    return { min, max, minPos, eps: 1e-4 };
  }

  const api = {
    sum, mean, variance, sd, median, quantile, skewness, kurtosis, describe, rank,
    lnGamma, ibeta, gammaQ, normCdf, normSf, normInv, normPdf, tSf, tCdf, tInv, tTwoSided, fSf, chi2Sf, ptukey, tukeySf, dunnettSf,
    adjust, shapiroWilk, levene, anovaCore,
    tTest, pairedTTest, oneSampleT, mannWhitney, mwuMinP, wilcoxonSignedRank,
    oneWayAnova, welchAnova, kruskalWallis, friedman, rmAnova,
    tukeyHSD, gamesHowell, dunnett, dunn, pairwise,
    twoWayAnova, twoWayResiduals, pearson, spearman, chiSquare, fisherExact,
    TRANSFORMS, boxCoxLambda, transformInfo,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.StatLib = api;
})(typeof self !== 'undefined' ? self : this);
