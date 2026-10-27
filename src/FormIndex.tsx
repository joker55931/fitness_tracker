import { useEffect, useMemo, useState } from 'react';
import { telegram } from './telegram';
import { waitForActivitySaves, type Activity } from './Today';
import { calculateFormIndex } from '../server/form-index';

type Index = { start: string; end: string; main: number; micro: number; walking: number; score: number; activities: Activity[] };
const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const shortDate = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });

export function FormIndex({ authenticated, active, activityRevision, activities, onLoaded }: {
  authenticated: boolean; active: boolean; activityRevision: number;
  activities: Record<string, Activity>; onLoaded: (activities: Activity[]) => void;
}) {
  const [data, setData] = useState<Index | null>(null);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [day, setDay] = useState(() => new Date().toDateString());

  useEffect(() => {
    const update = () => setDay(new Date().toDateString());
    const onVisible = () => {
      if (document.visibilityState === 'visible') { update(); setRefresh((v) => v + 1); }
    };
    const timer = window.setInterval(update, 30_000);
    document.addEventListener('visibilitychange', onVisible);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, []);

  useEffect(() => {
    if (!authenticated) return;
    const controller = new AbortController();
    waitForActivitySaves().then(async () => {
      const response = await fetch(`/api/form-index?timezone=${encodeURIComponent(timezone)}`, {
        headers: { Authorization: `tma ${telegram?.initData ?? ''}` }, signal: controller.signal,
      });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error);
      if (!controller.signal.aborted) { onLoaded(value.activities); setData(value); setError(''); }
    }).catch((err: unknown) => {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Не удалось загрузить индекс.');
    });
    return () => controller.abort();
  }, [authenticated, active, activityRevision, refresh, day, onLoaded]);

  const result = useMemo(() => {
    if (!data) return null;
    const days = data.activities.map((saved) => activities[saved.date] ?? saved);
    const main = days.filter((entry) => entry.training).length;
    const micro = days.filter((entry) => entry.microTraining).length;
    const walking = days.filter((entry) => entry.walking).length;
    return { main, micro, walking, score: calculateFormIndex(main, micro, walking) };
  }, [data, activities]);

  return (
    <section className="form-index" aria-labelledby="form-index-title">
      <header className="today-header"><p className="eyebrow">Активность за неделю</p><h1 id="form-index-title">Индекс формы</h1>
        <p className="today-description">Последние 7 дней{data ? ` · ${shortDate(data.start)} — ${shortDate(data.end)}` : ', включая сегодня'}</p>
      </header>
      <div className="index-score-card">
        <div className="index-score">{result?.score ?? '—'}<span>/ 100</span></div>
        <progress className="weight-progress index-progress" max="100" value={result?.score ?? 0} aria-label="Индекс формы из 100 баллов" />
      </div>
      <div className="index-variables">
        <div><span className="variable-symbol main-symbol">О</span><div><strong>Основные тренировки</strong></div><b>{result?.main ?? '—'}</b></div>
        <div><span className="variable-symbol micro-symbol">М</span><div><strong>Микро тренировки</strong></div><b>{result?.micro ?? '—'}</b></div>
        <div><span className="variable-symbol walking-symbol">Х</span><div><strong>Ходьба</strong></div><b>{result?.walking ?? '—'}</b></div>
      </div>
      {!telegram?.initData && <p className="activity-status">Открой приложение через Telegram, чтобы увидеть свой индекс.</p>}
      {error && <div className="activity-error" role="alert"><p>{error}</p><button className="retry-button" onClick={() => setRefresh((v) => v + 1)}>Повторить</button></div>}
    </section>
  );
}
