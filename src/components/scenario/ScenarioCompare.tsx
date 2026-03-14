import { useAppStore } from '@/store/appStore'

export function ScenarioCompare() {
  const scenarios = useAppStore(s => s.scenarios)
  const compareIds = useAppStore(s => s.compareScenarioIds)
  const compareScenarios = scenarios.filter(s => compareIds.includes(s.id))

  if (compareScenarios.length < 2) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8', fontSize: '0.875rem' }}>
        Wähle 2 Szenarien (Checkbox) für den Vergleich.
      </div>
    )
  }

  const [a, b] = compareScenarios
  const metrics = [
    {
      label: 'Wochendurchsatz',
      a: a.results?.weeklyThroughput ?? 0,
      b: b.results?.weeklyThroughput ?? 0,
      unit: 'Pat./Woche',
    },
    {
      label: 'Pat. pro Kohorte',
      a: a.results?.maxPatientsPerCohort ?? 0,
      b: b.results?.maxPatientsPerCohort ?? 0,
      unit: '',
    },
    {
      label: 'Kohortenstart-Tage',
      a: a.results?.startDaysCount ?? 0,
      b: b.results?.startDaysCount ?? 0,
      unit: 'Tage/Woche',
    },
    {
      label: 'Engpass',
      a: a.results?.primaryBottleneck.resourceGroupName ?? '—',
      b: b.results?.primaryBottleneck.resourceGroupName ?? '—',
      unit: '',
    },
    {
      label: 'Engpass-Wochentag',
      a: a.results?.primaryBottleneck.affectedWeekday ?? '—',
      b: b.results?.primaryBottleneck.affectedWeekday ?? '—',
      unit: '',
    },
  ]

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
      <thead>
        <tr style={{ background: '#f1f5f9' }}>
          <th style={thStyle}>Kennzahl</th>
          <th style={thStyle}>{a.name}</th>
          <th style={thStyle}>{b.name}</th>
          <th style={thStyle}>Differenz</th>
        </tr>
      </thead>
      <tbody>
        {metrics.map(m => {
          const diff = typeof m.a === 'number' && typeof m.b === 'number' ? m.b - m.a : null
          return (
            <tr key={m.label}>
              <td style={tdStyle}>{m.label}</td>
              <td style={tdStyle}>{m.a} {m.unit}</td>
              <td style={tdStyle}>{m.b} {m.unit}</td>
              <td style={{
                ...tdStyle,
                color: diff == null ? '#64748b' : diff > 0 ? '#15803d' : diff < 0 ? '#b91c1c' : '#64748b',
                fontWeight: diff != null && diff !== 0 ? 600 : 400,
              }}>
                {diff != null ? (diff > 0 ? '+' : '') + diff : '—'}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

const thStyle: React.CSSProperties = {
  padding: '0.75rem', textAlign: 'left', fontWeight: 600, color: '#475569', border: '1px solid #e2e8f0',
}
const tdStyle: React.CSSProperties = { padding: '0.75rem', border: '1px solid #e2e8f0', color: '#1e293b' }
