interface Props { capacity: number; max?: number }

export function TrafficLight({ capacity, max = 20 }: Props) {
  const pct = capacity / max
  const color = pct < 0.25 ? '#ef4444' : pct < 0.6 ? '#f97316' : '#22c55e'
  const label = pct < 0.25 ? 'Kritisch' : pct < 0.6 ? 'Eingeschränkt' : 'OK'
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
      <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: color, display: 'inline-block' }} />
      <span style={{ fontSize: '0.75rem', color }}>{label}</span>
    </span>
  )
}
