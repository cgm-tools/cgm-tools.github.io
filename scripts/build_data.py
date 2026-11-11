#!/usr/bin/env python3
"""Build the website's data files from the raw source tables.

    python3 scripts/build_data.py

Reads   sources/*  (Morton 2003, Verner+1996, Cashman+2017, NIST ASD, GS07)
        scripts/line_selection.txt
Writes  data/lines.js  data/lines.csv  data/ions.js  data/ions.csv
        sources/crosscheck_report.txt

Standard library only.  Fails loudly if a selected line is not found.
"""
import csv
import datetime
import json
import math
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import sources_io as S  # noqa: E402

ROOT = S.ROOT
DATA = ROOT / "data"
SELECTION = ROOT / "scripts" / "line_selection.txt"
LYMAN_LIMIT = 911.75          # Morton (2003) covers lambda > 911.75 A
TOL = 0.05                    # A, max |lambda_selection - lambda_source|
GREEK = {2: "α", 3: "β", 4: "γ", 5: "δ", 6: "ε", 7: "ζ", 8: "η", 9: "θ", 10: "ι"}

EL_NAMES = {"H": "Hydrogen", "He": "Helium", "C": "Carbon", "N": "Nitrogen",
            "O": "Oxygen", "Ne": "Neon", "Na": "Sodium", "Mg": "Magnesium",
            "Al": "Aluminium", "Si": "Silicon", "P": "Phosphorus", "S": "Sulfur",
            "Ar": "Argon", "Ca": "Calcium", "Ti": "Titanium", "Cr": "Chromium",
            "Mn": "Manganese", "Fe": "Iron", "Ni": "Nickel", "Zn": "Zinc"}


def read_selection():
    rows = []
    for n, raw in enumerate(open(SELECTION, encoding="utf-8"), 1):
        line = raw.split("#", 1)[0].strip()
        if not line:
            continue
        parts = line.split()
        el, rom, lam, group, opts = parts[0], parts[1], float(parts[2]), parts[3], set(parts[4:])
        if el not in S.Z_OF or rom not in S.FROM_ROMAN:
            sys.exit(f"line_selection.txt:{n}: bad ion {el} {rom}")
        rows.append(dict(el=el, stage=S.FROM_ROMAN[rom], lam=lam, group=group,
                         mean="mean" in opts, force_v96="V96" in opts, selline=n))
    return rows


def index(recs):
    idx = defaultdict(list)
    for r in recs:
        idx[(r["el"], r["stage"])].append(r)
    return idx


def find(idx, sel, allow_isotope):
    pool = [r for r in idx.get((sel["el"], sel["stage"]), [])
            if r["mean"] == sel["mean"] and abs(r["wave"] - sel["lam"]) < TOL]
    plain = [r for r in pool if not r.get("isotope")]
    if plain:
        pool = plain
    elif not allow_isotope:
        pool = []
    return min(pool, key=lambda r: abs(r["wave"] - sel["lam"])) if pool else None


def upper_level_gamma(idx, rec):
    """Sum of A over every tabulated transition out of the same upper level."""
    tot = 0.0
    for r in idx[(rec["el"], rec["stage"])]:
        if r["mean"] or r.get("isotope") != rec.get("isotope") or r["A"] is None:
            continue
        if abs(r["Eup"] - rec["Eup"]) <= max(0.5, 1e-6 * rec["Eup"]):
            tot += r["A"]
    return tot or rec["A"]


def label_for(el, stage, wave, excited, dup):
    ion = S.ion_name(el, stage) + ("*" if excited else "")
    if el == "H" and stage == 1:
        return None                              # set below (Ly-series)
    if wave < 100:
        w = f"{wave:.2f}"
    elif dup:
        w = f"{math.floor(wave * 10) / 10:.1f}"
    else:
        w = f"{int(wave)}"
    return f"{ion} {w}"


def main():
    morton, verner, cashman = S.parse_morton(), S.parse_verner(), S.parse_cashman()
    nist = S.parse_nist_ie()
    logT, gsfrac = S.parse_gs07()
    M, V = index(morton), index(verner)
    C = index(cashman)

    report = []
    rep = report.append
    sel_rows = read_selection()
    lines = []
    for sel in sel_rows:
        use_m = sel["lam"] > LYMAN_LIMIT and not sel["force_v96"]
        rec = find(M, sel, allow_isotope=True) if use_m else None
        fallback = False
        if rec is None:
            rec = find(V, sel, allow_isotope=False)
            fallback = use_m
        if rec is None:
            sys.exit(f"line_selection.txt:{sel['selline']}: {S.ion_name(sel['el'], sel['stage'])} "
                     f"{sel['lam']} not found in {'Morton 2003' if use_m else 'Verner+1996'}")
        idx = M if rec["src"] == "M03" else V
        gamma, gflag = rec["Gamma"], ""
        if rec["src"] == "M03" and gamma is not None and rec["A"] and gamma < 0.99 * rec["A"]:
            rep(f"[Gamma<A]  {S.ion_name(rec['el'], rec['stage'])} {rec['wave']}: Morton Gamma="
                f"{gamma:.3g} < A={rec['A']:.3g} (inconsistent); using Gamma = sum A from upper level")
            gamma = None
        if gamma is None:
            gamma = upper_level_gamma(idx, rec)
            gflag = "sumA"
        excited = rec["Elow"] > 0.5
        line = dict(el=rec["el"], Z=S.Z_OF[rec["el"]], stage=rec["stage"],
                    ion=S.ion_name(rec["el"], rec["stage"]),
                    wave=rec["wave"], wave_air=rec["wave_air"], f=rec["f"],
                    A=rec["A"], Gamma=gamma, gamma_flag=gflag,
                    gl=rec["gl"], gu=rec["gu"], Elow=rec["Elow"], Eup=rec["Eup"],
                    excited=excited, group=sel["group"], src=rec["src"],
                    src_line=rec["lineno"], mean=rec["mean"],
                    isotope=rec.get("isotope"))
        if fallback:
            rep(f"[fallback] {line['ion']} {rec['wave']}: not in Morton 2003 table; Verner+1996 used")
        if rec.get("isotope"):
            rep(f"[isotope]  {line['ion']} {rec['wave']}: Morton lists this ion only under "
                f"{rec['isotope']}{rec['el']}; that entry is used")

        # --- cross-check against the other compilations -------------------
        other = V if rec["src"] == "M03" else M
        cmp_ = [r for r in other.get((rec["el"], rec["stage"]), [])
                if r["mean"] == rec["mean"] and abs(r["wave"] - rec["wave"]) < 0.1
                and r["gl"] == rec["gl"] and not r.get("isotope")]
        if cmp_:
            o = min(cmp_, key=lambda r: abs(r["wave"] - rec["wave"]))
            line["f_other"] = dict(src=o["src"], f=o["f"])
            d = (o["f"] - rec["f"]) / rec["f"]
            if abs(d) > 0.10:
                rep(f"[M03/V96]  {line['ion']} {rec['wave']}: f({rec['src']})={rec['f']:.4g}  "
                    f"f({o['src']})={o['f']:.4g}  ({d:+.0%})")
        cc = [r for r in C.get((rec["el"], rec["stage"]), [])
              if r["wave"] and abs(r["wave"] - rec["wave"]) < TOL and r["gl"] == rec["gl"]]
        if cc:
            c = min(cc, key=lambda r: abs(r["wave"] - rec["wave"]))
            d = (c["f"] - rec["f"]) / rec["f"]
            if abs(d) > 0.10:
                line["alt_f"] = dict(src="C17", f=c["f"], grade=c["grade"], ref=c["ref"])
                rep(f"[Cashman]  {line['ion']} {rec['wave']}: f({rec['src']})={rec['f']:.4g}  "
                    f"f(C17)={c['f']:.4g} grade={c['grade'] or '-'} ref={c['ref']}  ({d:+.0%})")
        lines.append(line)

    # --- labels ------------------------------------------------------------
    byion = defaultdict(list)
    for l in lines:
        byion[(l["el"], l["stage"], l["excited"])].append(l)
    for key, ls in byion.items():
        trunc = [int(l["wave"]) if l["wave"] >= 100 else round(l["wave"], 2) for l in ls]
        for l, t in zip(ls, trunc):
            l["label"] = label_for(l["el"], l["stage"], l["wave"], l["excited"], trunc.count(t) > 1)
    for l in lines:
        if l["el"] == "H":
            n = round(math.sqrt(1 / (1 - 911.7633 / l["wave"])))      # upper principal quantum no.
            l["label"] = f"H I Ly{GREEK[n]}"
            l["upper_n"] = n
        wtag = str(int(l["wave"])) if l["el"] == "H" else l["label"].split()[-1].replace(".", "p")
        l["id"] = f"{l['el']}{S.ROMAN[l['stage']]}{'s' if l['excited'] else ''}_{wtag}"
    ids = [l["id"] for l in lines]
    dups = {i for i in ids if ids.count(i) > 1}
    if dups:
        sys.exit(f"duplicate line ids: {dups}")

    # --- ions --------------------------------------------------------------
    elements = []
    for l in lines:
        if l["el"] not in elements:
            elements.append(l["el"])
    elements.sort(key=lambda e: S.Z_OF[e])
    ions = []
    for el in elements:
        Z = S.Z_OF[el]
        for stage in range(1, Z + 2):
            nd = nist.get((el, stage))
            prev = nist.get((el, stage - 1))
            ion = dict(el=el, Z=Z, stage=stage, ion=S.ion_name(el, stage),
                       charge=stage - 1,
                       ie=nd["ie"] if nd else None,
                       ie_unc=nd["unc"] if nd else None,
                       ie_flag=nd["flag"] if nd else "",
                       ie_create=(prev["ie"] if prev else 0.0) if stage > 1 else 0.0,
                       isoseq=nd["isoseq"] if nd else "",
                       ground=nd["ground"] if nd else "",
                       nist_refs=nd["refs"] if nd else "",
                       n_lines=sum(1 for l in lines if l["el"] == el and l["stage"] == stage))
            if stage == Z + 1:
                ion["isoseq"] = "bare nucleus"
            frac = gsfrac.get((el, stage))
            if frac:
                tpk, fmax = S.gs07_peak(logT, frac)
                if tpk is not None:
                    above = [t for t, v in zip(logT, frac) if v >= 0.5 * fmax]
                    ion.update(logT_peak=round(tpk, 2), fmax=fmax,
                               logT_half=[round(min(above), 2), round(max(above), 2)])
            ions.append(ion)
    for (el, stage) in {(l["el"], l["stage"]) for l in lines}:
        if (el, stage) not in nist:
            sys.exit(f"NIST IE missing for {el} {stage}")

    # --- write ---------------------------------------------------------------
    DATA.mkdir(exist_ok=True)
    meta = dict(
        built=datetime.date.today().isoformat(),
        sources={
            "M03": "Morton 2003, ApJS 149, 205 (Table 2)",
            "V96": "Verner, Verner & Ferland 1996, ADNDT 64, 1 (Table 1)",
            "C17": "Cashman et al. 2017, ApJS 230, 8",
            "NIST": "NIST Atomic Spectra Database, ionization energies (Kramida et al.)",
            "GS07": "Gnat & Sternberg 2007, ApJS 168, 213 (CIE ion fractions)",
        },
        elements={e: EL_NAMES.get(e, e) for e in elements},
    )
    def clean(d):
        return {k: v for k, v in d.items() if v is not None and v != "" and v is not False}

    with open(DATA / "lines.js", "w", encoding="utf-8") as fh:
        fh.write("// GENERATED by scripts/build_data.py from sources/ -- do not edit by hand.\n")
        fh.write("window.CGM_META = " + json.dumps(meta, ensure_ascii=False) + ";\n")
        fh.write("window.CGM_LINES = [\n")
        for l in lines:
            fh.write("  " + json.dumps(clean(l), ensure_ascii=False) + ",\n")
        fh.write("];\n")
    with open(DATA / "ions.js", "w", encoding="utf-8") as fh:
        fh.write("// GENERATED by scripts/build_data.py from sources/ -- do not edit by hand.\n")
        fh.write("window.CGM_IONS = [\n")
        for i in ions:
            fh.write("  " + json.dumps(clean(i), ensure_ascii=False) + ",\n")
        fh.write("];\n")

    lcols = ["id", "label", "ion", "el", "Z", "stage", "wave", "wave_air", "f", "A", "Gamma",
             "gamma_flag", "gl", "gu", "Elow", "Eup", "excited", "group", "src", "src_line",
             "alt_f_C17"]
    with open(DATA / "lines.csv", "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(lcols)
        for l in lines:
            row = dict(l, alt_f_C17=l.get("alt_f", {}).get("f", ""))
            w.writerow([row.get(c, "") if row.get(c) is not None else "" for c in lcols])
    icols = ["ion", "el", "Z", "stage", "charge", "ie", "ie_unc", "ie_flag", "ie_create",
             "isoseq", "ground", "logT_peak", "n_lines", "nist_refs"]
    with open(DATA / "ions.csv", "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(icols)
        for i in ions:
            w.writerow([i.get(c, "") if i.get(c) is not None else "" for c in icols])

    hdr = [
        "Cross-check report -- generated by scripts/build_data.py",
        f"built {meta['built']}; {len(lines)} lines, {len(ions)} ion stages, {len(elements)} elements",
        "",
        "[M03/V96]  f-value differs by >10% between Morton 2003 and Verner+1996 (the site uses the first).",
        "[Cashman]  Cashman+2017 f differs by >10%; shown on the site as an annotation only.",
        "[fallback] line not in the Morton 2003 machine-readable table; Verner+1996 used instead.",
        "[Gamma<A]  Morton's tabulated Gamma is smaller than A (inconsistent); replaced.",
        "[isotope]  only an isotope-specific Morton block exists for the ion.",
        "Lines without a tabulated Gamma (all V96 lines and some M03 lines) use Gamma = sum of A",
        "over every transition out of the same upper level listed in the same source (a lower",
        "limit; gamma_flag = 'sumA').  This only matters on the damping part of the COG.",
        "",
    ]
    (S.SRC / "crosscheck_report.txt").write_text("\n".join(hdr + sorted(report)) + "\n", encoding="utf-8")
    nsrc = defaultdict(int)
    for l in lines:
        nsrc[l["src"]] += 1
    print(f"{len(lines)} lines ({dict(nsrc)}), {len(ions)} ions; {len(report)} report entries")


if __name__ == "__main__":
    main()
