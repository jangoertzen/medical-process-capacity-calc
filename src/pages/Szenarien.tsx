import { ScenarioPanel } from '@/components/scenario/ScenarioPanel'
import { ScenarioCompare } from '@/components/scenario/ScenarioCompare'

export default function Szenarien() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div>
        <h1 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#1e293b', margin: 0 }}>Szenarien</h1>
        <p style={{ fontSize: '0.85rem', color: '#64748b', marginTop: '0.25rem', marginBottom: 0 }}>
          Erstelle und vergleiche verschiedene Szenarien.
        </p>
      </div>
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '1.25rem' }}>
        <div style={{ fontWeight: 600, color: '#1e293b', marginBottom: '1rem' }}>Szenarien verwalten</div>
        <ScenarioPanel />
      </div>
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '1.25rem' }}>
        <div style={{ fontWeight: 600, color: '#1e293b', marginBottom: '1rem' }}>Szenariovergleich</div>
        <ScenarioCompare />
      </div>
    </div>
  )
}
