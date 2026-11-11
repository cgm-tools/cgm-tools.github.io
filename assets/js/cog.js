/* Curve-of-growth page. */
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
  const $ = id => document.getElementById(id);

  const state = { sel: [], b: 30, ref: true, unit: "mA", nMin: 10, nMax: 22, statN: 14, ion: null, q: "" };

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
  }
  function writeHash() {
    const h = new URLSearchParams({ lines: state.sel.map(s => s.id).join(","), b: state.b,
      unit: state.unit, ref: state.ref ? 1 : 0, logN: `${state.nMin},${state.nMax}` });
    history.replaceState(null, "", "#" + h.toString().replace(/%2C/g, ","));
  }

  // ---------------------------------------------------------------- curves
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

  // ---------------------------------------------------------------- figure
  let spec = null;
  const canvas = $("cogCanvas");
  const view = F.responsive(canvas, () => (spec = buildSpec()), w => Math.round(Math.min(w * 0.75, 620)),
                            { maxWidth: 900, minWidth: 300, after: attachHover });

  let readout = null;
  function attachHover(fig) {
    readout = document.createElement("div");
    readout.className = "readout"; readout.hidden = true;
    canvas.appendChild(readout);
    const svg = fig.svg;
    svg.style.touchAction = "pan-y";
    const hide = () => { readout.hidden = true; fig.overlay.innerHTML = ""; };
    svg.addEventListener("pointerleave", hide);
    svg.addEventListener("pointermove", ev => {
      const r = svg.getBoundingClientRect();
      const sx = (ev.clientX - r.left) * fig.W / r.width, sy = (ev.clientY - r.top) * fig.H / r.height;
      const px = sx - fig.margin.l, py = sy - fig.margin.t;
      const solid = spec.lines.filter(L => L.id);
      if (px < 0 || px > fig.pw || py < 0 || py > fig.ph || !solid.length) return hide();
      const k = Math.max(0, Math.min(solid[0].x.length - 1, Math.round((fig.x.invert(px) - state.nMin) / STEP)));
      const xv = solid[0].x[k];
      const ns = "http://www.w3.org/2000/svg";
      fig.overlay.innerHTML = "";
      const vl = document.createElementNS(ns, "line");
      Object.entries({ x1: fig.x(xv), x2: fig.x(xv), y1: 0, y2: fig.ph, stroke: "#777", "stroke-width": 0.7, "stroke-dasharray": "2 2" })
        .forEach(([a, v]) => vl.setAttribute(a, v));
      fig.overlay.appendChild(vl);
      const unit = UNIT_HTML[state.unit];
      let html = `log&thinsp;<i>N</i> = ${xv.toFixed(2)}&ensp;(<i>b</i> = ${fmtB(state.b)})`;
      for (const L of solid) {
        const yv = L.y[k];
        if (yv > 0 && yv >= fig.y.domain()[0] && yv <= fig.y.domain()[1]) {
          const c = document.createElementNS(ns, "circle");
          Object.entries({ cx: fig.x(xv), cy: fig.y(yv), r: 3.2, fill: L.color, stroke: "#fff", "stroke-width": 1 })
            .forEach(([a, v]) => c.setAttribute(a, v));
          fig.overlay.appendChild(c);
        }
        html += `<br><span class="sw" style="border-color:${L.color}"></span>${C.lineHTML(BY_ID.get(L.id))}: ` +
                `<i>W</i><sub>r</sub> = ${C.sig(yv, 3)} ${unit}`;
      }
      readout.innerHTML = html;
      readout.hidden = false;
      const cr = canvas.getBoundingClientRect();
      const left = ev.clientX - cr.left, top = ev.clientY - cr.top;
      const w = readout.offsetWidth, h = readout.offsetHeight;
      readout.style.left = `${left + 14 + w > cr.width ? left - 14 - w : left + 14}px`;
      readout.style.top = `${Math.max(0, Math.min(cr.height - h, top - h / 2))}px`;
    });
  }

  F.exportButtons($("cogTools"), () => buildSpec(), "curve_of_growth");
  window.CGM_PAGE = { spec: () => buildSpec() };       // for tests / console use

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
    const N = Math.pow(10, state.statN);
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
        `. Hover over the figure to read off values.`
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
    requestAnimationFrame(() => { pending = false; view.draw(); renderStats(); writeHash(); });
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

  // ---------------------------------------------------------------- wire up
  readHash();
  populateIonSelect();
  state.ion = state.sel.length ? BY_ID.get(state.sel[0].id).ion : "O VI";
  $("ionSel").value = state.ion;
  $("bRange").value = Math.min(150, state.b); $("bNum").value = state.b;
  $("refB").checked = state.ref; $("unit").value = state.unit;
  $("nMin").value = state.nMin; $("nMax").value = state.nMax;

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
    if (isFinite(a) && isFinite(b) && b - a >= 1) { state.nMin = a; state.nMax = b; update(); }
    else { $("nMin").value = state.nMin; $("nMax").value = state.nMax; }
  });
  $("statN").addEventListener("input", e => { const v = +e.target.value; if (isFinite(v)) { state.statN = v; renderStats(); } });

  renderList();
  document.fonts.ready.then(() => update());   // legend widths need the real font metrics
  update();
})();
