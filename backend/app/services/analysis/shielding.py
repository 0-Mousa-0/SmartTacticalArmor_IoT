"""Radiation-shielding model of the vest's inner layer.

Uses the team's own laboratory measurements (SAIF competition report:
PMMA films doped with nano Bi2O3, PbO and MgO) of the linear attenuation
coefficient mu (cm^-1) for X-rays (Leybold 554 811, 30 kV) and gamma rays
from Am-241 (59.5 keV) and Cs-137 (662 keV).

Narrow-beam Beer-Lambert law (the report's equation 3):

    T = R / R0 = exp(-mu * x)      HVL = ln 2 / mu      MFP = 1 / mu

Data provenance, kept explicit so the dashboard never overstates accuracy:
* the 0.0167 wt% and 8.333 wt% values are stated in the report's text;
* the 0.167 / 1.667 / 4.167 wt% values are read from the report's figures
  (approximate);
* MgO at 59.5 keV and 0.0167 wt% is 0.034 cm^-1: the text prints 0.34, but
  the report's own MFP (29.6 cm) and HVL (20.53 cm) both give 0.034.
"""
import math

SOURCE = "SAIF competition report — PMMA nanocomposite shielding measurements"

MATERIALS = {
    "bi2o3": {"label": "Bi2O3 / PMMA", "formula": "Bi₂O₃", "molar_mass_g_mol": 465.96},
    "pbo": {"label": "PbO / PMMA", "formula": "PbO", "molar_mass_g_mol": 223.2},
    "mgo": {"label": "MgO / PMMA", "formula": "MgO", "molar_mass_g_mol": 40.3044},
}

BEAMS = {
    "xray": {"label": "X-ray (30 kV tube)", "energy_kev": None},
    "am241": {"label": "Gamma — Am-241", "energy_kev": 59.5},
    "cs137": {"label": "Gamma — Cs-137", "energy_kev": 662.0},
}

CONCENTRATIONS_WT_PCT = (0.0167, 0.167, 1.667, 4.167, 8.333)
REPORTED_INDEXES = (0, 4)  # values stated in the text; the others are read from figures

MU_CM: dict[tuple[str, str], tuple[float, ...]] = {
    ("bi2o3", "xray"): (0.84, 1.20, 2.60, 3.70, 5.03),
    ("pbo", "xray"): (0.61, 1.05, 2.60, 3.55, 4.80),
    ("mgo", "xray"): (0.57, 0.70, 1.05, 1.38, 1.70),
    ("bi2o3", "am241"): (0.37, 0.75, 1.60, 2.42, 3.30),
    ("pbo", "am241"): (0.32, 1.05, 1.50, 2.42, 2.90),
    ("mgo", "am241"): (0.034, 0.05, 0.14, 0.44, 0.65),
    ("bi2o3", "cs137"): (0.07, 0.16, 0.21, 0.48, 1.00),
    ("pbo", "cs137"): (0.06, 0.17, 0.26, 0.60, 0.98),
    ("mgo", "cs137"): (0.011, 0.02, 0.07, 0.19, 0.34),
}


def dataset() -> dict:
    series = []
    for (material, beam), mus in MU_CM.items():
        series.append({
            "material": material,
            "beam": beam,
            "points": [
                {
                    "concentration_wt_pct": conc,
                    "mu_cm": mu,
                    "hvl_cm": round(math.log(2) / mu, 3),
                    "mfp_cm": round(1 / mu, 3),
                    "approximate": index not in REPORTED_INDEXES,
                }
                for index, (conc, mu) in enumerate(zip(CONCENTRATIONS_WT_PCT, mus, strict=True))
            ],
        })
    return {
        "source": SOURCE,
        "materials": MATERIALS,
        "beams": BEAMS,
        "concentrations_wt_pct": list(CONCENTRATIONS_WT_PCT),
        "series": series,
    }


def linear_attenuation(material: str, beam: str, concentration_wt_pct: float) -> float:
    key = (material, beam)
    if key not in MU_CM:
        raise ValueError("unknown material or beam")
    for conc, mu in zip(CONCENTRATIONS_WT_PCT, MU_CM[key], strict=True):
        if math.isclose(conc, concentration_wt_pct, rel_tol=1e-3):
            return mu
    raise ValueError("concentration must be one of the measured values: "
                     + ", ".join(str(c) for c in CONCENTRATIONS_WT_PCT))


def estimate(material: str, beam: str, concentration_wt_pct: float, thickness_cm: float,
             incident_dose_usvh: float | None = None) -> dict:
    if not 0 < thickness_cm <= 10:
        raise ValueError("thickness_cm must be between 0 and 10")
    if incident_dose_usvh is not None and not 0 <= incident_dose_usvh <= 1e6:
        raise ValueError("incident_dose_usvh must be between 0 and 1e6")
    mu = linear_attenuation(material, beam, concentration_wt_pct)
    transmission = math.exp(-mu * thickness_cm)
    return {
        "material": material,
        "beam": beam,
        "concentration_wt_pct": concentration_wt_pct,
        "thickness_cm": thickness_cm,
        "mu_cm": mu,
        "transmission": round(transmission, 6),
        "attenuation_pct": round((1 - transmission) * 100, 2),
        "hvl_cm": round(math.log(2) / mu, 3),
        "tvl_cm": round(math.log(10) / mu, 3),
        "mfp_cm": round(1 / mu, 3),
        "incident_dose_usvh": incident_dose_usvh,
        "transmitted_dose_usvh": round(incident_dose_usvh * transmission, 4)
        if incident_dose_usvh is not None else None,
        "approximate": MU_CM[(material, beam)].index(mu) not in REPORTED_INDEXES,
    }
