import { useEffect, useRef, useState, type FormEvent } from 'react';
import { telegram } from './telegram';
import { waitForActivitySaves } from './Today';

type Profile = { currentFat: number | null; targetFat: number | null; currentWeight: number | null; targetWeight: number | null; startWeight: number | null };
type Dashboard = { profile: Profile; progress: number | null; month: string; workouts: { training: number; microTraining: number; total: number; goal: number | null; progress: number | null } };
const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const number = (value: number | null | undefined) => value == null ? '—' : value.toLocaleString('ru-RU', { maximumFractionDigits: 1 });

async function dashboardRequest(options?: RequestInit, path = '/api/dashboard'): Promise<Dashboard> {
  const res = await fetch(`${path}?timezone=${encodeURIComponent(timezone)}`, {
    ...options, headers: { 'Content-Type': 'application/json', Authorization: `tma ${telegram?.initData ?? ''}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? 'Не удалось загрузить данные.');
  return data;
}

export function Home({ authenticated, active }: { authenticated: boolean; active: boolean }) {
  const [data, setData] = useState<Dashboard | null>(null);
  const [editing, setEditing] = useState(false);
  const [editingGoal, setEditingGoal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const revision = useRef(0);
  const [day, setDay] = useState(() => new Date().toDateString());

  useEffect(() => {
    const update = () => setDay(new Date().toDateString());
    const timer = window.setInterval(update, 30_000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') { update(); setRefresh((value) => value + 1); }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, []);

  useEffect(() => {
    if (!authenticated || !active || saving) return;
    const controller = new AbortController();
    const requestedRevision = revision.current;
    waitForActivitySaves().then(() => dashboardRequest({ signal: controller.signal }))
      .then((value) => {
        if (!controller.signal.aborted && requestedRevision === revision.current) setData(value);
      })
      .catch((err: unknown) => { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Не удалось загрузить данные.'); });
    return () => controller.abort();
  }, [authenticated, refresh, day, active, saving]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = (key: string) => {
      const raw = String(form.get(key) ?? '').trim().replace(',', '.');
      return raw === '' ? null : Number(raw);
    };
    revision.current++;
    setSaving(true);
    setError('');
    try {
      setData(await dashboardRequest({ method: 'PATCH', body: JSON.stringify({
        currentFat: value('currentFat'), targetFat: value('targetFat'),
        currentWeight: value('currentWeight'), targetWeight: value('targetWeight'),
      }) }));
      setEditing(false);
    } catch (err) { setError(err instanceof Error ? err.message : 'Не удалось сохранить данные.'); }
    finally { setSaving(false); }
  }

  async function saveWorkoutGoal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const raw = String(new FormData(event.currentTarget).get('goal') ?? '').trim();
    revision.current++;
    setSaving(true);
    setError('');
    try {
      setData(await dashboardRequest({ method: 'PATCH', body: JSON.stringify({ goal: raw === '' ? null : Number(raw) }) }, '/api/workout-goal'));
      setEditingGoal(false);
    } catch (err) { setError(err instanceof Error ? err.message : 'Не удалось сохранить цель.'); }
    finally { setSaving(false); }
  }

  const p = data?.profile;
  const remaining = p?.currentWeight != null && p.targetWeight != null ? Math.abs(p.currentWeight - p.targetWeight) : null;
  const month = data ? new Date(`${data.month}-01T12:00:00`).toLocaleDateString('ru-RU', { month: 'long' })
    : new Date().toLocaleDateString('ru-RU', { month: 'long' });

  return (
    <section className="home" aria-labelledby="home-title">
      <header className="home-header"><div><p className="eyebrow">Твоя форма</p><h1 id="home-title">Фигура и цели</h1></div>
        <button className="edit-profile" disabled={!authenticated || !data} onClick={() => setEditing(!editing)}>{editing ? 'Закрыть' : 'Изменить'}</button>
      </header>
      {editing && data && <form className="profile-form" onSubmit={(event) => void save(event)}>
        <h2>Мои показатели</h2>
        <fieldset disabled={saving}><div className="profile-fields">
          {(['currentFat', 'targetFat'] as const).map((key) => <label key={key}>{key === 'currentFat' ? 'Жир сейчас, %' : 'Целевой жир, %'}
            <input name={key} type="number" inputMode="decimal" min="1" max="70" step="0.1"
              defaultValue={p?.[key] ?? ''} placeholder="Не указан" /></label>)}
          <label>Вес сейчас, кг<input name="currentWeight" type="number" inputMode="decimal" min="20" max="400" step="0.1" defaultValue={p?.currentWeight ?? ''} placeholder="Не указан" /></label>
          <label>Целевой вес, кг<input name="targetWeight" type="number" inputMode="decimal" min="20" max="400" step="0.1" defaultValue={p?.targetWeight ?? ''} placeholder="Не указан" /></label>
        </div><p className="form-hint">При смене цели прогресс начнётся от текущего веса.</p>
          <button className="save-profile" type="submit">Сохранить</button>
        </fieldset>
      </form>}
      <div className="figure-card">
        <svg className="body-figure" viewBox="0 0 80 180" fill="none" aria-hidden="true">
          <circle cx="40" cy="15" r="10" />
          <path d="M34 25v7l-15 5c-7 3-9 18-10 30L6 101c0 5 5 6 7 1l5-30 1-13 3 48 5 62h10l3-48 3 48h10l5-62 3-48 1 13 5 30c2 5 7 4 7-1l-3-34c-1-12-3-27-10-30l-15-5v-7" />
          <path d="m22 40 6 14 12 3 12-3 6-14M28 99q12 5 24 0" opacity=".45" />
        </svg>
        <div className="figure-data"><p className="eyebrow">Сейчас · % жира</p>
          <div className="fat-value">{number(p?.currentFat)}<span>%</span></div>
          <span className="fat-goal">Цель <strong>{number(p?.targetFat)}%</strong></span>
          {p?.currentFat == null && <p className="empty-hint">Добавь свой первый замер</p>}
        </div>
      </div>

      <div className="weight-card">
        <div className="section-heading"><h2>Вес и цель</h2><span>кг</span></div>
        <div className="weight-values"><div><span>Сейчас</span><strong>{number(p?.currentWeight)}</strong></div>
          <span className="weight-arrow" aria-hidden="true">→</span><div><span>Цель</span><strong>{number(p?.targetWeight)}</strong></div></div>
        <div className="progress-caption"><span>Прогресс к цели</span><strong>{data?.progress == null ? '—' : `${data.progress}%`}</strong></div>
        <progress className="weight-progress" max="100" value={data?.progress ?? 0} aria-label="Прогресс к цели по весу" />
        <p className="progress-note">{remaining === null ? 'Укажи текущий вес и цель, чтобы отслеживать прогресс.'
          : remaining < 0.05 ? 'Целевой вес достигнут.' : `До цели ${number(Math.round(remaining * 10) / 10)} кг`}</p>
        {p?.startWeight != null && <p className="progress-baseline">Старт {number(p.startWeight)} кг</p>}
      </div>

      <div className="workouts-card"><div className="section-heading"><h2>Тренировки за месяц</h2><span className="month-label">{month}</span></div>
        <div className="workouts-target-row">
          <div className="workouts-total">{data ? data.workouts.total : '—'}<span>{data?.workouts.goal != null ? `/ ${data.workouts.goal}` : 'всего'}</span></div>
          <button className="edit-profile" disabled={!authenticated || !data || saving} onClick={() => setEditingGoal(!editingGoal)}>
            {editingGoal ? 'Закрыть' : data?.workouts.goal != null ? 'Изменить цель' : 'Задать цель'}
          </button>
        </div>
        {editingGoal && data && <form className="workout-goal-form" onSubmit={(event) => void saveWorkoutGoal(event)}>
          <label htmlFor="workout-goal">Цель тренировок на {month}</label>
          <div><input id="workout-goal" name="goal" type="number" inputMode="numeric" min="1" max="1000" step="1"
            defaultValue={data.workouts.goal ?? ''} placeholder="Например, 16" disabled={saving} />
            <button className="save-profile" type="submit" disabled={saving}>Сохранить</button></div>
          <p className="form-hint">Пустое поле убирает цель. Цель задаётся на этот месяц.</p>
        </form>}
        <div className="progress-caption"><span>{data?.workouts.progress != null ? `Выполнено ${data.workouts.progress}%` : 'Цель на месяц не задана'}</span>
          {data?.workouts.goal != null && <strong>{data.workouts.total >= data.workouts.goal ? 'Цель достигнута' : `Осталось ${data.workouts.goal - data.workouts.total}`}</strong>}
        </div>
        <progress className="weight-progress workout-progress" max="100" value={data?.workouts.progress ?? 0} aria-label="Прогресс к цели тренировок за месяц" />
        <p className="workout-count-note">Один день с тренировкой — один зачёт.</p>
        <div className="workouts-breakdown"><span><i className="main-dot" />Основные <strong>{data ? data.workouts.training : '—'}</strong></span>
          <span><i className="micro-dot" />Микро <strong>{data ? data.workouts.microTraining : '—'}</strong></span></div>
      </div>

      {authenticated && data && !editing && p?.currentWeight == null && p?.currentFat == null && <button className="save-profile" onClick={() => setEditing(true)}>Добавить показатели</button>}
      {!telegram?.initData && <p className="activity-status">Открой приложение через Telegram, чтобы добавить показатели.</p>}
      {error && <div className="activity-error" role="alert"><p>{error}</p>{!editing && <button className="retry-button" onClick={() => { setError(''); setRefresh((v) => v + 1); }}>Повторить</button>}</div>}
    </section>
  );
}
