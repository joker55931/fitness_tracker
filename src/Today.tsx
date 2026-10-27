import { useEffect, useRef, useState } from 'react';
import { telegram } from './telegram';

export type Activity = { date: string; training: boolean; microTraining: boolean; walking: boolean };
type Kind = 'training' | 'microTraining' | 'walking';
// Общая очередь сохраняется при переключении вкладок.
let saveQueue: Promise<void> = Promise.resolve();
export function waitForActivitySaves() { return saveQueue; }

const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

function dateKey() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

async function request(date: string, options?: RequestInit): Promise<Activity> {
  const response = await fetch(`/api/activity?timezone=${encodeURIComponent(timezone)}&date=${encodeURIComponent(date)}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', Authorization: `tma ${telegram?.initData ?? ''}` },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? 'Не удалось сохранить отметку.');
  return data.activity;
}

export function Today({ authenticated, active, selectedDate, onActivityChange }: { authenticated: boolean; active: boolean; selectedDate: string | null; onActivityChange: (activity: Activity) => void }) {
  const [today, setToday] = useState(dateKey);
  const date = selectedDate ?? today;
  const [cache, setCache] = useState<Map<string, Activity>>(() => new Map());
  const activity = cache.get(date);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const error = errors[date] ?? '';
  const [loading, setLoading] = useState(false);
  const confirmed = useRef(new Map<string, Activity>());
  const versions = useRef(new Map<string, number>());
  const [retry, setRetry] = useState(0);
  const revision = useRef(0);

  useEffect(() => {
    const update = () => setToday(dateKey());
    const timer = window.setInterval(update, 10_000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') { update(); setRetry((value) => value + 1); }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, []);

  useEffect(() => {
    if (!authenticated) return;
    const controller = new AbortController();
    const requestedRevision = revision.current;
    setLoading(true);
    saveQueue.then(() => request(date, { signal: controller.signal })).then((value) => {
      if (!controller.signal.aborted && requestedRevision === revision.current) {
        confirmed.current.set(date, value);
        onActivityChange(value);
        setCache((current) => new Map(current).set(date, value));
        setErrors((current) => ({ ...current, [date]: '' }));
      }
    }).catch((err: unknown) => {
      if (!controller.signal.aborted) setErrors((current) => ({ ...current, [date]: err instanceof Error ? err.message : 'Не удалось загрузить отметки.' }));
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [authenticated, date, retry, active, onActivityChange]);

  function toggle(kind: Kind, completed: boolean) {
    if (!activity) return;
    onActivityChange({ ...activity, [kind]: completed });
    revision.current++;
    const key = `${date}:${kind}`;
    const version = (versions.current.get(key) ?? 0) + 1;
    versions.current.set(key, version);
    setCache((current) => new Map(current).set(date, { ...current.get(date)!, [kind]: completed }));
    setErrors((current) => ({ ...current, [date]: '' }));
    const pending = saveQueue.then(() => request(date, {
      method: 'PATCH', body: JSON.stringify({ timezone, date, kind, completed }),
    }));
    saveQueue = pending.then((saved) => {
      const previous = confirmed.current.get(date);
      if (previous) confirmed.current.set(date, { ...previous, [kind]: saved[kind] });
    }, (err: unknown) => {
      if (versions.current.get(key) === version) {
        const previous = confirmed.current.get(date);
        if (previous) setCache((current) => {
          const restored = { ...current.get(date)!, [kind]: previous[kind] };
          return new Map(current).set(date, restored);
        });
        // Повторная загрузка синхронизирует календарь после неудачной записи.
        setRetry((value) => value + 1);
        setErrors((current) => ({ ...current, [date]: err instanceof Error ? err.message : 'Не удалось сохранить отметку.' }));
      }
    });
  }

  const ready = authenticated && !!activity;
  const initialLoading = authenticated && !activity && !error;
  const dateLabel = new Date(`${date}T12:00:00`).toLocaleDateString('ru-RU', {
    weekday: 'long', day: 'numeric', month: 'long',
  });

  return (
    <section className="today-panel" aria-labelledby="today-title">
      <header className="today-header">
        <p className="eyebrow">Тренировка</p>
        <h1 id="today-title">{dateLabel}</h1>
        <p className="today-description">Отметь, что удалось сделать за день.</p>
      </header>
      {initialLoading ? <div className="activity-skeleton" role="status" aria-label="Загрузка отметок">
        <div /><div /><div />
      </div> : <div className="activity-checks">
        {([
          ['training', 'Основная тренировка'],
          ['microTraining', 'Микро тренировка'],
          ['walking', 'Ходьба выполнена'],
        ] as const).map(([kind, label]) => (
          <label key={kind} className={`activity-option activity-${kind}${activity?.date === date && activity[kind] ? ' is-completed' : ''}`}>
            <input type="checkbox" checked={activity?.date === date && activity[kind] || false}
              disabled={!ready} onChange={(event) => toggle(kind, event.target.checked)} />
            <span className="check-box" aria-hidden="true">
              <svg viewBox="0 0 24 24"><path d="m6 12 4 4 8-9" /></svg>
            </span>
            <span>{label}{kind === 'walking' && <small className="walking-threshold">Минимум 8000 шагов за день</small>}</span>
          </label>
        ))}
      </div>}
      {!telegram?.initData && <p className="activity-status">Открой приложение через Telegram, чтобы отмечать занятия.</p>}
      {error && <div className="activity-error" role="alert"><p>{error}</p>
        <button className="retry-button" disabled={loading} onClick={() => setRetry((value) => value + 1)}>Повторить загрузку</button>
      </div>}
    </section>
  );
}
