import { useRef, useState } from 'react'
import { useAppStore } from '@/store/appStore'
import { calculateCapacity } from '@/lib/calculator'
import { normalizeScenario } from '@/lib/normalize'
import type { Scenario } from '@/types'

type ImportStatus =
  | { type: 'idle' }
  | { type: 'success'; count: number }
  | { type: 'error'; message: string }

export default function ImportExport() {
  const scenarios = useAppStore(s => s.scenarios)
  const activeScenarioId = useAppStore(s => s.activeScenarioId)
  const compareScenarioIds = useAppStore(s => s.compareScenarioIds)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [importStatus, setImportStatus] = useState<ImportStatus>({ type: 'idle' })
  const [previewJson, setPreviewJson] = useState<string | null>(null)

  // --- Export ---
  const exportData = {
    version: 'process-calc-v18',
    exportedAt: new Date().toISOString(),
    activeScenarioId,
    compareScenarioIds,
    scenarios,
  }
  const exportJson = JSON.stringify(exportData, null, 2)

  const handleDownload = () => {
    const blob = new Blob([exportJson], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const date = new Date().toISOString().slice(0, 10)
    a.download = `checkup-analyse-${date}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleCopyToClipboard = async () => {
    await navigator.clipboard.writeText(exportJson)
  }

  // --- Import ---
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target?.result as string
      setPreviewJson(text)
      setImportStatus({ type: 'idle' })
    }
    reader.readAsText(file)
  }

  const handleImport = () => {
    if (!previewJson) return
    try {
      const parsed = JSON.parse(previewJson)

      // Basic schema validation
      if (!parsed.scenarios || !Array.isArray(parsed.scenarios) || parsed.scenarios.length === 0) {
        setImportStatus({ type: 'error', message: 'Ungültiges Format: "scenarios" fehlt oder ist leer.' })
        return
      }
      if (!parsed.activeScenarioId || typeof parsed.activeScenarioId !== 'string') {
        setImportStatus({ type: 'error', message: 'Ungültiges Format: "activeScenarioId" fehlt.' })
        return
      }

      // Validate each scenario has required fields and recalculate results
      const importedScenarios: Scenario[] = parsed.scenarios.map((s: Scenario) => {
        if (!s.id || !s.name || !s.examinations || !s.resourceGroups || !s.resourceConfig) {
          throw new Error(`Szenario "${s.name ?? s.id}" hat unvollständige Daten.`)
        }
        const n = normalizeScenario(s)
        return {
          ...n,
          results: calculateCapacity(n.examinations, n.resourceGroups, n.resourceConfig),
        }
      })

      const importedActiveId = parsed.scenarios.some((s: Scenario) => s.id === parsed.activeScenarioId)
        ? parsed.activeScenarioId
        : importedScenarios[0].id

      const importedCompareIds: string[] = Array.isArray(parsed.compareScenarioIds)
        ? parsed.compareScenarioIds.filter((id: string) =>
            importedScenarios.some(s => s.id === id)
          )
        : []

      // Write directly to localStorage and reload — cleanest way to replace full state
      const storeKey = 'process-calc-v18'
      const storeValue = JSON.stringify({
        state: {
          scenarios: importedScenarios,
          activeScenarioId: importedActiveId,
          compareScenarioIds: importedCompareIds,
        },
        version: 0,
      })
      localStorage.setItem(storeKey, storeValue)

      setImportStatus({ type: 'success', count: importedScenarios.length })
      // Reload after short delay so the user sees the success message
      setTimeout(() => window.location.reload(), 1200)
    } catch (err) {
      setImportStatus({
        type: 'error',
        message: err instanceof Error ? err.message : 'JSON konnte nicht verarbeitet werden.',
      })
    }
  }

  const handlePasteJson = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setPreviewJson(e.target.value || null)
    setImportStatus({ type: 'idle' })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div>
        <h1 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#1e293b', margin: 0 }}>Import / Export</h1>
        <p style={{ fontSize: '0.85rem', color: '#64748b', marginTop: '0.25rem', marginBottom: 0 }}>
          Alle Szenarien und Einstellungen als JSON exportieren oder importieren.
        </p>
      </div>

      {/* Export */}
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '1.25rem' }}>
        <div style={{ fontWeight: 600, color: '#1e293b', marginBottom: '0.25rem', fontSize: '0.95rem' }}>Export</div>
        <div style={{ fontSize: '0.82rem', color: '#64748b', marginBottom: '1rem' }}>
          Exportiert alle {scenarios.length} Szenario{scenarios.length !== 1 ? 's' : ''} inkl. Untersuchungen,
          Ressourcengruppen und Öffnungszeiten.
        </div>

        <div style={{ display: 'flex', gap: '0.6rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
          <button onClick={handleDownload} style={btnPrimaryS}>
            JSON herunterladen
          </button>
          <button onClick={handleCopyToClipboard} style={btnSecondaryS}>
            In Zwischenablage kopieren
          </button>
        </div>

        <div style={{ position: 'relative' }}>
          <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginBottom: '0.3rem' }}>Vorschau</div>
          <textarea
            readOnly
            value={exportJson}
            rows={12}
            style={textareaS}
          />
        </div>
      </div>

      {/* Import */}
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '1.25rem' }}>
        <div style={{ fontWeight: 600, color: '#1e293b', marginBottom: '0.25rem', fontSize: '0.95rem' }}>Import</div>
        <div style={{ fontSize: '0.82rem', color: '#64748b', marginBottom: '1rem' }}>
          Lädt eine zuvor exportierte JSON-Datei. <strong>Der aktuelle Stand wird vollständig ersetzt.</strong>
        </div>

        <div style={{ display: 'flex', gap: '0.6rem', marginBottom: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <button onClick={() => fileInputRef.current?.click()} style={btnSecondaryS}>
            Datei auswählen …
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            onChange={handleFileChange}
            style={{ display: 'none' }}
          />
          {previewJson && (
            <span style={{ fontSize: '0.8rem', color: '#64748b' }}>
              {previewJson.length.toLocaleString('de-DE')} Zeichen geladen
            </span>
          )}
        </div>

        <div style={{ marginBottom: '1rem' }}>
          <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginBottom: '0.3rem' }}>
            Oder JSON direkt einfügen
          </div>
          <textarea
            value={previewJson ?? ''}
            onChange={handlePasteJson}
            rows={12}
            placeholder='{ "version": "process-calc-v18", "scenarios": [ ... ] }'
            style={{ ...textareaS, color: previewJson ? '#1e293b' : '#94a3b8' }}
          />
        </div>

        {importStatus.type === 'error' && (
          <div style={{
            padding: '0.6rem 1rem', background: '#fef2f2', border: '1px solid #fecaca',
            borderRadius: '6px', fontSize: '0.82rem', color: '#b91c1c', marginBottom: '0.75rem',
          }}>
            {importStatus.message}
          </div>
        )}
        {importStatus.type === 'success' && (
          <div style={{
            padding: '0.6rem 1rem', background: '#f0fdf4', border: '1px solid #bbf7d0',
            borderRadius: '6px', fontSize: '0.82rem', color: '#16a34a', marginBottom: '0.75rem',
          }}>
            {importStatus.count} Szenario{importStatus.count !== 1 ? 's' : ''} importiert. Seite wird neu geladen …
          </div>
        )}

        <button
          onClick={handleImport}
          disabled={!previewJson || importStatus.type === 'success'}
          style={{
            ...btnPrimaryS,
            opacity: (!previewJson || importStatus.type === 'success') ? 0.4 : 1,
            cursor: (!previewJson || importStatus.type === 'success') ? 'not-allowed' : 'pointer',
          }}
        >
          Importieren und anwenden
        </button>
      </div>
    </div>
  )
}

const btnPrimaryS: React.CSSProperties = {
  padding: '0.45rem 1.1rem', borderRadius: '6px', border: 'none',
  background: '#3b82f6', color: '#fff', fontWeight: 600,
  fontSize: '0.85rem', cursor: 'pointer',
}

const btnSecondaryS: React.CSSProperties = {
  padding: '0.45rem 1.1rem', borderRadius: '6px',
  border: '1px solid #cbd5e1', background: '#f8fafc',
  color: '#374151', fontWeight: 500, fontSize: '0.85rem', cursor: 'pointer',
}

const textareaS: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box',
  padding: '0.6rem 0.75rem', border: '1px solid #e2e8f0', borderRadius: '6px',
  fontSize: '0.75rem', fontFamily: 'monospace', color: '#1e293b',
  background: '#f8fafc', resize: 'vertical', outline: 'none',
}
