import { useState, useCallback } from 'react'
import {
  DndContext,
  DragOverlay,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  useDroppable,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useAppStore } from '@/store/appStore'
import type { DayNumber, Examination, ResourceGroup, ResourceGroupType, StaffConfig } from '@/types'

const DAY_LABELS: Record<DayNumber, string> = { 1: 'Tag 1', 2: 'Tag 2', 3: 'Tag 3' }
const STAFF_LABELS: Record<keyof StaffConfig, string> = {
  doctorCount: 'Ärzte',
  mfaFunktionsdiagnostik: 'MFA Funktionsdiagnostik',
  mfaLabor: 'MFA Labor',
}
const DEVICE_ROLE_LABELS = { attach: 'Gerät anlegen', return: 'Gerät abnehmen' } as const

const DAY_COLORS: Record<DayNumber, { bg: string; border: string; header: string }> = {
  1: { bg: '#eff6ff', border: '#bfdbfe', header: '#1d4ed8' },
  2: { bg: '#f0fdf4', border: '#bbf7d0', header: '#15803d' },
  3: { bg: '#fefce8', border: '#fde68a', header: '#92400e' },
}

// ---------------------------------------------------------------------------
// Modal for adding new examination
// ---------------------------------------------------------------------------

interface AddExamModalProps {
  day: DayNumber
  resourceGroups: ResourceGroup[]
  allExams: Examination[]
  onClose: () => void
  onAdd: (patch: Omit<Examination, 'id'>) => void
}

function AddExamModal({ day, resourceGroups, allExams, onClose, onAdd }: AddExamModalProps) {
  const [name, setName] = useState('')
  const [selectedDay, setSelectedDay] = useState<DayNumber>(day)
  const [staffRole, setStaffRole] = useState<'MFA' | 'Arzt'>('MFA')
  const [durationMin, setDurationMin] = useState(10)
  const [resourceGroupId, setResourceGroupId] = useState(resourceGroups[0]?.id ?? '')
  const [revenueEur, setRevenueEur] = useState(0)
  const [parallelWith, setParallelWith] = useState<string | null>(null)
  const [mustFollowExamId, setMustFollowExamId] = useState<string | null>(null)
  const [participationPercent, setParticipationPercent] = useState(100)
  const [deviceRole, setDeviceRole] = useState<'attach' | 'return'>('attach')
  const [scheduleLast, setScheduleLast] = useState(false)
  const [deviceCount, setDeviceCount] = useState<number | null>(null)
  const isDeviceGroup = resourceGroups.find(g => g.id === resourceGroupId)?.groupType === 'device_count'

  const maxOrder = allExams.filter(e => e.day === selectedDay).reduce((m, e) => Math.max(m, e.order), 0)

  const handleSubmit = () => {
    if (!name.trim()) return
    onAdd({
      day: selectedDay,
      name: name.trim(),
      room: '',
      staffRole,
      durationMin,
      parallelWith,
      resourceGroupId,
      revenueEur,
      order: maxOrder + 1,
      mustFollowExamId,
      participationPercent,
      deviceRole: isDeviceGroup ? deviceRole : undefined,
      scheduleLast,
      deviceCount: isDeviceGroup ? null : deviceCount,
    })
    onClose()
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onClose}>
      <div style={{
        background: '#fff', borderRadius: '10px', padding: '1.5rem', width: '480px', maxWidth: '95vw',
        boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
      }} onClick={e => e.stopPropagation()}>
        <div style={{ fontWeight: 700, fontSize: '1rem', color: '#1e293b', marginBottom: '1.25rem' }}>
          Neue Untersuchung
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <FormRow label="Name">
            <input value={name} onChange={e => setName(e.target.value)}
              placeholder="z.B. Lungenfunktion"
              style={inputS} autoFocus />
          </FormRow>
          <FormRow label="Tag">
            <select value={selectedDay} onChange={e => setSelectedDay(Number(e.target.value) as DayNumber)} style={inputS}>
              {([1, 2, 3] as DayNumber[]).map(d => <option key={d} value={d}>{DAY_LABELS[d]}</option>)}
            </select>
          </FormRow>
          <FormRow label="Rolle">
            <select value={staffRole} onChange={e => setStaffRole(e.target.value as 'MFA' | 'Arzt')} style={inputS}>
              <option>MFA</option>
              <option>Arzt</option>
            </select>
          </FormRow>
          <FormRow label="Dauer (min)">
            <input type="number" min={1} max={120} value={durationMin}
              onChange={e => setDurationMin(Number(e.target.value))} style={inputS} />
          </FormRow>
          <FormRow label="Ressourcengruppe">
            <select value={resourceGroupId} onChange={e => setResourceGroupId(e.target.value)} style={inputS}>
              {resourceGroups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </FormRow>
          {isDeviceGroup && (
            <FormRow label="Gerätezyklus">
              <select value={deviceRole} onChange={e => setDeviceRole(e.target.value as 'attach' | 'return')} style={inputS}>
                <option value="attach">{DEVICE_ROLE_LABELS.attach}</option>
                <option value="return">{DEVICE_ROLE_LABELS.return}</option>
              </select>
            </FormRow>
          )}
          {!isDeviceGroup && (
            <FormRow label="Anzahl Geräte">
              <DeviceCountInput value={deviceCount} onChange={setDeviceCount} />
            </FormRow>
          )}
          <FormRow label="Immer zuletzt">
            <input type="checkbox" checked={scheduleLast} onChange={e => setScheduleLast(e.target.checked)}
              style={{ width: '18px', height: '18px', accentColor: '#3b82f6' }} />
          </FormRow>
          <FormRow label="Umsatz (€)">
            <input type="number" min={0} max={9999} value={revenueEur}
              onChange={e => setRevenueEur(Number(e.target.value))} style={inputS} />
          </FormRow>
          <FormRow label="Parallel mit">
            <select value={parallelWith ?? ''} onChange={e => setParallelWith(e.target.value || null)} style={inputS}>
              <option value="">— keine —</option>
              {allExams.filter(e => e.name !== name).map(e => <option key={e.id} value={e.name}>{e.name}</option>)}
            </select>
          </FormRow>
          <FormRow label="Folgt nach">
            <select value={mustFollowExamId ?? ''} onChange={e => setMustFollowExamId(e.target.value || null)} style={inputS}>
              <option value="">— keine —</option>
              {allExams.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </FormRow>
          <FormRow label="Patientenanteil">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <input type="range" min={0} max={100} step={5} value={participationPercent}
                onChange={e => setParticipationPercent(Number(e.target.value))}
                style={{ width: '100px', accentColor: '#3b82f6' }} />
              <span style={{ fontWeight: 700, fontSize: '0.85rem', minWidth: '36px' }}>{participationPercent}%</span>
            </div>
          </FormRow>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1.25rem' }}>
          <button onClick={onClose} style={btnSecondaryS}>Abbrechen</button>
          <button onClick={handleSubmit} disabled={!name.trim()} style={btnPrimaryS}>Hinzufügen</button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Exam card (collapsed + expanded inline edit)
// ---------------------------------------------------------------------------

interface ExamCardProps {
  exam: Examination
  resourceGroups: ResourceGroup[]
  allExams: Examination[]
  isDragging?: boolean
  isOverlay?: boolean
}

function ExamCard({ exam, resourceGroups, allExams, isDragging = false, isOverlay = false }: ExamCardProps) {
  const updateExamination = useAppStore(s => s.updateExamination)
  const deleteExamination = useAppStore(s => s.deleteExamination)
  const [expanded, setExpanded] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const group = resourceGroups.find(g => g.id === exam.resourceGroupId)
  const followExam = exam.mustFollowExamId ? allExams.find(e => e.id === exam.mustFollowExamId) : null

  const {
    attributes, listeners, setNodeRef, transform, transition, isDragging: sortableIsDragging,
  } = useSortable({ id: exam.id })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: sortableIsDragging ? 0.3 : 1,
  }

  const cardStyle: React.CSSProperties = {
    background: isDragging || isOverlay ? '#f0f9ff' : '#fff',
    border: `1px solid ${isDragging || isOverlay ? '#60a5fa' : '#e2e8f0'}`,
    borderRadius: '8px',
    padding: '0.6rem 0.75rem',
    marginBottom: '0.5rem',
    boxShadow: isOverlay ? '0 8px 24px rgba(0,0,0,0.15)' : '0 1px 2px rgba(0,0,0,0.04)',
    cursor: isOverlay ? 'grabbing' : 'default',
    userSelect: 'none',
  }

  return (
    <div ref={isOverlay ? undefined : setNodeRef} style={isOverlay ? {} : style}>
      <div style={cardStyle}>
        {/* Card header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          {/* Drag handle */}
          {!isOverlay && (
            <span
              {...attributes}
              {...listeners}
              style={{ cursor: 'grab', color: '#cbd5e1', fontSize: '0.9rem', lineHeight: 1, padding: '0.1rem', touchAction: 'none' }}
              title="Ziehen"
            >⣿</span>
          )}
          <span
            style={{ flex: 1, fontWeight: 600, fontSize: '0.85rem', color: '#1e293b', cursor: 'pointer' }}
            onClick={() => !isOverlay && setExpanded(x => !x)}
          >
            {exam.name}
            {followExam && (
              <span style={{ marginLeft: '0.35rem', fontSize: '0.72rem', color: '#f97316' }} title={`Folgt nach: ${followExam.name}`}>→</span>
            )}
          </span>
          <span style={{
            fontSize: '0.7rem', fontWeight: 600, padding: '0.1rem 0.4rem',
            borderRadius: '4px',
            background: exam.staffRole === 'Arzt' ? '#fef2f2' : '#eff6ff',
            color: exam.staffRole === 'Arzt' ? '#b91c1c' : '#1d4ed8',
          }}>{exam.staffRole}</span>
          <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{exam.durationMin}min</span>
          {exam.deviceCount ? (
            <span title={`${exam.deviceCount} Gerät(e) nur für diese Untersuchung`} style={{ fontSize: '0.7rem', fontWeight: 600, color: '#0f766e', background: '#f0fdfa', padding: '0.1rem 0.35rem', borderRadius: '4px' }}>
              {exam.deviceCount}×
            </span>
          ) : null}
          {(exam.participationPercent ?? 100) < 100 && (
            <span style={{ fontSize: '0.7rem', fontWeight: 600, color: '#f97316' }}>{exam.participationPercent}%</span>
          )}
          {exam.revenueEur > 0 && (
            <span style={{ fontSize: '0.72rem', color: '#16a34a' }}>{exam.revenueEur}€</span>
          )}
          {!isOverlay && (
            <>
              <button
                onClick={() => setExpanded(x => !x)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0.1rem 0.25rem', color: '#94a3b8', fontSize: '0.75rem' }}
                title="Bearbeiten"
              >{expanded ? '▲' : '✏'}</button>
              {confirmDelete ? (
                <span style={{ display: 'flex', gap: '0.25rem' }}>
                  <button onClick={() => deleteExamination(exam.id)} style={{ ...btnDangerS, fontSize: '0.7rem', padding: '0.1rem 0.4rem' }}>Löschen</button>
                  <button onClick={() => setConfirmDelete(false)} style={{ ...btnSecondaryS, fontSize: '0.7rem', padding: '0.1rem 0.4rem' }}>Abbruch</button>
                </span>
              ) : (
                <button
                  onClick={() => setConfirmDelete(true)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0.1rem 0.25rem', color: '#f87171', fontSize: '0.75rem' }}
                  title="Löschen"
                >🗑</button>
              )}
            </>
          )}
        </div>

        {/* Expanded edit fields */}
        {expanded && !isOverlay && (
          <div style={{ marginTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', borderTop: '1px solid #f1f5f9', paddingTop: '0.75rem' }}>
            <FormRow label="Name">
              <input value={exam.name} onChange={e => updateExamination(exam.id, { name: e.target.value })} style={inputS} />
            </FormRow>
            <FormRow label="Rolle">
              <select value={exam.staffRole} onChange={e => updateExamination(exam.id, { staffRole: e.target.value as 'MFA' | 'Arzt' })} style={inputS}>
                <option>MFA</option>
                <option>Arzt</option>
              </select>
            </FormRow>
            <FormRow label="Dauer (min)">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <input type="range" min={1} max={120} value={exam.durationMin}
                  onChange={e => updateExamination(exam.id, { durationMin: Number(e.target.value) })}
                  style={{ width: '100px', accentColor: '#3b82f6' }} />
                <input type="number" min={1} max={120} value={exam.durationMin}
                  onChange={e => { const v = parseInt(e.target.value); if (!isNaN(v) && v >= 1) updateExamination(exam.id, { durationMin: v }) }}
                  style={{ width: '52px', ...inputS }} />
              </div>
            </FormRow>
            <FormRow label="Patientenanteil">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <input type="range" min={0} max={100} step={5}
                  value={exam.participationPercent ?? 100}
                  onChange={e => updateExamination(exam.id, { participationPercent: Number(e.target.value) })}
                  style={{ width: '100px', accentColor: exam.participationPercent < 100 ? '#f97316' : '#3b82f6' }} />
                <span style={{
                  fontWeight: 700, fontSize: '0.85rem', minWidth: '36px',
                  color: (exam.participationPercent ?? 100) < 100 ? '#f97316' : '#1e293b',
                }}>{exam.participationPercent ?? 100}%</span>
              </div>
            </FormRow>
            <FormRow label="Umsatz (€)">
              <input type="number" min={0} max={9999} value={exam.revenueEur}
                onChange={e => { const v = parseInt(e.target.value); if (!isNaN(v) && v >= 0) updateExamination(exam.id, { revenueEur: v }) }}
                style={{ ...inputS, width: '80px' }} />
            </FormRow>
            <FormRow label="Ressourcengruppe">
              <select value={exam.resourceGroupId} onChange={e => updateExamination(exam.id, { resourceGroupId: e.target.value })} style={inputS}>
                {resourceGroups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </FormRow>
            {group?.groupType === 'device_count' && (
              <FormRow label="Gerätezyklus">
                <select value={exam.deviceRole ?? 'attach'} onChange={e => updateExamination(exam.id, { deviceRole: e.target.value as 'attach' | 'return' })} style={inputS}>
                  <option value="attach">{DEVICE_ROLE_LABELS.attach}</option>
                  <option value="return">{DEVICE_ROLE_LABELS.return}</option>
                </select>
              </FormRow>
            )}
            {group?.groupType !== 'device_count' && (
              <FormRow label="Anzahl Geräte">
                <DeviceCountInput value={exam.deviceCount ?? null} onChange={v => updateExamination(exam.id, { deviceCount: v })} />
              </FormRow>
            )}
            <FormRow label="Immer zuletzt">
              <input type="checkbox" checked={exam.scheduleLast ?? false}
                onChange={e => updateExamination(exam.id, { scheduleLast: e.target.checked })}
                style={{ width: '18px', height: '18px', accentColor: '#3b82f6' }} />
            </FormRow>
            <FormRow label="Parallel mit">
              <select value={exam.parallelWith ?? ''} onChange={e => updateExamination(exam.id, { parallelWith: e.target.value || null })} style={inputS}>
                <option value="">— keine —</option>
                {allExams.filter(e => e.id !== exam.id).map(e => <option key={e.id} value={e.name}>{e.name}</option>)}
              </select>
            </FormRow>
            <FormRow label="Folgt nach">
              <select value={exam.mustFollowExamId ?? ''} onChange={e => updateExamination(exam.id, { mustFollowExamId: e.target.value || null })} style={inputS}>
                <option value="">— keine —</option>
                {allExams.filter(e => e.id !== exam.id).map(e => <option key={e.id} value={e.id}>{e.name} ({DAY_LABELS[e.day]})</option>)}
              </select>
            </FormRow>
            <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>
              Gruppe: {group?.name ?? exam.resourceGroupId}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Day column (droppable)
// ---------------------------------------------------------------------------

interface DayColumnProps {
  day: DayNumber
  exams: Examination[]
  resourceGroups: ResourceGroup[]
  allExams: Examination[]
  onAddExam: (day: DayNumber) => void
  /** Shown in the header, e.g. when Tag 3 is folded into Tag 2 (2-day program) */
  hint?: string
}

function DayColumn({ day, exams, resourceGroups, allExams, onAddExam, hint }: DayColumnProps) {
  const colors = DAY_COLORS[day]
  const sortedExams = [...exams].sort((a, b) => a.order - b.order)
  const ids = sortedExams.map(e => e.id)

  const { setNodeRef, isOver } = useDroppable({ id: `day-col-${day}` })

  return (
    <div style={{
      flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column',
      background: isOver ? colors.bg : '#f8fafc',
      border: `2px solid ${isOver ? colors.border : '#e2e8f0'}`,
      borderRadius: '10px',
      transition: 'background 0.15s, border-color 0.15s',
      minHeight: '200px',
    }}>
      {/* Column header */}
      <div style={{
        padding: '0.6rem 0.9rem', borderBottom: '1px solid #e2e8f0',
        background: colors.bg, borderRadius: '8px 8px 0 0',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <span style={{ fontWeight: 700, fontSize: '0.9rem', color: colors.header }}>{DAY_LABELS[day]}</span>
        <span style={{ fontSize: '0.75rem', color: hint ? '#f97316' : '#94a3b8' }}>{hint ?? `${sortedExams.length} Untersuchungen`}</span>
      </div>

      {/* Sortable items */}
      <div ref={setNodeRef} style={{ flex: 1, padding: '0.6rem 0.7rem' }}>
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          {sortedExams.map(exam => (
            <ExamCard
              key={exam.id}
              exam={exam}
              resourceGroups={resourceGroups}
              allExams={allExams}
            />
          ))}
        </SortableContext>
        {sortedExams.length === 0 && (
          <div style={{ textAlign: 'center', padding: '1.5rem 0', color: '#cbd5e1', fontSize: '0.8rem' }}>
            Keine Untersuchungen
          </div>
        )}
      </div>

      {/* Add button */}
      <div style={{ padding: '0.5rem 0.7rem', borderTop: '1px solid #f1f5f9' }}>
        <button onClick={() => onAddExam(day)} style={{
          width: '100%', padding: '0.35rem', borderRadius: '6px', border: `1px dashed ${colors.border}`,
          background: 'transparent', cursor: 'pointer', fontSize: '0.8rem', color: colors.header,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.35rem',
        }}>
          + Untersuchung
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Resource groups panel (collapsible)
// ---------------------------------------------------------------------------

interface ResourceGroupsPanelProps {
  resourceGroups: ResourceGroup[]
  allExams: Examination[]
}

function ResourceGroupsPanel({ resourceGroups, allExams }: ResourceGroupsPanelProps) {
  const [open, setOpen] = useState(false)
  const [showAddGroup, setShowAddGroup] = useState(false)
  const updateResourceGroup = useAppStore(s => s.updateResourceGroup)
  const addResourceGroup = useAppStore(s => s.addResourceGroup)
  const deleteResourceGroup = useAppStore(s => s.deleteResourceGroup)

  const [newGroupName, setNewGroupName] = useState('')
  const [newGroupType, setNewGroupType] = useState<ResourceGroupType>('time_based')
  const [newGroupDeviceCount, setNewGroupDeviceCount] = useState<number | null>(null)
  const [newGroupStaffType, setNewGroupStaffType] = useState<keyof StaffConfig>('mfaFunktionsdiagnostik')
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  const handleAddGroup = () => {
    if (!newGroupName.trim()) return
    addResourceGroup({
      name: newGroupName.trim(),
      examinationIds: [],
      slotsPerDay: newGroupDeviceCount ?? 4,
      groupType: newGroupType,
      deviceCount: newGroupType === 'staff_multiplied' ? null : (newGroupDeviceCount ?? 1),
      staffType: newGroupType === 'staff_multiplied' ? newGroupStaffType : undefined,
    })
    setNewGroupName('')
    setNewGroupDeviceCount(null)
    setShowAddGroup(false)
  }

  return (
    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '10px' }}>
      <button
        onClick={() => setOpen(x => !x)}
        style={{
          width: '100%', padding: '0.9rem 1.25rem', background: 'none', border: 'none',
          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          fontSize: '0.9rem', fontWeight: 700, color: '#1e293b',
        }}
      >
        <span>Ressourcengruppen konfigurieren</span>
        <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>{open ? '▲ Einklappen' : '▼ Aufklappen'}</span>
      </button>

      {open && (
        <div style={{ padding: '0 1.25rem 1.25rem', borderTop: '1px solid #f1f5f9' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.83rem', marginTop: '0.75rem' }}>
            <thead>
              <tr style={{ background: '#f8fafc' }}>
                <th style={thS}>Name</th>
                <th style={thS}>Typ</th>
                <th style={thS}>Geräte/Einheiten</th>
                <th style={thS}>Untersuchungen</th>
                <th style={thS}></th>
              </tr>
            </thead>
            <tbody>
              {resourceGroups.map(group => {
                const assignedCount = allExams.filter(e => e.resourceGroupId === group.id).length
                const canDelete = assignedCount === 0
                return (
                  <tr key={group.id} style={{ borderTop: '1px solid #f1f5f9' }}>
                    <td style={tdS}><strong>{group.name}</strong></td>
                    <td style={tdS}>
                      <span style={{
                        fontSize: '0.72rem', padding: '0.1rem 0.4rem', borderRadius: '4px',
                        background: group.groupType === 'device_count' ? '#fef2f2' : group.groupType === 'time_based' ? '#eff6ff' : '#f0fdf4',
                        color: group.groupType === 'device_count' ? '#b91c1c' : group.groupType === 'time_based' ? '#1d4ed8' : '#15803d',
                      }}>
                        {group.groupType === 'device_count' ? 'Gerät' : group.groupType === 'time_based' ? 'Zeitbasiert' : 'Personal'}
                      </span>
                    </td>
                    <td style={tdS}>
                      {group.groupType !== 'staff_multiplied' ? (
                        <input
                          type="number" min={1} max={50}
                          value={group.deviceCount ?? ''}
                          placeholder="—"
                          onChange={e => {
                            const v = parseInt(e.target.value)
                            updateResourceGroup(group.id, { deviceCount: isNaN(v) ? null : v })
                          }}
                          style={{ width: '60px', padding: '0.2rem 0.35rem', border: '1px solid #cbd5e1', borderRadius: '4px', fontSize: '0.82rem' }}
                        />
                      ) : (
                        <select
                          value={group.staffType ?? 'mfaFunktionsdiagnostik'}
                          onChange={e => updateResourceGroup(group.id, { staffType: e.target.value as keyof StaffConfig })}
                          title="Welches Personal bedient diese Gruppe?"
                          style={{ padding: '0.2rem 0.35rem', border: '1px solid #cbd5e1', borderRadius: '4px', fontSize: '0.8rem' }}
                        >
                          {(Object.keys(STAFF_LABELS) as (keyof StaffConfig)[]).map(k => (
                            <option key={k} value={k}>{STAFF_LABELS[k]}</option>
                          ))}
                        </select>
                      )}
                    </td>
                    <td style={tdS}>{assignedCount}</td>
                    <td style={tdS}>
                      {confirmDeleteId === group.id ? (
                        <span style={{ display: 'flex', gap: '0.25rem' }}>
                          <button
                            onClick={() => { deleteResourceGroup(group.id); setConfirmDeleteId(null) }}
                            disabled={!canDelete}
                            style={{ ...btnDangerS, fontSize: '0.72rem', padding: '0.1rem 0.4rem' }}
                          >Löschen</button>
                          <button onClick={() => setConfirmDeleteId(null)} style={{ ...btnSecondaryS, fontSize: '0.72rem', padding: '0.1rem 0.4rem' }}>Abbruch</button>
                        </span>
                      ) : (
                        <button
                          onClick={() => setConfirmDeleteId(group.id)}
                          disabled={!canDelete}
                          title={canDelete ? 'Gruppe löschen' : 'Gruppe hat zugewiesene Untersuchungen'}
                          style={{ background: 'none', border: 'none', cursor: canDelete ? 'pointer' : 'not-allowed', color: canDelete ? '#f87171' : '#cbd5e1', fontSize: '0.8rem' }}
                        >🗑</button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          {showAddGroup ? (
            <div style={{ marginTop: '1rem', padding: '0.75rem', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
              <div style={{ fontWeight: 600, fontSize: '0.85rem', color: '#1e293b', marginBottom: '0.75rem' }}>Neue Ressourcengruppe</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'flex-end' }}>
                <div>
                  <label style={labelS}>Name</label>
                  <input value={newGroupName} onChange={e => setNewGroupName(e.target.value)} style={inputS} placeholder="Gruppenname" />
                </div>
                <div>
                  <label style={labelS}>Typ</label>
                  <select value={newGroupType} onChange={e => setNewGroupType(e.target.value as ResourceGroupType)} style={inputS}>
                    <option value="time_based">Zeitbasiert</option>
                    <option value="device_count">Gerät (device_count)</option>
                    <option value="staff_multiplied">Personal</option>
                  </select>
                </div>
                {newGroupType === 'staff_multiplied' && (
                  <div>
                    <label style={labelS}>Personal</label>
                    <select value={newGroupStaffType} onChange={e => setNewGroupStaffType(e.target.value as keyof StaffConfig)} style={inputS}>
                      {(Object.keys(STAFF_LABELS) as (keyof StaffConfig)[]).map(k => (
                        <option key={k} value={k}>{STAFF_LABELS[k]}</option>
                      ))}
                    </select>
                  </div>
                )}
                {newGroupType !== 'staff_multiplied' && (
                  <div>
                    <label style={labelS}>Anzahl Geräte</label>
                    <input type="number" min={1} max={50} value={newGroupDeviceCount ?? ''}
                      onChange={e => { const v = parseInt(e.target.value); setNewGroupDeviceCount(isNaN(v) ? null : v) }}
                      style={{ ...inputS, width: '80px' }} />
                  </div>
                )}
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button onClick={handleAddGroup} disabled={!newGroupName.trim()} style={btnPrimaryS}>Hinzufügen</button>
                  <button onClick={() => setShowAddGroup(false)} style={btnSecondaryS}>Abbrechen</button>
                </div>
              </div>
            </div>
          ) : (
            <button onClick={() => setShowAddGroup(true)} style={{ ...btnSecondaryS, marginTop: '0.75rem', fontSize: '0.82rem' }}>
              + Neue Gruppe
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Helper form row
// ---------------------------------------------------------------------------

/** Number of devices dedicated to one examination; empty = unlimited. */
function DeviceCountInput({ value, onChange }: { value: number | null; onChange: (v: number | null) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
      <input
        type="number" min={1} max={50} value={value ?? ''} placeholder="∞"
        onChange={e => { const v = parseInt(e.target.value); onChange(isNaN(v) || v < 1 ? null : v) }}
        style={{ ...inputS, width: '64px' }}
      />
      <span style={{ fontSize: '0.72rem', color: '#94a3b8' }}>leer = unbegrenzt</span>
    </div>
  )
}

function FormRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
      <label style={{ ...labelS, width: '120px', flexShrink: 0 }}>{label}</label>
      {children}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main page component
// ---------------------------------------------------------------------------

export default function Untersuchungen() {
  const activeScenario = useAppStore(s => s.getActiveScenario())
  const updateExamination = useAppStore(s => s.updateExamination)
  const reorderExaminationsForDay = useAppStore(s => s.reorderExaminationsForDay)
  const addExamination = useAppStore(s => s.addExamination)

  const [activeId, setActiveId] = useState<string | null>(null)
  const [addExamDay, setAddExamDay] = useState<DayNumber | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(event.active.id as string)
  }, [])

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event
    setActiveId(null)

    if (!over || !activeScenario) return

    const activeExam = activeScenario.examinations.find(e => e.id === active.id)
    if (!activeExam) return

    const overId = over.id as string

    // Determine target day
    let targetDay: DayNumber = activeExam.day
    if (overId === 'day-col-1') targetDay = 1
    else if (overId === 'day-col-2') targetDay = 2
    else if (overId === 'day-col-3') targetDay = 3
    else {
      const overExam = activeScenario.examinations.find(e => e.id === overId)
      if (overExam) targetDay = overExam.day
    }

    if (targetDay !== activeExam.day) {
      // Cross-column move: update day and assign order at end of target column
      const targetExams = activeScenario.examinations.filter(e => e.day === targetDay)
      const newOrder = targetExams.reduce((m, e) => Math.max(m, e.order), 0) + 1
      updateExamination(active.id as string, { day: targetDay, order: newOrder })
    } else if (active.id !== over.id) {
      // Same-column reorder
      const dayExams = [...activeScenario.examinations.filter(e => e.day === activeExam.day)]
        .sort((a, b) => a.order - b.order)
      const oldIndex = dayExams.findIndex(e => e.id === active.id)
      const newIndex = dayExams.findIndex(e => e.id === over.id)
      if (oldIndex !== -1 && newIndex !== -1) {
        const reordered = arrayMove(dayExams, oldIndex, newIndex)
        reorderExaminationsForDay(activeExam.day, reordered.map(e => e.id))
      }
    }
  }, [activeScenario, updateExamination, reorderExaminationsForDay])

  if (!activeScenario) return null

  const { examinations, resourceGroups } = activeScenario
  const programDays = activeScenario.resourceConfig.scheduleConfig.programDays ?? 3
  const activeExam = activeId ? examinations.find(e => e.id === activeId) : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <div>
        <h1 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#1e293b', margin: 0 }}>Untersuchungen</h1>
        <p style={{ fontSize: '0.85rem', color: '#64748b', marginTop: '0.25rem', marginBottom: 0 }}>
          Untersuchungen per Drag &amp; Drop zwischen Tagen verschieben und sortieren.
        </p>
      </div>

      {/* Drag & Drop day columns */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start' }}>
          {([1, 2, 3] as DayNumber[]).map(day => (
            <DayColumn
              key={day}
              day={day}
              exams={examinations.filter(e => e.day === day)}
              resourceGroups={resourceGroups}
              allExams={examinations}
              onAddExam={setAddExamDay}
              hint={day === 3 && programDays === 2 ? 'zählt als Tag 2 (2-Tage-Programm)' : undefined}
            />
          ))}
        </div>

        <DragOverlay>
          {activeExam ? (
            <ExamCard
              exam={activeExam}
              resourceGroups={resourceGroups}
              allExams={examinations}
              isDragging
              isOverlay
            />
          ) : null}
        </DragOverlay>
      </DndContext>

      {/* Resource groups panel */}
      <ResourceGroupsPanel resourceGroups={resourceGroups} allExams={examinations} />

      {/* Add exam modal */}
      {addExamDay !== null && (
        <AddExamModal
          day={addExamDay}
          resourceGroups={resourceGroups}
          allExams={examinations}
          onClose={() => setAddExamDay(null)}
          onAdd={addExamination}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Shared styles
// ---------------------------------------------------------------------------

const labelS: React.CSSProperties = { fontSize: '0.8rem', fontWeight: 500, color: '#475569' }
const inputS: React.CSSProperties = { padding: '0.3rem 0.5rem', border: '1px solid #cbd5e1', borderRadius: '4px', fontSize: '0.85rem', color: '#1e293b', background: '#fff' }
const btnPrimaryS: React.CSSProperties = { padding: '0.35rem 0.9rem', borderRadius: '6px', border: 'none', background: '#3b82f6', color: '#fff', fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer' }
const btnSecondaryS: React.CSSProperties = { padding: '0.35rem 0.9rem', borderRadius: '6px', border: '1px solid #e2e8f0', background: '#fff', color: '#475569', fontSize: '0.85rem', cursor: 'pointer' }
const btnDangerS: React.CSSProperties = { padding: '0.35rem 0.9rem', borderRadius: '6px', border: 'none', background: '#fef2f2', color: '#b91c1c', fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer' }
const thS: React.CSSProperties = { padding: '0.5rem 0.75rem', textAlign: 'left', fontWeight: 600, color: '#475569', fontSize: '0.78rem', borderBottom: '2px solid #e2e8f0' }
const tdS: React.CSSProperties = { padding: '0.5rem 0.75rem', color: '#1e293b' }
