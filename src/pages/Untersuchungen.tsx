import { useState } from 'react'
import { useAppStore } from '@/store/appStore'
import type { DayNumber } from '@/types'

const DAY_LABELS: Record<DayNumber, string> = { 1: 'Tag 1', 2: 'Tag 2', 3: 'Tag 3' }

export default function Untersuchungen() {
  const activeScenario = useAppStore(s => s.getActiveScenario())
  const updateExamination = useAppStore(s => s.updateExamination)
  const [activeDay, setActiveDay] = useState<DayNumber>(1)

  if (!activeScenario) return null

  const exams = activeScenario.examinations.filter(e => e.day === activeDay)
  // All exam names except the current one, for the "Parallel mit" selector
  const allExamNames = activeScenario.examinations.map(e => e.name)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <div>
        <h1 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#1e293b', margin: 0 }}>Untersuchungen</h1>
        <p style={{ fontSize: '0.85rem', color: '#64748b', marginTop: '0.25rem', marginBottom: 0 }}>
          Bearbeite Untersuchungen pro Tag. Änderungen werden sofort berechnet.
        </p>
      </div>

      <div style={{ display: 'flex', gap: '0.5rem' }}>
        {([1, 2, 3] as DayNumber[]).map(d => (
          <button key={d} onClick={() => setActiveDay(d)} style={{
            padding: '0.4rem 1rem', borderRadius: '6px', border: '1px solid #e2e8f0', cursor: 'pointer',
            background: activeDay === d ? '#3b82f6' : '#fff',
            color: activeDay === d ? '#fff' : '#475569',
            fontWeight: activeDay === d ? 600 : 400,
            fontSize: '0.875rem',
          }}>
            {DAY_LABELS[d]}
          </button>
        ))}
      </div>

      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
          <thead>
            <tr style={{ background: '#f1f5f9' }}>
              <th style={thS}>Untersuchung</th>
              <th style={thS}>Rolle</th>
              <th style={thS}>Dauer (min)</th>
              <th style={thS}>Parallel mit</th>
              <th style={thS}>Ressourcengruppe</th>
            </tr>
          </thead>
          <tbody>
            {exams.map(exam => (
              <tr key={exam.id} style={{ borderTop: '1px solid #f1f5f9' }}>
                <td style={tdS}><strong>{exam.name}</strong></td>
                <td style={tdS}>
                  <select value={exam.staffRole} onChange={e => updateExamination(exam.id, { staffRole: e.target.value as 'MFA' | 'Arzt' })}
                    style={inputS}>
                    <option>MFA</option>
                    <option>Arzt</option>
                  </select>
                </td>
                <td style={tdS}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <input type="range" min={1} max={60} value={exam.durationMin}
                      onChange={e => updateExamination(exam.id, { durationMin: Number(e.target.value) })}
                      style={{ width: '100px' }} />
                    <span style={{ minWidth: '2rem', textAlign: 'right' }}>{exam.durationMin}</span>
                  </div>
                </td>
                <td style={tdS}>
                  <select
                    value={exam.parallelWith ?? ''}
                    onChange={e => updateExamination(exam.id, { parallelWith: e.target.value || null })}
                    style={inputS}
                  >
                    <option value="">— keine —</option>
                    {allExamNames
                      .filter(n => n !== exam.name)
                      .map(n => <option key={n} value={n}>{n}</option>)
                    }
                  </select>
                </td>
                <td style={tdS}><span style={{ fontSize: '0.8rem', color: '#64748b' }}>{exam.resourceGroupId}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const thS: React.CSSProperties = { padding: '0.75rem 1rem', textAlign: 'left', fontWeight: 600, color: '#475569' }
const tdS: React.CSSProperties = { padding: '0.75rem 1rem', color: '#1e293b' }
const inputS: React.CSSProperties = { padding: '0.25rem 0.5rem', border: '1px solid #cbd5e1', borderRadius: '4px', fontSize: '0.85rem', color: '#1e293b' }
