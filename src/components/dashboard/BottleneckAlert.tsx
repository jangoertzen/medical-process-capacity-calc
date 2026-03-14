import type { BottleneckSummary } from '@/types'
import { AlertTriangle } from 'lucide-react'

interface Props { bottleneck: BottleneckSummary }

export function BottleneckAlert({ bottleneck }: Props) {
  return (
    <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', padding: '1rem 1.25rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
      <AlertTriangle size={20} color="#ef4444" />
      <div>
        <div style={{ fontWeight: 600, color: '#b91c1c', fontSize: '0.9rem' }}>Engpass erkannt: {bottleneck.resourceGroupName}</div>
        <div style={{ fontSize: '0.8rem', color: '#7f1d1d', marginTop: '0.2rem' }}>
          {bottleneck.description} — begrenzend am {bottleneck.affectedWeekday}
        </div>
      </div>
    </div>
  )
}
