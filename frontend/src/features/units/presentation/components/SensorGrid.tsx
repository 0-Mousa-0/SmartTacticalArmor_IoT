import type { ReactNode } from 'react';
import { useI18n } from '@/core/i18n/useI18n';
import { Icon, type IconName } from '@/shared/ui';
import type { Unit } from '../../domain/Unit';
import { hasSensor, SENSOR_PHASE, type OptionalSensor } from '../../domain/unitRules';
import s from './sensors.module.css';

interface TileProps {
  icon: IconName;
  label: string;
  value?: ReactNode;
  unit?: string;
  hint?: ReactNode;
  tone?: 'normal' | 'warning' | 'critical';
  missingPhase?: number;
}

function Tile({ icon, label, value, unit, hint, tone = 'normal', missingPhase }: TileProps) {
  const { t } = useI18n();
  const missing = missingPhase !== undefined;
  return (
    <div className={`${s.tile} ${missing ? s.missing : ''} ${tone !== 'normal' ? s[tone] : ''}`}>
      <span className={s.label}>
        <Icon name={icon} size={16} />
        {label}
      </span>
      {missing ? (
        <span className={s.notFitted}>
          {t('sensors.notFitted')} · {t('sensors.phase', { n: missingPhase })}
        </span>
      ) : (
        <span className={s.value}>
          {value ?? '—'}
          {unit && value !== undefined && value !== '—' && <span className={s.unit}>{unit}</span>}
        </span>
      )}
      {!missing && hint && <span className={s.hint}>{hint}</span>}
    </div>
  );
}

/** Live readings: Phase-1 sensors (IMU + temperature) plus the planned ones. */
export function SensorGrid({ unit }: { unit: Unit }) {
  const { t, fmt } = useI18n();
  const tm = unit.telemetry;
  const phase = (sensor: OptionalSensor) => (hasSensor(unit, sensor) ? undefined : SENSOR_PHASE[sensor]);
  const temp = tm?.vestTempC ?? null;
  const still = tm?.stillS ?? null;
  // The MAX30102 reports no values while nothing touches it.
  const vitalsHint = tm?.sensorContact === false ? t('sensors.noContact') : undefined;

  return (
    <div className={s.grid}>
      <Tile
        icon="thermometer"
        label={t('sensors.vestTemp')}
        value={fmt.number(temp, 1)}
        unit="°C"
        hint={t('sensors.vestTempHint')}
        tone={temp !== null && temp >= 55 ? 'critical' : temp !== null && temp >= 45 ? 'warning' : 'normal'}
      />
      <Tile
        icon="posture"
        label={t('sensors.posture')}
        value={tm?.posture ? t(`posture.${tm.posture}`) : '—'}
        hint={tm?.tiltDeg !== null && tm?.tiltDeg !== undefined ? t('sensors.tilt', { value: fmt.number(tm.tiltDeg) }) : undefined}
        tone={tm?.posture === 'lying' ? 'critical' : tm?.posture === 'bent' ? 'warning' : 'normal'}
      />
      <Tile icon="activity" label={t('sensors.activity')} value={fmt.number(tm?.activityG, 3)} unit="g" />
      <Tile icon="zap" label={t('sensors.peak')} value={fmt.number(tm?.peakG, 2)} unit="g" tone={(tm?.peakG ?? 0) >= 6 ? 'critical' : 'normal'} />
      <Tile icon="clock" label={t('sensors.still')} value={fmt.duration(still)} tone={still !== null && still >= 60 ? 'warning' : 'normal'} />
      <Tile icon="wifi" label={t('sensors.signal')} value={fmt.number(tm?.rssi ?? unit.rssi)} unit="dBm" />

      <Tile icon="heart" label={t('sensors.heartRate')} value={fmt.number(tm?.heartRate)} unit="bpm" hint={vitalsHint} missingPhase={phase('heartRate')} />
      <Tile icon="droplet" label={t('sensors.spo2')} value={fmt.number(tm?.spo2)} unit="%" hint={vitalsHint} missingPhase={phase('spo2')} />
      <Tile icon="thermometer" label={t('sensors.skinTemp')} value={fmt.number(tm?.skinTempC, 1)} unit="°C" missingPhase={phase('skinTemp')} />
      <Tile
        icon="pin"
        label={t('sensors.gps')}
        value={tm?.lat !== null && tm?.lat !== undefined ? <span className="ltr">{`${tm.lat.toFixed(4)}, ${tm.lng?.toFixed(4)}`}</span> : '—'}
        missingPhase={phase('gps')}
      />
      <Tile icon="radiation" label={t('sensors.radiation')} value={fmt.number(tm?.radiationUsvh, 3)} unit="µSv/h" missingPhase={phase('radiation')} />
      <Tile icon="battery" label={t('sensors.battery')} value={fmt.number(tm?.batteryPct)} unit="%" missingPhase={phase('battery')} />
    </div>
  );
}
