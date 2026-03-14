import { useMemo } from 'react'
import { useAppStore } from '@/store/appStore'
import { KPICard } from '@/components/dashboard/KPICard'
import { BottleneckAlert } from '@/components/dashboard/BottleneckAlert'
import { WeeklyCalendar } from '@/components/dashboard/WeeklyCalendar'
import { DayScheduleGantt } from '@/components/charts/DayScheduleGantt'
import { buildWeekSchedule, analyzeScheduleDay } from '@/lib/scheduler'
import type { Weekday } from '@/types'

const WEEKDAYS: Weekday[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
const WD_DE: Record<Weekday, string> = { Mon: 'Mo', Tue: 'Di', Wed: 'Mi', Thu: 'Do', Fri: 'Fr' }

export default function Dashboard() {
  const results = useAppStore(s => s.getResults())
  const activeScenario = useAppStore(s => s.getActiveScenario())
  const updateScheduleConfig = useAppStore(s => s.updateScheduleConfig)

  const nPatients = Math.max(1, results?.maxPatientsPerCohort ?? 1)

  // Run scheduler & analyze for actual slot counts and wait times
  const scheduleAnalysis = useMemo(() => {
    if (!activeScenario || !results) return null
    const allSchedules = buildWeekSchedule(
      activeScenario.examinations, activeScenario.resourceGroups,
      activeScenario.resourceConfig, nPatients,
    )
    // Per absDay analyses
    const byAbsDay = new Map<number, ReturnType<typeof analyzeScheduleDay>>()
    for (const s of allSchedules) byAbsDay.set(s.absDay, analyzeScheduleDay(s))

    // Aggregate wait times across Week 2
    const waitTotals: Record<string, number> = {}
    for (const s of allSchedules.filter(s => s.week === 2)) {
      const a = byAbsDay.get(s.absDay)
      if (!a) continue
      for (const [gid, wt] of Object.entries(a.waitMinByGroup)) {
        waitTotals[gid] = (waitTotals[gid] ?? 0) + wt
      }
    }
    const sorted = Object.entries(waitTotals).sort((a, b) => b[1] - a[1])
    const worstWait = sorted[0]
    const worstWaitGroup = worstWait
      ? activeScenario.resourceGroups.find(g => g.id === worstWait[0])
      : null

    return { byAbsDay, worstWaitGroupName: worstWaitGroup?.name ?? '—', worstWaitMin: worstWait?.[1] ?? 0 }
  }, [activeScenario, results, nPatients])

  if (!results || !activeScenario) return <div>Keine Daten</div>

  const schedule = activeScenario.resourceConfig.scheduleConfig

  const toggleStartDay = (wd: Weekday) => {
    const current = schedule.startDays
    const next = current.includes(wd) ? current.filter(d => d !== wd) : [...current, wd]
    if (next.length === 0) return // must have at least 1 start day
    updateScheduleConfig({ startDays: next as Weekday[] })
  }

  const setTag2Offset = (delta: number) => {
    const cur = schedule.visitDayOffsets[1]
    const next = Math.max(1, Math.min(5, cur + delta))
    if (next === cur) return
    // Tag 3 must remain > Tag 2
    const tag3 = Math.max(schedule.visitDayOffsets[2], next + 1)
    updateScheduleConfig({ visitDayOffsets: [0, next, tag3] })
  }

  const setTag3Offset = (delta: number) => {
    const tag2 = schedule.visitDayOffsets[1]
    const cur = schedule.visitDayOffsets[2]
    const next = Math.max(tag2 + 1, Math.min(tag2 + 5, cur + delta))
    if (next === cur) return
    updateScheduleConfig({ visitDayOffsets: [0, tag2, next] })
  }

  const toggleLzAnlegenDay = () => {
    updateScheduleConfig({ lzAnlegenDay: schedule.lzAnlegenDay === 1 ? 2 : 1 })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <div>
        <h1 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#1e293b', margin: 0 }}>Dashboard</h1>
        <p style={{ fontSize: '0.85rem', color: '#64748b', marginTop: '0.25rem', marginBottom: 0 }}>
          Kapazitätsübersicht — mehrere Patientenkohorten laufen parallel
        </p>
      </div>

      <BottleneckAlert bottleneck={results.primaryBottleneck} />

      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
        <KPICard
          title="Wochendurchsatz"
          value={results.weeklyThroughput}
          subtitle={`${results.startDaysCount} Kohorte(n) × ${results.maxPatientsPerCohort} Pat./Kohorte`}
          color="blue"
        />
        <KPICard
          title="Pat. pro Kohorte"
          value={results.maxPatientsPerCohort}
          subtitle="Engpasskapazität je Starttag"
          color={results.maxPatientsPerCohort <= 4 ? 'red' : 'green'}
        />
        <KPICard
          title="Primärer Engpass"
          value={results.primaryBottleneck.resourceGroupName || '—'}
          subtitle={`am ${results.primaryBottleneck.affectedWeekday}`}
          color="orange"
        />
        <KPICard
          title="Kohortenstart-Tage"
          value={results.startDaysCount}
          subtitle={schedule.startDays.join(', ')}
          color="gray"
        />
        <KPICard
          title="Wartezeitverursacher"
          value={scheduleAnalysis?.worstWaitGroupName ?? '—'}
          subtitle={scheduleAnalysis ? `${scheduleAnalysis.worstWaitMin} min Gesamtwartezeit (W2)` : ''}
          color="orange"
        />
      </div>

      {/* Schedule configuration */}
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '1.25rem' }}>
        <div style={{ fontWeight: 600, marginBottom: '0.75rem', color: '#1e293b' }}>Patientenplan-Konfiguration</div>
        <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: '0.4rem', fontWeight: 500 }}>
              Kohortenstart-Wochentage
            </div>
            <div style={{ display: 'flex', gap: '0.4rem' }}>
              {WEEKDAYS.map(wd => {
                const active = schedule.startDays.includes(wd)
                return (
                  <button key={wd} onClick={() => toggleStartDay(wd)} style={{
                    padding: '0.3rem 0.65rem', borderRadius: '6px', cursor: 'pointer', fontSize: '0.8rem',
                    border: `1px solid ${active ? '#3b82f6' : '#cbd5e1'}`,
                    background: active ? '#eff6ff' : '#f8fafc',
                    color: active ? '#1d4ed8' : '#94a3b8',
                    fontWeight: active ? 700 : 400,
                  }}>
                    {WD_DE[wd]}
                  </button>
                )
              })}
            </div>
            <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: '0.3rem' }}>
              Wähle Tage, an denen neue Patienten ihren Tag 1 starten.
            </div>
          </div>

          <div>
            <div style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: '0.4rem', fontWeight: 500 }}>
              Tage zwischen den Besuchen
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              {([
                { label: 'Tag 1 → Tag 2', value: schedule.visitDayOffsets[1], onMinus: () => setTag2Offset(-1), onPlus: () => setTag2Offset(1) },
                { label: 'Tag 1 → Tag 3', value: schedule.visitDayOffsets[2], onMinus: () => setTag3Offset(-1), onPlus: () => setTag3Offset(1) },
              ] as const).map(row => (
                <div key={row.label} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ fontSize: '0.78rem', color: '#64748b', minWidth: '100px' }}>{row.label}</span>
                  <button onClick={row.onMinus} style={stepBtn}>−</button>
                  <span style={{ fontWeight: 700, minWidth: '20px', textAlign: 'center', fontSize: '0.9rem' }}>{row.value}</span>
                  <button onClick={row.onPlus} style={stepBtn}>+</button>
                  <span style={{ fontSize: '0.72rem', color: '#94a3b8' }}>Tage</span>
                </div>
              ))}
            </div>
            <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: '0.3rem' }}>
              Max. 5 Tage je Abstand. Tag 1, 2, 3 dürfen bis zu 5 Tage auseinanderliegen.
            </div>
          </div>

          <div>
            <div style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: '0.4rem', fontWeight: 500 }}>
              Langzeit-Gerät anlegen
            </div>
            <button onClick={toggleLzAnlegenDay} style={{
              padding: '0.4rem 1rem', borderRadius: '6px', cursor: 'pointer', fontSize: '0.82rem',
              border: '1px solid #cbd5e1', background: '#fff', color: '#374151',
              display: 'flex', alignItems: 'center', gap: '0.5rem',
            }}>
              <span style={{ fontWeight: 700 }}>
                {schedule.lzAnlegenDay === 1 ? 'Anlegen an Tag 1' : 'Anlegen an Tag 2'}
              </span>
              <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>umschalten</span>
            </button>
            <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: '0.3rem' }}>
              Gerät wird jeweils am Folgetag (nächster Kalendertag) zurückgegeben.
            </div>
          </div>

          <div>
            <div style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: '0.4rem', fontWeight: 500 }}>
              Langzeit-Anteil
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <input type="range" min={0} max={100} step={5}
                value={schedule.lzPercent ?? 100}
                onChange={e => updateScheduleConfig({ lzPercent: Number(e.target.value) })}
                style={{ width: '120px', accentColor: '#3b82f6' }} />
              <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>{schedule.lzPercent ?? 100}%</span>
            </div>
            <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: '0.3rem' }}>
              Anteil der Patienten mit Langzeit-EKG/-RR.
            </div>
          </div>

          <div>
            <div style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: '0.4rem', fontWeight: 500 }}>
              Max. Aufenthalt/Tag
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <input type="range" min={30} max={480} step={15}
                value={schedule.maxStayMinutes ?? 120}
                onChange={e => updateScheduleConfig({ maxStayMinutes: Number(e.target.value) })}
                style={{ width: '120px', accentColor: '#3b82f6' }} />
              <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>
                {Math.floor((schedule.maxStayMinutes ?? 120) / 60)}:{String((schedule.maxStayMinutes ?? 120) % 60).padStart(2, '0')} h
              </span>
            </div>
            <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: '0.3rem' }}>
              Maximale Verweildauer eines Patienten pro Besuchstag.
            </div>
          </div>

          <div>
            <div style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: '0.4rem', fontWeight: 500 }}>
              Pause zwischen Untersuchungen
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
              <input type="checkbox"
                checked={schedule.breakBetweenExams ?? false}
                onChange={e => updateScheduleConfig({ breakBetweenExams: e.target.checked })}
                style={{ width: '18px', height: '18px', accentColor: '#3b82f6' }} />
              <span style={{ fontSize: '0.82rem', color: '#374151' }}>5 min Pause</span>
            </label>
            <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: '0.3rem' }}>
              Fügt 5 Minuten Pause zwischen jeder Untersuchung ein.
            </div>
          </div>
        </div>
      </div>

      {/* Capacity table */}
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '1.25rem' }}>
        <div style={{ fontWeight: 600, marginBottom: '1rem', color: '#1e293b' }}>
          Kapazitätsübersicht — Ressourcen × Kohortenüberlappung
        </div>
        <WeeklyCalendar results={results} actualSlotsByDay={scheduleAnalysis?.byAbsDay} />
      </div>

      {/* Time-based schedule */}
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '1.25rem' }}>
        <div style={{ fontWeight: 600, marginBottom: '1rem', color: '#1e293b' }}>
          Wochenkalender — Tagesplan mit Uhrzeiten
        </div>
        <DayScheduleGantt
          scenario={activeScenario}
          nPatients={Math.max(1, results.maxPatientsPerCohort)}
        />
      </div>
    </div>
  )
}

const stepBtn: React.CSSProperties = {
  width: '26px', height: '26px', borderRadius: '4px', border: '1px solid #cbd5e1',
  background: '#f8fafc', cursor: 'pointer', fontSize: '1rem', lineHeight: 1,
  display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600,
  color: '#374151',
}
