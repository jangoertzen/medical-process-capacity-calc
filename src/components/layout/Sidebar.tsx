import { Link, useLocation } from 'react-router-dom'
import { LayoutDashboard, ClipboardList, Settings, GitBranch, BarChart3 } from 'lucide-react'

const navItems = [
  { path: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/untersuchungen', label: 'Untersuchungen', icon: ClipboardList },
  { path: '/ressourcen', label: 'Ressourcen', icon: Settings },
  { path: '/szenarien', label: 'Szenarien', icon: GitBranch },
  { path: '/diagramme', label: 'Diagramme', icon: BarChart3 },
]

export function Sidebar() {
  const location = useLocation()
  return (
    <aside style={{ width: '220px', background: '#1e293b', color: '#cbd5e1', display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <div style={{ padding: '1.25rem 1rem', borderBottom: '1px solid #334155' }}>
        <div style={{ fontWeight: 700, fontSize: '1rem', color: '#f1f5f9' }}>Checkup Analyse</div>
        <div style={{ fontSize: '0.7rem', color: '#64748b', marginTop: '0.2rem' }}>Engpassanalyse</div>
      </div>
      <nav style={{ padding: '0.75rem 0', flex: 1 }}>
        {navItems.map(item => {
          const Icon = item.icon
          const active = location.pathname === item.path
          return (
            <Link
              key={item.path}
              to={item.path}
              style={{
                display: 'flex', alignItems: 'center', gap: '0.6rem',
                padding: '0.6rem 1rem',
                color: active ? '#f1f5f9' : '#94a3b8',
                background: active ? '#334155' : 'transparent',
                textDecoration: 'none',
                fontSize: '0.875rem',
                borderLeft: active ? '3px solid #3b82f6' : '3px solid transparent',
                transition: 'all 0.15s',
              }}
            >
              <Icon size={16} />
              {item.label}
            </Link>
          )
        })}
      </nav>
    </aside>
  )
}
