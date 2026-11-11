/* mplfig.js -- matplotlib/LaTeX-looking SVG figures (needs D3 v7 for scales).
 *
 *   const fig = MplFig.render(containerEl, spec, {width, height});
 *   MplFig.exportPNG(spec, "name.png");  MplFig.exportPDF(spec, "name.pdf");
 *
 * spec = {
 *   margin: {l, r, t, b},
 *   x: {scale: "linear"|"log", lim: [a, b], label: markup},
 *   y: {scale: ..., lim: [...], label: markup, ticks: [{v, label}], minor: false, invert: false},
 *   x2: {fromX: E => lambda, toX: lambda => E, label}       // optional secondary top axis
 *   lines:  [{x: [], y: [], color, lw, ls: "-"|"--"|":"|"-.", label}],
 *   barh:   [{y, x0, x1, h (in y data units), color, title}],
 *   vlines: [{x, color, ls, lw, text}],  hlines: [{y, color, lw}],
 *   legend: {loc: "upper left"|..., entries: [{label, color, ls, lw, patch}]},   (or legends: [...])
 * }
 * markup: plain text with *italic*, ^{sup}, _{sub}, ~SC~ (ApJ small-caps numerals).
 */
(function (root) {
  "use strict";
  const NS = "http://www.w3.org/2000/svg";
  const FONT = "CMU Serif";
  const FONT_STACK = `"CMU Serif", "Latin Modern Roman", "Times New Roman", serif`;
  // matplotlib "seaborn-v0_8-colorblind" colours, re-ordered so every adjacent
  // pair stays distinct under protan/deutan simulation (worst dE 15.8).
  const CYCLE = ["#0072B2", "#D55E00", "#CC79A7", "#E69F00", "#56B4E9", "#009E73"];
  const DASH = { "-": null, "--": [3.7, 1.6], ":": [1, 1.65], "-.": [6.4, 1.6, 1, 1.6] };  // x linewidth
  const FS = { tick: 13, label: 14.5, legend: 12.5, text: 11.5 };
  const TICK = { major: 4.9, minor: 2.8, pad: 4.9 };
  const FONT_URLS = {
    woff2: {
      normal: "https://cdn.jsdelivr.net/npm/computer-modern@0.1.3/fonts/cmu-serif-500-roman.woff2",
      italic: "https://cdn.jsdelivr.net/npm/computer-modern@0.1.3/fonts/cmu-serif-500-italic.woff2",
    },
    ttf: {
      normal: "https://cdn.jsdelivr.net/npm/computer-modern@0.1.3/fonts/cmu-serif-500-roman.ttf",
      italic: "https://cdn.jsdelivr.net/npm/computer-modern@0.1.3/fonts/cmu-serif-500-italic.ttf",
    },
  };
  const LIBS = {
    jspdf: "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js",
    svg2pdf: "https://cdn.jsdelivr.net/npm/svg2pdf.js@2.2.3/dist/svg2pdf.umd.min.js",
  };
  let uid = 0;

  // ------------------------------------------------------------------ markup
  function parseMarkup(s) {
    if (Array.isArray(s)) return s;
    s = String(s ?? "");
    const segs = [];
    let it = false, sc = false, buf = "";
    const push = () => { if (buf) { segs.push({ t: buf, it, sc }); buf = ""; } };
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === "*") { push(); it = !it; continue; }
      if (c === "~") { push(); sc = !sc; continue; }
      if ((c === "^" || c === "_") && s[i + 1] === "{") {
        push();
        const j = s.indexOf("}", i + 2);
        for (const seg of parseMarkup(s.slice(i + 2, j)))
          segs.push({ ...seg, it: seg.it || it, sc: seg.sc || sc, pos: c === "^" ? "sup" : "sub" });
        i = j;
        continue;
      }
      buf += c;
    }
    push();
    return segs;
  }

  /** markup -> HTML (for tables, captions, read-outs). */
  function markupHTML(s) {
    return parseMarkup(s).map(seg => {
      let t = (seg.sc ? seg.t.toUpperCase() : seg.t).replace(/&/g, "&amp;").replace(/</g, "&lt;");
      if (seg.sc) t = `<span class="num">${t}</span>`;
      if (seg.it) t = `<i>${t}</i>`;
      if (seg.pos) t = `<${seg.pos}>${t}</${seg.pos}>`;
      return t;
    }).join("");
  }

  function el(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs || {}) if (attrs[k] != null) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  function text(parent, x, y, markup, size, attrs = {}) {
    const t = el("text", { x, y, "font-size": size, "xml:space": "preserve", ...attrs }, parent);
    t.style.whiteSpace = "pre";
    let shift = 0;
    for (const seg of parseMarkup(markup)) {
      let fs = size, dy = 0;
      if (seg.pos === "sup") { fs = size * 0.7; dy = -size * 0.4; }
      if (seg.pos === "sub") { fs = size * 0.7; dy = size * 0.25; }
      if (seg.sc) fs *= 0.78;
      const ts = el("tspan", { "font-size": +fs.toFixed(2) }, t);
      if (seg.it) ts.setAttribute("font-style", "italic");
      if (dy !== shift) { ts.setAttribute("dy", +(dy - shift).toFixed(2)); shift = dy; }
      ts.textContent = seg.sc ? seg.t.toUpperCase() : seg.t;
    }
    if (shift) {                                  // return to the baseline (keeps later tspans honest)
      const ts = el("tspan", { dy: +(-shift).toFixed(2), "font-size": size }, t);
      ts.textContent = "​";
    }
    return t;
  }

  // ------------------------------------------------------------------ ticks
  const MINUS = "−";
  const fmtSigned = v => (v < 0 ? MINUS : "") + Math.abs(v);

  function logTicks(lo, hi) {
    const d0 = Math.floor(Math.log10(lo) + 1e-9), d1 = Math.ceil(Math.log10(hi) - 1e-9);
    const nd = d1 - d0, step = Math.max(1, Math.ceil(nd / 9));
    const major = [], minor = [];
    for (let d = d0; d <= d1; d++) {
      const v = Math.pow(10, d);
      const isMaj = ((d % step) + step) % step === 0;
      if (v >= lo * (1 - 1e-9) && v <= hi * (1 + 1e-9)) (isMaj ? major : minor).push({ v, label: `10^{${fmtSigned(d)}}` });
      if (step === 1 && nd <= 14)
        for (let m = 2; m <= 9; m++) { const w = m * v; if (w >= lo && w <= hi) minor.push({ v: w }); }
    }
    if (major.length < 2 && nd <= 2) {            // short range: label 2x and 5x too (matplotlib-ish)
      minor.forEach(t => { const m = Math.round(t.v / Math.pow(10, Math.floor(Math.log10(t.v) + 1e-9)));
        if (m === 2 || m === 5) { t.label = `${m}×10^{${fmtSigned(Math.floor(Math.log10(t.v) + 1e-9))}}`; } });
      return { major: major.concat(minor.filter(t => t.label)), minor: minor.filter(t => !t.label) };
    }
    return { major, minor };
  }

  function linTicks(lo, hi, n = 6) {
    const vals = d3.ticks(lo, hi, n);
    const step = vals.length > 1 ? vals[1] - vals[0] : 1;
    const mant = +(step / Math.pow(10, Math.floor(Math.log10(step) + 1e-9))).toFixed(6);
    const ndiv = [1, 5, 10].includes(mant) ? 5 : 4;   // matplotlib AutoMinorLocator
    const dec = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
    const major = vals.map(v => ({ v, label: (v < 0 ? MINUS : "") + Math.abs(v).toFixed(dec) }));
    const minor = [];
    const first = vals[0] - step, last = vals[vals.length - 1] + step;
    for (let v = first; v <= last + 1e-9; v += step)
      for (let k = 1; k < ndiv; k++) { const w = v + k * step / ndiv; if (w > lo && w < hi) minor.push({ v: w }); }
    return { major, minor };
  }

  function scaleFor(ax, range) {
    const s = ax.scale === "log" ? d3.scaleLog() : d3.scaleLinear();
    return s.domain(ax.lim).range(range);
  }

  // ------------------------------------------------------------------ render
  function render(container, spec, size) {
    const W = Math.round(size.width), H = Math.round(size.height);
    const m = Object.assign({ l: 64, r: 16, t: 14, b: 50 }, spec.margin);
    const pw = W - m.l - m.r, ph = H - m.t - m.b;
    container.innerHTML = "";
    const svg = el("svg", {
      xmlns: NS, viewBox: `0 0 ${W} ${H}`, width: W, height: H,
      "font-family": FONT_STACK, fill: "#000", role: "img",
    }, container);
    if (spec.title) el("title", {}, svg).textContent = spec.title;
    el("rect", { x: 0, y: 0, width: W, height: H, fill: "#fff" }, svg);
    const g = el("g", { transform: `translate(${m.l},${m.t})` }, svg);
    const x = scaleFor(spec.x, [0, pw]);
    const y = scaleFor(spec.y, spec.y.invert ? [0, ph] : [ph, 0]);
    const clipId = `clip${++uid}`;
    el("rect", { x: 0, y: 0, width: pw, height: ph }, el("clipPath", { id: clipId }, el("defs", {}, svg)));
    const plot = el("g", { "clip-path": `url(#${clipId})` }, g);

    // --- artists
    for (const b of spec.barh || []) {
      const x0 = x(Math.max(b.x0, x.domain()[0])), x1 = x(Math.min(b.x1, x.domain()[1]));
      const hpx = Math.abs(y(1) - y(0)) * b.h;          // b.h in data units of y
      const r = el("rect", { x: Math.min(x0, x1), y: y(b.y) - hpx / 2, width: Math.abs(x1 - x0), height: hpx,
        fill: b.color, stroke: b.edge || "none", "stroke-width": b.edge ? 0.8 : null }, plot);
      if (b.title) el("title", {}, r).textContent = b.title;
    }
    for (const h of spec.hlines || [])
      el("line", { x1: 0, x2: pw, y1: y(h.y), y2: y(h.y), stroke: h.color || "#000", "stroke-width": h.lw || 0.8,
        "stroke-dasharray": dash(h.ls, h.lw || 0.8) }, plot);
    for (const v of spec.vlines || []) {
      el("line", { x1: x(v.x), x2: x(v.x), y1: 0, y2: ph, stroke: v.color || "#000", "stroke-width": v.lw || 0.8,
        "stroke-dasharray": dash(v.ls, v.lw || 0.8) }, plot);
      if (v.text) text(g, x(v.x) + 3, FS.text + 3, v.text, FS.text, { fill: v.color || "#000" });
    }
    for (const L of spec.lines || []) {
      const pts = [];
      for (let i = 0; i < L.x.length; i++) {
        const xv = L.x[i], yv = L.y[i];
        if (!(isFinite(xv) && isFinite(yv)) || (spec.y.scale === "log" && yv <= 0)) continue;
        pts.push(`${x(xv).toFixed(2)},${y(yv).toFixed(2)}`);
      }
      if (pts.length > 1)
        el("polyline", { points: pts.join(" "), fill: "none", stroke: L.color || CYCLE[0],
          "stroke-width": L.lw || 1.5, "stroke-dasharray": dash(L.ls, L.lw || 1.5),
          "stroke-linejoin": "round", "stroke-linecap": L.ls && L.ls !== "-" ? "butt" : "round" }, plot);
    }

    // --- frame + ticks (inward, all four sides)
    const axes = el("g", { stroke: "#000", "stroke-width": 0.8, fill: "none" }, g);
    el("rect", { x: 0, y: 0, width: pw, height: ph }, axes);
    const xt = spec.x.ticks ? { major: spec.x.ticks, minor: [] } :
      spec.x.scale === "log" ? logTicks(...x.domain()) : linTicks(...x.domain());
    const yt = spec.y.ticks ? { major: spec.y.ticks, minor: [] } :
      spec.y.scale === "log" ? logTicks(...minmax(y.domain())) : linTicks(...minmax(y.domain()));
    const tl = el("g", { "font-size": FS.tick }, g);
    const inX = v => { const p = x(v); return p >= -0.5 && p <= pw + 0.5; };
    const inY = v => { const p = y(v); return p >= -0.5 && p <= ph + 0.5; };
    for (const [t, len] of [...xt.major.map(t => [t, TICK.major]), ...(spec.x.minor === false ? [] : xt.minor.map(t => [t, TICK.minor]))]) {
      if (!inX(t.v)) continue;
      const px = x(t.v);
      el("line", { x1: px, x2: px, y1: ph, y2: ph - len }, axes);
      if (!spec.x2) el("line", { x1: px, x2: px, y1: 0, y2: len }, axes);
      if (t.label && len === TICK.major) text(tl, px, ph + TICK.pad + FS.tick * 0.95, t.label, FS.tick, { "text-anchor": "middle" });
    }
    for (const [t, len] of [...yt.major.map(t => [t, TICK.major]), ...(spec.y.minor === false ? [] : yt.minor.map(t => [t, TICK.minor]))]) {
      if (!inY(t.v)) continue;
      const py = y(t.v);
      el("line", { x1: 0, x2: len, y1: py, y2: py }, axes);
      el("line", { x1: pw, x2: pw - len, y1: py, y2: py }, axes);
      if (t.label && len === TICK.major) text(tl, -TICK.pad, py + FS.tick * 0.33, t.label, FS.tick, { "text-anchor": "end" });
    }
    if (spec.x2) {                                 // secondary top axis (same quantity, other units)
      const d = x.domain().map(spec.x2.fromX);
      const t2 = logTicks(...minmax(d));
      for (const [t, len] of [...t2.major.map(t => [t, TICK.major]), ...t2.minor.map(t => [t, TICK.minor])]) {
        const px = x(spec.x2.toX(t.v));
        if (px < -0.5 || px > pw + 0.5) continue;
        el("line", { x1: px, x2: px, y1: 0, y2: len }, axes);
        if (t.label && len === TICK.major) text(tl, px, -TICK.pad, t.label, FS.tick, { "text-anchor": "middle" });
      }
      if (spec.x2.label) text(g, pw / 2, -TICK.pad - FS.tick - 8, spec.x2.label, FS.label, { "text-anchor": "middle" });
    }
    if (spec.x.label) text(g, pw / 2, ph + TICK.pad + FS.tick + FS.label + 6, spec.x.label, FS.label, { "text-anchor": "middle" });
    if (spec.y.label) {
      const yl = text(g, 0, 0, spec.y.label, FS.label, { "text-anchor": "middle" });
      yl.setAttribute("transform", `translate(${-(spec.y.labelPad || 46)},${ph / 2}) rotate(-90)`);
    }
    for (const L of spec.legends || (spec.legend ? [spec.legend] : []))
      if (L.entries && L.entries.length) legend(g, L, pw, ph);
    const overlay = el("g", { "pointer-events": "none" }, g);
    return { svg, g, plot, overlay, x, y, pw, ph, margin: m, W, H };
  }

  function minmax(a) { return [Math.min(...a), Math.max(...a)]; }
  function dash(ls, lw) { const d = DASH[ls || "-"]; return d ? d.map(v => +(v * lw).toFixed(2)).join(" ") : null; }

  function legend(g, L, pw, ph) {
    const fs = FS.legend, pad = 0.4 * fs, hl = 2 * fs, gap = 0.8 * fs, rowH = fs * 1.35;
    const box = el("g", {}, g);
    const bg = el("rect", { rx: 0.2 * fs, fill: "#fff", "fill-opacity": 0.85, stroke: "#cccccc", "stroke-width": 0.8 }, box);
    let wmax = 0;
    L.entries.forEach((e, i) => {
      const cy = pad + rowH * (i + 0.5);
      if (e.patch) el("rect", { x: pad, y: cy - fs * 0.35, width: hl, height: fs * 0.7, fill: e.color, stroke: e.edge || "none" }, box);
      else el("line", { x1: pad, x2: pad + hl, y1: cy, y2: cy, stroke: e.color || "#000", "stroke-width": e.lw || 1.5,
        "stroke-dasharray": dash(e.ls, e.lw || 1.5) }, box);
      const t = text(box, pad + hl + gap, cy + fs * 0.33, e.label, fs);
      wmax = Math.max(wmax, textWidth(t, e.label, fs));
    });
    const bw = pad * 2 + hl + gap + wmax, bh = pad * 2 + rowH * L.entries.length;
    bg.setAttribute("width", bw.toFixed(1)); bg.setAttribute("height", bh.toFixed(1));
    const ax = 0.5 * fs, loc = L.loc || "upper left";
    const tx = loc.includes("right") ? pw - ax - bw : ax;
    const ty = loc.includes("lower") ? ph - ax - bh : ax;
    box.setAttribute("transform", `translate(${tx.toFixed(1)},${ty.toFixed(1)})`);
  }

  function textWidth(t, markup, fs) {
    try { const w = t.getComputedTextLength(); if (w > 0) return w; } catch (e) { /* detached */ }
    return parseMarkup(markup).reduce((s, seg) => s + seg.t.length * fs * (seg.pos ? 0.35 : 0.5), 0);
  }

  // ------------------------------------------------------------------ export
  const cache = {};
  async function fetchB64(url) {
    if (cache[url]) return cache[url];
    const buf = await (await fetch(url)).arrayBuffer();
    const bytes = new Uint8Array(buf);
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return (cache[url] = btoa(s));
  }
  function loadScript(src) {
    return new Promise((res, rej) => {
      if ([...document.scripts].some(s => s.src === src)) return res();
      const s = document.createElement("script");
      s.src = src; s.onload = res; s.onerror = () => rej(new Error("could not load " + src));
      document.head.appendChild(s);
    });
  }
  function offscreen(spec, size) {
    const div = document.createElement("div");
    div.style.cssText = `position:absolute;left:-20000px;top:0;width:${size.width}px`;
    document.body.appendChild(div);
    const fig = render(div, spec, size);
    return { div, fig };
  }
  function download(blob, name) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  const EXPORT_SIZE = s => ({ width: s?.width || 640, height: s?.height || 480 });  // matplotlib 6.4x4.8 in @100 dpi

  async function pngBlob(spec, size, scale = 3) {
    size = EXPORT_SIZE(size);
    await document.fonts.ready;
    const { div, fig } = offscreen(spec, size);
    try {
      const [r, i] = await Promise.all([fetchB64(FONT_URLS.woff2.normal), fetchB64(FONT_URLS.woff2.italic)]);
      const style = el("style", {}, null);
      style.textContent =
        `@font-face{font-family:"CMU Serif";font-style:normal;src:url(data:font/woff2;base64,${r}) format("woff2")}` +
        `@font-face{font-family:"CMU Serif";font-style:italic;src:url(data:font/woff2;base64,${i}) format("woff2")}`;
      fig.svg.insertBefore(style, fig.svg.firstChild);
      const xml = new XMLSerializer().serializeToString(fig.svg);
      const img = new Image();
      img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(xml);
      await img.decode();
      await new Promise(r => setTimeout(r, 60));
      const c = document.createElement("canvas");
      c.width = size.width * scale; c.height = size.height * scale;
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      return await new Promise(r => c.toBlob(r, "image/png"));
    } finally { div.remove(); }
  }

  async function pdfBlob(spec, size) {
    size = EXPORT_SIZE(size);
    await Promise.all([loadScript(LIBS.jspdf), document.fonts.ready]);
    await loadScript(LIBS.svg2pdf);
    const { jsPDF } = window.jspdf;
    const k = 0.72;                                  // 100 px/in -> 72 pt/in
    const doc = new jsPDF({ unit: "pt", format: [size.width * k, size.height * k],
      orientation: size.width > size.height ? "landscape" : "portrait", compress: true });
    const [r, i] = await Promise.all([fetchB64(FONT_URLS.ttf.normal), fetchB64(FONT_URLS.ttf.italic)]);
    doc.addFileToVFS("cmu-serif-roman.ttf", r); doc.addFont("cmu-serif-roman.ttf", FONT, "normal");
    doc.addFileToVFS("cmu-serif-italic.ttf", i); doc.addFont("cmu-serif-italic.ttf", FONT, "italic");
    doc.setFont(FONT, "normal");
    const { div, fig } = offscreen(spec, size);
    try {
      fig.svg.setAttribute("font-family", FONT);
      fig.svg.querySelectorAll("[font-family]").forEach(n => n.setAttribute("font-family", FONT));
      fig.svg.querySelectorAll("tspan").forEach(n => { if (n.textContent === "​") n.textContent = ""; });
      await doc.svg(fig.svg, { x: 0, y: 0, width: size.width * k, height: size.height * k });
      return doc.output("blob");
    } finally { div.remove(); }
  }

  async function exportPNG(spec, name, size) { download(await pngBlob(spec, size), name); }
  async function exportPDF(spec, name, size) { download(await pdfBlob(spec, size), name); }

  /** Attach "PNG" / "PDF" buttons; getSpec() is called at click time. */
  function exportButtons(container, getSpec, basename, getSize) {
    container.innerHTML = "";
    for (const kind of ["PNG", "PDF"]) {
      const b = document.createElement("button");
      b.className = "btn"; b.type = "button"; b.textContent = `Save ${kind}`;
      b.addEventListener("click", async () => {
        const old = b.textContent; b.disabled = true; b.textContent = "Saving…";
        try {
          const size = getSize ? getSize() : undefined;
          await (kind === "PNG" ? exportPNG : exportPDF)(getSpec(), `${basename}.${kind.toLowerCase()}`, size);
        } catch (e) { console.error(e); alert(`Export failed: ${e.message}`); }
        finally { b.disabled = false; b.textContent = old; }
      });
      container.appendChild(b);
    }
  }

  /** Re-render on container resize; returns {fig()} accessor. */
  function responsive(container, getSpec, aspect, opts = {}) {
    let fig = null, lastW = 0;
    const draw = () => {
      const w = Math.max(opts.minWidth || 300, Math.min(opts.maxWidth || 900, container.clientWidth || 640));
      const h = typeof aspect === "function" ? aspect(w) : w * aspect;
      fig = render(container, getSpec(w), { width: w, height: h });
      lastW = container.clientWidth;
      if (opts.after) opts.after(fig);
      return fig;
    };
    let t = null;
    new ResizeObserver(() => {
      if (Math.abs(container.clientWidth - lastW) < 2) return;
      clearTimeout(t); t = setTimeout(draw, 80);
    }).observe(container);
    return { draw, fig: () => fig };
  }

  root.MplFig = { render, responsive, exportPNG, exportPDF, pngBlob, pdfBlob, exportButtons,
                  parseMarkup, markupHTML, CYCLE, FS, logTicks, linTicks };
})(window);
