import { useAppStore } from '@/store/appStore'

export function Header() {
  const scenarios = useAppStore(s => s.scenarios)
  const activeScenarioId = useAppStore(s => s.activeScenarioId)
  const setActiveScenario = useAppStore(s => s.setActiveScenario)

  return (
    <header style={{ background: '#fff', borderBottom: '1px solid #e2e8f0', padding: '0.75rem 1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <div style={{ fontWeight: 600, color: '#1e293b', fontSize: '0.95rem' }}>
        Check-up Kapazitäts- &amp; Engpassanalyse
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <span style={{ fontSize: '0.8rem', color: '#64748b' }}>Szenario:</span>
        <select
          value={activeScenarioId}
          onChange={e => setActiveScenario(e.target.value)}
          style={{ fontSize: '0.85rem', padding: '0.25rem 0.5rem', border: '1px solid #cbd5e1', borderRadius: '4px', color: '#1e293b' }}
        >
          {scenarios.map(s => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </div>
    </header>
  )
}
