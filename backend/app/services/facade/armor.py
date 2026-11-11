"""Armor profile: the radiation-shielding research behind the vest."""
from app.services.analysis import shielding
from app.services.facade.errors import FacadeError


class ArmorFacadeMixin:
    def get_shielding_dataset(self) -> dict:
        return shielding.dataset()

    def estimate_shielding(self, data: dict) -> dict:
        try:
            return shielding.estimate(
                material=str(data.get("material", "")),
                beam=str(data.get("beam", "")),
                concentration_wt_pct=float(data.get("concentration_wt_pct")),
                thickness_cm=float(data.get("thickness_cm")),
                incident_dose_usvh=(float(data["incident_dose_usvh"])
                                    if data.get("incident_dose_usvh") not in (None, "") else None),
            )
        except (TypeError, ValueError) as error:
            raise FacadeError(str(error) or "invalid shielding parameters", 400) from None
