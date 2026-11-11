"""Parsers for the raw source tables in ../sources/.

Every number shown on the website is read from one of these files by
build_data.py; nothing is typed in by hand.  Standard library only.
"""
import csv
import math
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "sources"

MORTON = SRC / "morton2003_table2.txt"
VERNER = SRC / "verner1996_table1.txt"
CASHMAN = SRC / "cashman2017_table1.txt"
NIST_IE = SRC / "nist_asd_ionization_energies.csv"
GS07 = SRC / "gnat_sternberg2007_cie.tsv"

ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X",
         "XI", "XII", "XIII", "XIV", "XV", "XVI", "XVII", "XVIII", "XIX", "XX",
         "XXI", "XXII", "XXIII", "XXIV", "XXV", "XXVI", "XXVII", "XXVIII",
         "XXIX", "XXX", "XXXI"]
FROM_ROMAN = {r: i for i, r in enumerate(ROMAN) if r}

ELEMENTS = ["H", "He", "Li", "Be", "B", "C", "N", "O", "F", "Ne", "Na", "Mg",
            "Al", "Si", "P", "S", "Cl", "Ar", "K", "Ca", "Sc", "Ti", "V", "Cr",
            "Mn", "Fe", "Co", "Ni", "Cu", "Zn", "Ga"]
Z_OF = {el: i + 1 for i, el in enumerate(ELEMENTS)}

FLOAT = re.compile(r"^[+-]?(\d+\.?\d*|\.\d+)([Ee][+-]?\d+)?$")


def ion_name(el, stage):
    return f"{el} {ROMAN[stage]}"


def _f(tok):
    return float(tok) if tok is not None and FLOAT.match(tok) else None


# ---------------------------------------------------------------------------
# Morton (2003, ApJS 149, 205), Table 2 -- fixed-width AAS machine-readable
# table.  Columns: Mult | Air lambda | Vac lambda | Elow | Eup | gl gu | A |
# Gamma | f | log gf | log wf | Error.  Gamma may be blank.
# ---------------------------------------------------------------------------
_MORTON_HDR = re.compile(r"^([A-Z][a-z]?)\s*([IVX]+)\s")


def parse_morton(path=MORTON):
    out = []
    ion = None
    with open(path, encoding="latin-1") as fh:
        for lineno, raw in enumerate(fh, 1):
            s = raw.rstrip("\n")
            if not s.strip():
                continue
            iso = re.match(r"^(\d+)([A-Z][a-z]?)\s*([IVX]+)\s", s)
            m = _MORTON_HDR.match(s)
            if (iso or m) and ("GROUND" in s or "GRND" in s or "EXCITED" in s):
                # isotope-specific blocks (13C II, 26MgII, 40Ar I, ...) are kept but
                # tagged; build_data.py uses them only when no plain block exists.
                el, rom = (iso.group(2), iso.group(3)) if iso else (m.group(1), m.group(2))
                st = FROM_ROMAN.get(rom)
                ion = (el, st, iso.group(1) if iso else None) if el in Z_OF and st else None
                continue
            if re.match(r"^\d+[A-Z]", s):          # any other isotope header form
                ion = None
                continue
            mean = s.startswith("MltMean")
            if ion is None or (s[0] != " " and not mean):   # multiplet labels, page headers
                continue
            rec = _morton_dataline(" " * 7 + s[7:] if mean else s)
            if rec is None:
                continue
            rec.update(el=ion[0], stage=ion[1], isotope=ion[2], src="M03", lineno=lineno,
                       mean=mean)
            out.append(rec)
    _fill_mean_gamma(out)
    return out


def _fill_mean_gamma(recs):
    """Multiplet-mean rows carry no Gamma; take the largest Gamma of the
    J-components listed directly beneath them (same upper term)."""
    for i, r in enumerate(recs):
        if not r["mean"] or r["Gamma"] is not None:
            continue
        comps = []
        for c in recs[i + 1:]:
            if c["mean"] or (c["el"], c["stage"], c["isotope"]) != (r["el"], r["stage"], r["isotope"]):
                break
            comps.append(c)
        gam = [c["Gamma"] for c in comps if c["Gamma"]]
        if gam:
            r["Gamma"] = max(gam)


def _morton_dataline(s):
    toks = [(m.start(), m.group()) for m in re.finditer(r"\S+", s)]
    air = vac = None
    e_vals, g_vals = [], []
    A = G = f = loggf = logwf = None
    for st, t in toks:
        if st < 7:
            continue                                # multiplet number
        if 7 <= st < 18 and FLOAT.match(t):
            air = float(t)
        elif 18 <= st < 31 and FLOAT.match(t):
            vac = float(t)
        elif 31 <= st < 52 and FLOAT.match(t):
            e_vals.append(float(t))
        elif 52 <= st < 58 and t.isdigit():
            g_vals.append(int(t))
        elif 58 <= st < 67 and "E" in t:
            A = _f(t)
        elif 67 <= st < 77 and "E" in t:
            G = _f(t)
        elif 77 <= st < 87 and "E" in t:
            f = _f(t)
        elif 87 <= st < 96 and FLOAT.match(t) and loggf is None:
            loggf = float(t)
        elif 96 <= st < 103 and FLOAT.match(t) and logwf is None:
            logwf = float(t)
    if vac is None or f is None or len(e_vals) != 2 or len(g_vals) != 2:
        return None
    gl, gu = g_vals
    # sanity: the log(lambda f) column must agree with the parsed lambda and f
    # (catches column slips).  log(gf) is not used: a few Morton rows tabulate
    # it with g_u instead of g_l.
    if logwf is not None and abs(math.log10(vac * f) - logwf) > 0.02:
        raise ValueError(f"Morton column mismatch: {s!r}")
    return dict(wave=vac, wave_air=air, Elow=e_vals[0], Eup=e_vals[1],
                gl=gl, gu=gu, A=A, Gamma=G, f=f)


# ---------------------------------------------------------------------------
# Verner, Verner & Ferland (1996, ADNDT 64, 1), Table 1.  A multiplet header
# line (element, ion stage, configurations, term, multiplet-mean data) is
# followed by its J-resolved components.  Columns: lambda, Elow, Eup, gl, gu,
# A, f.
# ---------------------------------------------------------------------------
_V_NUMS = re.compile(r"(\d+\.\d+)\s+(\d+\.\d+)\s+(\d+\.\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\S+)")


def parse_verner(path=VERNER):
    out = []
    ion = None
    with open(path, encoding="latin-1") as fh:
        for lineno, raw in enumerate(fh, 1):
            if not raw.strip():
                continue
            mean = raw[0] != " "                    # multiplet header row = multiplet mean
            if mean:
                el = raw[0:2].strip()
                ion = (el, int(raw[2:4]))
            m = _V_NUMS.search(raw, 40 if mean else 0)
            if not m or ion is None:
                continue
            lam, elow, eup, gl, gu, A, f = m.groups()
            out.append(dict(el=ion[0], stage=ion[1], wave=float(lam), wave_air=None,
                            Elow=float(elow), Eup=float(eup), gl=int(gl), gu=int(gu),
                            A=float(A), Gamma=None, f=float(f), src="V96", lineno=lineno,
                            mean=mean))
    return out


# ---------------------------------------------------------------------------
# Cashman et al. (2017, ApJS 230, 8) -- revised f-values (CSV body).
# ---------------------------------------------------------------------------
def parse_cashman(path=CASHMAN):
    out = []
    with open(path, encoding="latin-1") as fh:
        rows = [l for l in fh if not l.startswith(";")]
    for row in csv.DictReader(rows):
        name = row["name"]                          # e.g. CII_1335, NI_1134p2
        m = re.match(r"([A-Z][a-z]?)([IVX]+)_", name)
        if not m:
            continue
        if int(row["Z"]) > len(ELEMENTS):           # Ge, Kr, Sn, ... not used here
            continue
        el = ELEMENTS[int(row["Z"]) - 1]
        stage = FROM_ROMAN[m.group(2)]
        wave = _f(row["wrest"]) or _f(row["wobs"])
        out.append(dict(el=el, stage=stage, wave=wave, f=float(row["f"]),
                        gl=int(row["gj"]), gu=int(row["gk"]),
                        grade=row["grade"].strip(), ref=row["Ref"].strip()))
    return out


# ---------------------------------------------------------------------------
# NIST ASD ionization energies (CSV, Excel-style ="..." quoting).
# Prefix/suffix "( )" = theoretical, "[ ]" = semi-empirical / interpolated.
# ---------------------------------------------------------------------------
def parse_nist_ie(path=NIST_IE):
    def clean(v):
        v = (v or "").strip()
        if v.startswith('="') and v.endswith('"'):
            v = v[2:-1]
        return v.replace('""', '"').strip('"')
    out = {}
    with open(path, encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            row = {k: clean(v) for k, v in row.items() if k}
            if not row.get("Sp. Name"):
                continue
            el, rom = row["Sp. Name"].split()
            stage = FROM_ROMAN[rom]
            ie = _f(row["Ionization Energy (eV)"])
            flag = {"(": "theoretical", "[": "semi-empirical"}.get(row.get("Prefix", ""), "")
            out[(el, stage)] = dict(el=el, Z=int(row["At. num"]), stage=stage,
                                    ie=ie, unc=_f(row.get("Uncertainty (eV)")),
                                    flag=flag, isoseq=row.get("Isoel. Seq.", ""),
                                    ground=row.get("Ground Level", ""),
                                    refs=row.get("References", ""))
    return out


# ---------------------------------------------------------------------------
# Gnat & Sternberg (2007, ApJS 168, 213) CIE ion fractions, VizieR TSV.
# Column names like "O5+/O" (charge 5 = O VI).
# ---------------------------------------------------------------------------
def parse_gs07(path=GS07):
    header, rows = None, []
    with open(path, encoding="utf-8") as fh:
        for raw in fh:
            if raw.startswith("#") or not raw.strip():
                continue
            parts = raw.rstrip("\n").split("\t")
            if header is None:
                header = [p.strip() for p in parts]
                continue
            if parts[0].strip().startswith("-") or not parts[0].strip().isdigit():
                continue
            rows.append([p.strip() for p in parts])
    iT = header.index("T")
    logT = [math.log10(float(r[iT])) for r in rows]
    fracs = {}
    for j, name in enumerate(header):
        m = re.match(r"([A-Z][a-z]?)(\d*)\+?/([A-Z][a-z]?)$", name)
        if not m:
            continue
        el, q = m.group(1), m.group(2)
        charge = int(q) if q else (0 if "+" not in name else 1)
        fracs[(el, charge + 1)] = [float(r[j]) for r in rows]
    return logT, fracs


def gs07_peak(logT, frac):
    """log T at the CIE maximum (ties -- the table is given to 2 sig. figs -- are averaged)."""
    fmax = max(frac)
    if fmax <= 0:
        return None, 0.0
    idx = [i for i, v in enumerate(frac) if v == fmax]
    if idx[0] == 0 or idx[-1] == len(frac) - 1:     # peak at the grid edge: not a real maximum
        return None, fmax
    return sum(logT[i] for i in idx) / len(idx), fmax
