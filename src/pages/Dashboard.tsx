import { useMemo, useState } from 'react'
import { useAppStore } from '@/store/appStore'
import { KPICard } from '@/components/dashboard/KPICard'
import { BottleneckAlert } from '@/components/dashboard/BottleneckAlert'
import { WeeklyCalendar } from '@/components/dashboard/WeeklyCalendar'
import { DayScheduleGantt } from '@/components/charts/DayScheduleGantt'
import { buildWeekSchedule, analyzeScheduleDay } from '@/lib/scheduler'
import { computeQuickThroughput } from '@/lib/calculator'
import type { Weekday, ResourceCapacityResult } from '@/types'

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
    // Use the auto-determined bestLzAnlegenDay from the calculator
    const configWithBestLz = {
      ...activeScenario.resourceConfig,
      scheduleConfig: {
        ...activeScenario.resourceConfig.scheduleConfig,
        lzAnlegenDay: results.bestLzAnlegenDay ?? activeScenario.resourceConfig.scheduleConfig.lzAnlegenDay,
        visitDayOffsets: results.bestVisitDayOffsets ?? activeScenario.resourceConfig.scheduleConfig.visitDayOffsets,
      },
    }
    const allSchedules = buildWeekSchedule(
      activeScenario.examinations, activeScenario.resourceGroups,
      configWithBestLz, nPatients,
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

    // Average wait per patient: total wait across W2 / (nPatients × W2 days)
    const w2Days = allSchedules.filter(s => s.week === 2).length
    const avgWaitPerPatient = (worstWait && w2Days > 0 && nPatients > 0)
      ? Math.round(worstWait[1] / (nPatients * w2Days) * 10) / 10
      : 0

    return { byAbsDay, worstWaitGroupName: worstWaitGroup?.name ?? '—', worstWaitMin: worstWait?.[1] ?? 0, avgWaitPerPatient }
  }, [activeScenario, results, nPatients])

  // Revenue calculation: sum per-patient revenue, account for lzPercent on LZ exams
  const revenuePerPatient = useMemo(() => {
    if (!activeScenario) return 0
    const lzPct = (activeScenario.resourceConfig.scheduleConfig.lzPercent ?? 100) / 100
    const lzGroupIds = new Set(['langzeit-ekg', 'langzeit-rr'])
    return activeScenario.examinations.reduce((sum, exam) => {
      const factor = lzGroupIds.has(exam.resourceGroupId) ? lzPct : 1
      return sum + exam.revenueEur * factor
    }, 0)
  }, [activeScenario])

  const monthlyRevenue = Math.round(revenuePerPatient * (results?.weeklyThroughput ?? 0) * 4)

  // Collect ALL bottleneck resources (not just the first one)
  const bottleneckInfo = useMemo(() => {
    if (!results || !activeScenario) return { resources: [], sensitivityMap: new Map<string, number>() }

    // Deduplicate by resourceGroupId
    const seen = new Set<string>()
    const resources: ResourceCapacityResult[] = []
    for (const wd of results.weekdayResults) {
      for (const r of wd.resourceResults) {
        if (r.isBottleneck && !seen.has(r.resourceGroupId)) {
          seen.add(r.resourceGroupId)
          resources.push(r)
        }
      }
    }

    // For each bottleneck, compute how many extra check-ups +1 device/staff would give
    const { examinations, resourceGroups, resourceConfig } = activeScenario
    const sensitivityMap = new Map<string, number>()
    const lzGroupIds = ['langzeit-ekg', 'langzeit-rr']

    for (const r of resources) {
      let modConfig = resourceConfig
      const group = resourceGroups.find(g => g.id === r.resourceGroupId)
      if (!group) continue

      if (group.groupType === 'staff_multiplied') {
        const groupExams = examinations.filter(e => group.examinationIds.includes(e.id))
        if (groupExams.some(e => e.staffRole === 'Arzt')) {
          modConfig = { ...resourceConfig, staff: { ...resourceConfig.staff, doctorCount: resourceConfig.staff.doctorCount + 1 } }
        } else if (group.id === 'mfa-kapazitat') {
          modConfig = { ...resourceConfig, staff: { ...resourceConfig.staff, mfaLabor: resourceConfig.staff.mfaLabor + 1 } }
        } else {
          modConfig = { ...resourceConfig, staff: { ...resourceConfig.staff, mfaFunktionsdiagnostik: resourceConfig.staff.mfaFunktionsdiagnostik + 1 } }
        }
      } else if (lzGroupIds.includes(group.id)) {
        // Vary both LZ groups together
        const ekgCount = (resourceConfig.groupOverrides['langzeit-ekg']?.deviceCount ?? 4) + 1
        const rrCount = (resourceConfig.groupOverrides['langzeit-rr']?.deviceCount ?? 4) + 1
        modConfig = {
          ...resourceConfig,
          groupOverrides: {
            ...resourceConfig.groupOverrides,
            'langzeit-ekg': { ...resourceConfig.groupOverrides['langzeit-ekg'], deviceCount: ekgCount },
            'langzeit-rr': { ...resourceConfig.groupOverrides['langzeit-rr'], deviceCount: rrCount },
          },
        }
      } else {
        const currentCount = resourceConfig.groupOverrides[group.id]?.deviceCount ?? (group.groupType === 'device_count' ? group.slotsPerDay : 1)
        modConfig = {
          ...resourceConfig,
          groupOverrides: {
            ...resourceConfig.groupOverrides,
            [group.id]: { ...resourceConfig.groupOverrides[group.id], deviceCount: currentCount + 1 },
          },
        }
      }

      const newTP = computeQuickThroughput(examinations, resourceGroups, modConfig)
      const delta = newTP - results.weeklyThroughput
      sensitivityMap.set(r.resourceGroupId, delta)
    }

    return { resources, sensitivityMap }
  }, [results, activeScenario])

  const [showBottleneckModal, setShowBottleneckModal] = useState(false)

  if (!results || !activeScenario) return <div>Keine Daten</div>

  const schedule = activeScenario.resourceConfig.scheduleConfig

  const toggleStartDay = (wd: Weekday) => {
    const current = schedule.startDays
    const next = current.includes(wd) ? current.filter(d => d !== wd) : [...current, wd]
    if (next.length === 0) return // must have at least 1 start day
    updateScheduleConfig({ startDays: next as Weekday[] })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <div>
        <h1 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#1e293b', margin: 0 }}>Dashboard</h1>
        <p style={{ fontSize: '0.85rem', color: '#64748b', marginTop: '0.25rem', marginBottom: 0 }}>
          Kapazitätsübersicht — mehrere Patientenkohorten laufen parallel
        </p>
      </div>

      <BottleneckAlert bottleneck={results.primaryBottleneck} allBottlenecks={bottleneckInfo.resources} />

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
          title={bottleneckInfo.resources.length > 1 ? 'Engpässe' : 'Primärer Engpass'}
          value={bottleneckInfo.resources.length > 1
            ? `${bottleneckInfo.resources.length} Ressourcen`
            : (results.primaryBottleneck.resourceGroupName || '—')}
          subtitle={bottleneckInfo.resources.length > 1
            ? 'Klicken für Details'
            : `am ${results.primaryBottleneck.affectedWeekday}`}
          color="orange"
          onClick={bottleneckInfo.resources.length > 0 ? () => setShowBottleneckModal(true) : undefined}
        />
        <KPICard
          title="Monatsumsatz (extrapol.)"
          value={`${monthlyRevenue.toLocaleString('de-DE')} €`}
          subtitle={`${revenuePerPatient.toLocaleString('de-DE')} € / Pat. × ${results.weeklyThroughput} / Woche × 4`}
          color="green"
        />
        <KPICard
          title="Wartezeitverursacher"
          value={scheduleAnalysis?.worstWaitGroupName ?? '—'}
          subtitle={scheduleAnalysis ? `Ø ${scheduleAnalysis.avgWaitPerPatient} min / Patient (W2)` : ''}
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
              Besuchsabstände
            </div>
            <div style={{
              padding: '0.4rem 1rem', borderRadius: '6px', fontSize: '0.82rem',
              border: '1px solid #e2e8f0', background: '#f0fdf4', color: '#374151',
              display: 'flex', alignItems: 'center', gap: '0.75rem',
            }}>
              <span>Tag 1→2: <strong>{results.bestVisitDayOffsets[1]}</strong>d</span>
              <span>Tag 1→3: <strong>{results.bestVisitDayOffsets[2]}</strong>d</span>
              <span style={{ fontSize: '0.75rem', color: '#16a34a' }}>automatisch</span>
            </div>
            <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: '0.3rem' }}>
              Automatisch optimiert (max. 5 Tage Abstand pro Termin).
            </div>
          </div>

          <div>
            <div style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: '0.4rem', fontWeight: 500 }}>
              Langzeit-Gerät anlegen
            </div>
            <div style={{
              padding: '0.4rem 1rem', borderRadius: '6px', fontSize: '0.82rem',
              border: '1px solid #e2e8f0', background: '#f0fdf4', color: '#374151',
              display: 'flex', alignItems: 'center', gap: '0.5rem',
            }}>
              <span style={{ fontWeight: 700 }}>
                Anlegen an Tag {results.bestLzAnlegenDay}
              </span>
              <span style={{ fontSize: '0.75rem', color: '#16a34a' }}>automatisch</span>
            </div>
            <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: '0.3rem' }}>
              Automatisch optimiert. Gerät wird am Folgetag zurückgegeben. Tag 3 ist ausgeschlossen.
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
          scenario={{
            ...activeScenario,
            resourceConfig: {
              ...activeScenario.resourceConfig,
              scheduleConfig: {
                ...activeScenario.resourceConfig.scheduleConfig,
                lzAnlegenDay: results.bestLzAnlegenDay,
                visitDayOffsets: results.bestVisitDayOffsets,
              },
            },
          }}
          nPatients={Math.max(1, results.maxPatientsPerCohort)}
        />
      </div>

      {/* Bottleneck detail modal */}
      {showBottleneckModal && (
        <div
          onClick={() => setShowBottleneckModal(false)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: '#fff', borderRadius: '12px', padding: '1.5rem',
              maxWidth: '520px', width: '90%', maxHeight: '80vh', overflowY: 'auto',
              boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: '#1e293b' }}>
                Engpass-Analyse
              </h2>
              <button
                onClick={() => setShowBottleneckModal(false)}
                style={{
                  border: 'none', background: 'none', cursor: 'pointer',
                  fontSize: '1.25rem', color: '#94a3b8', lineHeight: 1,
                }}
              >
                &times;
              </button>
            </div>

            <div style={{ fontSize: '0.82rem', color: '#64748b', marginBottom: '1rem' }}>
              Aktueller Wochendurchsatz: <strong>{results.weeklyThroughput} Check-ups/Woche</strong>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {bottleneckInfo.resources.map(r => {
                const delta = bottleneckInfo.sensitivityMap.get(r.resourceGroupId) ?? 0
                return (
                  <div
                    key={r.resourceGroupId}
                    style={{
                      border: '1px solid #fecaca', borderRadius: '8px', padding: '1rem',
                      background: '#fef2f2',
                    }}
                  >
                    <div style={{ fontWeight: 700, color: '#b91c1c', fontSize: '0.9rem' }}>
                      {r.resourceGroupName}
                    </div>
                    <div style={{ fontSize: '0.8rem', color: '#7f1d1d', marginTop: '0.25rem' }}>
                      Kapazität: {r.limitingCapacity} Pat./Kohorte
                    </div>
                    {delta > 0 ? (
                      <div style={{
                        marginTop: '0.5rem', padding: '0.3rem 0.65rem', borderRadius: '5px',
                        background: '#f0fdf4', border: '1px solid #bbf7d0',
                        fontSize: '0.8rem', color: '#16a34a', fontWeight: 500, width: 'fit-content',
                      }}>
                        +1 Einheit &rarr; <strong>+{delta} Check-ups/Woche</strong>
                      </div>
                    ) : (
                      <div style={{
                        marginTop: '0.5rem', padding: '0.3rem 0.65rem', borderRadius: '5px',
                        background: '#f8fafc', fontSize: '0.8rem', color: '#94a3b8', width: 'fit-content',
                      }}>
                        +1 Einheit bringt keinen Mehrwert (anderer Engpass limitiert)
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {bottleneckInfo.resources.length === 0 && (
              <div style={{ color: '#94a3b8', fontSize: '0.85rem' }}>Kein Engpass erkannt.</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

