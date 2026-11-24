import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '@/core/i18n/useI18n';
import type { Unit } from '@/features/units/domain/Unit';
import { hasSensor, SENSOR_PHASE } from '@/features/units/domain/unitRules';
import { Card, ConnectionPill, cx, EmptyState, Icon, RiskBadge, type IconName } from '@/shared/ui';
import { heartRateTone, spo2Tone, vestTempTone, type Tone } from '../../domain/overviewRules';
import s from '../overview.module.css';
import { TrendSpark } from './TrendSpark';

interface VitalProps {
  icon: IconName;
  label: string;
  value: string | null;
  unit: string;
  tone?: Tone;
  /** sensor not on this vest yet */
  missing?: string;
  hint?: string;
  iconClass?: string;
  /** takes the whole row */
  wide?: boolean;
}

function Vital({ icon, label, value, unit, tone = 'normal', missing, hint, iconClass, wide }: VitalProps) {
  const shown = missing ? null : value;
  return (
    <div
      className={cx(
        s.vital,
        wide && s.vitalWide,
        missing && s.vitalMissing,
        tone === 'warning' && s.vitalWarning,
        tone === 'critical' && s.vitalCritical,
      )}
    >
      <span className={s.vitalLabel}>
        <Icon name={icon} size={15} className={iconClass} />
        {label}
      </span>
      <span className={s.vitalValue}>
        {shown ?? '—'}
        {shown !== null && <span className={s.vitalUnit}>{unit}</span>}
      </span>
      {(missing || hint) && <span className={s.vitalHint}>{missing ?? hint}</span>}
    </div>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </>
  );
}

/** The selected unit's live data: vitals first, then motion, link and position. */
export function LiveReadings({ unit }: { unit: Unit | null }) {
  const { t, fmt } = useI18n();
  if (!unit) {
    return (
      <Card title={t('overview.readings')} className={s.readings}>
        <EmptyState icon="activity" title={t('overview.noUnits')} />
      </Card>
    );
  }

  const tm = unit.telemetry;
  const live = unit.connection === 'online';
  const notFitted = (phase: number) => `${t('sensors.notFitted')} · ${t('sensors.phase', { n: phase })}`;
  const ppgFitted = hasSensor(unit, 'heartRate');
  const noContact = ppgFitted && tm?.sensorContact === false;
  const vitalsHint = noContact ? t('overview.placeFinger') : undefined;
  const heart = tm?.heartRate ?? null;
  const spo2 = tm?.spo2 ?? null;
  const temp = tm?.vestTempC ?? null;
  const position = unit.position;

  return (
    <Card
      title={t('overview.readings')}
      subtitle={unit.wearer ? `${unit.wearer.fullName} · ${unit.wearer.callsign}` : unit.name}
      actions={
        <Link to={`/units/${unit.id}`} className={s.openUnit} title={t('overview.openUnit')}>
          {t('common.details')}
          <Icon name="chevron" size={14} flipRtl />
        </Link>
      }
      className={s.readings}
    >
      <div className={s.readingsBody}>
        <div className={s.vitals}>
          <Vital
            icon="heart"
            label={t('sensors.heartRate')}
            value={heart !== null ? fmt.number(heart) : null}
            unit="bpm"
            tone={heartRateTone(heart)}
            missing={ppgFitted ? undefined : notFitted(SENSOR_PHASE.heartRate)}
            hint={vitalsHint}
            iconClass={live && heart !== null ? s.heartBeat : undefined}
          />
          <Vital
            icon="droplet"
            label={t('sensors.spo2')}
            value={spo2 !== null ? fmt.number(spo2) : null}
            unit="%"
            tone={spo2Tone(spo2)}
            missing={hasSensor(unit, 'spo2') ? undefined : notFitted(SENSOR_PHASE.spo2)}
            hint={vitalsHint}
          />
          <Vital
            icon="thermometer"
            label={t('sensors.vestTemp')}
            value={temp !== null ? fmt.number(temp, 1) : null}
            unit="°C"
            tone={vestTempTone(temp)}
            wide
          />
        </div>

        <TrendSpark unitId={unit.id} />

        <dl className={s.facts}>
          <Fact label={t('overview.status')}>
            <RiskBadge level={unit.risk.level} score={unit.risk.score} />
          </Fact>
          <Fact label={t('sensors.posture')}>
            {tm?.posture ? t(`posture.${tm.posture}`) : '—'}
            {tm?.tiltDeg != null && <span className="muted"> · {t('sensors.tilt', { value: fmt.number(tm.tiltDeg) })}</span>}
          </Fact>
          <Fact label={t('sensors.activity')}>
            <span className="ltr">{tm?.activityG != null ? `${fmt.number(tm.activityG, 3)} g` : '—'}</span>
          </Fact>
          <Fact label={t('sensors.still')}>{fmt.duration(tm?.stillS ?? null)}</Fact>
          <Fact label={t('sensors.signal')}>
            <span className="ltr">{(tm?.rssi ?? unit.rssi) != null ? `${fmt.number(tm?.rssi ?? unit.rssi)} dBm` : '—'}</span>
          </Fact>
          <Fact label={t('overview.position')}>
            {position ? (
              <>
                <span className="ltr mono">{`${position.lat.toFixed(4)}, ${position.lng.toFixed(4)}`}</span>
                <span className="muted"> · {position.source === 'gps' ? t('overview.positionGps') : t('overview.positionPost')}</span>
              </>
            ) : (
              '—'
            )}
          </Fact>
          <Fact label={t('overview.connection')}>
            <ConnectionPill state={unit.connection} />
          </Fact>
          <Fact label={t('overview.lastUpdate')}>{fmt.relative(unit.telemetryAt ?? unit.lastSeenAt)}</Fact>
        </dl>
      </div>
    </Card>
  );
}
