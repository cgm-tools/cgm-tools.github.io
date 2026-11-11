# cgm-tools.github.io

Quick-look tools for circumgalactic-medium (CGM) absorption-line spectroscopy, live at
<https://cgm-tools.github.io>:

- **Curve of growth** (`cog.html`): W_r against log N for up to six transitions, with any Doppler b,
  reference curves at b = 10/30/100 km/s, a hover read-out, a parameter table, and PNG/PDF export.
- **Ions & lines** (`ions.html`): an ionization-energy ladder and a table of NIST ionization energies, Gnat &
  Sternberg (2007) CIE peak temperatures and resonance lines for 20 elements.

The site is static (GitHub Pages), with no build step at deploy time.

## Where the numbers come from

All atomic data are generated from unedited copies of the original tables in `sources/`
(see [`sources/README.md`](sources/README.md) for citations, URLs and caveats):

| Quantity | Source |
|---|---|
| λ, f, Γ for λ > 912 Å | Morton (2003, ApJS 149, 205) |
| EUV/X-ray lines, Ca II | Verner, Verner & Ferland (1996, ADNDT 64, 1) |
| alternative f (annotation only) | Cashman et al. (2017, ApJS 230, 8) |
| ionization energies | NIST Atomic Spectra Database |
| CIE peak temperatures | Gnat & Sternberg (2007, ApJS 168, 213) |

[`DATA_CHANGES.md`](DATA_CHANGES.md) lists every value that changed from the first version of the site, and
[`sources/crosscheck_report.txt`](sources/crosscheck_report.txt) lists where the compilations disagree.

## Layout

```
index.html cog.html ions.html     pages
assets/css/site.css               LaTeX-article styling (CMU Serif)
assets/js/physics.js              Voigt (Humlicek 1982 W4), tau0, a, W(N, b)
assets/js/mplfig.js               matplotlib-style SVG figures + PNG/PDF export (D3 scales)
assets/js/common.js, cog.js, ions.js
data/lines.js, data/ions.js       GENERATED: do not edit; CSV copies alongside
scripts/line_selection.txt        the curated line list (edit this to add lines)
scripts/build_data.py             sources/ -> data/  (Python standard library only)
scripts/compare_legacy.py         writes DATA_CHANGES.md
scripts/make_reference_cog.py     scipy reference W(N, b) for the tests
tests/physics.html                open in a browser: physics.js vs analytic limits and scipy
sources/                          raw source tables + README
```

## Rebuilding

```bash
python3 scripts/build_data.py           # regenerate data/ and sources/crosscheck_report.txt
python3 scripts/compare_legacy.py       # regenerate DATA_CHANGES.md
python scripts/make_reference_cog.py    # needs numpy + scipy; regenerates tests/reference_cog.js
python3 -m http.server                  # then open http://localhost:8000/tests/physics.html
```

To add a transition, add a row to `scripts/line_selection.txt` and rerun `build_data.py`. The build stops
if the line is not found in the source tables.
