import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Dumbbell, ListChecks, Save } from '../components/icons';
import html2pdf from 'html2pdf.js';
import axios from 'axios';
import {
  workoutPlanApi,
  type SavedWorkoutPlan,
  type WorkoutDayPayload,
  type WorkoutSessionSnapshot,
  type WorkoutSessionTrack,
} from '../api/services';
import { useAuth } from '../context/AuthContext';
import { formatApiError } from '../api/errors';

const DURATIONS = [14, 30, 90, 180] as const;
const SESSIONS = ['session1', 'session2', 'session3', 'session4'] as const;
const SESSION_LABELS: Record<(typeof SESSIONS)[number], string> = {
  session1: 'Блок 1 (утро / активация)',
  session2: 'Блок 2 (основной)',
  session3: 'Блок 3 (вечер / мобильность)',
  session4: 'Блок 4 (доп. кардио / восстановление)',
};

function workoutPlanStatusLabel(status: string): string {
  if (status === 'active') return 'активный';
  if (status === 'completed') return 'завершён';
  if (status === 'cancelled') return 'архив';
  return status;
}

function formatRuWorkoutSaveStamp(d = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Minsk',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `План тренировок ${get('day')}.${get('month')}.${get('year')} ${get('hour')}:${get('minute')}`;
}

type SlotKey = (typeof SESSIONS)[number];
const WORKOUT_DND_MIME = 'application/x-workout-block';

type DayState = {
  day: number;
  date?: string;
  dayId?: string;
  sessions: Record<SlotKey, WorkoutSessionSnapshot | null>;
  sessionStatuses: Partial<Record<SlotKey, WorkoutSessionTrack>>;
};

function snapshotFromRow(
  key: SlotKey,
  raw: Record<string, unknown> | null | undefined,
): WorkoutSessionSnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  return {
    blockId: typeof r.blockId === 'string' ? r.blockId : undefined,
    title: String(r.title ?? ''),
    description: String(r.description ?? ''),
    durationMin: Number(r.durationMin ?? 0),
    exercises: Array.isArray(r.exercises) ? (r.exercises as string[]) : [],
    slot: key,
  };
}

function emptyWorkoutDays(len: number): DayState[] {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return Array.from({ length: len }).map((_, index) => ({
    day: index + 1,
    date: new Date(start.getTime() + index * 24 * 60 * 60 * 1000).toISOString(),
    sessions: {
      session1: null,
      session2: null,
      session3: null,
      session4: null,
    } as Record<SlotKey, WorkoutSessionSnapshot | null>,
    sessionStatuses: {},
  }));
}

function statusLabel(s: WorkoutSessionTrack | undefined) {
  if (s === 'done') return 'выполнено';
  if (s === 'skipped') return 'пропуск';
  return 'ожидает';
}

/** Фон ячейки учёта: ожидает — голубой, выполнил — зелёный, пропуск — красный */
function trackingCellBackground(st: WorkoutSessionTrack | undefined): CSSProperties {
  if (st === 'done') {
    return {
      background: 'var(--bg-elevated, #fff)',
      // Зелёный из палитры: подтверждает выполнение.
      // Переменная --done-color переопределяется для тёмной темы:
      // базовый оливковый даёт на тёмном фоне контраст лишь 3:1.
      border: '2px solid var(--done-color, #5C6B3F)',
    };
  }
  if (st === 'skipped') {
    return {
      background: 'var(--bg-elevated, #fff)',
      border: '2px solid rgba(239, 68, 68, 0.75)',
    };
  }
  return {
    background: 'var(--bg-elevated, #fff)',
    border: '2px solid rgba(14, 165, 233, 0.65)',
  };
}

export const WorkoutPlanPage = () => {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const loadPlanFromUrl = searchParams.get('loadPlan');
  const loadPlanId = useMemo(() => {
    if (typeof sessionStorage === 'undefined') return loadPlanFromUrl;
    return loadPlanFromUrl ?? sessionStorage.getItem('workoutPlan:lastOpened');
  }, [loadPlanFromUrl]);
  const pdfRef = useRef<HTMLDivElement | null>(null);
  const [duration, setDuration] = useState<(typeof DURATIONS)[number]>(14);
  const [days, setDays] = useState<DayState[]>([]);
  const [planMeta, setPlanMeta] = useState<{
    id: string;
    name: string | null;
    status: string;
    endDate: string;
    trackingStartedAt: string | null;
  } | null>(null);
  const [allBlocks, setAllBlocks] = useState<
    Array<{ id: string; slot: string; title: string; description: string; durationMin: number; exercises: string[] }>
  >([]);
  const [search, setSearch] = useState('');
  const filteredBlocks = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? allBlocks.filter((b) => b.title.toLowerCase().includes(q)) : allBlocks;
  }, [allBlocks, search]);
  const [selected, setSelected] = useState<WorkoutSessionSnapshot | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [isDraggingBlock, setIsDraggingBlock] = useState(false);
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(false);
  const [trackingLoading, setTrackingLoading] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const dateLabel = (iso?: string) =>
    iso
      ? new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', timeZone: 'Europe/Minsk' })
      : '';

  const applySaved = useCallback((plan: SavedWorkoutPlan | null) => {
    if (!plan?.days?.length) return;
    setPlanMeta({
      id: plan.id,
      name: plan.name ?? null,
      status: plan.status,
      endDate: plan.endDate,
      trackingStartedAt: plan.trackingStartedAt ?? null,
    });
    setDuration(plan.durationDays as (typeof DURATIONS)[number]);
    setDays(
      plan.days.map((row) => ({
        day: row.dayNumber,
        date: row.date,
        dayId: row.id,
        sessions: {
          session1: snapshotFromRow('session1', row.session1 as never),
          session2: snapshotFromRow('session2', row.session2 as never),
          session3: snapshotFromRow('session3', row.session3 as never),
          session4: snapshotFromRow('session4', row.session4 as never),
        },
        sessionStatuses: {
          session1: row.sessionStatuses?.session1,
          session2: row.sessionStatuses?.session2,
          session3: row.sessionStatuses?.session3,
          session4: row.sessionStatuses?.session4,
        },
      })),
    );
  }, []);

  useEffect(() => {
    const load = async () => {
      if (!user) return;
      setLoading(true);
      try {
        const blockList = await workoutPlanApi.blocks();
        setAllBlocks(blockList);
        if (loadPlanId) {
          const plan = await workoutPlanApi.getPlan(user.id, loadPlanId);
          if (plan?.days?.length) {
            applySaved(plan);
            if (plan.id) sessionStorage.setItem('workoutPlan:lastOpened', String(plan.id));
          }
          return;
        }
        const plan = await workoutPlanApi.getActive(user.id);
        if (plan?.days?.length) {
          applySaved(plan);
          if (plan.id) sessionStorage.setItem('workoutPlan:lastOpened', String(plan.id));
        } else {
          setPlanMeta(null);
          setDays(emptyWorkoutDays(14));
          setDuration(14);
        }
      } catch (err) {
        setMsg(formatApiError(err, 'Не удалось загрузить план тренировок.'));
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [user, loadPlanId, applySaved]);

  const endSummary = useMemo(() => {
    if (!planMeta?.endDate || !days.length) return null;
    const end = new Date(planMeta.endDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    end.setHours(0, 0, 0, 0);
    if (end >= today) return null;
    let done = 0;
    let skipped = 0;
    let scheduled = 0;
    for (const d of days) {
      for (const slot of SESSIONS) {
        if (!d.sessions[slot]?.title) continue;
        scheduled += 1;
        const st = d.sessionStatuses[slot];
        if (st === 'done') done += 1;
        else if (st === 'skipped') skipped += 1;
      }
    }
    return { done, skipped, scheduled, planEnded: true as const };
  }, [planMeta, days]);

  const allScheduledSlotsMarked = useMemo(() => {
    for (const d of days) {
      for (const slot of SESSIONS) {
        if (!d.sessions[slot]?.title) continue;
        const st = d.sessionStatuses[slot];
        if (st !== 'done' && st !== 'skipped') return false;
      }
    }
    return true;
  }, [days]);

  const generateServer = async () => {
    if (!user) return;
    setMsg('');
    try {
      const saved = await workoutPlanApi.generate(user.id, duration);
      applySaved(saved);
      setMsg('План тренировок сгенерирован и сохранён.');
    } catch (err) {
      setMsg(formatApiError(err, 'Не удалось сгенерировать план.'));
    }
  };

  const savePlan = async () => {
    if (!user) return;
    const payload: WorkoutDayPayload[] = days.map((d) => ({
      dayNumber: d.day,
      session1: d.sessions.session1,
      session2: d.sessions.session2,
      session3: d.sessions.session3,
      session4: d.sessions.session4,
    }));
    try {
      const name = formatRuWorkoutSaveStamp(new Date());
      const saved = await workoutPlanApi.save(user.id, { durationDays: duration, days: payload, name });
      applySaved(saved);
      setMsg('План сохранён.');
    } catch (err) {
      setMsg('Не удалось сохранить.');
    }
  };

  const exportPdf = async () => {
    if (!pdfRef.current) return;
    setIsExportingPdf(true);
    document.body.classList.add('pdf-export-loading');
    document.body.classList.add('pdf-exporting');
    try {
      await new Promise((resolve) => setTimeout(resolve, 0));
      const options: Record<string, unknown> = {
        margin: 10,
        filename: `workout-plan-${user?.id ?? 'user'}.pdf`,
        image: { type: 'jpeg', quality: 0.95 },
        html2canvas: {
          scale: 2,
          ignoreElements: (el: HTMLElement) => el.tagName.toLowerCase() === 'img',
        },
        pagebreak: { mode: ['css'], before: '.workout-pdf-break-before' },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' },
      };
      await html2pdf()
        .set(options as never)
        .from(pdfRef.current)
        .save();
    } finally {
      document.body.classList.remove('pdf-exporting');
      document.body.classList.remove('pdf-export-loading');
      setIsExportingPdf(false);
    }
  };

  const setSession = (day: number, slot: SlotKey, v: WorkoutSessionSnapshot | null) => {
    setDays((prev) =>
      prev.map((row) =>
        row.day === day ? { ...row, sessions: { ...row.sessions, [slot]: v } } : row,
      ),
    );
  };

  const filteredBySlot = (slot: SlotKey) => filteredBlocks.filter((b) => b.slot === slot);

  const toSnapshotFromBlock = (
    b: { id: string; slot: string; title: string; description: string; durationMin: number; exercises: string[] },
    slotOverride?: SlotKey,
  ): WorkoutSessionSnapshot => ({
    blockId: b.id,
    title: b.title,
    description: b.description,
    durationMin: b.durationMin,
    exercises: b.exercises,
    slot: (slotOverride ?? (b.slot as WorkoutSessionSnapshot['slot'])) as WorkoutSessionSnapshot['slot'],
  });

  const parseDraggedBlock = (data: string): WorkoutSessionSnapshot | null => {
    try {
      const parsed = JSON.parse(data) as Partial<WorkoutSessionSnapshot>;
      if (!parsed || typeof parsed !== 'object' || !parsed.title || !parsed.slot) return null;
      return {
        blockId: parsed.blockId,
        title: String(parsed.title),
        description: String(parsed.description ?? ''),
        durationMin: Number(parsed.durationMin ?? 0),
        exercises: Array.isArray(parsed.exercises) ? parsed.exercises.map(String) : [],
        slot: parsed.slot as WorkoutSessionSnapshot['slot'],
      };
    } catch (err) {
      return null;
    }
  };

  const startDragBlock = (e: DragEvent<HTMLElement>, snapshot: WorkoutSessionSnapshot) => {
    setIsDraggingBlock(true);
    e.dataTransfer.setData(WORKOUT_DND_MIME, JSON.stringify(snapshot));
    e.dataTransfer.effectAllowed = 'copyMove';
  };

  const handleBlockDrop = (e: DragEvent<HTMLElement>, day: number, slot: SlotKey) => {
    e.preventDefault();
    setDropTargetId(null);
    setIsDraggingBlock(false);
    const raw = e.dataTransfer.getData(WORKOUT_DND_MIME);
    const block = parseDraggedBlock(raw);
    if (!block) return;
    if (block.slot !== slot) {
      setMsg('Перетаскивайте блок только в соответствующий слот (1-4).');
      setTimeout(() => setMsg(''), 2500);
      return;
    }
    setSession(day, slot, { ...block, slot });
  };

  const onCellDragOver = (e: DragEvent<HTMLElement>, day: number, slot: SlotKey) => {
    e.preventDefault();
    setDropTargetId(`${day}-${slot}`);
    const wrap = (e.currentTarget as HTMLElement).closest('.table-wrap') as HTMLElement | null;
    if (!wrap) return;
    const r = wrap.getBoundingClientRect();
    const edge = 56;
    if (e.clientY < r.top + edge) wrap.scrollTop -= 18;
    else if (e.clientY > r.bottom - edge) wrap.scrollTop += 18;
  };

  const onCellDragLeave = (e: DragEvent<HTMLElement>, day: number, slot: SlotKey) => {
    const current = e.currentTarget as HTMLElement;
    const related = e.relatedTarget as Node | null;
    if (related && current.contains(related)) return;
    const id = `${day}-${slot}`;
    setDropTargetId((prev) => (prev === id ? null : prev));
  };

  useEffect(() => {
    if (!isDraggingBlock) return;
    const onWindowDragOver = (e: globalThis.DragEvent) => {
      const edge = 80;
      if (e.clientY < edge) {
        window.scrollBy(0, -20);
      } else if (e.clientY > window.innerHeight - edge) {
        window.scrollBy(0, 20);
      }
      const target = e.target as HTMLElement | null;
      const lib = target?.closest?.('.workout-block-library') as HTMLElement | null;
      if (lib) {
        const r = lib.getBoundingClientRect();
        if (e.clientY < r.top + 40) lib.scrollTop -= 16;
        else if (e.clientY > r.bottom - 40) lib.scrollTop += 16;
      }
    };
    const stopDrag = () => {
      setIsDraggingBlock(false);
      setDropTargetId(null);
    };
    window.addEventListener('dragover', onWindowDragOver as EventListener);
    window.addEventListener('drop', stopDrag);
    window.addEventListener('dragend', stopDrag);
    return () => {
      window.removeEventListener('dragover', onWindowDragOver as EventListener);
      window.removeEventListener('drop', stopDrag);
      window.removeEventListener('dragend', stopDrag);
    };
  }, [isDraggingBlock]);

  const makePlanActive = async () => {
    if (!user || !planMeta) return;
    setMsg('');
    try {
      const saved = await workoutPlanApi.activatePlan(user.id, planMeta.id);
      applySaved(saved);
      setMsg('План сделан активным; предыдущий активный переведён в архив.');
    } catch (err) {
      setMsg('Не удалось активировать план.');
    }
  };

  const startUsingPlan = async () => {
    if (!user || !planMeta) {
      setMsg('Сначала сохраните план в БД.');
      return;
    }
    if (planMeta.status !== 'active') {
      setMsg('Сначала сделайте план активным (кнопка выше) или в «Мои планы тренировок».');
      return;
    }
    setTrackingLoading(true);
    setMsg('');
    try {
      const plan = await workoutPlanApi.startTracking(user.id, planMeta.id);
      applySaved(plan);
      setMsg('Режим учёта включён. Отметьте тренировки в таблице ниже.');
    } catch (err) {
      setMsg('Не удалось начать учёт.');
    } finally {
      setTrackingLoading(false);
    }
  };

  const setSessionTrack = async (dayId: string | undefined, slot: SlotKey, value: WorkoutSessionTrack | null) => {
    if (!user || !dayId) {
      setMsg('Сохраните план, чтобы вести учёт по дням.');
      return;
    }
    setTrackingLoading(true);
    setMsg('');
    try {
      const body =
        value === null
          ? { [slot]: null as null }
          : { [slot]: value };
      await workoutPlanApi.patchDaySessions(user.id, dayId, body);
      setDays((prev) =>
        prev.map((d) => {
          if (d.dayId !== dayId) return d;
          const next = { ...d.sessionStatuses };
          if (value === null) delete next[slot];
          else next[slot] = value;
          return { ...d, sessionStatuses: next };
        }),
      );
    } catch (err) {
      setMsg('Не удалось обновить статус.');
    } finally {
      setTrackingLoading(false);
    }
  };

  const finishCompleteTracking = async (early: boolean) => {
    if (!user || !planMeta) return;
    if (early) {
    }
    setTrackingLoading(true);
    setMsg('');
    try {
      const plan = await workoutPlanApi.completeTracking(user.id, planMeta.id, early);
      applySaved(plan);
      setMsg(
        early
          ? 'Учёт завершён досрочно.'
          : 'Учёт завершён: все тренировки отмечены. План снят с активных.',
      );
    } catch (e) {
      const m =
        axios.isAxiosError(e) && e.response?.data
          ? (Array.isArray((e.response.data as { message?: unknown }).message)
              ? (e.response.data as { message: string[] }).message.join(' ')
              : (e.response.data as { message?: string }).message)
          : null;
      setMsg(m || 'Не удалось завершить учёт.');
    } finally {
      setTrackingLoading(false);
    }
  };

  const trackingStarted = Boolean(planMeta?.trackingStartedAt);
  /** Таблица с кнопками: только для активного плана с начатым учётом. */
  const showActiveTracking = trackingStarted && planMeta?.status === 'active';
  const canTrack = Boolean(planMeta?.id) && planMeta?.status === 'active';
  const trainingFinishedOnPlan = planMeta?.status === 'completed' && trackingStarted;

  return (
    <div className="profile-premium plan-surface">
      <section className="card section-card">
        <div className="section-head">
          <Dumbbell size={18} />
          <h2>План тренировок</h2>
        </div>
        <p className="muted small">
          Сроки как у питания: 2 недели, 1 мес., 3 мес., 6 мес. Четыре блока в день. Сохранённые планы — в разделе{' '}
          <Link to="/workout-plans" className="workout-plans-link">
            Мои планы тренировок
          </Link>
          . Открытый из списка архивный или завершённый план можно снова сделать активным кнопкой ниже.
        </p>
        {planMeta ? (
          <p className="muted small" style={{ marginTop: 6 }}>
            План: <strong>{planMeta.name ?? 'без названия'}</strong> ·{' '}
            {workoutPlanStatusLabel(planMeta.status)} ·{' '}
            {new Date(planMeta.endDate).toLocaleDateString('ru-RU', { timeZone: 'Europe/Minsk' })}
          </p>
        ) : null}
        <div className="chip-grid" style={{ marginBottom: 12 }}>
          {DURATIONS.map((d) => (
            <button
              key={d}
              type="button"
              className={`allergy-chip ${duration === d ? 'selected' : ''}`}
              onClick={() => {
                setDuration(d);
                setDays(emptyWorkoutDays(d));
                setPlanMeta(null);
              }}
            >
              {d === 14 ? '2 нед.' : d === 30 ? '1 мес.' : d === 90 ? '3 мес.' : '6 мес.'} ({d} дн.)
            </button>
          ))}
        </div>
        <div className="stack-row wrap-actions">
          <button type="button" className="btn-primary" onClick={generateServer}>
            Сгенерировать из библиотеки и сохранить
          </button>
          <button type="button" className="btn-secondary" onClick={savePlan}>
            <Save size={16} /> Сохранить в БД
          </button>
          <button type="button" className="btn-secondary" onClick={exportPdf}>
            PDF
          </button>
          {planMeta?.status !== 'active' ? (
            <button type="button" className="btn-secondary" onClick={() => void makePlanActive()}>
              Сделать активным
            </button>
          ) : null}
        </div>
        {loading ? <p className="muted">Загрузка…</p> : null}
        {msg ? <p className="success">{msg}</p> : null}

        {endSummary ? (
          <div className="card" style={{ marginTop: 12, padding: 12, borderLeft: '3px solid var(--accent, #4a7)' }}>
            <h4>Итог плана (срок ended)</h4>
            <p className="small">
              Запланировано тренировок (блоков с нагрузкой): <strong>{endSummary.scheduled}</strong>. Выполнено:{' '}
              <strong>{endSummary.done}</strong>. Пропущено: <strong>{endSummary.skipped}</strong>.
            </p>
          </div>
        ) : null}

        {trainingFinishedOnPlan ? (
          <div className="card" style={{ marginTop: 12, padding: 12 }}>
            <p className="muted small" style={{ margin: 0 }}>
              План завершён и убран из активных. Открыть можно в «Мои планы тренировок» (статус completed).
            </p>
          </div>
        ) : null}

        {canTrack ? (
          <div className="stack-row wrap-actions" style={{ marginTop: 12 }}>
            <button
              type="button"
              className="btn-primary"
              disabled={trackingLoading || trackingStarted}
              onClick={() => void startUsingPlan()}
            >
              <ListChecks size={16} /> {trackingStarted ? 'Учёт включён' : 'Начать использовать план тренировок'}
            </button>
            {!trackingStarted ? (
              <span className="muted small">После нажатия откроется таблица выполнения по дням и блокам.</span>
            ) : null}
          </div>
        ) : null}

        {showActiveTracking ? (
          <div className="table-wrap" style={{ marginTop: 14, maxHeight: 420, overflow: 'auto' }}>
            <h4>Учёт тренировок</h4>
            <p className="muted small">Для каждого блока: «Выполнил», «Пропустить» или сброс.</p>
            <table className="plan-table workout-plan-table">
              <thead>
                <tr>
                  <th>День</th>
                  {SESSIONS.map((s) => (
                    <th key={s}>{SESSION_LABELS[s]}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {days.map((row) => (
                  <tr key={row.day}>
                    <td>
                      <strong>{dateLabel(row.date)}</strong>
                      <div className="muted small">День {row.day}</div>
                    </td>
                    {SESSIONS.map((slot) => {
                      const sn = row.sessions[slot];
                      const st = row.sessionStatuses[slot];
                      if (!sn?.title) {
                        return (
                          <td key={slot} style={{ background: 'var(--wo-empty)' }}>
                            <span className="muted">—</span>
                          </td>
                        );
                      }
                      return (
                        <td
                          key={slot}
                          style={{
                            ...trackingCellBackground(st),
                            padding: 10,
                            verticalAlign: 'top',
                            borderRadius: 6,
                          }}
                        >
                          <div className="small" style={{ marginBottom: 6 }}>
                            {sn.title}
                          </div>
                          <span className="small" style={{ fontWeight: 500 }}>
                            {statusLabel(st)}
                          </span>
                          <div className="chip-grid" style={{ marginTop: 6 }}>
                            <button
                              type="button"
                              className="allergy-chip"
                              disabled={trackingLoading}
                              onClick={() => void setSessionTrack(row.dayId, slot, 'done')}
                            >
                              Выполнил
                            </button>
                            <button
                              type="button"
                              className="allergy-chip"
                              disabled={trackingLoading}
                              onClick={() => void setSessionTrack(row.dayId, slot, 'skipped')}
                            >
                              Пропустить
                            </button>
                            <button
                              type="button"
                              className="allergy-chip"
                              disabled={trackingLoading}
                              onClick={() => void setSessionTrack(row.dayId, slot, null)}
                            >
                              Сброс
                            </button>
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="stack-row wrap-actions" style={{ marginTop: 14 }}>
              <button
                type="button"
                className="btn-primary"
                disabled={trackingLoading || !allScheduledSlotsMarked}
                onClick={() => void finishCompleteTracking(false)}
                title="Доступно, когда у каждой запланированной тренировки выбрано «выполнено» или «пропустить»"
              >
                Завершить учёт
              </button>
              <button
                type="button"
                className="btn-secondary"
                disabled={trackingLoading}
                onClick={() => void finishCompleteTracking(true)}
              >
                Завершить учёт досрочно
              </button>
            </div>
            <p className="muted small" style={{ marginTop: 8 }}>
              «Завершить учёт» — когда все ячейки не в статусе «ожидает». «Досрочно» — в любой момент (с подтверждением);
              план перестаёт быть активным.
            </p>
          </div>
        ) : null}

        <div className="card" style={{ marginTop: 12 }}>
          <h4>Библиотека блоков</h4>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Поиск…" />
          <div className="workout-block-library" style={{ marginTop: 8 }}>
            {filteredBlocks.slice(0, 80).map((b) => (
              <button
                key={b.id}
                type="button"
                className="allergy-chip"
                draggable
                onDragStart={(e) => startDragBlock(e, toSnapshotFromBlock(b))}
                onDragEnd={() => setIsDraggingBlock(false)}
                onClick={() =>
                  setSelected({
                    ...toSnapshotFromBlock(b),
                  })
                }
              >
                {b.title}
              </button>
            ))}
          </div>
        </div>

        <div ref={pdfRef} className="table-wrap pdf-export" style={{ marginTop: 14 }}>
          <h4>План тренировок (сетка)</h4>
          <table className="plan-table workout-plan-table">
            <thead>
              <tr>
                <th>День</th>
                {SESSIONS.map((s) => (
                  <th key={s}>{SESSION_LABELS[s]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {days.map((row, rowIndex) => (
                <tr key={row.day} className={rowIndex > 0 && rowIndex % 8 === 0 ? 'workout-pdf-break-before' : undefined}>
                  <td>
                    <strong>{dateLabel(row.date)}</strong>
                    <div className="muted small">День {row.day}</div>
                  </td>
                  {SESSIONS.map((slot) => (
                    <td
                      key={slot}
                      className={dropTargetId === `${row.day}-${slot}` ? 'cell-drop-over' : undefined}
                      onDragOver={(e) => onCellDragOver(e, row.day, slot)}
                      onDragLeave={(e) => onCellDragLeave(e, row.day, slot)}
                      onDrop={(e) => handleBlockDrop(e, row.day, slot)}
                    >
                      <button
                        type="button"
                        className="cell-card"
                        draggable={Boolean(row.sessions[slot])}
                        onDragStart={(e) => {
                          const current = row.sessions[slot];
                          if (current) startDragBlock(e, current);
                        }}
                        onDragEnd={() => setIsDraggingBlock(false)}
                        onClick={() => setSelected(row.sessions[slot])}
                      >
                        {row.sessions[slot]?.title ?? '—'}
                      </button>
                      {selected && selected.slot === slot ? (
                        <button
                          type="button"
                          className="allergy-chip selected"
                          style={{ marginTop: 6, display: 'block' }}
                          onClick={() => setSession(row.day, slot, selected)}
                        >
                          Подставить блок
                        </button>
                      ) : null}
                      {!isExportingPdf ? <div className="chip-grid" style={{ marginTop: 6 }}>
                        {filteredBySlot(slot)
                          .slice(0, 3)
                          .map((b) => (
                            <button
                              key={`${row.day}-${b.id}`}
                              type="button"
                              className="allergy-chip"
                              onClick={() =>
                                setSession(row.day, slot, toSnapshotFromBlock(b, slot))
                              }
                            >
                              + {b.title.slice(0, 22)}…
                            </button>
                          ))}
                      </div> : null}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {selected ? (
        <div className="modal-backdrop">
          <div className="modal-window">
            <h3>{selected.title}</h3>
            <p className="muted small">{selected.description}</p>
            <p>Длительность: {selected.durationMin} мин</p>
            <ul className="recommend-list">
              {selected.exercises.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
            <button type="button" onClick={() => setSelected(null)}>
              Закрыть
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
};
