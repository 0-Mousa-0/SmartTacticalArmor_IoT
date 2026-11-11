import { useMemo, useState } from 'react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useI18n } from '@/core/i18n/useI18n';
import { useDebouncedValue } from '@/shared/hooks/useDebouncedValue';
import { Badge, Card, ErrorState, Icon, PageHeader, SegmentedControl, SelectField, Skeleton, StatTile, TextField, uiStyles, type IconName } from '@/shared/ui';
import { useShieldingDataset, useShieldingEstimate } from '../application/hooks';
import { MATERIAL_COLORS, type Beam, type Material, type ShieldingDataset, type ShieldingInput } from '../domain/Shielding';
import s from './armor.module.css';

const MATERIALS: Material[] = ['bi2o3', 'pbo', 'mgo'];
const BEAMS: Beam[] = ['xray', 'am241', 'cs137'];

const SENSING: { icon: IconName; key: 'heartRate' | 'vestTemp' | 'posture' | 'gps' | 'radiation'; phase: number }[] = [
  { icon: 'posture', key: 'posture', phase: 1 },
  { icon: 'thermometer', key: 'vestTemp', phase: 1 },
  { icon: 'heart', key: 'heartRate', phase: 2 },
  { icon: 'pin', key: 'gps', phase: 3 },
  { icon: 'radiation', key: 'radiation', phase: 4 },
];

function AttenuationChart({ dataset, beam }: { dataset: ShieldingDataset; beam: Beam }) {
  const rows = dataset.concentrations.map((concentration, index) => {
    const row: Record<string, number | string> = { concentration: String(concentration) };
    for (const series of dataset.series.filter((item) => item.beam === beam)) {
      row[series.material] = series.points[index].mu;
    }
    return row;
  });
  return (
    <div dir="ltr" style={{ width: '100%', height: 280 }}>
      <ResponsiveContainer>
        <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 8, left: -8 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 4" vertical={false} />
          <XAxis dataKey="concentration" stroke="var(--text-faint)" fontSize={11} unit=" wt%" />
          <YAxis stroke="var(--text-faint)" fontSize={11} width={44} />
          <Tooltip contentStyle={{ background: 'var(--surface-2)', border: '1px solid var(--border-strong)', borderRadius: 8 }} formatter={(value: number, name: string) => [`${value} cm⁻¹`, dataset.materials[name as Material]?.label ?? name]} />
          <Legend formatter={(value: string) => dataset.materials[value as Material]?.label ?? value} wrapperStyle={{ fontSize: 12 }} />
          {MATERIALS.map((material) => (
            <Line key={material} type="monotone" dataKey={material} stroke={MATERIAL_COLORS[material]} strokeWidth={2.2} dot={{ r: 3 }} isAnimationActive={false} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function ArmorPage() {
  const { t, fmt } = useI18n();
  const dataset = useShieldingDataset();
  const [beam, setBeam] = useState<Beam>('cs137');
  const [material, setMaterial] = useState<Material>('bi2o3');
  const [concentration, setConcentration] = useState(8.333);
  const [thickness, setThickness] = useState('1.0');
  const [dose, setDose] = useState('10');

  const input = useMemo<ShieldingInput | null>(() => {
    const thicknessCm = Number(thickness);
    const incident = dose.trim() === '' ? null : Number(dose);
    if (!(thicknessCm > 0 && thicknessCm <= 10) || (incident !== null && !(incident >= 0))) return null;
    return { material, beam, concentration, thicknessCm, incidentDoseUsvh: incident };
  }, [material, beam, concentration, thickness, dose]);
  const estimate = useShieldingEstimate(useDebouncedValue(input, 250));

  if (dataset.isLoading) return <Skeleton height={520} />;
  if (dataset.error || !dataset.data) return <ErrorState error={dataset.error} onRetry={() => void dataset.refetch()} />;
  const data = dataset.data;
  const beamSeries = data.series.filter((series) => series.beam === beam);
  const result = estimate.data;

  return (
    <>
      <PageHeader title={t('armor.title')} subtitle={t('armor.subtitle')} />

      <div className={s.top}>
        <Card title={t('armor.layers')}>
          <div className={s.layers} aria-label={t('armor.order')}>
            {/* Same order as the caption: wearer → Bi₂O₃ → Kevlar → outside (mirrors in RTL). */}
            <div className={s.layerWearer}>
              <Icon name="user" size={22} />
            </div>
            <div className={s.layerBi}>
              <strong>{t('armor.inner')}</strong>
              <span>{t('armor.innerDesc')}</span>
            </div>
            <div className={s.layerKevlar}>
              <strong>{t('armor.outer')}</strong>
              <span>{t('armor.outerDesc')}</span>
            </div>
            <div className={s.layerOutside} aria-hidden="true" />
          </div>
          <p className={s.order}>{t('armor.order')}</p>
          <div className={s.sensing}>
            {SENSING.map((item) => (
              <span key={item.key} className={s.sensor}>
                <Icon name={item.icon} size={16} />
                {t(`sensors.${item.key}`)}
                <Badge tone={item.phase === 1 ? 'success' : 'neutral'}>{t('sensors.phase', { n: item.phase })}</Badge>
              </span>
            ))}
          </div>
        </Card>

        <Card
          title={t('armor.attenuation')}
          actions={
            <SegmentedControl<Beam>
              label={t('armor.beam')}
              value={beam}
              onChange={setBeam}
              options={BEAMS.map((value) => ({ value, label: data.beams[value].energyKev ? `${data.beams[value].energyKev} keV` : 'X-ray' }))}
            />
          }
        >
          <AttenuationChart dataset={data} beam={beam} />
          <p className={s.finding}>
            <Icon name="check" size={15} /> {t('armor.finding')}
          </p>
        </Card>
      </div>

      <div className={s.bottom}>
        <Card title={t('armor.calculator')}>
          <div className={s.form}>
            <SelectField label={t('armor.material')} value={material} onChange={(e) => setMaterial(e.target.value as Material)}>
              {MATERIALS.map((value) => (
                <option key={value} value={value}>
                  {data.materials[value].label}
                </option>
              ))}
            </SelectField>
            <SelectField label={t('armor.beam')} value={beam} onChange={(e) => setBeam(e.target.value as Beam)}>
              {BEAMS.map((value) => (
                <option key={value} value={value}>
                  {data.beams[value].label}
                </option>
              ))}
            </SelectField>
            <SelectField label={t('armor.concentration')} value={String(concentration)} onChange={(e) => setConcentration(Number(e.target.value))}>
              {data.concentrations.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </SelectField>
            <TextField label={t('armor.thickness')} type="number" min={0.01} max={10} step={0.1} value={thickness} onChange={(e) => setThickness(e.target.value)} dir="ltr" />
            <TextField label={t('armor.incidentDose')} type="number" min={0} step={1} value={dose} onChange={(e) => setDose(e.target.value)} dir="ltr" />
          </div>

          {result && (
            <>
              <div className={s.results}>
                <StatTile label={t('armor.transmitted')} value={<span className="ltr">{fmt.number(result.transmission * 100, 1)}%</span>} />
                <StatTile label={t('armor.attenuated')} value={<span className="ltr">{fmt.number(result.attenuationPct, 1)}%</span>} color="var(--accent)" />
                <StatTile label={t('armor.hvl')} value={<span className="ltr">{fmt.number(result.hvlCm, 2)} cm</span>} />
                <StatTile label={t('armor.mfp')} value={<span className="ltr">{fmt.number(result.mfpCm, 2)} cm</span>} />
                <StatTile label={t('armor.tvl')} value={<span className="ltr">{fmt.number(result.tvlCm, 2)} cm</span>} />
                {result.transmittedDoseUsvh !== null && (
                  <StatTile label={t('armor.behindShield')} value={<span className="ltr">{fmt.number(result.transmittedDoseUsvh, 2)}</span>} hint="µSv/h" color="var(--success)" />
                )}
              </div>
              <p className="muted ltr" style={{ marginTop: 10, fontSize: 12.5 }}>
                T = e<sup>−μx</sup> = e<sup>−{result.mu}×{thickness}</sup>
                {result.approximate && <> · * {t('armor.approximate')}</>}
              </p>
            </>
          )}
        </Card>

        <Card title={`μ / HVL — ${data.beams[beam].label}`} flush>
          <div className={uiStyles.tableWrap}>
            <table className={uiStyles.table}>
              <thead>
                <tr>
                  <th>wt %</th>
                  {beamSeries.map((series) => (
                    <th key={series.material}>{data.materials[series.material].label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.concentrations.map((concentrationValue, index) => (
                  <tr key={concentrationValue}>
                    <td className="num">{concentrationValue}</td>
                    {beamSeries.map((series) => {
                      const point = series.points[index];
                      return (
                        <td key={series.material} className="num" title={point.approximate ? t('armor.approximate') : undefined}>
                          <span className="ltr">
                            {point.mu}
                            {point.approximate ? '*' : ''} <span className="muted">· HVL {point.hvl} cm</span>
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={s.source}>
            * {t('armor.approximate')}. {t('armor.source')}
          </p>
        </Card>
      </div>
    </>
  );
}
