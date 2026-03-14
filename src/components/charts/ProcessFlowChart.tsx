import type { Examination, ResourceGroup } from '@/types'

interface Props {
  examinations: Examination[]
  resourceGroups: ResourceGroup[]
}

const DAY_COLORS = ['#dbeafe', '#dcfce7', '#fef9c3']
const DAY_BORDER = ['#93c5fd', '#86efac', '#fde047']

export function ProcessFlowChart({ examinations, resourceGroups }: Props) {
  const days = [1, 2, 3] as const
  const boxW = 160, boxH = 44, gapX = 24, rowH = 64, paddingX = 16, paddingY = 16

  return (
    <div style={{ overflowX: 'auto' }}>
      {resourceGroups.map(group => {
        const groupExams = examinations.filter(e => group.examinationIds.includes(e.id))
        if (groupExams.length === 0) return null

        const byDay = days.map(d => groupExams.filter(e => e.day === d))
        const maxPerDay = Math.max(...byDay.map(d => d.length), 1)
        const svgW = days.length * (maxPerDay * (boxW + gapX) + paddingX * 2)
        const svgH = rowH + paddingY * 2

        return (
          <div key={group.id} style={{ marginBottom: '1.5rem' }}>
            <div style={{ fontWeight: 600, fontSize: '0.85rem', color: '#475569', marginBottom: '0.4rem' }}>{group.name}</div>
            <svg width={Math.max(600, svgW)} height={svgH} style={{ display: 'block' }}>
              {days.map((day, di) => {
                const dayExams = byDay[di]
                return dayExams.map((exam, ei) => {
                  const x = di * (maxPerDay * (boxW + gapX) + paddingX * 2) + ei * (boxW + gapX) + paddingX
                  const y = paddingY
                  return (
                    <g key={exam.id}>
                      <rect x={x} y={y} width={boxW} height={boxH} rx={6}
                        fill={DAY_COLORS[di]} stroke={DAY_BORDER[di]} strokeWidth={1.5} />
                      <text x={x + boxW / 2} y={y + 16} textAnchor="middle" fontSize={10} fontWeight={600} fill="#1e293b">
                        {exam.name.length > 22 ? exam.name.slice(0, 21) + '…' : exam.name}
                      </text>
                      <text x={x + boxW / 2} y={y + 30} textAnchor="middle" fontSize={10} fill="#64748b">
                        {exam.durationMin} min · {exam.staffRole}
                        {exam.parallelWith ? ' ⟳' : ''}
                      </text>
                    </g>
                  )
                })
              })}
            </svg>
          </div>
        )
      })}
    </div>
  )
}
