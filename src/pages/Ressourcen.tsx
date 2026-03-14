import { useAppStore } from '@/store/appStore'
import type { Weekday } from '@/types'

const WEEKDAYS: Weekday[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
const WD_LABELS: Record<Weekday, string> = { Mon: 'Montag', Tue: 'Dienstag', Wed: 'Mittwoch', Thu: 'Donnerstag', Fri: 'Freitag' }

export default function Ressourcen() {
  const activeScenario = useAppStore(s => s.getActiveScenario())
  const updateOpeningHours = useAppStore(s => s.updateOpeningHours)
  const updateStaff = useAppStore(s => s.updateStaff)
  const updateGroupOverride = useAppStore(s => s.updateGroupOverride)
  const updateScheduleConfig = useAppStore(s => s.updateScheduleConfig)

  if (!activeScenario) return null
  const { openingHours, staff, groupOverrides, scheduleConfig } = activeScenario.resourceConfig

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
        <p style={{ fontSize: '0.85rem', color: '#64748b', marginTop: '0.25rem', marginBottom: 0 }}>Konfiguriere Öffnungszeiten, Personal und Geräte.</p>
      </div>

      <Card title="Öffnungszeiten">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '0.75rem' }}>
          {WEEKDAYS.map(wd => (
            <div key={wd}>
              <label style={labelS}>{WD_LABELS[wd]}</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                <input type="number" min={0} max={12} step={0.5}
                  value={openingHours[wd] / 60}
                  onChange={e => updateOpeningHours(wd, Math.round(parseFloat(e.target.value) * 60))}
                  style={{ ...numInputS, width: '60px' }} />
                <span style={{ fontSize: '0.8rem', color: '#64748b' }}>h</span>
                <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>({openingHours[wd]} min)</span>
              </div>
            </div>
          ))}
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

      <Card title="Geräte-Overrides">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem' }}>
          <div>
            <label style={labelS}>Ultraschallgeräte (Anzahl)</label>
            <input type="number" min={1} max={5} value={groupOverrides['arzt-sono']?.deviceCount ?? 1}
              onChange={e => updateGroupOverride('arzt-sono', { deviceCount: Number(e.target.value) })}
              style={numInputS} />
            <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: '0.2rem' }}>
              Serialisiert alle Sono-Untersuchungen
            </div>
          </div>
          <div>
            <label style={labelS}>Langzeit-EKG-Geräte (Anzahl)</label>
            <input type="number" min={1} max={20} value={groupOverrides['langzeit-ekg']?.deviceCount ?? 4}
              onChange={e => updateGroupOverride('langzeit-ekg', { deviceCount: Number(e.target.value) })}
              style={numInputS} />
          </div>
          <div>
            <label style={labelS}>Langzeit-RR-Geräte (Anzahl)</label>
            <input type="number" min={1} max={20} value={groupOverrides['langzeit-rr']?.deviceCount ?? 4}
              onChange={e => updateGroupOverride('langzeit-rr', { deviceCount: Number(e.target.value) })}
              style={numInputS} />
          </div>
          <div>
            <label style={labelS}>Ergometer (Anzahl)</label>
            <input type="number" min={1} max={10} value={groupOverrides['ergometrie']?.deviceCount ?? 1}
              onChange={e => updateGroupOverride('ergometrie', { deviceCount: Number(e.target.value) })}
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
            <label style={labelS}>Langzeit-Gerät anlegen</label>
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.25rem' }}>
              {([1, 2] as const).map(day => {
                const active = scheduleConfig.lzAnlegenDay === day
                return (
                  <button key={day} onClick={() => updateScheduleConfig({ lzAnlegenDay: day })} style={{
                    padding: '0.35rem 0.8rem', borderRadius: '6px', cursor: 'pointer', fontSize: '0.82rem',
                    border: `1px solid ${active ? '#3b82f6' : '#cbd5e1'}`,
                    background: active ? '#eff6ff' : '#f8fafc',
                    color: active ? '#1d4ed8' : '#64748b',
                    fontWeight: active ? 600 : 400,
                  }}>
                    Anlegen an Tag {day}
                  </button>
                )
              })}
            </div>
            <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '0.3rem' }}>
              Gerät wird jeweils am Folgetag (nächster Kalendertag) zurückgegeben.
            </div>
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
