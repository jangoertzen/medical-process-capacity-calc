import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Sidebar } from '@/components/layout/Sidebar'
import { Header } from '@/components/layout/Header'
import Dashboard from '@/pages/Dashboard'
import Untersuchungen from '@/pages/Untersuchungen'
import Ressourcen from '@/pages/Ressourcen'
import Szenarien from '@/pages/Szenarien'
import Diagramme from '@/pages/Diagramme'
import Import from '@/pages/Import'

export default function App() {
  return (
    <BrowserRouter>
      <div style={{ display: 'flex', minHeight: '100vh' }}>
        <Sidebar />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <Header />
          <main style={{ flex: 1, padding: '1.5rem', overflow: 'auto' }}>
            <Routes>
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/untersuchungen" element={<Untersuchungen />} />
              <Route path="/ressourcen" element={<Ressourcen />} />
              <Route path="/szenarien" element={<Szenarien />} />
              <Route path="/diagramme" element={<Diagramme />} />
              <Route path="/import" element={<Import />} />
            </Routes>
          </main>
        </div>
      </div>
    </BrowserRouter>
  )
}
