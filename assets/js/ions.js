/* Ions & lines page: filter bar, ionization-energy ladder, ion table. */
(function () {
  "use strict";
  const F = window.MplFig, C = window.CGM;
  const IONS = window.CGM_IONS, LINES = window.CGM_LINES;
  const ELS = C.elements();
  const BY_ION = C.linesByIon();
  const HC = 12398.4198;                                 // eV Angstrom
  const $ = id => document.getElementById(id);
  const ROW = 15;                                        // px per ion in the ladder

  const state = { el: "all", q: "", all: false, groups: new Set(Object.keys(C.GROUPS)) };

  // ------------------------------------------------------------ filtering
  function linesOf(ion) {
    return (BY_ION.get(ion.ion) || []).filter(l => state.groups.has(l.group));
  }
  function visibleIons() {
    const q = state.q.trim().toLowerCase();
    return IONS.filter(i => {
      if (state.el !== "all" && i.el !== state.el) return false;
      const ls = linesOf(i);
      if (!state.all && !ls.length) return false;
      if (!q) return true;
      if (i.ion.toLowerCase() === q || i.ion.toLowerCase().replace(" ", "") === q) return true;
      if (/^\d/.test(q)) return ls.some(l => String(l.wave).startsWith(q));
      return i.ion.toLowerCase().startsWith(q) || (ELS[i.el] || "").toLowerCase().startsWith(q);
    });
  }

  // ------------------------------------------------------------ ladder figure
  function ladderSpec(ions) {
    const n = ions.length;
    const hasLines = i => linesOf(i).length > 0;
    let lo = Infinity, hi = 0;
    for (const i of ions) {
      if (i.ie_create > 0) lo = Math.min(lo, i.ie_create);
      if (i.ie) { lo = Math.min(lo, i.ie); hi = Math.max(hi, i.ie); }
      else hi = Math.max(hi, i.ie_create);
    }
    const xmin = Math.pow(10, Math.floor(Math.log10(Math.min(lo, 5)))), xmax = Math.pow(10, Math.ceil(Math.log10(hi * 1.05)));
    const barh = ions.map((i, k) => ({
      y: k, h: 0.62,                                   // bar height in row units
      x0: i.ie_create > 0 ? i.ie_create : xmin, x1: i.ie || xmax,
      color: hasLines(i) ? F.CYCLE[0] : "#c4c4c4",
      title: `${i.ion}: created at ${fmtIE(i.ie_create)} eV, destroyed at ${i.ie ? fmtIE(i.ie) + " eV" : "— (bare nucleus)"}` +
             (i.logT_peak ? `; CIE peak log T = ${i.logT_peak}` : ""),
    }));
    const hlines = [];
    for (let k = 1; k < n; k++) if (ions[k].el !== ions[k - 1].el) hlines.push({ y: k - 0.5, color: "#999", lw: 0.5 });
    const edges = [[13.598, "1 Ry"], [24.587, "He ~I~"], [54.418, "4 Ry"]].filter(([e]) => e > xmin && e < xmax);
    const legend = state.all && ions.some(i => !hasLines(i)) ? { loc: "lower right", entries: [
      { label: "has lines in Table 1", color: F.CYCLE[0], patch: true },
      { label: "no lines listed", color: "#c4c4c4", patch: true }] } : null;
    return {
      title: "Ionization-energy ladder",
      margin: { l: 70, r: 16, t: 58, b: 50 },
      x: { scale: "log", lim: [xmin, xmax], label: "Ionization energy [eV]" },
      x2: { fromX: E => HC / E, toX: lam => HC / lam, label: "*λ* = *hc*/*E* [Å]" },
      y: { scale: "linear", lim: [-1.6, n - 0.5], invert: true, minor: false,   // empty band on top for edge labels
           ticks: ions.map((i, k) => ({ v: k, label: C.ionMarkup(i.ion) })) },
      barh, hlines,
      vlines: edges.map(([e, t]) => ({ x: e, ls: ":", lw: 0.9, color: "#000", text: t })),
      legend,
    };
  }
  const ladderHeight = n => Math.max(170, (n + 1.1) * ROW + 58 + 50);
  let ladderIons = [];
  const view = F.responsive($("ladderCanvas"), () => ladderSpec(ladderIons),
                            () => ladderHeight(ladderIons.length), { maxWidth: 1100, minWidth: 320 });
  F.exportButtons($("ladderTools"), () => ladderSpec(ladderIons), "ionization_ladder",
                  () => ({ width: 640, height: Math.max(200, (ladderIons.length + 1.1) * 12 + 108) }));

  window.CGM_PAGE = { spec: () => ladderSpec(ladderIons),
                      size: () => ({ width: 640, height: Math.max(200, (ladderIons.length + 1.1) * 12 + 108) }) };

  // ------------------------------------------------------------ table
  function fmtIE(v, flag) {
    if (v == null) return "—";
    const s = v >= 1000 ? v.toFixed(1) : v >= 100 ? v.toFixed(2) : v.toFixed(3);
    return flag === "theoretical" ? `(${s})` : flag === "semi-empirical" ? `[${s}]` : s;
  }
  function lineItem(l) {
    const w = l.wave >= 100 ? l.wave.toFixed(3) : l.wave.toFixed(4);
    const tag = l.group !== "core" ? ` <span class="muted small">${C.GROUPS[l.group]}</span>` : "";
    const v = l.src === "V96" ? "<sup>V</sup>" : "";
    const alt = l.alt_f ? `<sup title="Cashman et al. (2017): f = ${l.alt_f.f}${l.alt_f.grade ? ", grade " + l.alt_f.grade : ""} (ref. ${l.alt_f.ref})">C</sup>` : "";
    return `<span style="white-space:nowrap">${C.srcLink(l.src, l.src_line, w)}${l.excited ? "*" : ""}${v} ` +
           `(${C.sig(l.f, 3)})${alt}${tag}</span>`;
  }
  function renderTable(ions) {
    let html = "", cur = null;
    for (const i of ions) {
      if (i.el !== cur) {
        cur = i.el;
        html += `<tr class="group"><td colspan="6">${ELS[i.el] || i.el} <span class="muted" style="font-weight:400">(<i>Z</i> = ${i.Z})</span></td></tr>`;
      }
      const ls = linesOf(i);
      const T = i.logT_peak ? `${i.logT_peak.toFixed(2)} <span class="muted small">(${i.logT_half[0].toFixed(1)}–${i.logT_half[1].toFixed(1)})</span>` : "—";
      html += `<tr>
        <td>${C.ionHTML(i.ion)}</td>
        <td class="muted">${i.isoseq || ""}</td>
        <td class="num">${fmtIE(i.ie, i.ie_flag)}</td>
        <td class="num">${i.stage > 1 ? fmtIE(i.ie_create) : "0"}</td>
        <td class="num">${T}</td>
        <td>${ls.length ? ls.map(lineItem).join("; ") : '<span class="muted">—</span>'}</td>
      </tr>`;
    }
    $("ionBody").innerHTML = html || `<tr><td colspan="6" class="muted">No ions match.</td></tr>`;
  }

  function update() {
    const ions = visibleIons();
    ladderIons = ions;
    if (ions.length) view.draw(); else $("ladderCanvas").innerHTML = '<p class="muted">No ions match.</p>';
    renderTable(ions);
    $("ladderNote").textContent = state.all ? "Grey bars: ions with no line in the list." : "";
  }

  // ------------------------------------------------------------ controls
  $("elBtns").innerHTML = [`<button type="button" class="btn" data-el="all" aria-pressed="true">All</button>`]
    .concat(Object.keys(ELS).map(e => `<button type="button" class="btn sym" data-el="${e}" aria-pressed="false" title="${ELS[e]}">${e}</button>`)).join("");
  $("grpBtns").innerHTML = Object.entries(C.GROUPS).map(([k, v]) =>
    `<button type="button" class="btn" data-g="${k}" aria-pressed="true">${v}</button>`).join("");
  $("elBtns").addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    state.el = b.dataset.el;
    $("elBtns").querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", x === b));
    update();
  });
  $("grpBtns").addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    const g = b.dataset.g;
    state.groups.has(g) ? state.groups.delete(g) : state.groups.add(g);
    b.setAttribute("aria-pressed", state.groups.has(g));
    update();
  });
  $("q").addEventListener("input", e => { state.q = e.target.value; update(); });
  $("allStages").addEventListener("change", e => { state.all = e.target.checked; update(); });

  update();
  document.fonts.ready.then(update);
})();
