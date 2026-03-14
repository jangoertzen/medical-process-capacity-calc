import { BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend, ResponsiveContainer, Cell } from 'recharts'
import type { WeeklyCapacityResult } from '@/types'

interface Props { results: WeeklyCapacityResult }

export function WeeklyCapacityChart({ results }: Props) {
  // Show per-weekday resource utilization as stacked/grouped bars
  const data = results.weekdayResults.map(d => {
    const row: Record<string, number | string> = { tag: d.weekday }
    for (const r of d.resourceResults) {
      row[r.resourceGroupName] = r.limitingCapacity
    }
    return row
  })

  const allGroups = [...new Set(results.allResourceUtilization.map(r => r.resourceGroupName))]
  const colors = ['#3b82f6', '#22c55e', '#f97316', '#a855f7', '#ef4444', '#14b8a6', '#f59e0b']

  return (
    <ResponsiveContainer width="100%" height={340}>
      <BarChart data={data} margin={{ top: 8, right: 16, bottom: 32, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
        <XAxis dataKey="tag" tick={{ fontSize: 12 }} />
        <YAxis tick={{ fontSize: 12 }} />
        <Tooltip />
        <Legend />
        {allGroups.map((name, i) => (
          <Bar key={name} dataKey={name} fill={colors[i % colors.length]} radius={[2, 2, 0, 0]}>
            {data.map((_, di) => (
              <Cell key={di} fill={colors[i % colors.length]} />
            ))}
          </Bar>
        ))}
      </BarChart>
    </ResponsiveContainer>
  )
}
