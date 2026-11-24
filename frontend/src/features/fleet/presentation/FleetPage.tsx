import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useDataSource } from '@/app/di/dataSource';
import { useI18n } from '@/core/i18n/useI18n';
import { useAuth } from '@/features/auth/application/authContext';
import { useUnits } from '@/features/units/application/hooks';
import type { Unit } from '@/features/units/domain/Unit';
import { isAdmin } from '@/shared/domain/types';
import { Badge, Button, Card, ConfirmDialog, ConnectionPill, EmptyState, ErrorState, PageHeader, SegmentedControl, SimulatedBadge, Skeleton, useErrorMessage, useToast, uiStyles } from '@/shared/ui';
import { useDeactivatePersonnel, usePersonnel, useRetireVest } from '../application/hooks';
import type { Personnel } from '../domain/Fleet';
import { PersonnelFormModal, VestFormModal } from './FleetForms';

type Tab = 'vests' | 'personnel';
type Editing<T> = { open: boolean; item: T | null };

export default function FleetPage() {
  const { t, fmt } = useI18n();
  const { operator } = useAuth();
  // The simulated fleet is for looking at; edits belong to the real registry.
  const simulated = useDataSource().mode === 'demo';
  const admin = isAdmin(operator?.role) && !simulated;
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const units = useUnits();
  const personnel = usePersonnel();
  const retire = useRetireVest();
  const deactivate = useDeactivatePersonnel();
  const [tab, setTab] = useState<Tab>('vests');
  const [vestForm, setVestForm] = useState<Editing<Unit>>({ open: false, item: null });
  const [personForm, setPersonForm] = useState<Editing<Personnel>>({ open: false, item: null });
  const [toRetire, setToRetire] = useState<Unit | null>(null);
  const [toDeactivate, setToDeactivate] = useState<Personnel | null>(null);

  const people = personnel.data ?? [];
  const vests = units.data ?? [];

  const confirmRetire = () =>
    toRetire &&
    retire.mutate(toRetire.id, {
      onSuccess: () => toast.show(t('fleet.saved'), 'success'),
      onError: (error) => toast.show(errorMessage(error), 'error'),
      onSettled: () => setToRetire(null),
    });

  const confirmDeactivate = () =>
    toDeactivate &&
    deactivate.mutate(toDeactivate.id, {
      onSuccess: () => toast.show(t('fleet.saved'), 'success'),
      onError: (error) => toast.show(errorMessage(error), 'error'),
      onSettled: () => setToDeactivate(null),
    });

  return (
    <>
      <PageHeader
        title={t('fleet.title')}
        subtitle={simulated ? t('demo.fleetReadOnly') : admin ? t('fleet.subtitle') : t('fleet.readOnly')}
        actions={
          admin &&
          (tab === 'vests' ? (
            <Button variant="primary" icon="plus" onClick={() => setVestForm({ open: true, item: null })}>
              {t('fleet.registerVest')}
            </Button>
          ) : (
            <Button variant="primary" icon="plus" onClick={() => setPersonForm({ open: true, item: null })}>
              {t('fleet.addPerson')}
            </Button>
          ))
        }
      />
      <div style={{ marginBottom: 'var(--gap)' }}>
        <SegmentedControl<Tab>
          label={t('fleet.title')}
          value={tab}
          onChange={setTab}
          options={[
            { value: 'vests', label: t('fleet.tabVests'), count: vests.length },
            { value: 'personnel', label: t('fleet.tabPersonnel'), count: people.length },
          ]}
        />
      </div>

      {tab === 'vests' ? (
        <Card flush>
          {units.isLoading ? (
            <Skeleton height={240} />
          ) : units.error ? (
            <ErrorState error={units.error} onRetry={() => void units.refetch()} />
          ) : vests.length === 0 ? (
            <EmptyState icon="fleet" title={t('common.noData')} />
          ) : (
            <div className={uiStyles.tableWrap}>
              <table className={uiStyles.table}>
                <thead>
                  <tr>
                    <th>{t('fleet.vest')}</th>
                    <th>{t('fleet.displayName')}</th>
                    <th>{t('fleet.wearer')}</th>
                    <th>{t('fleet.firmware')}</th>
                    <th>{t('fleet.lastSeen')}</th>
                    <th>{t('fleet.status')}</th>
                    {admin && <th>{t('common.actions')}</th>}
                  </tr>
                </thead>
                <tbody>
                  {vests.map((vest) => (
                    <tr key={vest.id}>
                      <td>
                        <Link to={`/units/${vest.id}`} className="ltr mono">
                          {vest.code}
                        </Link>{' '}
                        {vest.isSimulated && <SimulatedBadge />}
                      </td>
                      <td>{vest.name}</td>
                      <td>{vest.wearer ? `${vest.wearer.callsign} — ${vest.wearer.fullName}` : <Badge>{t('fleet.unassigned')}</Badge>}</td>
                      <td className="ltr">{vest.firmwareVersion ?? '—'}</td>
                      <td>{vest.lastSeenAt ? fmt.relative(vest.lastSeenAt) : t('connection.never')}</td>
                      <td>
                        <ConnectionPill state={vest.connection} />
                      </td>
                      {admin && (
                        <td>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <Button size="sm" icon="edit" onClick={() => setVestForm({ open: true, item: vest })}>
                              {t('common.edit')}
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setToRetire(vest)}>
                              {t('fleet.retire')}
                            </Button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : (
        <Card flush>
          {personnel.isLoading ? (
            <Skeleton height={240} />
          ) : personnel.error ? (
            <ErrorState error={personnel.error} onRetry={() => void personnel.refetch()} />
          ) : people.length === 0 ? (
            <EmptyState icon="units" title={t('common.noData')} />
          ) : (
            <div className={uiStyles.tableWrap}>
              <table className={uiStyles.table}>
                <thead>
                  <tr>
                    <th>{t('fleet.callsign')}</th>
                    <th>{t('fleet.fullName')}</th>
                    <th>{t('fleet.rank')}</th>
                    <th>{t('fleet.team')}</th>
                    <th>{t('fleet.bloodType')}</th>
                    <th>{t('fleet.zone')}</th>
                    <th>{t('fleet.vest')}</th>
                    {admin && <th>{t('common.actions')}</th>}
                  </tr>
                </thead>
                <tbody>
                  {people.map((person) => (
                    <tr key={person.id}>
                      <td className="mono">{person.callsign}</td>
                      <td>{person.fullName}</td>
                      <td>{person.rank ?? '—'}</td>
                      <td>{person.unitName ?? '—'}</td>
                      <td className="ltr">{person.bloodType ?? '—'}</td>
                      <td>{person.zone ?? '—'}</td>
                      <td className="ltr mono">{person.deviceCode ?? '—'}</td>
                      {admin && (
                        <td>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <Button size="sm" icon="edit" onClick={() => setPersonForm({ open: true, item: person })}>
                              {t('common.edit')}
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setToDeactivate(person)}>
                              {t('fleet.deactivate')}
                            </Button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {vestForm.open && (
        <VestFormModal open vest={vestForm.item} personnel={people} onClose={() => setVestForm({ open: false, item: null })} />
      )}
      {personForm.open && <PersonnelFormModal open person={personForm.item} onClose={() => setPersonForm({ open: false, item: null })} />}
      <ConfirmDialog
        open={toRetire !== null}
        title={t('fleet.retire')}
        message={t('fleet.retireConfirm', { code: toRetire?.code ?? '' })}
        confirmLabel={t('fleet.retire')}
        danger
        busy={retire.isPending}
        onConfirm={confirmRetire}
        onClose={() => setToRetire(null)}
      />
      <ConfirmDialog
        open={toDeactivate !== null}
        title={t('fleet.deactivate')}
        message={t('fleet.deactivateConfirm', { name: toDeactivate?.fullName ?? '' })}
        confirmLabel={t('fleet.deactivate')}
        danger
        busy={deactivate.isPending}
        onConfirm={confirmDeactivate}
        onClose={() => setToDeactivate(null)}
      />
    </>
  );
}
