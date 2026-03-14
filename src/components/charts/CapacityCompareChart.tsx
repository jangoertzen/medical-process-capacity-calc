import { BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend, ResponsiveContainer, ReferenceLine } from 'recharts'
import type { WeeklyCapacityResult } from '@/types'

interface Props { results: WeeklyCapacityResult }

export function CapacityCompareChart({ results }: Props) {
  const data = results.weekdayResults.map(d => ({
    tag: d.weekday,
    maxKohorte: d.maxPatientsPerCohort,
    durchsatz: results.weeklyThroughput,
  }))

  return (
    <ResponsiveContainer width="100%" height={320}>
      <BarChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
        <XAxis dataKey="tag" tick={{ fontSize: 12 }} />
        <YAxis tick={{ fontSize: 12 }} />
        <Tooltip />
        <Legend />
        <ReferenceLine y={results.maxPatientsPerCohort} stroke="#ef4444" strokeDasharray="4 4"
          label={{ value: `Max/Kohorte: ${results.maxPatientsPerCohort}`, fill: '#ef4444', fontSize: 11 }} />
        <Bar dataKey="maxKohorte" name="Max Pat./Kohorte" fill="#3b82f6" radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}
