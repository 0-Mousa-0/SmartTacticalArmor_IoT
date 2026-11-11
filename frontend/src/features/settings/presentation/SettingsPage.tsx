import { useState, type FormEvent } from 'react';
import { env } from '@/core/config/env';
import { useI18n } from '@/core/i18n/useI18n';
import { useAuth } from '@/features/auth/application/authContext';
import type { Operator } from '@/features/auth/domain/Operator';
import { useSystemHealth } from '@/features/system/application/useSystemHealth';
import { isAdmin, type Role } from '@/shared/domain/types';
import { Badge, Button, Card, FormError, FormGrid, Modal, PageHeader, SegmentedControl, SelectField, TextField, useErrorMessage, useToast, uiStyles } from '@/shared/ui';
import { useChangePassword, useCreateOperator, useOperators, useUpdateOperator } from '../application/hooks';
import s from './settings.module.css';

const ROLES: Role[] = ['admin', 'operator', 'viewer'];

function ChangePasswordCard() {
  const { t } = useI18n();
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const change = useChangePassword();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    change.mutate(
      { current, next },
      {
        onSuccess: () => {
          setCurrent('');
          setNext('');
          toast.show(t('settings.passwordChanged'), 'success');
        },
        onError: (err) => setError(errorMessage(err)),
      },
    );
  };

  return (
    <Card title={t('settings.changePassword')}>
      <form className={s.form} onSubmit={submit}>
        <TextField label={t('settings.currentPassword')} type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} dir="ltr" />
        <TextField label={t('settings.newPassword')} type="password" autoComplete="new-password" minLength={8} value={next} onChange={(e) => setNext(e.target.value)} dir="ltr" />
        <FormError message={error} />
        <div>
          <Button type="submit" variant="primary" loading={change.isPending} disabled={!current || next.length < 8}>
            {t('common.save')}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function OperatorsCard({ me }: { me: Operator }) {
  const { t, fmt } = useI18n();
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const operators = useOperators(true);
  const update = useUpdateOperator();
  const create = useCreateOperator();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ email: '', fullName: '', role: 'operator' as Role, password: '' });
  const [error, setError] = useState<string | null>(null);

  const change = (operator: Operator, changes: { role?: Role; isActive?: boolean }) =>
    update.mutate({ id: operator.id, changes }, { onError: (err) => toast.show(errorMessage(err), 'error') });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    create.mutate(form, {
      onSuccess: () => {
        toast.show(t('settings.created'), 'success');
        setOpen(false);
        setForm({ email: '', fullName: '', role: 'operator', password: '' });
      },
      onError: (err) => setError(errorMessage(err)),
    });
  };

  return (
    <Card
      title={t('settings.operators')}
      flush
      actions={
        <Button size="sm" variant="primary" icon="plus" onClick={() => setOpen(true)}>
          {t('settings.addOperator')}
        </Button>
      }
    >
      <div className={uiStyles.tableWrap}>
        <table className={uiStyles.table}>
          <thead>
            <tr>
              <th>{t('settings.name')}</th>
              <th>{t('settings.email')}</th>
              <th>{t('settings.role')}</th>
              <th>{t('fleet.lastSeen')}</th>
              <th>{t('fleet.status')}</th>
            </tr>
          </thead>
          <tbody>
            {(operators.data ?? []).map((operator) => (
              <tr key={operator.id}>
                <td>{operator.fullName}</td>
                <td className="ltr">{operator.email}</td>
                <td>
                  <select
                    className={uiStyles.select}
                    style={{ height: 32, width: 'auto' }}
                    value={operator.role}
                    disabled={operator.id === me.id}
                    onChange={(e) => change(operator, { role: e.target.value as Role })}
                    aria-label={t('settings.role')}
                  >
                    {ROLES.map((role) => (
                      <option key={role} value={role}>
                        {t(`settings.roles.${role}`)}
                      </option>
                    ))}
                  </select>
                </td>
                <td>{operator.lastLoginAt ? fmt.relative(operator.lastLoginAt) : '—'}</td>
                <td>
                  {operator.id === me.id ? (
                    <Badge tone="success">{t('settings.active')}</Badge>
                  ) : (
                    <Button size="sm" variant={operator.isActive ? 'ghost' : 'secondary'} onClick={() => change(operator, { isActive: !operator.isActive })}>
                      {operator.isActive ? t('settings.disable') : t('settings.enable')}
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal
        open={open}
        title={t('settings.addOperator')}
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
            <Button type="submit" form="operator-form" variant="primary" loading={create.isPending} disabled={!form.email || !form.fullName || form.password.length < 8}>
              {t('common.save')}
            </Button>
          </>
        }
      >
        <form id="operator-form" onSubmit={submit}>
          <FormGrid>
            <TextField label={t('settings.name')} value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
            <TextField label={t('settings.email')} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} dir="ltr" />
            <SelectField label={t('settings.role')} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
              {ROLES.map((role) => (
                <option key={role} value={role}>
                  {t(`settings.roles.${role}`)}
                </option>
              ))}
            </SelectField>
            <TextField label={t('settings.password')} type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} dir="ltr" />
          </FormGrid>
          <div style={{ marginTop: 12 }}>
            <FormError message={error} />
          </div>
        </form>
      </Modal>
    </Card>
  );
}

export default function SettingsPage() {
  const { t, lang, setLang } = useI18n();
  const { operator } = useAuth();
  const health = useSystemHealth();
  if (!operator) return null;

  return (
    <>
      <PageHeader title={t('settings.title')} subtitle={t('settings.subtitle')} />
      <div className={s.grid}>
        <Card title={t('settings.profile')}>
          <dl className={uiStyles.kv}>
            <dt>{t('settings.name')}</dt>
            <dd>{operator.fullName}</dd>
            <dt>{t('settings.email')}</dt>
            <dd className="ltr">{operator.email}</dd>
            <dt>{t('settings.role')}</dt>
            <dd>
              <Badge tone="accent">{t(`settings.roles.${operator.role}`)}</Badge>
            </dd>
          </dl>
        </Card>

        <Card title={t('settings.language')} subtitle={t('settings.languageHint')}>
          <SegmentedControl<'ar' | 'en'>
            label={t('settings.language')}
            value={lang}
            onChange={setLang}
            options={[
              { value: 'ar', label: 'العربية' },
              { value: 'en', label: 'English' },
            ]}
          />
        </Card>

        <ChangePasswordCard />

        <Card title={t('settings.about')}>
          <dl className={uiStyles.kv}>
            <dt>{t('settings.apiUrl')}</dt>
            <dd className="ltr mono">{env.apiBaseUrl}</dd>
            <dt>API</dt>
            <dd className="ltr">{health.data ? `v${health.data.version}` : '—'}</dd>
            <dt>{t('overview.broker')}</dt>
            <dd>
              {health.data?.mqtt.enabled ? (
                <Badge tone={health.data.mqtt.connected ? 'success' : 'critical'} dot>
                  {health.data.mqtt.connected ? t('overview.connected') : t('overview.disconnected')}
                </Badge>
              ) : (
                <Badge>{t('overview.disabled')}</Badge>
              )}
            </dd>
          </dl>
        </Card>
      </div>

      {isAdmin(operator.role) && (
        <div style={{ marginTop: 'var(--gap)' }}>
          <OperatorsCard me={operator} />
        </div>
      )}
    </>
  );
}
