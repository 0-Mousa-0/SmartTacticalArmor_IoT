import type { HttpClient } from '@/core/http/HttpClient';
import type { ArmorRepository, Beam, Material, ShieldingDataset, ShieldingEstimate, ShieldingInput } from '../domain/Shielding';

interface DatasetDto {
  source: string;
  materials: Record<Material, { label: string; formula: string }>;
  beams: Record<Beam, { label: string; energy_kev: number | null }>;
  concentrations_wt_pct: number[];
  series: {
    material: Material;
    beam: Beam;
    points: { concentration_wt_pct: number; mu_cm: number; hvl_cm: number; mfp_cm: number; approximate: boolean }[];
  }[];
}

interface EstimateDto {
  mu_cm: number;
  transmission: number;
  attenuation_pct: number;
  hvl_cm: number;
  tvl_cm: number;
  mfp_cm: number;
  transmitted_dose_usvh: number | null;
  approximate: boolean;
}

export class ArmorApi implements ArmorRepository {
  constructor(private readonly http: HttpClient) {}

  async dataset(): Promise<ShieldingDataset> {
    const dto = await this.http.get<DatasetDto>('/armor/shielding');
    const beams = Object.fromEntries(
      Object.entries(dto.beams).map(([key, beam]) => [key, { label: beam.label, energyKev: beam.energy_kev }]),
    ) as ShieldingDataset['beams'];
    return {
      source: dto.source,
      materials: dto.materials,
      beams,
      concentrations: dto.concentrations_wt_pct,
      series: dto.series.map((s) => ({
        material: s.material,
        beam: s.beam,
        points: s.points.map((p) => ({
          concentration: p.concentration_wt_pct,
          mu: p.mu_cm,
          hvl: p.hvl_cm,
          mfp: p.mfp_cm,
          approximate: p.approximate,
        })),
      })),
    };
  }

  async estimate(input: ShieldingInput): Promise<ShieldingEstimate> {
    const dto = await this.http.post<EstimateDto>('/armor/shielding/estimate', {
      material: input.material,
      beam: input.beam,
      concentration_wt_pct: input.concentration,
      thickness_cm: input.thicknessCm,
      incident_dose_usvh: input.incidentDoseUsvh,
    });
    return {
      mu: dto.mu_cm,
      transmission: dto.transmission,
      attenuationPct: dto.attenuation_pct,
      hvlCm: dto.hvl_cm,
      tvlCm: dto.tvl_cm,
      mfpCm: dto.mfp_cm,
      transmittedDoseUsvh: dto.transmitted_dose_usvh,
      approximate: dto.approximate,
    };
  }
}
