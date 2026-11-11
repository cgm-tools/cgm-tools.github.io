/* Shared helpers: ion names, number formatting, source citations. */
(function (root) {
  "use strict";
  const REPO = "https://github.com/cgm-tools/cgm-tools.github.io/blob/main/";

  const SOURCES = {
    M03: { cite: "Morton (2003)", file: "sources/morton2003_table2.txt",
           ads: "https://ui.adsabs.harvard.edu/abs/2003ApJS..149..205M" },
    V96: { cite: "Verner et al. (1996)", file: "sources/verner1996_table1.txt",
           ads: "https://ui.adsabs.harvard.edu/abs/1996ADNDT..64....1V" },
    C17: { cite: "Cashman et al. (2017)", file: "sources/cashman2017_table1.txt",
           ads: "https://ui.adsabs.harvard.edu/abs/2017ApJS..230....8C" },
    NIST: { cite: "NIST ASD", file: "sources/nist_asd_ionization_energies.csv",
            ads: "https://physics.nist.gov/PhysRefData/ASD/ionEnergy.html" },
    GS07: { cite: "Gnat & Sternberg (2007)", file: "sources/gnat_sternberg2007_cie.tsv",
            ads: "https://ui.adsabs.harvard.edu/abs/2007ApJS..168..213G" },
  };
  const GROUPS = { core: "UV", euv: "EUV", xray: "X-ray", optical: "optical", ism: "ISM/DLA" };

  /** "O VI" -> markup "O ~VI~" (small-caps numerals); excited adds a star. */
  function ionMarkup(ion, excited) {
    const [el, num] = ion.split(" ");
    return `${el} ~${num}~${excited ? "*" : ""}`;
  }
  function ionHTML(ion, excited) {
    return `<span class="ion">${MplFig.markupHTML(ionMarkup(ion, excited))}</span>`;
  }
  /** Wavelength part of a line label: "1031", "903.6", "21.60", or "Lyα". */
  function waveTag(line) { return line.label.split(" ").slice(2).join(" "); }
  function lineMarkup(line) { return `${ionMarkup(line.ion, line.excited)} ${waveTag(line)}`; }
  function lineHTML(line) {
    return `<span class="ion">${MplFig.markupHTML(ionMarkup(line.ion, line.excited))}&thinsp;${waveTag(line)}</span>`;
  }

  /** 2.88e8 -> "2.88 × 10<sup>8</sup>" */
  function expHTML(v, digits = 3) {
    if (v == null || !isFinite(v)) return "—";
    if (v === 0) return "0";
    const e = Math.floor(Math.log10(Math.abs(v)));
    if (e >= -2 && e <= 3) return sig(v, digits);
    const m = v / Math.pow(10, e);
    return `${m.toFixed(digits - 1)}&thinsp;×&thinsp;10<sup>${e < 0 ? "−" + -e : e}</sup>`;
  }
  /** significant figures, plain decimal, unicode minus */
  function sig(v, digits = 3) {
    if (v == null || !isFinite(v)) return "—";
    let s = Number(v.toPrecision(digits)).toString();
    if (/e/.test(s)) s = Number(v).toFixed(Math.max(0, digits - 1 - Math.floor(Math.log10(Math.abs(v)))));
    return s.replace("-", "−");
  }
  function fixed(v, d) { return v == null || !isFinite(v) ? "—" : v.toFixed(d).replace("-", "−"); }

  function srcLink(src, lineno, text) {
    const s = SOURCES[src];
    const href = REPO + s.file + (lineno ? `#L${lineno}` : "");
    return `<a href="${href}" title="${s.cite}${lineno ? ", line " + lineno + " of " + s.file : ""}">${text || src}</a>`;
  }

  function elements() { return root.CGM_META.elements; }
  function linesByIon() {
    const m = new Map();
    for (const l of root.CGM_LINES) {
      if (!m.has(l.ion)) m.set(l.ion, []);
      m.get(l.ion).push(l);
    }
    return m;
  }

  /** Render $...$ / $$...$$ with KaTeX if it is loaded. */
  function renderMath(node) {
    if (root.renderMathInElement) root.renderMathInElement(node || document.body, {
      delimiters: [{ left: "$$", right: "$$", display: true }, { left: "$", right: "$", display: false }],
      throwOnError: false,
    });
  }

  root.CGM = { SOURCES, GROUPS, ionMarkup, ionHTML, lineMarkup, lineHTML, waveTag,
               expHTML, sig, fixed, srcLink, elements, linesByIon, renderMath, REPO };
})(window);
