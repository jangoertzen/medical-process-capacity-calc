import { Component, type ReactNode } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Sidebar } from '@/components/layout/Sidebar'
import { Header } from '@/components/layout/Header'
import Dashboard from '@/pages/Dashboard'
import Untersuchungen from '@/pages/Untersuchungen'
import Ressourcen from '@/pages/Ressourcen'
import Szenarien from '@/pages/Szenarien'
import Diagramme from '@/pages/Diagramme'

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }
  static getDerivedStateFromError(error: Error) { return { error } }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: '2rem', color: '#b91c1c' }}>
          <h2 style={{ margin: '0 0 0.5rem' }}>Rendering-Fehler</h2>
          <pre style={{ fontSize: '0.8rem', whiteSpace: 'pre-wrap' }}>{this.state.error.message}</pre>
          <button onClick={() => this.setState({ error: null })}
            style={{ marginTop: '1rem', padding: '0.4rem 1rem', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer' }}>
            Erneut versuchen
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

export default function App() {
  return (
    <BrowserRouter>
      <div style={{ display: 'flex', minHeight: '100vh' }}>
        <Sidebar />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <Header />
          <main style={{ flex: 1, padding: '1.5rem', overflow: 'auto' }}>
            <ErrorBoundary>
              <Routes>
                <Route path="/" element={<Navigate to="/dashboard" replace />} />
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/untersuchungen" element={<Untersuchungen />} />
                <Route path="/ressourcen" element={<Ressourcen />} />
                <Route path="/szenarien" element={<Szenarien />} />
                <Route path="/diagramme" element={<Diagramme />} />
              </Routes>
            </ErrorBoundary>
          </main>
        </div>
      </div>
    </BrowserRouter>
  )
}
