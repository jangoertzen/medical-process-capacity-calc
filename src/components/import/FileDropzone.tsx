import { useRef, useState } from 'react'
import { Upload } from 'lucide-react'

interface Props {
  onFile: (file: File) => void
}

export function FileDropzone({ onFile }: Props) {
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const handle = (file: File) => {
    if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
      onFile(file)
    }
  }

  return (
    <div
      onClick={() => inputRef.current?.click()}
      onDrop={e => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) handle(f) }}
      onDragOver={e => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      style={{
        border: `2px dashed ${dragging ? '#3b82f6' : '#cbd5e1'}`,
        borderRadius: '8px', padding: '3rem', textAlign: 'center', cursor: 'pointer',
        background: dragging ? '#eff6ff' : '#f8fafc',
        transition: 'all 0.2s',
      }}
    >
      <Upload size={32} color="#94a3b8" style={{ margin: '0 auto 0.75rem' }} />
      <div style={{ fontWeight: 500, color: '#475569' }}>Excel-Datei hier ablegen</div>
      <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginTop: '0.25rem' }}>oder klicken zum Durchsuchen (.xlsx, .xls)</div>
      <input ref={inputRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) handle(f) }} />
    </div>
  )
}
