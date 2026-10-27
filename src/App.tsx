import { useCallback, useEffect, useState } from 'react';
import { telegram } from './telegram';
import { Calendar } from './Calendar';
import { Today, type Activity } from './Today';
import { Home } from './Home';
import { FormIndex } from './FormIndex';

export function App() {
  const [error, setError] = useState('');
  const [activities, setActivities] = useState<Record<string, Activity>>({});
  const [activityRevision, setActivityRevision] = useState(0);
  const updateActivity = useCallback((activity: Activity) => {
    setActivities((current) => ({ ...current, [activity.date]: activity }));
    setActivityRevision((value) => value + 1);
  }, []);
  const loadActivities = useCallback((loaded: Activity[]) => {
    setActivities((current) => ({ ...current, ...Object.fromEntries(loaded.map((activity) => [activity.date, activity])) }));
  }, []);
  const [authenticated, setAuthenticated] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [tab, setTab] = useState<'home' | 'calendar' | 'today' | 'formIndex'>('home');

  useEffect(() => {
    if (!telegram?.initData) return;
    const controller = new AbortController();
    fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData: telegram.initData }),
      signal: controller.signal,
    }).then(async (res) => {
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error);
      }
      if (!controller.signal.aborted) setAuthenticated(true);
    }).catch((err: unknown) => {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Не удалось войти.');
    });
    return () => controller.abort();
  }, []);

  return (
    <main className="app">
      <div hidden={tab !== 'home'}><Home authenticated={authenticated} active={tab === 'home'} /></div>
      <div hidden={tab !== 'calendar'}><Calendar authenticated={authenticated} active={tab === 'calendar'}
        activities={activities} activityRevision={activityRevision} onLoaded={loadActivities}
        onSelectDate={(date) => { setSelectedDate(date); setTab('today'); }} /></div>
      <div hidden={tab !== 'today'}><Today authenticated={authenticated} active={tab === 'today'} selectedDate={selectedDate} onActivityChange={updateActivity} /></div>
      <div hidden={tab !== 'formIndex'}><FormIndex authenticated={authenticated} active={tab === 'formIndex'} activityRevision={activityRevision} activities={activities} onLoaded={loadActivities} /></div>
      <nav className="bottom-nav" aria-label="Разделы приложения">
        <button type="button" aria-current={tab === 'home' ? 'page' : undefined} onClick={() => setTab('home')}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 10 9-7 9 7M5 9v11h5v-6h4v6h5V9" /></svg>
          <span>Главная</span>
        </button>
        <button type="button" aria-current={tab === 'calendar' ? 'page' : undefined} onClick={() => setTab('calendar')}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="16" rx="3" /><path d="M8 3v4m8-4v4M4 11h16m-11 4h2m2 0h2m-6 3h2" /></svg>
          <span>Календарь</span>
        </button>
        <button type="button" aria-current={tab === 'today' ? 'page' : undefined} onClick={() => setTab('today')}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="5" /><path d="m8 12 3 3 5-6" /></svg>
          <span>Тренировка</span>
        </button>
        <button type="button" aria-current={tab === 'formIndex' ? 'page' : undefined} onClick={() => setTab('formIndex')}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h16M6 16v-4m6 4V8m6 8V4" /></svg>
          <span>Индекс формы</span>
        </button>
      </nav>
      {error && <p className="auth-error" role="alert">{error}</p>}
    </main>
  );
}
