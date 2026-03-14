interface Props {
  data: Record<string, unknown>[]
  limit?: number
}

export function DataPreview({ data, limit = 5 }: Props) {
  if (!data.length) return <div style={{ color: '#94a3b8', fontSize: '0.85rem' }}>Keine Daten</div>
  const keys = Object.keys(data[0])
  const rows = data.slice(0, limit)
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', fontSize: '0.8rem', width: '100%' }}>
        <thead>
          <tr style={{ background: '#f1f5f9' }}>
            {keys.map(k => <th key={k} style={{ padding: '0.5rem 0.75rem', border: '1px solid #e2e8f0', fontWeight: 600, color: '#475569', whiteSpace: 'nowrap' }}>{k}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {keys.map(k => <td key={k} style={{ padding: '0.5rem 0.75rem', border: '1px solid #e2e8f0', color: '#1e293b' }}>{String(row[k] ?? '')}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      {data.length > limit && <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '0.5rem' }}>... und {data.length - limit} weitere Zeilen</div>}
    </div>
  )
}
