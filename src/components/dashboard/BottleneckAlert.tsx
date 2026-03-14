import { AlertTriangle, CheckCircle } from 'lucide-react'

interface BottleneckEntry {
  groupName: string
  delta: number
}

interface Props {
  bottlenecks: BottleneckEntry[]
}

export function BottleneckAlert({ bottlenecks }: Props) {
  if (bottlenecks.length === 0) {
    return (
      <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', padding: '1rem 1.25rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <CheckCircle size={20} color="#16a34a" />
        <div>
          <div style={{ fontWeight: 600, color: '#15803d', fontSize: '0.9rem' }}>Kein Engpass erkannt</div>
          <div style={{ fontSize: '0.8rem', color: '#166534', marginTop: '0.2rem' }}>
            Keine Ressource limitiert aktuell den Durchsatz.
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', padding: '1rem 1.25rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
      <AlertTriangle size={20} color="#ef4444" />
      <div>
        <div style={{ fontWeight: 600, color: '#b91c1c', fontSize: '0.9rem' }}>
          {bottlenecks.length > 1
            ? `${bottlenecks.length} Engpässe erkannt`
            : `Engpass erkannt: ${bottlenecks[0].groupName}`}
        </div>
        <div style={{ fontSize: '0.8rem', color: '#7f1d1d', marginTop: '0.2rem' }}>
          {bottlenecks.length > 1
            ? bottlenecks.map(b => b.groupName).join(', ')
            : `+1 Einheit → +${bottlenecks[0].delta} Check-ups/Woche`}
        </div>
      </div>
    </div>
  )
}
