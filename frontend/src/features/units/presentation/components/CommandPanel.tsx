import { useState } from 'react';
import { useI18n } from '@/core/i18n/useI18n';
import { useAuth } from '@/features/auth/application/authContext';
import { canOperate } from '@/shared/domain/types';
import { Badge, Button, ConfirmDialog, SegmentedControl, useErrorMessage, useToast, uiStyles } from '@/shared/ui';
import { useCommands, useSendCommand } from '../../application/hooks';
import type { CommandStatus, CommandType, Unit } from '../../domain/Unit';
import { unitLabel } from '../../domain/unitRules';
import s from './panels.module.css';

const STATUS_TONE: Record<CommandStatus, 'neutral' | 'info' | 'success' | 'critical' | 'warning'> = {
  queued: 'neutral',
  sent: 'info',
  acknowledged: 'success',
  failed: 'critical',
  timeout: 'warning',
};

export function CommandPanel({ unit }: { unit: Unit }) {
  const { t } = useI18n();
  const { operator } = useAuth();
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const send = useSendCommand(unit.id);
  const [confirmEvac, setConfirmEvac] = useState(false);
  const allowed = canOperate(operator?.role);
  const label = unitLabel(unit);

  const run = (type: CommandType, params?: Record<string, unknown>) =>
    send.mutate(
      { type, params },
      {
        onSuccess: (command) =>
          command.status === 'failed'
            ? toast.show(t('commands.failed', { reason: command.responseInfo ?? '' }), 'error')
            : toast.show(t('commands.sent', { unit: label }), 'success'),
        onError: (error) => toast.show(errorMessage(error), 'error'),
        onSettled: () => setConfirmEvac(false),
      },
    );

  const busy = send.isPending;
  const interval = String(unit.telemetryIntervalS) as '2' | '5' | '10';

  return (
    <div className={s.commands}>
      <div className={s.commandGrid}>
        <Button icon="send" disabled={!allowed || busy} onClick={() => run('ping')}>
          {t('commands.ping')}
        </Button>
        <Button icon="refresh" disabled={!allowed || busy} onClick={() => run('status')}>
          {t('commands.status')}
        </Button>
        <Button icon="posture" disabled={!allowed || busy} onClick={() => run('calibrate')} title={t('commands.calibrateHint')}>
          {t('commands.calibrate')}
        </Button>
        <Button icon="bell" disabled={!allowed || busy} onClick={() => run('silent', { on: unit.buzzerEnabled !== false })}>
          {unit.buzzerEnabled === false ? t('commands.unsilent') : t('commands.silent')}
        </Button>
        <Button icon="close" disabled={!allowed || busy} onClick={() => run('stop')}>
          {t('commands.stop')}
        </Button>
        <Button icon="alert" variant="danger" disabled={!allowed || busy} onClick={() => setConfirmEvac(true)}>
          {t('commands.evac')}
        </Button>
      </div>

      <div className={s.intervalRow}>
        <span className={uiStyles.label}>{t('commands.interval')}</span>
        <SegmentedControl<'2' | '5' | '10'>
          label={t('commands.interval')}
          value={interval}
          onChange={(value) => allowed && !busy && run('interval', { sec: Number(value) })}
          options={['2', '5', '10'].map((n) => ({ value: n as '2' | '5' | '10', label: t('commands.everyN', { n }) }))}
        />
      </div>

      <ConfirmDialog
        open={confirmEvac}
        title={t('commands.evac')}
        message={t('commands.evacConfirm', { unit: label })}
        confirmLabel={t('commands.evac')}
        danger
        busy={busy}
        onConfirm={() => run('evac')}
        onClose={() => setConfirmEvac(false)}
      />
    </div>
  );
}

export function CommandLog({ unitId }: { unitId: string }) {
  const { t, fmt } = useI18n();
  const { data = [] } = useCommands(unitId);
  if (data.length === 0) return null;
  return (
    <div className={s.log}>
      <span className={uiStyles.label}>{t('commands.history')}</span>
      <ul>
        {data.slice(0, 8).map((command) => (
          <li key={command.id}>
            <div className={s.logMain}>
              <strong>{t(`commands.${command.type}`)}</strong>
              {command.params.sec !== undefined && <span className="muted"> · {t('commands.everyN', { n: String(command.params.sec) })}</span>}
              <span className={s.logMeta}>
                {fmt.time(command.issuedAt)}
                {command.issuedBy ? ` · ${command.issuedBy}` : ''}
                {command.responseInfo ? ` · ${command.responseInfo}` : ''}
              </span>
            </div>
            <Badge tone={STATUS_TONE[command.status]}>{t(`commands.statuses.${command.status}`)}</Badge>
          </li>
        ))}
      </ul>
    </div>
  );
}
