import { useMemo } from 'react'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
  ResponsiveContainer, ReferenceLine,
} from 'recharts'
import type { Examination, ResourceGroup, ResourceConfig } from '@/types'
import { computeQuickThroughput } from '@/lib/calculator'

export interface SensitivityParam {
  id: string
  label: string
  xLabel: string
  currentCount: number
  makeConfig: (n: number) => ResourceConfig
}

interface Props {
  param: SensitivityParam
  examinations: Examination[]
  resourceGroups: ResourceGroup[]
}

export function ResourceSensitivityChart({ param, examinations, resourceGroups }: Props) {
  const { data, delta, saturation } = useMemo(() => {
    const max = Math.max(10, param.currentCount + 4)
    const data: { count: number; throughput: number }[] = []

    for (let n = 1; n <= max; n++) {
      const modConfig = param.makeConfig(n)
      const throughput = computeQuickThroughput(
        examinations, resourceGroups, modConfig,
      )
      data.push({ count: n, throughput })
    }

    // Delta: what does +1 give?
    const currentTP = data.find(d => d.count === param.currentCount)?.throughput ?? 0
    const nextTP = data.find(d => d.count === param.currentCount + 1)?.throughput ?? currentTP
    const delta = nextTP - currentTP

    // Saturation point: last count where throughput still increases
    let saturation = 1
    for (let i = 1; i < data.length; i++) {
      if (data[i].throughput > data[i - 1].throughput) saturation = data[i].count
    }

    return { data, delta, saturation }
  }, [param, examinations, resourceGroups])

  const currentTP = data.find(d => d.count === param.currentCount)?.throughput ?? 0
  const isBottleneck = delta > 0

  return (
    <div style={{
      background: '#fff', border: '1px solid #e2e8f0', borderRadius: '10px',
      padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.5rem',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div style={{ fontWeight: 700, fontSize: '0.95rem', color: '#1e293b' }}>{param.label}</div>
        <div style={{ fontSize: '0.78rem', color: '#64748b' }}>
          Aktuell: <strong>{param.currentCount}</strong> &rarr; {currentTP} Pat./Wo.
        </div>
      </div>

      {isBottleneck ? (
        <div style={{
          fontSize: '0.78rem', color: '#16a34a', background: '#f0fdf4',
          padding: '0.3rem 0.65rem', borderRadius: '5px', width: 'fit-content',
          border: '1px solid #bbf7d0', fontWeight: 500,
        }}>
          +1 &rarr; <strong>+{delta} Check-ups/Woche</strong>
          {saturation > param.currentCount + 1 && (
            <span style={{ color: '#64748b', fontWeight: 400, marginLeft: '0.5rem' }}>
              (Plateau ab {saturation})
            </span>
          )}
        </div>
      ) : (
        <div style={{
          fontSize: '0.78rem', color: '#94a3b8', background: '#f8fafc',
          padding: '0.3rem 0.65rem', borderRadius: '5px', width: 'fit-content',
        }}>
          Kein Engpass — Aufstockung bringt keinen Mehrwert
        </div>
      )}

      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={data} margin={{ top: 10, right: 16, bottom: 28, left: 4 }}>
          <defs>
            <linearGradient id={`grad-${param.id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={isBottleneck ? '#3b82f6' : '#94a3b8'} stopOpacity={0.25} />
              <stop offset="100%" stopColor={isBottleneck ? '#3b82f6' : '#94a3b8'} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis
            dataKey="count"
            tick={{ fontSize: 11 }}
            label={{ value: param.xLabel, position: 'insideBottom', offset: -16, fontSize: 11, fill: '#94a3b8' }}
          />
          <YAxis
            tick={{ fontSize: 11 }}
            label={{ value: 'Check-ups / Woche', angle: -90, position: 'insideLeft', offset: 12, fontSize: 11, fill: '#94a3b8' }}
          />
          <Tooltip
            formatter={(value: number) => [`${value} Pat./Woche`, 'Durchsatz']}
            labelFormatter={(label: number) => `${param.xLabel}: ${label}`}
          />
          <ReferenceLine
            x={param.currentCount}
            stroke="#f97316"
            strokeWidth={2}
            strokeDasharray="4 4"
          />
          <ReferenceLine
            y={currentTP}
            stroke="#f9731640"
            strokeDasharray="3 3"
          />
          <Area
            type="monotone"
            dataKey="throughput"
            stroke={isBottleneck ? '#3b82f6' : '#94a3b8'}
            strokeWidth={2.5}
            fill={`url(#grad-${param.id})`}
            dot={({ cx, cy, payload }: { cx: number; cy: number; payload: { count: number } }) => {
              const isCurrent = payload.count === param.currentCount
              return (
                <circle
                  key={payload.count}
                  cx={cx} cy={cy}
                  r={isCurrent ? 6 : 2.5}
                  fill={isCurrent ? '#f97316' : (isBottleneck ? '#3b82f6' : '#94a3b8')}
                  stroke={isCurrent ? '#fff' : 'none'}
                  strokeWidth={isCurrent ? 2 : 0}
                />
              )
            }}
            activeDot={{ r: 5, fill: '#3b82f6', stroke: '#fff', strokeWidth: 2 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
