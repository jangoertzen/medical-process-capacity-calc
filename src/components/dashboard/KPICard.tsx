interface KPICardProps {
  title: string
  value: string | number
  subtitle?: string
  color?: 'blue' | 'green' | 'red' | 'orange' | 'gray'
  onClick?: () => void
}

const colors = {
  blue: { bg: '#eff6ff', border: '#bfdbfe', text: '#1d4ed8', label: '#3b82f6' },
  green: { bg: '#f0fdf4', border: '#bbf7d0', text: '#15803d', label: '#22c55e' },
  red: { bg: '#fef2f2', border: '#fecaca', text: '#b91c1c', label: '#ef4444' },
  orange: { bg: '#fff7ed', border: '#fed7aa', text: '#c2410c', label: '#f97316' },
  gray: { bg: '#f8fafc', border: '#e2e8f0', text: '#374151', label: '#6b7280' },
}

export function KPICard({ title, value, subtitle, color = 'blue', onClick }: KPICardProps) {
  const c = colors[color]
  return (
    <div
      onClick={onClick}
      style={{
        background: c.bg, border: `1px solid ${c.border}`, borderRadius: '8px',
        padding: '1.25rem', flex: 1, minWidth: 0,
        cursor: onClick ? 'pointer' : undefined,
        transition: onClick ? 'box-shadow 0.15s' : undefined,
      }}
      onMouseEnter={onClick ? (e) => { (e.currentTarget as HTMLElement).style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)' } : undefined}
      onMouseLeave={onClick ? (e) => { (e.currentTarget as HTMLElement).style.boxShadow = 'none' } : undefined}
    >
      <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{title}</div>
      <div style={{ fontSize: '2rem', fontWeight: 700, color: c.text, margin: '0.25rem 0' }}>{value}</div>
      {subtitle && <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>{subtitle}</div>}
    </div>
  )
}
