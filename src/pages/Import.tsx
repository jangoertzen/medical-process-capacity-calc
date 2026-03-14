import { useState } from 'react'
import { FileDropzone } from '@/components/import/FileDropzone'
import { DataPreview } from '@/components/import/DataPreview'
import { ColumnMapper } from '@/components/import/ColumnMapper'
import { parseExcelFile, mapRowsToExaminations } from '@/lib/excelImport'
import { useAppStore } from '@/store/appStore'

export default function Import() {
  const [sheets, setSheets] = useState<{ name: string; data: Record<string, unknown>[] }[]>([])
  const [activeSheet, setActiveSheet] = useState<string>('')
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [errors, setErrors] = useState<string[]>([])
  const [success, setSuccess] = useState(false)
  const updateExamination = useAppStore(s => s.updateExamination)
  const activeScenario = useAppStore(s => s.getActiveScenario())

  const handleFile = async (file: File) => {
    const buf = await file.arrayBuffer()
    const parsed = parseExcelFile(buf)
    setSheets(parsed)
    setActiveSheet(parsed[0]?.name ?? '')
    setSuccess(false)
    setErrors([])
  }

  const currentData = sheets.find(s => s.name === activeSheet)?.data ?? []
  const columns = currentData.length > 0 ? Object.keys(currentData[0]) : []

  const handleApply = () => {
    const fullMapping = {
      day: mapping.day ?? '',
      name: mapping.name ?? '',
      staffRole: mapping.staffRole ?? '',
      durationMin: mapping.durationMin ?? '',
      parallelWith: mapping.parallelWith ?? '',
      resourceGroupId: mapping.resourceGroupId ?? '',
    }
    const { examinations, errors: errs } = mapRowsToExaminations(currentData, fullMapping)
    if (errs.length > 0) { setErrors(errs); return }
    const existing = activeScenario?.examinations ?? []
    for (const imp of examinations) {
      const match = existing.find(e => e.name === imp.name)
      if (match) {
        updateExamination(match.id, { durationMin: imp.durationMin, parallelWith: imp.parallelWith, staffRole: imp.staffRole })
      }
    }
    setSuccess(true)
    setErrors([])
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', maxWidth: '800px' }}>
      <div>
        <h1 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#1e293b', margin: 0 }}>Import</h1>
        <p style={{ fontSize: '0.85rem', color: '#64748b', marginTop: '0.25rem', marginBottom: 0 }}>
          Excel-Datei (.xlsx) importieren und Spalten zuordnen.
        </p>
      </div>

      <FileDropzone onFile={handleFile} />

      {sheets.length > 0 && (
        <>
          <div>
            <label style={{ fontSize: '0.85rem', fontWeight: 500, color: '#475569', marginRight: '0.5rem' }}>Tabellenblatt:</label>
            <select value={activeSheet} onChange={e => setActiveSheet(e.target.value)}
              style={{ padding: '0.3rem 0.5rem', border: '1px solid #cbd5e1', borderRadius: '4px', fontSize: '0.85rem' }}>
              {sheets.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
            </select>
          </div>

          <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '1.25rem' }}>
            <div style={{ fontWeight: 600, color: '#1e293b', marginBottom: '0.75rem' }}>Vorschau ({currentData.length} Zeilen)</div>
            <DataPreview data={currentData} />
          </div>

          <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '1.25rem' }}>
            <div style={{ fontWeight: 600, color: '#1e293b', marginBottom: '0.75rem' }}>Spalten zuordnen</div>
            <ColumnMapper columns={columns} mapping={mapping} onChange={(f, c) => setMapping(m => ({ ...m, [f]: c }))} />
          </div>

          {errors.length > 0 && (
            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '6px', padding: '0.875rem' }}>
              {errors.map((e, i) => <div key={i} style={{ fontSize: '0.8rem', color: '#b91c1c' }}>{e}</div>)}
            </div>
          )}

          {success && (
            <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '6px', padding: '0.875rem', color: '#15803d', fontSize: '0.875rem', fontWeight: 500 }}>
              Import erfolgreich angewendet.
            </div>
          )}

          <button onClick={handleApply} style={{
            padding: '0.6rem 1.5rem', background: '#3b82f6', color: '#fff', border: 'none',
            borderRadius: '6px', cursor: 'pointer', fontWeight: 600, fontSize: '0.9rem', alignSelf: 'flex-start',
          }}>
            Importieren
          </button>
        </>
      )}
    </div>
  )
}
