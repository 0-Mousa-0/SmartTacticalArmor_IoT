import { useMemo, useState } from 'react';
import { useI18n } from '@/core/i18n/useI18n';
import { EmptyState, ErrorState, Icon, PageHeader, SegmentedControl, Skeleton, uiStyles } from '@/shared/ui';
import { useUnits } from '../application/hooks';
import { isAtRisk, matchesSearch, sortByPriority } from '../domain/unitRules';
import { UnitCard } from './components/UnitCard';
import cardStyles from './components/units.module.css';
import s from './unitsPage.module.css';

type Filter = 'all' | 'online' | 'offline' | 'risk';

export default function UnitsPage() {
  const { t } = useI18n();
  const { data, isLoading, error, refetch } = useUnits();
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');

  const units = useMemo(() => sortByPriority(data ?? []), [data]);
  const counts = {
    all: units.length,
    online: units.filter((u) => u.connection === 'online').length,
    offline: units.filter((u) => u.connection !== 'online').length,
    risk: units.filter(isAtRisk).length,
  };
  const visible = units
    .filter((u) => (filter === 'online' ? u.connection === 'online' : filter === 'offline' ? u.connection !== 'online' : filter === 'risk' ? isAtRisk(u) : true))
    .filter((u) => matchesSearch(u, query));

  return (
    <>
      <PageHeader title={t('units.title')} subtitle={t('units.subtitle')} />
      <div className={s.toolbar}>
        <SegmentedControl<Filter>
          label={t('units.title')}
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: t('units.filterAll'), count: counts.all },
            { value: 'online', label: t('units.filterOnline'), count: counts.online },
            { value: 'offline', label: t('units.filterOffline'), count: counts.offline },
            { value: 'risk', label: t('units.filterAtRisk'), count: counts.risk },
          ]}
        />
        <label className={s.search}>
          <Icon name="search" size={16} />
          <input className={uiStyles.input} placeholder={t('units.search')} value={query} onChange={(e) => setQuery(e.target.value)} aria-label={t('units.search')} />
        </label>
      </div>

      {isLoading ? (
        <div className={cardStyles.grid}>
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} height={200} />
          ))}
        </div>
      ) : error ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : visible.length === 0 ? (
        <EmptyState icon="search" title={t('units.empty')} />
      ) : (
        <div className={cardStyles.grid}>
          {visible.map((unit) => (
            <UnitCard key={unit.id} unit={unit} />
          ))}
        </div>
      )}
    </>
  );
}
