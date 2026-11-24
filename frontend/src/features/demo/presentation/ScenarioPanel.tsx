import { useEffect, useState } from 'react';
import { useDataSource } from '@/app/di/dataSource';
import { useI18n } from '@/core/i18n/useI18n';
import { Button, Card, cx, Meter } from '@/shared/ui';
import type { ScenarioStatus } from '../domain/DemoWorld';
import { CYCLE_S } from '../domain/scenario';
import s from './demo.module.css';

function useScenarioStatus(): ScenarioStatus | null {
  const { scenario } = useDataSource();
  const [status, setStatus] = useState<ScenarioStatus | null>(() => scenario?.status() ?? null);
  useEffect(() => {
    if (!scenario) return;
    const tick = () => setStatus(scenario.status());
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [scenario]);
  return status;
}

/** Simulation mode: what is happening now and what comes next, so a presenter can narrate it. */
export function ScenarioPanel({ className }: { className?: string }) {
  const { t, fmt } = useI18n();
  const { scenario } = useDataSource();
  const status = useScenarioStatus();

  return (
    <Card
      title={t('demo.scenario')}
      subtitle={t('demo.scenarioHint', { n: CYCLE_S / 60 })}
      actions={
        <Button size="sm" variant="ghost" icon="refresh" onClick={() => scenario?.restart()}>
          {t('demo.restart')}
        </Button>
      }
      className={className}
    >
      {!status ? (
        <p className={s.muted}>{t('demo.preparing')}</p>
      ) : (
        <div className={s.scenarioBody}>
          <div className={s.progressRow}>
            <Meter value={(status.elapsedS / status.cycleS) * 100} color="var(--ai)" label={t('demo.progress')} />
            <span className="ltr mono">
              {fmt.duration(status.elapsedS)} / {fmt.duration(status.cycleS)}
            </span>
          </div>

          <section>
            <h3 className={s.heading}>{t('demo.happening')}</h3>
            {status.active.length ? (
              <ul className={cx(s.cues, s.live)}>
                {status.active.map((cue) => (
                  <li key={`${cue.story}-${cue.label}`} className={s.cue}>
                    <span className={s.cueTime}>{t('demo.sinceTime', { time: fmt.duration(cue.seconds) })}</span>
                    <span>{t(`demo.stories.${cue.story}`)}</span>
                    <span className={s.cueUnit}>{cue.label}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={s.muted}>{t('demo.nothingNow')}</p>
            )}
          </section>

          <section>
            <h3 className={s.heading}>{t('demo.upcoming')}</h3>
            <ul className={s.cues}>
              {status.upcoming.map((cue) => (
                <li key={`${cue.story}-${cue.label}-${cue.seconds}`} className={s.cue}>
                  <span className={s.cueTime}>{t('demo.inTime', { time: fmt.duration(cue.seconds) })}</span>
                  <span>{t(`demo.stories.${cue.story}`)}</span>
                  <span className={s.cueUnit}>{cue.label}</span>
                </li>
              ))}
            </ul>
          </section>

          <p className={s.note}>{t('demo.autoHandling')}</p>
        </div>
      )}
    </Card>
  );
}
