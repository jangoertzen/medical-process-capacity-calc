import type { BottleneckSummary, ResourceCapacityResult } from '@/types'
import { AlertTriangle } from 'lucide-react'

interface Props {
  bottleneck: BottleneckSummary
  allBottlenecks?: ResourceCapacityResult[]
}

export function BottleneckAlert({ bottleneck, allBottlenecks }: Props) {
  const names = allBottlenecks && allBottlenecks.length > 1
    ? allBottlenecks.map(b => b.resourceGroupName)
    : [bottleneck.resourceGroupName]

  return (
    <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', padding: '1rem 1.25rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
      <AlertTriangle size={20} color="#ef4444" />
      <div>
        <div style={{ fontWeight: 600, color: '#b91c1c', fontSize: '0.9rem' }}>
          {names.length > 1 ? `${names.length} Engpässe erkannt` : `Engpass erkannt: ${names[0]}`}
        </div>
        <div style={{ fontSize: '0.8rem', color: '#7f1d1d', marginTop: '0.2rem' }}>
          {names.length > 1
            ? names.join(', ')
            : `${bottleneck.description} — begrenzend am ${bottleneck.affectedWeekday}`}
        </div>
      </div>
    </div>
  )
}
