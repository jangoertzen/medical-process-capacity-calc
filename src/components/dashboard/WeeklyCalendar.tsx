import { useState } from 'react'
import type { WeeklyCapacityResult, DayCapacityResult, Weekday, DayNumber } from '@/types'
import type { DayAnalysis } from '@/lib/scheduler'

interface Props {
  results: WeeklyCapacityResult
  actualSlotsByDay?: Map<number, DayAnalysis>
}

const WD_LABEL: Record<Weekday, string> = {
  Mon: 'Mo', Tue: 'Di', Wed: 'Mi', Thu: 'Do', Fri: 'Fr',
}
const STAGE_LABEL: Record<DayNumber, string> = { 1: 'T1', 2: 'T2', 3: 'T3' }
const STAGE_COLOR: Record<DayNumber, string> = {
  1: '#dbeafe', 2: '#dcfce7', 3: '#fef9c3',
}

function utilizationColor(pct: number): string {
  if (pct >= 90) return '#fef2f2'
  if (pct >= 60) return '#fff7ed'
  return '#f0fdf4'
}
function utilizationTextColor(pct: number): string {
  if (pct >= 90) return '#b91c1c'
  if (pct >= 60) return '#c2410c'
  return '#15803d'
}

const ALL_WEEKDAYS: Weekday[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
const WEEK_LABELS: Record<1 | 2 | 3, string> = {
  1: 'Woche 1 (Anlauf)',
  2: 'Woche 2 (Steady State)',
  3: 'Woche 3 (Auslauf)',
}

export function WeeklyCalendar({ results, actualSlotsByDay }: Props) {
  const [selectedWeek, setSelectedWeek] = useState<1 | 2 | 3>(2)

  const threeWeekData: DayCapacityResult[] = results.threeWeekData ?? []
  const weekDays = threeWeekData.filter(d => d.week === selectedWeek)

  // Build lookup: weekday → DayCapacityResult for the selected week
  const byWeekday = new Map(weekDays.map(d => [d.weekday, d]))

  // Collect all resource group IDs that appear this week
  const allGroupIds: string[] = []
  const allGroupNames: Record<string, string> = {}
  for (const day of weekDays) {
    for (const r of day.resourceResults) {
      if (!allGroupIds.includes(r.resourceGroupId)) allGroupIds.push(r.resourceGroupId)
      allGroupNames[r.resourceGroupId] = r.resourceGroupName
    }
  }

  const n = results.maxPatientsPerCohort

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>

      {/* Week tabs */}
      <div style={{ display: 'flex', gap: '0.25rem', background: '#f1f5f9', borderRadius: '8px', padding: '3px', width: 'fit-content' }}>
        {([1, 2, 3] as const).map(w => (
          <button
            key={w}
            onClick={() => setSelectedWeek(w)}
            style={{
              padding: '0.35rem 0.9rem',
              borderRadius: '6px',
              border: 'none',
              background: selectedWeek === w ? '#fff' : 'transparent',
              color: selectedWeek === w ? '#1e293b' : '#64748b',
              cursor: 'pointer',
              fontSize: '0.8rem',
              fontWeight: selectedWeek === w ? 600 : 400,
              boxShadow: selectedWeek === w ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
            }}
          >
            {WEEK_LABELS[w]}
          </button>
        ))}
      </div>

      {selectedWeek === 2 && (
        <div style={{ fontSize: '0.75rem', color: '#3b82f6', background: '#eff6ff', padding: '0.35rem 0.75rem', borderRadius: '5px', border: '1px solid #bfdbfe' }}>
          Kapazität und Engpass werden ausschließlich anhand von Woche 2 (Steady State) berechnet.
        </div>
      )}

      {weekDays.length === 0 ? (
        <div style={{ color: '#94a3b8', padding: '1rem', fontSize: '0.85rem' }}>
          In dieser Woche sind keine Patientenphasen aktiv.
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
            <thead>
              <tr style={{ background: '#f1f5f9' }}>
                <th style={thLeft}>Ressource</th>
                {ALL_WEEKDAYS.map(wd => {
                  const day = byWeekday.get(wd)
                  return (
                    <th key={wd} style={thCenter}>
                      <div style={{ fontWeight: 700, color: '#1e293b' }}>{WD_LABEL[wd]}</div>
                      {day && (
                        <div style={{ fontSize: '0.7rem', color: '#64748b' }}>
                          {day.openingMinutes / 60}h
                        </div>
                      )}
                    </th>
                  )
                })}
              </tr>
              <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                <td style={{ ...thLeft, fontWeight: 500, color: '#64748b', fontSize: '0.75rem' }}>Aktive Phasen</td>
                {ALL_WEEKDAYS.map(wd => {
                  const day = byWeekday.get(wd)
                  return (
                    <td key={wd} style={{ padding: '0.4rem', textAlign: 'center', border: '1px solid #e2e8f0' }}>
                      {day
                        ? <>
                            {[...day.activeStages].sort().map(s => (
                              <span key={s} style={{
                                display: 'inline-block', margin: '0 1px',
                                padding: '1px 6px', borderRadius: '4px',
                                background: STAGE_COLOR[s],
                                fontSize: '0.7rem', fontWeight: 600, color: '#374151',
                              }}>
                                {STAGE_LABEL[s]}
                              </span>
                            ))}
                          </>
                        : <span style={{ color: '#cbd5e1' }}>—</span>
                      }
                    </td>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {allGroupIds.map(groupId => (
                <tr key={groupId} style={{ background: '#fff' }}>
                  <td style={tdLeft}>{allGroupNames[groupId]}</td>
                  {ALL_WEEKDAYS.map(wd => {
                    const day = byWeekday.get(wd)
                    const r = day?.resourceResults.find(r => r.resourceGroupId === groupId)
                    if (!r) {
                      return <td key={wd} style={{ ...tdCenter, color: '#cbd5e1' }}>—</td>
                    }
                    const analysis = day ? actualSlotsByDay?.get(day.absDay) : undefined
                    const actual = analysis?.actualSlots[groupId]
                    const hasConflict = actual !== undefined && actual < r.limitingCapacity
                    const bg = r.isBottleneck ? '#fef2f2' : utilizationColor(r.utilizationPct)
                    const textColor = utilizationTextColor(r.utilizationPct)
                    return (
                      <td key={wd} style={{ ...tdCenter, background: bg }}>
                        <div style={{ fontWeight: r.isBottleneck ? 700 : 500, color: r.isBottleneck ? '#b91c1c' : '#1e293b' }}>
                          {r.limitingCapacity} Slots
                          {actual !== undefined && (
                            <span style={{ fontSize: '0.65rem', color: hasConflict ? '#dc2626' : '#16a34a', marginLeft: '0.3rem' }}>
                              ({actual} geplant)
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: '0.7rem', color: textColor, marginTop: '1px' }}>
                          {r.utilizationPct}% ausgelastet
                        </div>
                        {r.timePerPatientMin > 0 && (
                          <div style={{ fontSize: '0.65rem', color: '#94a3b8' }}>
                            {Math.round(r.timePerPatientMin * 10) / 10} min/Slot
                          </div>
                        )}
                        {r.isBottleneck && (
                          <div style={{ fontSize: '0.65rem', color: '#ef4444', fontWeight: 600 }}>▲ ENGPASS</div>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}

              <tr style={{ background: '#1e293b', color: '#f1f5f9' }}>
                <td style={{ ...tdLeft, color: '#f1f5f9', fontWeight: 700 }}>Max Slots/Kohorte</td>
                {ALL_WEEKDAYS.map(wd => {
                  const day = byWeekday.get(wd)
                  return (
                    <td key={wd} style={{ padding: '0.6rem', textAlign: 'center', border: '1px solid #334155' }}>
                      {day
                        ? <span style={{ fontWeight: 700, fontSize: '1rem' }}>{n}</span>
                        : <span style={{ color: '#475569' }}>—</span>
                      }
                    </td>
                  )
                })}
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* Summary footer */}
      <div style={{
        padding: '0.75rem 1rem',
        background: '#eff6ff', borderRadius: '6px', border: '1px solid #bfdbfe',
        display: 'flex', gap: '2rem', flexWrap: 'wrap', fontSize: '0.875rem',
      }}>
        <div>
          <span style={{ color: '#64748b' }}>Kohortenstart-Tage: </span>
          <strong style={{ color: '#1d4ed8' }}>{results.startDaysCount}</strong>
        </div>
        <div>
          <span style={{ color: '#64748b' }}>Patienten/Kohorte: </span>
          <strong style={{ color: '#1d4ed8' }}>{n}</strong>
        </div>
        <div>
          <span style={{ color: '#64748b' }}>Wochendurchsatz: </span>
          <strong style={{ color: '#1d4ed8' }}>{results.weeklyThroughput} Pat./Woche</strong>
          <span style={{ color: '#94a3b8', marginLeft: '0.4rem', fontSize: '0.8rem' }}>
            ({results.startDaysCount} × {n})
          </span>
        </div>
        <div>
          <span style={{ color: '#64748b' }}>Engpass: </span>
          <strong style={{ color: '#b91c1c' }}>{results.primaryBottleneck.resourceGroupName || '—'}</strong>
          <span style={{ color: '#64748b' }}> am {results.primaryBottleneck.affectedWeekday}</span>
        </div>
      </div>
    </div>
  )
}

const thLeft: React.CSSProperties = {
  padding: '0.6rem 0.75rem', textAlign: 'left', fontWeight: 600,
  color: '#475569', border: '1px solid #e2e8f0', minWidth: '140px',
}
const thCenter: React.CSSProperties = {
  padding: '0.5rem 0.6rem', textAlign: 'center', fontWeight: 600,
  color: '#475569', border: '1px solid #e2e8f0', minWidth: '90px',
}
const tdLeft: React.CSSProperties = {
  padding: '0.6rem 0.75rem', border: '1px solid #e2e8f0',
  fontWeight: 500, color: '#1e293b',
}
const tdCenter: React.CSSProperties = {
  padding: '0.5rem 0.6rem', border: '1px solid #e2e8f0', textAlign: 'center',
}
