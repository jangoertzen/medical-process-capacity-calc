import { BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine, ResponsiveContainer, Cell } from 'recharts'
import type { WeeklyCapacityResult } from '@/types'

interface Props { results: WeeklyCapacityResult }

export function UtilizationChart({ results }: Props) {
  const data = results.allResourceUtilization.map(r => ({
    name: r.resourceGroupName,
    kapazität: r.limitingCapacity,
    isBottleneck: r.isBottleneck,
    tag: r.weekday,
  }))

  return (
    <ResponsiveContainer width="100%" height={320}>
      <BarChart data={data} margin={{ top: 8, right: 16, bottom: 60, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
        <XAxis dataKey="name" angle={-30} textAnchor="end" tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 11 }} />
        <Tooltip />
        <ReferenceLine y={results.weeklyThroughput} stroke="#ef4444" strokeDasharray="4 4" label={{ value: `Durchsatz: ${results.weeklyThroughput}`, fill: '#ef4444', fontSize: 11 }} />
        <Bar dataKey="kapazität" radius={[3, 3, 0, 0]}>
          {data.map((entry, i) => (
            <Cell key={i} fill={entry.isBottleneck ? '#ef4444' : '#3b82f6'} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
