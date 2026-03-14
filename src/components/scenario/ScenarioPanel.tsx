import { useState } from 'react'
import { useAppStore } from '@/store/appStore'
import { Plus, Trash2, Copy, Edit2, Check, X } from 'lucide-react'

export function ScenarioPanel() {
  const scenarios = useAppStore(s => s.scenarios)
  const activeScenarioId = useAppStore(s => s.activeScenarioId)
  const compareIds = useAppStore(s => s.compareScenarioIds)
  const setActiveScenario = useAppStore(s => s.setActiveScenario)
  const createScenario = useAppStore(s => s.createScenario)
  const deleteScenario = useAppStore(s => s.deleteScenario)
  const renameScenario = useAppStore(s => s.renameScenario)
  const toggleCompare = useAppStore(s => s.toggleCompareScenario)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [newName, setNewName] = useState('')

  return (
    <div>
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', alignItems: 'center' }}>
        <input
          value={newName}
          onChange={e => setNewName(e.target.value)}
          placeholder="Neues Szenario..."
          style={{ flex: 1, padding: '0.4rem 0.6rem', border: '1px solid #cbd5e1', borderRadius: '4px', fontSize: '0.85rem' }}
        />
        <button
          onClick={() => { if (newName.trim()) { createScenario(newName.trim()); setNewName('') } }}
          style={{ padding: '0.4rem 0.75rem', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.85rem' }}
        >
          <Plus size={14} /> Erstellen
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {scenarios.map(scenario => {
          const isActive = scenario.id === activeScenarioId
          const inCompare = compareIds.includes(scenario.id)
          const throughput = scenario.results?.weeklyThroughput ?? '—'
          const bottleneck = scenario.results?.primaryBottleneck.resourceGroupName ?? '—'

          return (
            <div key={scenario.id} style={{
              background: isActive ? '#eff6ff' : '#fff',
              border: `1px solid ${isActive ? '#bfdbfe' : '#e2e8f0'}`,
              borderRadius: '8px', padding: '0.875rem 1rem',
              display: 'flex', alignItems: 'center', gap: '0.75rem',
            }}>
              <input type="checkbox" checked={inCompare} onChange={() => toggleCompare(scenario.id)}
                title="Zum Vergleich hinzufügen" style={{ cursor: 'pointer' }} />

              <div style={{ flex: 1, cursor: 'pointer' }} onClick={() => setActiveScenario(scenario.id)}>
                {editingId === scenario.id ? (
                  <input value={editName} onChange={e => setEditName(e.target.value)}
                    style={{ border: '1px solid #3b82f6', borderRadius: '4px', padding: '0.2rem 0.4rem', fontSize: '0.875rem' }}
                    autoFocus onKeyDown={e => { if (e.key === 'Enter') { renameScenario(scenario.id, editName); setEditingId(null) } }} />
                ) : (
                  <div style={{ fontWeight: isActive ? 600 : 400, color: '#1e293b', fontSize: '0.875rem' }}>{scenario.name}</div>
                )}
                <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.1rem' }}>
                  Durchsatz: <strong>{throughput}</strong> Pat./Woche · Engpass: {bottleneck}
                </div>
              </div>

              <div style={{ display: 'flex', gap: '0.25rem' }}>
                {editingId === scenario.id ? (
                  <>
                    <button onClick={() => { renameScenario(scenario.id, editName); setEditingId(null) }} style={iconBtnStyle}><Check size={14} /></button>
                    <button onClick={() => setEditingId(null)} style={iconBtnStyle}><X size={14} /></button>
                  </>
                ) : (
                  <>
                    <button onClick={() => { setEditingId(scenario.id); setEditName(scenario.name) }} style={iconBtnStyle}><Edit2 size={14} /></button>
                    <button onClick={() => createScenario(scenario.name + ' (Kopie)', scenario.id)} style={iconBtnStyle}><Copy size={14} /></button>
                    <button onClick={() => deleteScenario(scenario.id)} style={{ ...iconBtnStyle, color: '#ef4444' }} disabled={scenarios.length <= 1}><Trash2 size={14} /></button>
                  </>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

const iconBtnStyle: React.CSSProperties = {
  background: 'transparent', border: 'none', cursor: 'pointer', padding: '0.25rem', color: '#64748b', display: 'flex', alignItems: 'center'
}
