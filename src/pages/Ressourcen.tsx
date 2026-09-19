import { useAppStore } from '@/store/appStore'
import type { TimeInterval, Weekday } from '@/types'

function toTimeStr(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function fromTimeStr(str: string): number {
  const [h, m] = str.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

function totalMin(intervals: TimeInterval[]): number {
  return intervals.reduce((s, iv) => s + Math.max(0, iv.endMin - iv.startMin), 0)
}

const WEEKDAYS: Weekday[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
const WD_LABELS: Record<Weekday, string> = { Mon: 'Montag', Tue: 'Dienstag', Wed: 'Mittwoch', Thu: 'Donnerstag', Fri: 'Freitag' }

export default function Ressourcen() {
  const activeScenario = useAppStore(s => s.getActiveScenario())
  const updateOpeningHours = useAppStore(s => s.updateOpeningHours)
  const updateStaff = useAppStore(s => s.updateStaff)
  const updateScheduleConfig = useAppStore(s => s.updateScheduleConfig)

  if (!activeScenario) return null
  const { openingHours, staff, scheduleConfig } = activeScenario.resourceConfig

  const setInterval = (wd: Weekday, idx: number, patch: Partial<TimeInterval>) => {
    const intervals = openingHours[wd].map((iv, i) => i === idx ? { ...iv, ...patch } : iv)
    updateOpeningHours(wd, intervals)
  }

  const addInterval = (wd: Weekday) => {
    const existing = openingHours[wd]
    const lastEnd = existing.length > 0 ? existing[existing.length - 1].endMin : 480
    const start = Math.min(lastEnd + 60, 1380) // default: 1h after last end, max 23:00
    const end = Math.min(start + 120, 1440)
    updateOpeningHours(wd, [...existing, { startMin: start, endMin: end }])
  }

  const removeInterval = (wd: Weekday, idx: number) => {
    const intervals = openingHours[wd].filter((_, i) => i !== idx)
    updateOpeningHours(wd, intervals)
  }

  const toggleStartDay = (wd: Weekday) => {
    const next = scheduleConfig.startDays.includes(wd)
      ? scheduleConfig.startDays.filter(d => d !== wd)
      : [...scheduleConfig.startDays, wd]
    if (next.length === 0) return
    updateScheduleConfig({ startDays: next as Weekday[] })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div>
        <h1 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#1e293b', margin: 0 }}>Ressourcen</h1>
        <p style={{ fontSize: '0.85rem', color: '#64748b', marginTop: '0.25rem', marginBottom: 0 }}>Konfiguriere Öffnungszeiten, Personal und Patientenplan.</p>
      </div>

      <div style={{
        padding: '0.6rem 1rem', background: '#f0fdf4', borderRadius: '8px',
        border: '1px solid #bbf7d0', fontSize: '0.82rem', color: '#374151',
        display: 'flex', alignItems: 'center', gap: '0.5rem',
      }}>
        <span>Geräte- und Raumkonfiguration</span>
        <span style={{ fontWeight: 700, color: '#16a34a' }}>→ Reiter Untersuchungen</span>
      </div>

      <Card title="Öffnungszeiten">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {WEEKDAYS.map(wd => {
            const intervals = openingHours[wd] ?? []
            const total = totalMin(intervals)
            return (
              <div key={wd} style={{ display: 'flex', alignItems: 'flex-start', gap: '1rem' }}>
                {/* Day label */}
                <div style={{ width: '90px', flexShrink: 0, paddingTop: '0.3rem' }}>
                  <span style={{ fontWeight: 600, fontSize: '0.85rem', color: '#1e293b' }}>{WD_LABELS[wd]}</span>
                  <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: '0.1rem' }}>
                    {total > 0 ? `${Math.floor(total / 60)}h ${total % 60 > 0 ? `${total % 60}min` : ''}`.trim() : '—'}
                  </div>
                </div>

                {/* Intervals */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', flex: 1 }}>
                  {intervals.length === 0 && (
                    <span style={{ fontSize: '0.8rem', color: '#cbd5e1', paddingTop: '0.3rem' }}>Kein Zeitraum</span>
                  )}
                  {intervals.map((iv, idx) => (
                    <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      <input
                        type="time"
                        value={toTimeStr(iv.startMin)}
                        onChange={e => setInterval(wd, idx, { startMin: fromTimeStr(e.target.value) })}
                        style={timeInputS}
                      />
                      <span style={{ color: '#94a3b8', fontSize: '0.85rem' }}>–</span>
                      <input
                        type="time"
                        value={toTimeStr(iv.endMin)}
                        onChange={e => setInterval(wd, idx, { endMin: fromTimeStr(e.target.value) })}
                        style={timeInputS}
                      />
                      <span style={{ fontSize: '0.72rem', color: '#94a3b8', minWidth: '36px' }}>
                        {Math.max(0, iv.endMin - iv.startMin)}min
                      </span>
                      {intervals.length > 1 && (
                        <button
                          onClick={() => removeInterval(wd, idx)}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#f87171', fontSize: '0.8rem', padding: '0 0.1rem' }}
                          title="Zeitraum entfernen"
                        >✕</button>
                      )}
                    </div>
                  ))}
                  <button
                    onClick={() => addInterval(wd)}
                    style={{
                      alignSelf: 'flex-start', background: 'none', border: '1px dashed #cbd5e1',
                      borderRadius: '4px', color: '#64748b', cursor: 'pointer',
                      fontSize: '0.75rem', padding: '0.15rem 0.5rem', marginTop: '0.1rem',
                    }}
                  >+ Zeitraum</button>
                </div>
              </div>
            )
          })}
        </div>
      </Card>

      <Card title="Personal">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem' }}>
          <div>
            <label style={labelS}>Anzahl Ärzte</label>
            <input type="number" min={1} max={20} value={staff.doctorCount}
              onChange={e => updateStaff({ doctorCount: Number(e.target.value) })}
              style={numInputS} />
          </div>
          <div>
            <label style={labelS}>MFA Funktionsdiagnostik</label>
            <input type="number" min={1} max={10} value={staff.mfaFunktionsdiagnostik}
              onChange={e => updateStaff({ mfaFunktionsdiagnostik: Number(e.target.value) })}
              style={numInputS} />
          </div>
          <div>
            <label style={labelS}>MFA Labor</label>
            <input type="number" min={1} max={10} value={staff.mfaLabor}
              onChange={e => updateStaff({ mfaLabor: Number(e.target.value) })}
              style={numInputS} />
          </div>
        </div>
      </Card>

      <Card title="Patientenplan">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div>
            <label style={labelS}>Kohortenstart-Wochentage</label>
            <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.25rem' }}>
              {(['Mon', 'Tue', 'Wed', 'Thu', 'Fri'] as Weekday[]).map(wd => {
                const active = scheduleConfig.startDays.includes(wd)
                return (
                  <button key={wd} onClick={() => toggleStartDay(wd)} style={{
                    padding: '0.3rem 0.65rem', borderRadius: '6px', cursor: 'pointer', fontSize: '0.82rem',
                    border: `1px solid ${active ? '#3b82f6' : '#cbd5e1'}`,
                    background: active ? '#eff6ff' : '#f8fafc',
                    color: active ? '#1d4ed8' : '#94a3b8',
                    fontWeight: active ? 700 : 400,
                  }}>
                    {wd}
                  </button>
                )
              })}
            </div>
            <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '0.3rem' }}>
              Ausgewählt: {scheduleConfig.startDays.join(', ') || '—'}
            </div>
          </div>
          <div>
            <label style={labelS}>Programmdauer</label>
            <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.25rem' }}>
              {([3, 2] as const).map(d => {
                const active = (scheduleConfig.programDays ?? 3) === d
                return (
                  <button key={d} onClick={() => updateScheduleConfig({ programDays: d })} style={{
                    padding: '0.3rem 0.65rem', borderRadius: '6px', cursor: 'pointer', fontSize: '0.82rem',
                    border: `1px solid ${active ? '#3b82f6' : '#cbd5e1'}`,
                    background: active ? '#eff6ff' : '#f8fafc',
                    color: active ? '#1d4ed8' : '#94a3b8',
                    fontWeight: active ? 700 : 400,
                  }}>
                    {d} Tage
                  </button>
                )
              })}
            </div>
            <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '0.3rem' }}>
              Bei 2 Tagen wandern alle Tag-3-Untersuchungen auf Tag 2.
            </div>
          </div>
          <div>
            <label style={labelS}>Langzeit-Gerät anlegen</label>
            <div style={{
              padding: '0.35rem 0.8rem', borderRadius: '6px', fontSize: '0.82rem',
              border: '1px solid #e2e8f0', background: '#f0fdf4', color: '#374151',
              display: 'inline-flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.25rem',
            }}>
              <span style={{ fontWeight: 600 }}>
                Anlegen an Tag {activeScenario.results?.bestLzAnlegenDay ?? scheduleConfig.lzAnlegenDay}
              </span>
              <span style={{ fontSize: '0.72rem', color: '#16a34a' }}>automatisch</span>
            </div>
            <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '0.3rem' }}>
              Automatisch optimiert. Tag 3 ist ausgeschlossen.
            </div>
          </div>
          <div>
            <label style={labelS}>Max. Aufenthalt pro Besuchstag</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.25rem' }}>
              <input type="range" min={30} max={480} step={15}
                value={scheduleConfig.maxStayMinutes ?? 120}
                onChange={e => updateScheduleConfig({ maxStayMinutes: Number(e.target.value) })}
                style={{ width: '160px', accentColor: '#3b82f6' }} />
              <span style={{ fontWeight: 700, fontSize: '0.9rem', minWidth: '50px' }}>
                {Math.floor((scheduleConfig.maxStayMinutes ?? 120) / 60)}:{String((scheduleConfig.maxStayMinutes ?? 120) % 60).padStart(2, '0')} h
              </span>
            </div>
            <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '0.3rem' }}>
              Maximale Verweildauer eines Patienten pro Besuchstag (Standard: 2:00 h).
            </div>
          </div>
          <div>
            <label style={labelS}>Pause zwischen Untersuchungen</label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.25rem', cursor: 'pointer' }}>
              <input type="checkbox"
                checked={scheduleConfig.breakBetweenExams ?? false}
                onChange={e => updateScheduleConfig({ breakBetweenExams: e.target.checked })}
                style={{ width: '18px', height: '18px', accentColor: '#3b82f6' }} />
              <span style={{ fontSize: '0.85rem', color: '#1e293b' }}>5 Minuten Pause zwischen jeder Untersuchung</span>
            </label>
          </div>
        </div>
      </Card>
    </div>
  )
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '1.25rem' }}>
      <div style={{ fontWeight: 600, color: '#1e293b', marginBottom: '1rem', fontSize: '0.95rem' }}>{title}</div>
      {children}
    </div>
  )
}

const labelS: React.CSSProperties = { fontSize: '0.8rem', fontWeight: 500, color: '#475569', display: 'block', marginBottom: '0.25rem' }
const numInputS: React.CSSProperties = { padding: '0.3rem 0.5rem', border: '1px solid #cbd5e1', borderRadius: '4px', fontSize: '0.875rem', color: '#1e293b', width: '80px' }
const timeInputS: React.CSSProperties = { padding: '0.25rem 0.4rem', border: '1px solid #cbd5e1', borderRadius: '4px', fontSize: '0.85rem', color: '#1e293b', width: '92px' }
