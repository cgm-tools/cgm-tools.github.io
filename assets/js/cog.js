/* Curve-of-growth page: Figure 1 (COG), Figure 2 (Voigt profiles), Table 1. */
(function () {
  "use strict";
  const P = window.CGMPhysics, F = window.MplFig, C = window.CGM;
  const LINES = window.CGM_LINES;
  const BY_ID = new Map(LINES.map(l => [l.id, l]));
  const BY_ION = C.linesByIon();
  const REF_B = [10, 30, 100];
  const REF_LS = { 10: ":", 30: "--", 100: "-." };
  const MAXSEL = F.CYCLE.length;
  const DEFAULT = ["HI_1215", "CIV_1548", "OVI_1031", "MgII_2796"];
  const STEP = 0.05;                                   // dex sampling of log N
  const UNIT_AXIS = { mA: "mÅ", A: "Å", kms: "km s^{−1}" };
  const UNIT_HTML = { mA: "mÅ", A: "Å", kms: "km&thinsp;s<sup>−1</sup>" };
  const WIDE = window.matchMedia("(min-width: 1300px)"); // figures side by side (see site.css)
  const NS = "http://www.w3.org/2000/svg";
  const $ = id => document.getElementById(id);

  const state = { sel: [], b: 30, ref: true, unit: "mA", nMin: 10, nMax: 22,
                  profN: 14, vmax: null, ion: null, q: "" };

  // ---------------------------------------------------------------- state <-> URL
  function nextColor() {
    const used = new Set(state.sel.map(s => s.color));
    return F.CYCLE.find(c => !used.has(c));
  }
  function readHash() {
    const h = new URLSearchParams(location.hash.slice(1));
    const ids = h.has("lines") ? h.get("lines").split(",").filter(id => BY_ID.has(id)) : DEFAULT;
    state.sel = [];
    for (const id of ids.slice(0, MAXSEL)) state.sel.push({ id, color: nextColor() });
    const b = parseFloat(h.get("b"));
    if (b > 0) state.b = Math.min(1000, Math.max(0.5, b));
    if (P.UNITS[h.get("unit")]) state.unit = h.get("unit");
    if (h.has("ref")) state.ref = h.get("ref") !== "0";
    if (h.has("logN")) {
      const [a, c] = h.get("logN").split(",").map(Number);
      if (isFinite(a) && isFinite(c) && c - a >= 1) { state.nMin = a; state.nMax = c; }
    }
    const n = parseFloat(h.get("N"));
    if (isFinite(n)) state.profN = n;
    const v = parseFloat(h.get("vmax"));
    if (v > 0) state.vmax = v;
    state.profN = clampN(state.profN);
  }
  function writeHash() {
    const o = { lines: state.sel.map(s => s.id).join(","), b: state.b, unit: state.unit,
                ref: state.ref ? 1 : 0, logN: `${state.nMin},${state.nMax}`, N: state.profN.toFixed(2) };
    if (state.vmax) o.vmax = state.vmax;
    history.replaceState(null, "", "#" + new URLSearchParams(o).toString().replace(/%2C/g, ","));
  }
  /** Run fn on the next animation frame, or after 60 ms if no frame comes
   *  (rAF is starved in background tabs and some headless browsers). */
  function nextFrame(fn) {
    let done = false;
    const run = () => { if (!done) { done = true; fn(); } };
    requestAnimationFrame(run);
    setTimeout(run, 60);
  }
  const clampN = n => +Math.min(state.nMax, Math.max(state.nMin, Math.round(n / STEP) * STEP)).toFixed(2);

  // ---------------------------------------------------------------- Figure 1: curve of growth
  const cache = new Map();
  function curve(line, b) {
    const key = `${line.id}|${b}|${state.nMin}|${state.nMax}`;
    let c = cache.get(key);
    if (!c) {
      const x = [];
      const n = Math.round((state.nMax - state.nMin) / STEP);
      for (let k = 0; k <= n; k++) x.push(+(state.nMin + k * STEP).toFixed(4));
      c = { x, W: P.cog(line, b, x) };
      cache.set(key, c);
      if (cache.size > 300) cache.delete(cache.keys().next().value);
    }
    return c;
  }
  const fmtB = b => (Math.round(b * 10) / 10).toString();

  function buildSpec() {
    const U = P.UNITS[state.unit];
    const lines = [], lineEntries = [], bEntries = [];
    let ymin = Infinity, ymax = 0;
    const upd = ys => ys.forEach(v => { if (v > 0) { ymin = Math.min(ymin, v); ymax = Math.max(ymax, v); } });
    const refBs = state.ref ? REF_B.filter(rb => Math.abs(rb - state.b) > 1e-9) : [];
    for (const s of state.sel) {
      const l = BY_ID.get(s.id);
      for (const rb of refBs) {
        const c = curve(l, rb), y = c.W.map(w => U.conv(w, l));
        lines.push({ x: c.x, y, color: s.color, lw: 1, ls: REF_LS[rb] }); upd(y);
      }
      const c = curve(l, state.b), y = c.W.map(w => U.conv(w, l));
      lines.push({ x: c.x, y, color: s.color, lw: 1.6, ls: "-", id: s.id }); upd(y);
      lineEntries.push({ label: C.lineMarkup(l), color: s.color, lw: 1.6 });
    }
    if (state.sel.length && refBs.length) {
      bEntries.push({ label: `*b* = ${fmtB(state.b)} km s^{−1}`, color: "#000", lw: 1.6 });
      refBs.forEach(rb => bEntries.push({ label: `*b* = ${rb} km s^{−1}`, color: "#000", lw: 1, ls: REF_LS[rb] }));
    }
    if (!isFinite(ymin)) { ymin = 1e-3; ymax = 1e4; }
    let lo = Math.pow(10, Math.floor(Math.log10(ymin) + 1e-9));
    let hi = Math.pow(10, Math.ceil(Math.log10(ymax) - 1e-9));
    if (hi / lo < 100) hi = lo * 100;
    return {
      title: "Curve of growth",
      margin: { l: 66, r: 14, t: 12, b: 52 },
      x: { scale: "linear", lim: [state.nMin, state.nMax], label: "log *N* [cm^{−2}]" },
      y: { scale: "log", lim: [lo, hi], label: `*W*_{r} [${UNIT_AXIS[state.unit]}]`, labelPad: 50 },
      lines,
      legends: [{ loc: "upper left", entries: lineEntries }, { loc: "lower right", entries: bEntries }],
    };
  }

  let spec = null, cogFig = null;
  const canvas = $("cogCanvas");
  const view = F.responsive(canvas, () => (spec = buildSpec()), w => Math.round(Math.min(w * 0.75, 620)),
                            { maxWidth: 900, minWidth: 300, after: fig => { cogFig = fig; attachHover(fig); drawPin(); scheduleProfiles(); } });

  /** Dashed marker at the pinned log N (drawn outside the spec, so not exported). */
  function drawPin() {
    if (!cogFig) return;
    cogFig.g.querySelector(".pin")?.remove();
    const xv = state.profN;
    if (xv < state.nMin || xv > state.nMax) return;
    const g = document.createElementNS(NS, "g");
    g.setAttribute("class", "pin");
    g.setAttribute("pointer-events", "none");
    const ln = document.createElementNS(NS, "line");
    Object.entries({ x1: cogFig.x(xv), x2: cogFig.x(xv), y1: 0, y2: cogFig.ph, stroke: "#000",
                     "stroke-width": 0.8, "stroke-dasharray": "4 3" }).forEach(([a, v]) => ln.setAttribute(a, v));
    g.appendChild(ln);
    cogFig.g.insertBefore(g, cogFig.overlay);
  }

  function placeReadout(ro, host, ev) {
    const cr = host.getBoundingClientRect();
    const left = ev.clientX - cr.left, top = ev.clientY - cr.top;
    const w = ro.offsetWidth, h = ro.offsetHeight;
    ro.style.left = `${left + 14 + w > cr.width ? left - 14 - w : left + 14}px`;
    ro.style.top = `${Math.max(0, Math.min(cr.height - h, top - h / 2))}px`;
  }
  function svgEl(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    Object.entries(attrs).forEach(([a, v]) => e.setAttribute(a, v));
    parent.appendChild(e);
    return e;
  }

  function attachHover(fig) {
    const readout = document.createElement("div");
    readout.className = "readout"; readout.hidden = true;
    canvas.appendChild(readout);
    const svg = fig.svg;
    svg.style.touchAction = "pan-y";
    svg.style.cursor = "crosshair";
    let hoverN = null;
    const hide = () => {
      readout.hidden = true; fig.overlay.innerHTML = "";
      if (hoverN !== null) { hoverN = null; previewN = null; scheduleProfiles(); }
    };
    svg.addEventListener("pointerleave", hide);
    svg.addEventListener("click", () => {
      if (hoverN === null) return;
      setProfN(hoverN);
    });
    svg.addEventListener("pointermove", ev => {
      const r = svg.getBoundingClientRect();
      const sx = (ev.clientX - r.left) * fig.W / r.width, sy = (ev.clientY - r.top) * fig.H / r.height;
      const px = sx - fig.margin.l, py = sy - fig.margin.t;
      const solid = spec.lines.filter(L => L.id);
      if (px < 0 || px > fig.pw || py < 0 || py > fig.ph || !solid.length) return hide();
      const k = Math.max(0, Math.min(solid[0].x.length - 1, Math.round((fig.x.invert(px) - state.nMin) / STEP)));
      const xv = solid[0].x[k];
      fig.overlay.innerHTML = "";
      svgEl("line", { x1: fig.x(xv), x2: fig.x(xv), y1: 0, y2: fig.ph, stroke: "#777", "stroke-width": 0.7,
                      "stroke-dasharray": "2 2" }, fig.overlay);
      const unit = UNIT_HTML[state.unit];
      let html = `log&thinsp;<i>N</i> = ${xv.toFixed(2)}&ensp;(<i>b</i> = ${fmtB(state.b)})`;
      for (const L of solid) {
        const yv = L.y[k];
        if (yv > 0 && yv >= fig.y.domain()[0] && yv <= fig.y.domain()[1])
          svgEl("circle", { cx: fig.x(xv), cy: fig.y(yv), r: 3.2, fill: L.color, stroke: "#fff", "stroke-width": 1 }, fig.overlay);
        html += `<br><span class="sw" style="border-color:${L.color}"></span>${C.lineHTML(BY_ID.get(L.id))}: ` +
                `<i>W</i><sub>r</sub> = ${C.sig(yv, 3)} ${unit}`;
      }
      html += `<br><span class="muted">click to fix the profiles here</span>`;
      readout.innerHTML = html;
      readout.hidden = false;
      placeReadout(readout, canvas, ev);
      if (hoverN !== xv) { hoverN = xv; previewN = xv; scheduleProfiles(); }
    });
  }

  F.exportButtons($("cogTools"), () => buildSpec(), "curve_of_growth");

  // ---------------------------------------------------------------- Figure 2: Voigt profiles
  let previewN = null;                                  // log N under the COG cursor, if any
  const profCanvas = $("profCanvas");
  const Y_TICKS = [0, 0.5, 1].map(v => ({ v, label: v.toFixed(1) }));
  const Y_MINOR = [0.1, 0.2, 0.3, 0.4, 0.6, 0.7, 0.8, 0.9, 1.1, 1.2].map(v => ({ v }));

  function niceCeil(v) {
    const e = Math.pow(10, Math.floor(Math.log10(v)));
    return [1, 2, 2.5, 5, 10].map(m => m * e).find(x => x >= v * (1 - 1e-9));
  }
  function profVmax(N) {
    if (state.vmax) return state.vmax;
    let v = 0;
    for (const s of state.sel) v = Math.max(v, P.profileHalfWidth(BY_ID.get(s.id), N, state.b));
    return Math.min(5000, Math.max(10, niceCeil(1.15 * v)));
  }

  function buildProfileSpec(logN, compact = false) {
    if (!state.sel.length) return null;
    const yTicks = compact ? Y_TICKS.map(t => (t.v === 0.5 ? { v: 0.5 } : t)) : Y_TICKS;   // short panels: label 0 and 1 only
    const N = Math.pow(10, logN), vmax = profVmax(N), U = P.UNITS[state.unit];
    const panels = state.sel.map(s => {
      const l = BY_ID.get(s.id);
      const v = P.profileGrid(l, N, state.b, vmax), Fv = P.profile(l, N, state.b, v);
      const W = U.conv(P.Wlambda(l, N, state.b), l);
      return {
        y: { scale: "linear", lim: [-0.1, 1.25], ticks: yTicks, minorTicks: Y_MINOR },
        fills: [{ x: v, y1: Fv, y2: 1, color: s.color, alpha: 0.16 }],
        hlines: [{ y: 1, ls: ":", lw: 0.8, color: "#555" }, { y: 0, ls: ":", lw: 0.8, color: "#555" }],
        lines: [{ x: v, y: Fv, color: s.color, lw: 1.5, id: s.id }],
        texts: [{ x: 0.025, y: 0.09, text: C.lineMarkup(l), bbox: true, size: 12.5 },
                { x: 0.975, y: 0.09, text: `*W*_{r} = ${C.sig(W, 3)} ${UNIT_AXIS[state.unit]}`,
                  anchor: "end", bbox: true, size: 11.5 }],
      };
    });
    return {
      title: "Voigt profiles", margin: { l: 58, r: 12, t: 12, b: 52 }, hspace: 0,
      x: { scale: "linear", lim: [-vmax, vmax], label: "Δ*v* [km s^{−1}]" },
      ylabel: "Normalized flux", ylabelPad: 42, panels,
    };
  }
  const profHeight = () => {
    if (WIDE.matches && cogFig) return cogFig.H;
    return Math.round(Math.max(260, Math.max(1, state.sel.length) * 115 + 64));
  };

  let profSpec = null, profFig = null;
  const profView = F.responsive(profCanvas,
    () => (profSpec = buildProfileSpec(previewN ?? state.profN, (profHeight() - 64) / Math.max(1, state.sel.length) < 85)), profHeight,
    { maxWidth: 900, minWidth: 260, empty: '<p class="muted small">Select one or more transitions.</p>',
      after: fig => { profFig = fig; attachProfileHover(fig); } });

  let profPending = false;
  function scheduleProfiles() {
    if (profPending) return;
    profPending = true;
    nextFrame(() => { profPending = false; profView.draw(); renderProfCaption(); });
  }

  function attachProfileHover(fig) {
    const readout = document.createElement("div");
    readout.className = "readout"; readout.hidden = true;
    profCanvas.appendChild(readout);
    const svg = fig.svg;
    svg.style.touchAction = "pan-y";
    const clear = () => fig.panels.forEach(p => { p.overlay.innerHTML = ""; });
    svg.addEventListener("pointerleave", () => { readout.hidden = true; clear(); });
    svg.addEventListener("pointermove", ev => {
      const r = svg.getBoundingClientRect();
      const sx = (ev.clientX - r.left) * fig.W / r.width, sy = (ev.clientY - r.top) * fig.H / r.height;
      const px = sx - fig.margin.l;
      if (px < 0 || px > fig.pw || sy < fig.margin.t || sy > fig.margin.t + fig.ph) { readout.hidden = true; clear(); return; }
      const vv = fig.panels[0].x.invert(px);
      clear();
      let html = `Δ<i>v</i> = ${C.fixed(vv, 1)}&nbsp;km&thinsp;s<sup>−1</sup>&ensp;(log&thinsp;<i>N</i> = ${(previewN ?? state.profN).toFixed(2)})`;
      fig.panels.forEach((p, i) => {
        const L = profSpec.panels[i].lines[0];
        const k = nearest(L.x, vv), fv = L.y[k];
        svgEl("line", { x1: p.x(vv), x2: p.x(vv), y1: 0, y2: p.ph, stroke: "#777", "stroke-width": 0.7,
                        "stroke-dasharray": "2 2" }, p.overlay);
        svgEl("circle", { cx: p.x(L.x[k]), cy: p.y(fv), r: 3, fill: L.color, stroke: "#fff", "stroke-width": 1 }, p.overlay);
        html += `<br><span class="sw" style="border-color:${L.color}"></span>${C.lineHTML(BY_ID.get(L.id))}: ` +
                `<i>F</i> = ${fv.toFixed(3)}`;
      });
      readout.innerHTML = html;
      readout.hidden = false;
      placeReadout(readout, profCanvas, ev);
    });
  }
  function nearest(xs, v) {
    let lo = 0, hi = xs.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (xs[m] < v) lo = m; else hi = m; }
    return Math.abs(xs[lo] - v) <= Math.abs(xs[hi] - v) ? lo : hi;
  }

  F.exportButtons($("profTools"), () => buildProfileSpec(state.profN), "voigt_profiles",
                  () => ({ width: 480, height: 110 * Math.max(1, state.sel.length) + 100 }));
  window.CGM_PAGE = {                                   // for tests / console use
    spec: () => buildSpec(),
    profSpec: () => buildProfileSpec(state.profN),
    profSize: () => ({ width: 480, height: 110 * Math.max(1, state.sel.length) + 100 }),
  };

  function renderProfCaption() {
    const n = previewN ?? state.profN;
    const names = state.sel.map(s => C.lineHTML(BY_ID.get(s.id)));
    $("profCaption").innerHTML = names.length
      ? `Normalized flux of a single Voigt component at log&thinsp;<i>N</i> = ${n.toFixed(2)}` +
        `${previewN !== null && Math.abs(previewN - state.profN) > 1e-6 ? " (preview)" : ""} and <i>b</i> = ${fmtB(state.b)}&nbsp;km&thinsp;s<sup>−1</sup> ` +
        `for ${listJoin(names)}. Shading marks the absorbed flux, whose area is the equivalent width. ` +
        `Hover over Figure 1 to preview other column densities; click it to fix one (dashed line).`
      : "Select one or more transitions.";
  }

  function setProfN(n) {
    state.profN = clampN(n);
    $("pnRange").value = state.profN; $("pnNum").value = state.profN.toFixed(2);
    drawPin(); renderStats(); writeHash(); scheduleProfiles();
  }

  // ---------------------------------------------------------------- controls
  function populateIonSelect() {
    const sel = $("ionSel");
    const els = C.elements();
    let html = "";
    for (const el of Object.keys(els)) {
      const ions = [...BY_ION.keys()].filter(i => i.split(" ")[0] === el);
      if (!ions.length) continue;
      html += `<optgroup label="${els[el]}">` + ions.map(i =>
        `<option value="${i}">${i} (${BY_ION.get(i).length} line${BY_ION.get(i).length > 1 ? "s" : ""})</option>`).join("") + "</optgroup>";
    }
    sel.innerHTML = html;
  }

  function matchLines(q) {
    q = q.trim().toLowerCase().replace(/\s+/g, " ");
    if (!q) return BY_ION.get(state.ion) || [];
    const exact = LINES.filter(l => l.ion.toLowerCase() === q || l.ion.toLowerCase().replace(" ", "") === q);
    if (exact.length) return exact;
    if (/^\d/.test(q)) return LINES.filter(l => String(l.wave).startsWith(q) || l.label.includes(q));
    const toks = q.split(" ");
    return LINES.filter(l => { const s = `${l.label} ${l.ion.replace(" ", "")} ${C.GROUPS[l.group]}`.toLowerCase();
      return toks.every(t => s.includes(t)); });
  }

  function renderList() {
    const items = matchLines(state.q);
    const colorOf = new Map(state.sel.map(s => [s.id, s.color]));
    $("transList").innerHTML = items.length ? items.map(l => {
      const col = colorOf.get(l.id);
      const tags = [l.group !== "core" ? C.GROUPS[l.group] : "", l.excited ? "excited" : ""].filter(Boolean).join(", ");
      return `<li><label>
        <input type="checkbox" data-id="${l.id}" ${col ? "checked" : ""}>
        <span class="swatch" style="border-top-color:${col || "transparent"}"></span>
        <span>${C.lineHTML(l)}${tags ? ` <span class="meta">(${tags})</span>` : ""}</span>
        <span class="meta"><i>f</i>&thinsp;=&thinsp;${C.sig(l.f, 3)}</span>
      </label></li>`;
    }).join("") : `<li class="muted small" style="padding:.3rem">No transitions match.</li>`;
  }

  function renderChips() {
    $("chips").innerHTML = state.sel.map(s => {
      const l = BY_ID.get(s.id);
      return `<span class="chip"><span class="swatch" style="border-top-color:${s.color}"></span>${C.lineHTML(l)}` +
             `<button type="button" data-rm="${s.id}" aria-label="Remove ${l.label}">×</button></span>`;
    }).join("");
    $("selInfo").textContent = state.sel.length
      ? `${state.sel.length} of ${MAXSEL} plotted (one colour each).`
      : "Tick transitions to plot them (up to six at once).";
    $("clearBtn").disabled = !state.sel.length;
  }

  function renderStats() {
    const U = P.UNITS[state.unit];
    const N = Math.pow(10, state.profN);
    $("statNtxt").textContent = state.profN.toFixed(2);
    document.querySelectorAll(".unitlbl").forEach(e => { e.innerHTML = UNIT_HTML[state.unit]; });
    let anySum = false, anyAlt = false;
    $("statsBody").innerHTML = state.sel.length ? state.sel.map(s => {
      const l = BY_ID.get(s.id);
      const sumA = l.gamma_flag === "sumA"; anySum ||= sumA;
      const alt = l.alt_f ? ` <span class="muted" title="Cashman et al. (2017), grade ${l.alt_f.grade || "n/a"}, ref. ${l.alt_f.ref}">(C17: <i>f</i>&thinsp;=&thinsp;${C.sig(l.alt_f.f, 3)})</span>` : "";
      anyAlt ||= !!l.alt_f;
      return `<tr>
        <td><span class="swatch" style="border-top-color:${s.color}"></span> ${C.lineHTML(l)}</td>
        <td class="num">${l.wave.toFixed(4)}</td>
        <td class="num">${C.sig(l.f, 4)}</td>
        <td class="num">${C.expHTML(l.Gamma, 3)}${sumA ? "<sup>†</sup>" : ""}</td>
        <td class="num">${C.expHTML(P.dampA(l, state.b), 2)}</td>
        <td class="num">${C.fixed(P.logNtau1(l, state.b), 2)}</td>
        <td class="num">${C.expHTML(P.tau0(l, N, state.b), 3)}</td>
        <td class="num">${C.sig(U.conv(P.Wlambda(l, N, state.b), l), 4)}</td>
        <td>${C.srcLink(l.src, l.src_line)}${alt}</td></tr>`;
    }).join("") : `<tr><td colspan="9" class="muted">No transitions selected.</td></tr>`;
    $("statsNotes").innerHTML =
      `<p>Source links open the exact row of the source file: M03 = Morton (2003), V96 = Verner et al. (1996).</p>` +
      (anySum ? `<p><sup>†</sup> Γ not tabulated in the source; sum of the radiative rates out of the upper level (lower limit).</p>` : "") +
      (anyAlt ? `<p>C17: Cashman et al. (2017) <i>f</i>-value, shown where it differs from the adopted value by more than 10%.</p>` : "");
  }

  function renderCaption() {
    const names = state.sel.map(s => C.lineHTML(BY_ID.get(s.id)));
    const refBs = state.ref ? REF_B.filter(rb => Math.abs(rb - state.b) > 1e-9) : [];
    const lsName = { 10: "dotted", 30: "dashed", 100: "dash-dotted" };
    $("cogCaption").innerHTML = names.length
      ? `Curves of growth for ${listJoin(names)} at <i>b</i> = ${fmtB(state.b)}&nbsp;km&thinsp;s<sup>−1</sup> (solid)` +
        (refBs.length ? `; ${listJoin(refBs.map(rb => `${lsName[rb]} curves show <i>b</i> = ${rb}`))}&nbsp;km&thinsp;s<sup>−1</sup>` : "") +
        `. The dashed vertical line marks the column density of the profiles in Figure 2. Hover to read off values.`
      : "Select one or more transitions.";
  }
  function listJoin(a) { return a.length < 2 ? a.join("") : a.slice(0, -1).join(", ") + " and " + a[a.length - 1]; }

  let pending = false;
  function update(opts = {}) {
    if (opts.list) renderList();
    renderChips();
    renderCaption();
    if (pending) return;
    pending = true;
    nextFrame(() => {
      pending = false;
      view.draw();                                       // its after-hook redraws Figure 2
      if (!cogFig || !state.sel.length) scheduleProfiles();
      renderStats(); writeHash();
    });
  }

  function toggle(id, on) {
    const i = state.sel.findIndex(s => s.id === id);
    if (on && i < 0) {
      if (state.sel.length >= MAXSEL) {
        $("selInfo").innerHTML = `<span class="err">At most ${MAXSEL} lines at once; remove one first.</span>`;
        renderList();
        return;
      }
      state.sel.push({ id, color: nextColor() });
    } else if (!on && i >= 0) state.sel.splice(i, 1);
    update({ list: true });
  }

  function syncNRange() {
    for (const id of ["pnRange", "pnNum"]) { $(id).min = state.nMin; $(id).max = state.nMax; }
    $("pnRange").value = state.profN; $("pnNum").value = state.profN.toFixed(2);
  }

  // ---------------------------------------------------------------- wire up
  readHash();
  populateIonSelect();
  state.ion = state.sel.length ? BY_ID.get(state.sel[0].id).ion : "O VI";
  $("ionSel").value = state.ion;
  $("bRange").value = Math.min(150, state.b); $("bNum").value = state.b;
  $("refB").checked = state.ref; $("unit").value = state.unit;
  $("nMin").value = state.nMin; $("nMax").value = state.nMax;
  $("vmax").value = state.vmax || "";
  syncNRange();

  $("ionSel").addEventListener("change", e => { state.ion = e.target.value; state.q = ""; $("q").value = ""; renderList(); });
  $("q").addEventListener("input", e => { state.q = e.target.value; renderList(); });
  $("transList").addEventListener("change", e => { if (e.target.dataset.id) toggle(e.target.dataset.id, e.target.checked); });
  $("chips").addEventListener("click", e => { const id = e.target.closest("button")?.dataset.rm; if (id) toggle(id, false); });
  $("clearBtn").addEventListener("click", () => { state.sel = []; update({ list: true }); });
  $("bRange").addEventListener("input", e => { state.b = +e.target.value; $("bNum").value = state.b; update(); });
  $("bNum").addEventListener("change", e => {
    const v = Math.min(1000, Math.max(0.5, +e.target.value || 30));
    state.b = v; e.target.value = v; $("bRange").value = Math.min(150, v); update();
  });
  $("refB").addEventListener("change", e => { state.ref = e.target.checked; update(); });
  $("unit").addEventListener("change", e => { state.unit = e.target.value; update(); });
  for (const id of ["nMin", "nMax"]) $(id).addEventListener("change", () => {
    const a = +$("nMin").value, b = +$("nMax").value;
    if (isFinite(a) && isFinite(b) && b - a >= 1) {
      state.nMin = a; state.nMax = b; state.profN = clampN(state.profN); syncNRange(); update();
    } else { $("nMin").value = state.nMin; $("nMax").value = state.nMax; }
  });
  $("pnRange").addEventListener("input", e => setProfN(+e.target.value));
  $("pnNum").addEventListener("change", e => { const v = +e.target.value; if (isFinite(v)) setProfN(v); else syncNRange(); });
  $("vmax").addEventListener("change", e => {
    const v = +e.target.value;
    state.vmax = e.target.value.trim() && v > 0 ? Math.min(50000, v) : null;
    if (!state.vmax) e.target.value = "";
    writeHash(); scheduleProfiles();
  });
  WIDE.addEventListener("change", () => scheduleProfiles());

  renderList();
  renderProfCaption();
  document.fonts.ready.then(() => update());   // legend widths need the real font metrics
  update();
})();
