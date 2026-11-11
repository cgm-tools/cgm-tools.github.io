/* Curve-of-growth physics.  No dependencies; exposes window.CGMPhysics.
 *
 *   tau0(line, N, b)   line-centre optical depth of a Voigt profile
 *   dampA(line, b)     Voigt damping parameter a = Gamma lambda / (4 pi b)
 *   Wlambda(line,N,b)  rest-frame equivalent width in Angstrom
 *
 * line = {wave [A], f, Gamma [s^-1]};  N in cm^-2;  b in km/s.
 *
 * The Voigt function H(a,u) = Re w(u + i a) uses Humlicek (1982, JQSRT 27,
 * 437) "W4", relative accuracy ~1e-4.  W is integrated over the full
 * profile -- a fine uniform grid through the Doppler core, a logarithmic
 * grid through the Lorentzian wings -- plus the analytic wing tail beyond
 * the last grid point, so the damped part of the curve of growth is not
 * truncated.
 */
(function (root) {
  "use strict";

  // CODATA 2018, cgs
  const E_CHARGE = 4.80320471e-10;   // esu
  const M_E = 9.1093837015e-28;      // g
  const C_CGS = 2.99792458e10;       // cm/s
  const C_KMS = C_CGS / 1e5;
  const SQRTPI = Math.sqrt(Math.PI);
  const PI_E2_MEC = Math.PI * E_CHARGE * E_CHARGE / (M_E * C_CGS);   // 0.026540 cm^2 s^-1
  // tau0 = sqrt(pi) e^2/(m_e c) f lambda N / b, with lambda in A and b in km/s
  const TAU0_K = PI_E2_MEC / SQRTPI * 1e-8 / 1e5;                     // 1.4974e-15
  // optically thin limit: W_lambda = (pi e^2 / m_e c^2) N f lambda^2  [A, lambda in A]
  const LIN_K = PI_E2_MEC / C_CGS * 1e-8;                              // 8.853e-21

  /** Real part of the Faddeeva function w(z), z = x + i y (y >= 0).
   *  Humlicek (1982) W4 rational approximations, four regions. */
  function voigtH(y, x) {
    const ax = Math.abs(x);
    const s = ax + y;
    // t = y - i x
    const tr = y, ti = -x;
    let nr, ni, dr, di;
    if (s >= 15) {                                   // region I
      // w = t * 0.5641896 / (0.5 + t^2)
      const ur = tr * tr - ti * ti + 0.5, ui = 2 * tr * ti;
      nr = 0.5641896 * tr; ni = 0.5641896 * ti;
      return (nr * ur + ni * ui) / (ur * ur + ui * ui);
    }
    if (s >= 5.5) {                                  // region II
      // w = t (1.410474 + u 0.5641896) / (0.75 + u (3 + u)),  u = t^2
      const ur = tr * tr - ti * ti, ui = 2 * tr * ti;
      const ar = 1.410474 + 0.5641896 * ur, ai = 0.5641896 * ui;
      nr = tr * ar - ti * ai; ni = tr * ai + ti * ar;
      const br = 3 + ur, bi = ui;                    // 3 + u
      const cr = ur * br - ui * bi + 0.75, ci = ur * bi + ui * br;
      return (nr * cr + ni * ci) / (cr * cr + ci * ci);
    }
    if (y >= 0.195 * ax - 0.176) {                   // region III
      // w = P(t)/Q(t)
      const P = [0.5642236, 3.778987, 11.96482, 20.20933, 16.4955];
      const Q = [1, 6.699398, 21.69274, 39.27121, 38.82363, 16.4955];
      let pr = P[0], pi = 0;
      for (let k = 1; k < P.length; k++) { const r = pr * tr - pi * ti + P[k]; pi = pr * ti + pi * tr; pr = r; }
      let qr = Q[0], qi = 0;
      for (let k = 1; k < Q.length; k++) { const r = qr * tr - qi * ti + Q[k]; qi = qr * ti + qi * tr; qr = r; }
      return (pr * qr + pi * qi) / (qr * qr + qi * qi);
    }
    // region IV:  w = exp(u) - t P(u)/Q(u),  u = t^2
    const ur = tr * tr - ti * ti, ui = 2 * tr * ti;
    const P = [-0.56419, 1.320522, -35.76683, 219.0313, -1540.787, 3321.9905, -36183.31];
    const Q = [1, -1.841439, 61.57037, -364.2191, 2186.181, -9022.228, 24322.84, -32066.6];
    let pr = P[0], pi = 0;
    for (let k = 1; k < P.length; k++) { const r = pr * ur - pi * ui + P[k]; pi = pr * ui + pi * ur; pr = r; }
    let qr = Q[0], qi = 0;
    for (let k = 1; k < Q.length; k++) { const r = qr * ur - qi * ui + Q[k]; qi = qr * ui + qi * ur; qr = r; }
    // tP/Q
    const tpr = tr * pr - ti * pi, tpi = tr * pi + ti * pr;
    const den = qr * qr + qi * qi;
    const fr = (tpr * qr + tpi * qi) / den;
    const eu = Math.exp(ur) * Math.cos(ui);
    return eu - fr;
  }

  function tau0(line, N, b) { return TAU0_K * line.f * line.wave * N / b; }
  function dampA(line, b) { return (line.Gamma || 0) * line.wave * 1e-8 / (4 * Math.PI * b * 1e5); }

  /** Rest-frame equivalent width [A]. */
  function Wlambda(line, N, b) {
    const t0 = tau0(line, N, b);
    const a = dampA(line, b);
    const dlD = line.wave * b / C_KMS;                       // Doppler width [A]
    if (t0 < 1e-6) return LIN_K * N * line.f * line.wave * line.wave;   // exact limit
    const g = u => -Math.expm1(-t0 * voigtH(a, u));        // 1 - exp(-tau)

    // core: Simpson on a uniform grid out to where the Gaussian core is negligible
    const u1 = Math.max(5, Math.sqrt(Math.log(Math.max(t0, 1) / 1e-8)) + 1);
    let n = Math.ceil(u1 / 0.02); if (n % 2) n++;
    const h = u1 / n;
    let s = g(0) + g(u1);
    for (let i = 1; i < n; i++) s += (i % 2 ? 4 : 2) * g(i * h);
    let I = s * h / 3;

    // wings: trapezoid in ln u from u1 to u2, then analytic Lorentzian tail
    if (a > 0) {
      const u2 = Math.max(4 * u1, Math.sqrt(t0 * a / (SQRTPI * 1e-6)));
      const m = Math.max(16, Math.ceil(64 * Math.log10(u2 / u1)));
      const dl = Math.log(u2 / u1) / m;
      let prev = u1 * g(u1), acc = 0;
      for (let k = 1; k <= m; k++) {
        const u = u1 * Math.exp(k * dl);
        const cur = u * g(u);
        acc += 0.5 * (prev + cur) * dl;
        prev = cur;
      }
      I += acc + t0 * a / (SQRTPI * u2);                   // integral of tau0 a/(sqrt(pi) u^2) beyond u2
    }
    return 2 * dlD * I;
  }

  /** log N where the line-centre optical depth equals 1. */
  function logNtau1(line, b) { return Math.log10(b / (TAU0_K * line.f * line.wave)); }

  /** Curve of growth sampled on logN array. */
  function cog(line, b, logN) { return logN.map(x => Wlambda(line, Math.pow(10, x), b)); }

  const UNITS = {
    mA: { label: "mÅ", conv: (W, line) => W * 1e3 },
    A: { label: "Å", conv: (W, line) => W },
    kms: { label: "km s⁻¹", conv: (W, line) => W / line.wave * C_KMS },
  };

  root.CGMPhysics = { voigtH, tau0, dampA, Wlambda, cog, logNtau1, UNITS,
                      TAU0_K, LIN_K, C_KMS };
})(typeof window !== "undefined" ? window : globalThis);
