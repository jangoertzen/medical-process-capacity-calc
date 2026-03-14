import { useState } from 'react'
import { useAppStore } from '@/store/appStore'
import { UtilizationChart } from '@/components/charts/UtilizationChart'
import { CapacityCompareChart } from '@/components/charts/CapacityCompareChart'
import { WeeklyCapacityChart } from '@/components/charts/WeeklyCapacityChart'
import { ProcessFlowChart } from '@/components/charts/ProcessFlowChart'
import { DayScheduleGantt } from '@/components/charts/DayScheduleGantt'

const TABS = [
  { id: 'auslastung', label: 'Auslastung' },
  { id: 'kapazitaet', label: 'Kapazität vs. Bedarf' },
  { id: 'woche', label: 'Wochenübersicht' },
  { id: 'prozess', label: 'Prozessfluss' },
  { id: 'kalender', label: 'Wochenkalender' },
]

export default function Diagramme() {
  const [activeTab, setActiveTab] = useState('auslastung')
  const results = useAppStore(s => s.getResults())
  const activeScenario = useAppStore(s => s.getActiveScenario())

  if (!results || !activeScenario) return <div>Keine Daten</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <div>
        <h1 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#1e293b', margin: 0 }}>Diagramme</h1>
      </div>

      <div style={{ display: 'flex', gap: '0.5rem', borderBottom: '1px solid #e2e8f0', paddingBottom: '0.5rem' }}>
        {TABS.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
            padding: '0.4rem 1rem', borderRadius: '6px', border: 'none', cursor: 'pointer',
            background: activeTab === tab.id ? '#3b82f6' : 'transparent',
            color: activeTab === tab.id ? '#fff' : '#64748b',
            fontWeight: activeTab === tab.id ? 600 : 400,
            fontSize: '0.875rem',
          }}>
            {tab.label}
          </button>
        ))}
      </div>

      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '1.5rem' }}>
        {activeTab === 'auslastung' && <UtilizationChart results={results} />}
        {activeTab === 'kapazitaet' && <CapacityCompareChart results={results} />}
        {activeTab === 'woche' && <WeeklyCapacityChart results={results} />}
        {activeTab === 'prozess' && (
          <ProcessFlowChart
            examinations={activeScenario.examinations}
            resourceGroups={activeScenario.resourceGroups}
          />
        )}
        {activeTab === 'kalender' && (
          <DayScheduleGantt
            scenario={activeScenario}
            nPatients={Math.max(1, results.maxPatientsPerCohort)}
          />
        )}
      </div>
    </div>
  )
}
