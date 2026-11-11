import type { HttpClient } from '@/core/http/HttpClient';
import { toUnit, type DeviceViewDto } from '@/features/units/data/mappers';
import type { Unit } from '@/features/units/domain/Unit';
import type { FleetRepository, Personnel, PersonnelInput, VestInput } from '../domain/Fleet';

interface PersonnelDto {
  personnel_id: string;
  callsign: string;
  full_name: string;
  rank: string | null;
  unit_name: string | null;
  blood_type: string | null;
  zone: string | null;
  post_lat: number | null;
  post_lng: number | null;
  notes: string | null;
  is_active: boolean;
  device_id: string | null;
  device_code: string | null;
}

const toPersonnel = (dto: PersonnelDto): Personnel => ({
  id: dto.personnel_id,
  callsign: dto.callsign,
  fullName: dto.full_name,
  rank: dto.rank,
  unitName: dto.unit_name,
  bloodType: dto.blood_type,
  zone: dto.zone,
  postLat: dto.post_lat,
  postLng: dto.post_lng,
  notes: dto.notes,
  isActive: dto.is_active,
  deviceId: dto.device_id,
  deviceCode: dto.device_code,
});

/** Only the fields the caller actually set are sent (PATCH semantics). */
function personnelBody(input: Partial<PersonnelInput>): Record<string, unknown> {
  const map: Record<keyof PersonnelInput, string> = {
    callsign: 'callsign',
    fullName: 'full_name',
    rank: 'rank',
    unitName: 'unit_name',
    bloodType: 'blood_type',
    zone: 'zone',
    postLat: 'post_lat',
    postLng: 'post_lng',
    notes: 'notes',
  };
  return Object.fromEntries(
    (Object.keys(input) as (keyof PersonnelInput)[]).filter((key) => input[key] !== undefined).map((key) => [map[key], input[key]]),
  );
}

function vestBody(input: VestInput): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (input.deviceCode !== undefined) body.device_code = input.deviceCode;
  if (input.displayName !== undefined) body.display_name = input.displayName;
  if (input.isSimulated !== undefined) body.is_simulated = input.isSimulated;
  if (input.personnelId !== undefined) body.personnel_id = input.personnelId ?? '';
  if (input.notes !== undefined) body.notes = input.notes;
  return body;
}

export class FleetApi implements FleetRepository {
  constructor(private readonly http: HttpClient) {}

  async listPersonnel(): Promise<Personnel[]> {
    return (await this.http.get<PersonnelDto[]>('/personnel')).map(toPersonnel);
  }

  async createPersonnel(input: PersonnelInput): Promise<Personnel> {
    return toPersonnel(await this.http.post<PersonnelDto>('/personnel', personnelBody(input)));
  }

  async updatePersonnel(id: string, input: Partial<PersonnelInput>): Promise<Personnel> {
    return toPersonnel(await this.http.patch<PersonnelDto>(`/personnel/${encodeURIComponent(id)}`, personnelBody(input)));
  }

  async deactivatePersonnel(id: string): Promise<void> {
    await this.http.delete(`/personnel/${encodeURIComponent(id)}`);
  }

  async registerVest(input: VestInput): Promise<Unit> {
    return toUnit(await this.http.post<DeviceViewDto>('/devices', vestBody(input)));
  }

  async updateVest(id: string, input: VestInput): Promise<Unit> {
    return toUnit(await this.http.patch<DeviceViewDto>(`/devices/${encodeURIComponent(id)}`, vestBody(input)));
  }

  async retireVest(id: string): Promise<void> {
    await this.http.delete(`/devices/${encodeURIComponent(id)}`);
  }
}
