# Source data

Every number on the site is read from one of these files by `scripts/build_data.py`.
They are unedited copies of the original tables, all retrieved on 2026-11-11.

| File | What it is | Used for | Retrieved from |
|---|---|---|---|
| `morton2003_table2.txt` | Morton, D. C. 2003, ApJS, 149, 205, Table 2 (AAS machine-readable table) | λ, f, A, Γ, g, E_low for lines with λ > 911.75 Å | <https://content.cld.iop.org/journals/0067-0049/149/1/205/revision1/datafile2.txt> (byte-identical to the linetools copy `linetools/data/lines/morton03_table2.dat`, apart from the trailing newline) |
| `verner1996_table1.txt` | Verner, D. A., Verner, E. M., & Ferland, G. J. 1996, ADNDT, 64, 1, Table 1 | EUV/X-ray lines (λ < 912 Å) and Ca II; cross-check of Morton | <https://raw.githubusercontent.com/linetools/linetools/99e6dbe3ca0fd1f10476dbf1bed8482541692337/linetools/data/lines/verner96_tab1.txt> |
| `cashman2017_table1.txt` | Cashman, F. H., et al. 2017, ApJS, 230, 8 (machine-readable table) | Alternative f-values, shown as annotations when they differ from the adopted value by > 10% | <https://raw.githubusercontent.com/linetools/linetools/99e6dbe3ca0fd1f10476dbf1bed8482541692337/linetools/data/lines/cashman17.ascii> |
| `nist_asd_ionization_energies.csv` | NIST Atomic Spectra Database ionization energies (Kramida, Ralchenko, Reader & NIST ASD Team), H through Zn, all stages | Ionization and creation energies, isoelectronic sequence, ground level | `https://physics.nist.gov/cgi-bin/ASD/ie.pl?spectra=H-Zn&submit=Retrieve+Data&units=1&format=2&order=0&at_num_out=on&sp_name_out=on&ion_charge_out=on&el_name_out=on&seq_out=on&shells_out=on&conf_out=on&level_out=on&ion_conf_out=on&e_out=0&unc_out=on&biblio=on` |
| `gnat_sternberg2007_cie.tsv` | Gnat, O., & Sternberg, A. 2007, ApJS, 168, 213, CIE ion fractions (VizieR J/ApJS/168/213/ion_CIE) | Temperature of peak CIE ion fraction and the range above half the peak | `https://vizier.cfa.harvard.edu/viz-bin/asu-tsv?-source=J/ApJS/168/213/ion_CIE&-out.all&-out.max=unlimited` |

## Notes

- **Calcium is not in the Morton (2003) machine-readable table.** The publisher's file jumps from potassium to
  scandium, and so does the linetools copy. Ca II H & K therefore come from Verner et al. (1996).
- **Ar I** appears in Morton (2003) only under the isotope header `40Ar I` (99.6% of Ar), and that entry is used.
  Other isotope-specific blocks (13C, 24–26Mg, …) are ignored.
- **Γ.** Morton tabulates the total damping constant of the upper level for most lines. Where it is blank, and for
  all Verner lines, Γ is set to the sum of A over every transition out of the same upper level listed in the same
  file. This is a lower limit, flagged `gamma_flag = sumA` in `data/lines.csv`. Two Morton rows tabulate Γ < A, which
  is unphysical (Ar I 1048, Ti II 1910.95); they are treated the same way and listed in `crosscheck_report.txt`.
- **Multiplet means.** H I and the H-like X-ray lines (C VI, N VII, O VIII, Ne X), plus He II 303, use the multiplet
  mean, because their fine-structure components are unresolved. All other lines use the individual J components.
- **NIST notation.** NIST puts theoretical ionization energies in parentheses and semi-empirical ones in square
  brackets. The ion table keeps that notation.
- **Gnat & Sternberg (2007)** cover H, He, C, N, O, Ne, Mg, Si, S and Fe only. VizieR gives their fractions to two
  significant figures, so when several temperatures tie for the peak, their log T values are averaged.
