import { useState, type FormEvent } from 'react';
import { useI18n } from '@/core/i18n/useI18n';
import type { Unit } from '@/features/units/domain/Unit';
import { Button, CheckboxField, FormError, FormGrid, Modal, SelectField, TextField, useErrorMessage, useToast } from '@/shared/ui';
import { useSavePersonnel, useSaveVest } from '../application/hooks';
import type { Personnel, PersonnelInput } from '../domain/Fleet';

const BLOOD_TYPES = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

export function VestFormModal({ open, vest, personnel, onClose }: { open: boolean; vest: Unit | null; personnel: Personnel[]; onClose: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const save = useSaveVest();
  const [code, setCode] = useState(vest?.code ?? '');
  const [name, setName] = useState(vest?.name ?? '');
  const [simulated, setSimulated] = useState(vest?.isSimulated ?? false);
  const [wearer, setWearer] = useState(vest?.wearer?.id ?? '');
  const [error, setError] = useState<string | null>(null);

  // A person can wear one vest: offer the unassigned ones plus the current wearer.
  const choices = personnel.filter((p) => p.isActive && (!p.deviceId || p.deviceId === vest?.id));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    save.mutate(
      {
        id: vest?.id,
        input: {
          ...(vest ? {} : { deviceCode: code.trim().toUpperCase() }),
          displayName: name.trim() || undefined,
          isSimulated: simulated,
          personnelId: wearer || null,
        },
      },
      {
        onSuccess: () => {
          toast.show(t('fleet.saved'), 'success');
          onClose();
        },
        onError: (err) => setError(errorMessage(err)),
      },
    );
  };

  return (
    <Modal
      open={open}
      title={vest ? t('fleet.editVest') : t('fleet.registerVest')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" type="submit" form="vest-form" loading={save.isPending} disabled={!vest && !code.trim()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <form id="vest-form" onSubmit={submit}>
        <FormGrid>
          <TextField label={t('fleet.deviceCode')} hint={t('fleet.deviceCodeHint')} value={code} onChange={(e) => setCode(e.target.value)} disabled={Boolean(vest)} dir="ltr" placeholder="STA-01" full />
          <TextField label={t('fleet.displayName')} value={name} onChange={(e) => setName(e.target.value)} />
          <SelectField label={t('fleet.wearer')} value={wearer} onChange={(e) => setWearer(e.target.value)}>
            <option value="">{t('fleet.unassigned')}</option>
            {choices.map((person) => (
              <option key={person.id} value={person.id}>
                {person.callsign} — {person.fullName}
              </option>
            ))}
          </SelectField>
          <CheckboxField label={t('fleet.simulated')} checked={simulated} onChange={setSimulated} />
        </FormGrid>
        <div style={{ marginTop: 12 }}>
          <FormError message={error} />
        </div>
      </form>
    </Modal>
  );
}

export function PersonnelFormModal({ open, person, onClose }: { open: boolean; person: Personnel | null; onClose: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const save = useSavePersonnel();
  const [form, setForm] = useState({
    callsign: person?.callsign ?? '',
    fullName: person?.fullName ?? '',
    rank: person?.rank ?? '',
    unitName: person?.unitName ?? '',
    bloodType: person?.bloodType ?? '',
    zone: person?.zone ?? '',
    postLat: person?.postLat?.toString() ?? '',
    postLng: person?.postLng?.toString() ?? '',
    notes: person?.notes ?? '',
  });
  const [error, setError] = useState<string | null>(null);
  const set = (key: keyof typeof form) => (value: string) => setForm((current) => ({ ...current, [key]: value }));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    const input: PersonnelInput = {
      callsign: form.callsign.trim(),
      fullName: form.fullName.trim(),
      rank: form.rank.trim() || null,
      unitName: form.unitName.trim() || null,
      bloodType: form.bloodType || null,
      zone: form.zone.trim() || null,
      postLat: form.postLat.trim() === '' ? null : Number(form.postLat),
      postLng: form.postLng.trim() === '' ? null : Number(form.postLng),
      notes: form.notes.trim() || null,
    };
    save.mutate(
      { id: person?.id, input },
      {
        onSuccess: () => {
          toast.show(t('fleet.saved'), 'success');
          onClose();
        },
        onError: (err) => setError(errorMessage(err)),
      },
    );
  };

  return (
    <Modal
      open={open}
      title={person ? t('fleet.editPerson') : t('fleet.addPerson')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" type="submit" form="personnel-form" loading={save.isPending} disabled={!form.callsign.trim() || !form.fullName.trim()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <form id="personnel-form" onSubmit={submit}>
        <FormGrid>
          <TextField label={t('fleet.callsign')} value={form.callsign} onChange={(e) => set('callsign')(e.target.value)} dir="ltr" placeholder="ALPHA-07" />
          <TextField label={t('fleet.fullName')} value={form.fullName} onChange={(e) => set('fullName')(e.target.value)} />
          <TextField label={t('fleet.rank')} value={form.rank} onChange={(e) => set('rank')(e.target.value)} />
          <TextField label={t('fleet.team')} value={form.unitName} onChange={(e) => set('unitName')(e.target.value)} />
          <SelectField label={t('fleet.bloodType')} value={form.bloodType} onChange={(e) => set('bloodType')(e.target.value)}>
            <option value="">—</option>
            {BLOOD_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </SelectField>
          <TextField label={t('fleet.zone')} value={form.zone} onChange={(e) => set('zone')(e.target.value)} />
          <TextField label={t('fleet.postLat')} type="number" step="0.0001" value={form.postLat} onChange={(e) => set('postLat')(e.target.value)} dir="ltr" placeholder="24.7136" />
          <TextField label={t('fleet.postLng')} type="number" step="0.0001" value={form.postLng} onChange={(e) => set('postLng')(e.target.value)} dir="ltr" placeholder="46.6753" />
          <TextField label={t('fleet.notes')} value={form.notes} onChange={(e) => set('notes')(e.target.value)} full />
        </FormGrid>
        <div style={{ marginTop: 12 }}>
          <FormError message={error} />
        </div>
      </form>
    </Modal>
  );
}
