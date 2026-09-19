import { useState, useMemo } from 'react'
import { useAppStore } from '@/store/appStore'
import { DayScheduleGantt } from '@/components/charts/DayScheduleGantt'
import { ResourceSensitivityChart, type SensitivityParam } from '@/components/charts/ResourceSensitivityChart'
import { computeQuickThroughput, applyBestSchedule } from '@/lib/calculator'

const STAFF_LABEL = { doctorCount: 'Arztgespräch', mfaLabor: 'MFA Labor (Blutentnahmen)', mfaFunktionsdiagnostik: 'MFA Funktionsdiagnostik' } as const

const TABS = [
  { id: 'sensitivitaet', label: 'Ressourcen-Analyse' },
  { id: 'tagesplan', label: 'Tagesplan' },
]

export default function Diagramme() {
  const [activeTab, setActiveTab] = useState('sensitivitaet')
  const results = useAppStore(s => s.getResults())
  const activeScenario = useAppStore(s => s.getActiveScenario())

  const sensitivityParams = useMemo(() => {
    if (!activeScenario) return []
    const { examinations, resourceGroups, resourceConfig } = activeScenario
    const items: SensitivityParam[] = []
    const seenStaffFields = new Set<string>()

    for (const group of resourceGroups) {
      // Skip groups with no exams
      if (!examinations.some(e => group.examinationIds.includes(e.id))) continue

      if (group.groupType === 'staff_multiplied') {
        const field = group.staffType ?? 'mfaFunktionsdiagnostik'
        const label = STAFF_LABEL[field]
        const current = resourceConfig.staff[field]

        if (seenStaffFields.has(field)) continue
        seenStaffFields.add(field)

        const xLabel = field === 'doctorCount' ? 'Anzahl Ärzte'
          : field === 'mfaLabor' ? 'Anzahl MFA Labor'
          : 'Anzahl MFA Funktionsdiag.'

        items.push({
          id: field,
          label,
          xLabel,
          currentCount: current,
          compute: (n) => computeQuickThroughput(
            examinations,
            resourceGroups,
            { ...resourceConfig, staff: { ...resourceConfig.staff, [field]: n } },
          ),
        })
      } else {
        // time_based or device_count
        // All device_count groups share one device set: combine them into one chart
        if (group.groupType === 'device_count') {
          if (seenStaffFields.has('geraete')) continue
          seenStaffFields.add('geraete')

          const deviceGroups = resourceGroups.filter(g => g.groupType === 'device_count')
          const current = Math.min(...deviceGroups.map(g => g.deviceCount ?? g.slotsPerDay))

          items.push({
            id: 'geraete',
            label: deviceGroups.map(g => g.name).join(' + '),
            xLabel: 'Anzahl Geräte',
            currentCount: current,
            compute: (n) => computeQuickThroughput(
              examinations,
              resourceGroups.map(g => g.groupType === 'device_count' ? { ...g, deviceCount: n } : g),
              resourceConfig,
            ),
          })
        } else {
          const defaultCount = group.deviceCount ?? 1

          items.push({
            id: group.id,
            label: group.name,
            xLabel: 'Anzahl Geräte',
            currentCount: defaultCount,
            compute: (n) => computeQuickThroughput(
              examinations,
              resourceGroups.map(g => g.id === group.id ? { ...g, deviceCount: n } : g),
              resourceConfig,
            ),
          })
        }
      }
    }

    return items
  }, [activeScenario])

  if (!results || !activeScenario) return <div style={{ color: '#94a3b8', padding: '2rem' }}>Keine Daten</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <div>
        <h1 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#1e293b', margin: 0 }}>Diagramme</h1>
        <p style={{ fontSize: '0.85rem', color: '#64748b', marginTop: '0.25rem', marginBottom: 0 }}>
          Analyse der Ressourcen-Sensitivität und Tagesplanung.
        </p>
      </div>

      <div style={{ display: 'flex', gap: '0.25rem', background: '#f1f5f9', borderRadius: '8px', padding: '3px', width: 'fit-content' }}>
        {TABS.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
            padding: '0.4rem 1rem', borderRadius: '6px', border: 'none', cursor: 'pointer',
            background: activeTab === tab.id ? '#fff' : 'transparent',
            color: activeTab === tab.id ? '#1e293b' : '#64748b',
            fontWeight: activeTab === tab.id ? 600 : 400,
            fontSize: '0.85rem',
            boxShadow: activeTab === tab.id ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
          }}>
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'sensitivitaet' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div style={{
            padding: '0.75rem 1rem', background: '#eff6ff', borderRadius: '8px',
            border: '1px solid #bfdbfe', fontSize: '0.82rem', color: '#1e293b',
          }}>
            <strong>Wie lesen?</strong> Jedes Diagramm zeigt, wie sich die Anzahl der wöchentlichen
            Check-ups verändert, wenn eine Ressource aufgestockt oder reduziert wird.
            Die <span style={{ color: '#f97316', fontWeight: 600 }}>orange Markierung</span> zeigt
            die aktuelle Konfiguration. Flache Kurven bedeuten: diese Ressource ist kein Engpass.
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(420px, 1fr))',
            gap: '1rem',
          }}>
            {sensitivityParams.map(param => (
              <ResourceSensitivityChart
                key={param.id}
                param={param}
              />
            ))}
          </div>

          {/* Summary table */}
          <div style={{
            background: '#fff', border: '1px solid #e2e8f0', borderRadius: '10px',
            padding: '1.25rem',
          }}>
            <div style={{ fontWeight: 700, fontSize: '0.95rem', color: '#1e293b', marginBottom: '0.75rem' }}>
              Zusammenfassung
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
              <thead>
                <tr style={{ background: '#f8fafc' }}>
                  <th style={thStyle}>Ressource</th>
                  <th style={thStyle}>Aktuell</th>
                  <th style={thStyle}>Check-ups/Wo.</th>
                  <th style={thStyle}>+1 Einheit</th>
                  <th style={thStyle}>Bewertung</th>
                </tr>
              </thead>
              <tbody>
                {sensitivityParams.map(param => {
                  const currentTP = results.weeklyThroughput
                  const nextTP = param.compute(param.currentCount + 1)
                  const delta = nextTP - currentTP
                  return (
                    <tr key={param.id} style={{ borderTop: '1px solid #f1f5f9' }}>
                      <td style={tdStyle}>{param.label}</td>
                      <td style={{ ...tdStyle, textAlign: 'center', fontWeight: 600 }}>{param.currentCount}</td>
                      <td style={{ ...tdStyle, textAlign: 'center' }}>{currentTP}</td>
                      <td style={{ ...tdStyle, textAlign: 'center', color: delta > 0 ? '#16a34a' : '#94a3b8', fontWeight: delta > 0 ? 700 : 400 }}>
                        {delta > 0 ? `+${delta}` : '0'}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'center' }}>
                        {delta > 0 ? (
                          <span style={{ background: '#fef2f2', color: '#b91c1c', padding: '0.15rem 0.5rem', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 600 }}>
                            Engpass
                          </span>
                        ) : (
                          <span style={{ background: '#f0fdf4', color: '#16a34a', padding: '0.15rem 0.5rem', borderRadius: '4px', fontSize: '0.75rem' }}>
                            OK
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'tagesplan' && (
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '1.5rem' }}>
          <DayScheduleGantt
            scenario={applyBestSchedule(activeScenario)}
            nPatients={Math.max(1, results.maxPatientsPerCohort)}
          />
        </div>
      )}
    </div>
  )
}

const thStyle: React.CSSProperties = {
  padding: '0.5rem 0.75rem', textAlign: 'left', fontWeight: 600,
  color: '#475569', borderBottom: '2px solid #e2e8f0', fontSize: '0.78rem',
}
const tdStyle: React.CSSProperties = {
  padding: '0.5rem 0.75rem', color: '#1e293b',
}
