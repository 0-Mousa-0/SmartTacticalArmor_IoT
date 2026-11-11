import type { Unit } from '@/features/units/domain/Unit';

export interface Personnel {
  id: string;
  callsign: string;
  fullName: string;
  rank: string | null;
  unitName: string | null;
  bloodType: string | null;
  zone: string | null;
  postLat: number | null;
  postLng: number | null;
  notes: string | null;
  isActive: boolean;
  deviceId: string | null;
  deviceCode: string | null;
}

export interface PersonnelInput {
  callsign: string;
  fullName: string;
  rank?: string | null;
  unitName?: string | null;
  bloodType?: string | null;
  zone?: string | null;
  postLat?: number | null;
  postLng?: number | null;
  notes?: string | null;
}

export interface VestInput {
  deviceCode?: string;
  displayName?: string;
  isSimulated?: boolean;
  /** null / '' = unassign */
  personnelId?: string | null;
  notes?: string | null;
}

export interface FleetRepository {
  listPersonnel(): Promise<Personnel[]>;
  createPersonnel(input: PersonnelInput): Promise<Personnel>;
  updatePersonnel(id: string, input: Partial<PersonnelInput>): Promise<Personnel>;
  deactivatePersonnel(id: string): Promise<void>;
  registerVest(input: VestInput): Promise<Unit>;
  updateVest(id: string, input: VestInput): Promise<Unit>;
  retireVest(id: string): Promise<void>;
}
