interface Props {
  columns: string[]
  mapping: Record<string, string>
  onChange: (field: string, col: string) => void
}

const REQUIRED_FIELDS = [
  { key: 'day', label: 'Tag (1/2/3)' },
  { key: 'name', label: 'Untersuchungsname' },
  { key: 'staffRole', label: 'Personalrolle (MFA/Arzt)' },
  { key: 'durationMin', label: 'Dauer (Minuten)' },
  { key: 'parallelWith', label: 'Parallel mit' },
  { key: 'resourceGroupId', label: 'Ressourcengruppe' },
]

export function ColumnMapper({ columns, mapping, onChange }: Props) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
      {REQUIRED_FIELDS.map(f => (
        <div key={f.key}>
          <label style={{ fontSize: '0.8rem', fontWeight: 500, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>{f.label}</label>
          <select
            value={mapping[f.key] ?? ''}
            onChange={e => onChange(f.key, e.target.value)}
            style={{ width: '100%', padding: '0.35rem 0.5rem', border: '1px solid #cbd5e1', borderRadius: '4px', fontSize: '0.85rem', color: '#1e293b' }}
          >
            <option value="">— Spalte wählen —</option>
            {columns.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      ))}
    </div>
  )
}
