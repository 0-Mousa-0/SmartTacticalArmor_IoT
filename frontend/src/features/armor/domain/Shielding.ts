export type Material = 'bi2o3' | 'pbo' | 'mgo';
export type Beam = 'xray' | 'am241' | 'cs137';

export interface AttenuationPoint {
  concentration: number;
  mu: number;
  hvl: number;
  mfp: number;
  approximate: boolean;
}

export interface ShieldingDataset {
  source: string;
  materials: Record<Material, { label: string; formula: string }>;
  beams: Record<Beam, { label: string; energyKev: number | null }>;
  concentrations: number[];
  series: { material: Material; beam: Beam; points: AttenuationPoint[] }[];
}

export interface ShieldingInput {
  material: Material;
  beam: Beam;
  concentration: number;
  thicknessCm: number;
  incidentDoseUsvh: number | null;
}

export interface ShieldingEstimate {
  mu: number;
  transmission: number;
  attenuationPct: number;
  hvlCm: number;
  tvlCm: number;
  mfpCm: number;
  transmittedDoseUsvh: number | null;
  approximate: boolean;
}

export interface ArmorRepository {
  dataset(): Promise<ShieldingDataset>;
  estimate(input: ShieldingInput): Promise<ShieldingEstimate>;
}

export const MATERIAL_COLORS: Record<Material, string> = {
  bi2o3: '#35d0ba',
  pbo: '#f5b94f',
  mgo: '#a78bfa',
};
