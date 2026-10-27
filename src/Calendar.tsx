import { useEffect, useState } from 'react';
import { telegram } from './telegram';
import { waitForActivitySaves, type Activity } from './Today';

const weekdays = ['ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ', 'ВС'];
const months = ['ЯНВ', 'ФЕВ', 'МАР', 'АПР', 'МАЙ', 'ИЮН', 'ИЮЛ', 'АВГ', 'СЕН', 'ОКТ', 'НОЯ', 'ДЕК'];

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function Calendar({ onSelectDate, authenticated, active, activities, activityRevision, onLoaded }: {
  onSelectDate: (date: string) => void;
  authenticated: boolean;
  active: boolean;
  activities: Record<string, Activity>;
  activityRevision: number;
  onLoaded: (activities: Activity[]) => void;
}) {
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [today, setToday] = useState(() => new Date());

  useEffect(() => {
    const update = () => setToday(new Date());
    const timer = window.setInterval(update, 60_000);
    document.addEventListener('visibilitychange', update);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', update);
    };
  }, []);

  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12);
  start.setDate(start.getDate() - (start.getDay() + 6) % 7);
  const weeks = Array.from({ length: 12 }, (_, week) => (
    Array.from({ length: 7 }, (_, day) => {
      const date = new Date(start);
      date.setDate(start.getDate() + week * 7 + day);
      return date;
    })
  ));

  const rangeStart = dateKey(weeks[0][0]);
  const rangeEnd = dateKey(weeks[11][6]);
  useEffect(() => {
    if (!authenticated) return;
    const controller = new AbortController();
    waitForActivitySaves().then(async () => {
      const response = await fetch(`/api/calendar?start=${rangeStart}&end=${rangeEnd}`, {
        headers: { Authorization: `tma ${telegram?.initData ?? ''}` }, signal: controller.signal,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      if (!controller.signal.aborted) { onLoaded(data.activities); setError(''); }
    }).catch((err: unknown) => {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Не удалось загрузить отметки.');
    });
    return () => controller.abort();
  }, [authenticated, active, rangeStart, rangeEnd, activityRevision, onLoaded, retry]);

  return (
    <section className="calendar" aria-labelledby="calendar-title">
      <header className="calendar-header">
        <h1 id="calendar-title">Календарь</h1>
        <span className="calendar-period">
          {today.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' }).replace(' г.', '')}
        </span>
      </header>
      <table className="calendar-grid" aria-label="Календарь на 12 недель">
        <thead>
          <tr>
            <th className="week-heading" scope="col"><span className="sr-only">Неделя</span></th>
            {weekdays.map((day) => <th key={day} scope="col">{day}</th>)}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week, index) => (
            <tr key={dateKey(week[0])}>
              <th className="week-number" scope="row"><span className="sr-only">Неделя </span>{index + 1}</th>
              {week.map((date, day) => {
                const activity = activities[dateKey(date)];
                const labels = [activity?.training && 'основная тренировка', activity?.microTraining && 'микро тренировка', activity?.walking && 'ходьба'].filter(Boolean);
                const isToday = dateKey(date) === dateKey(today);
                const showMonth = date.getDate() === 1 || (index === 0 && day === 0);
                return (
                  <td key={dateKey(date)}>
                    <button type="button" onClick={() => onSelectDate(dateKey(date))} className={`calendar-day${isToday ? ' calendar-day-today' : ''}`}
                      aria-current={isToday ? 'date' : undefined}
                      aria-label={`${date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}${isToday ? ', сегодня' : ''}${labels.length ? ', выполнено: ' + labels.join(', ') : ''}`}>
                      {showMonth && <span className="day-month" aria-hidden="true">{months[date.getMonth()]}</span>}
                      <span className="day-number" aria-hidden="true">{date.getDate()}</span>
                      <span className="day-marks" aria-hidden="true">
                        {activity?.training && <i className="mark-training" />}
                        {activity?.microTraining && <i className="mark-micro" />}
                        {activity?.walking && <i className="mark-walking" />}
                      </span>
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="calendar-legend" aria-label="Обозначения отметок">
        <span><i className="mark-training" />Основная</span>
        <span><i className="mark-micro" />Микро</span>
        <span><i className="mark-walking" />Ходьба</span>
      </div>
      {error && <div className="activity-error" role="alert"><p>{error}</p>
        <button className="retry-button" onClick={() => setRetry((value) => value + 1)}>Повторить</button>
      </div>}
    </section>
  );
}
