import { useState, useMemo } from 'react'
import type { Scenario, Weekday, DayNumber } from '@/types'
import { buildWeekSchedule, type ScheduledExam, type WeekdaySchedule } from '@/lib/scheduler'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WEEKDAY_ORDER: Weekday[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']

const WD_LABELS: Record<Weekday, string> = {
  Mon: 'Montag', Tue: 'Dienstag', Wed: 'Mittwoch', Thu: 'Donnerstag', Fri: 'Freitag',
}
const WD_SHORT: Record<Weekday, string> = {
  Mon: 'Mo', Tue: 'Di', Wed: 'Mi', Thu: 'Do', Fri: 'Fr',
}
const STAGE_LABEL: Record<DayNumber | 'return', string> = { 1: 'Tag 1', 2: 'Tag 2', 3: 'Tag 3', return: 'Gerät zurück' }
const STAGE_BG: Record<DayNumber | 'return', string> = { 1: '#eff6ff', 2: '#f0fdf4', 3: '#fefce8', return: '#f8fafc' }
const STAGE_ROW_ALT: Record<DayNumber | 'return', string> = { 1: '#e0f2fe', 2: '#dcfce7', 3: '#fef9c3', return: '#f1f5f9' }

/** Colors for exam blocks in patient view (keyed by resourceGroupId) */
const GROUP_COLORS: Record<string, { bg: string; text: string }> = {
  'funktionsraum-tag1': { bg: '#3b82f6', text: '#fff' },
  'arzt-sono':          { bg: '#10b981', text: '#fff' },
  'arzt-sprechzeit':    { bg: '#f59e0b', text: '#fff' },
  'mfa-kapazitat':      { bg: '#ef4444', text: '#fff' },
  'langzeit-ekg':       { bg: '#8b5cf6', text: '#fff' },
  'langzeit-rr':        { bg: '#6366f1', text: '#fff' },
  'ergometrie':         { bg: '#f97316', text: '#fff' },
}
const DEFAULT_COLOR = { bg: '#94a3b8', text: '#fff' }

/** Colors for patient blocks in room view (keyed by stage) */
const STAGE_COLOR: Record<DayNumber | 'return', { bg: string; text: string }> = {
  1: { bg: '#3b82f6', text: '#fff' },
  2: { bg: '#16a34a', text: '#fff' },
  3: { bg: '#ca8a04', text: '#fff' },
  return: { bg: '#94a3b8', text: '#fff' },
}

/** Preferred room display order */
const ROOM_ORDER = ['Labor', 'Funktionsraum', 'Geräteraum', 'Sono', 'Sprechzimmer', 'Ergometrieraum']

const START_HOUR = 8       // day starts at 08:00
const PX_PER_MIN = 3       // 3 px/min → 360 min = 1080 px
const ROW_HEIGHT = 30      // px per patient/room row
const LABEL_WIDTH = 110    // px for the left label column
const TIME_HEADER = 28     // px for the time axis header

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtTime(minutes: number): string {
  const total = START_HOUR * 60 + minutes
  const h = Math.floor(total / 60)
  const m = total % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

// ---------------------------------------------------------------------------
// Patient view row data
// ---------------------------------------------------------------------------

interface PatientRow {
  rowId: string
  label: string
  stage: DayNumber | 'return'
  exams: ScheduledExam[]
}

function buildPatientRows(schedule: WeekdaySchedule): PatientRow[] {
  const rows: PatientRow[] = []
  const stages = [...schedule.activeStages].sort((a, b) => a - b)
  for (const stage of stages) {
    for (let p = 1; p <= schedule.nPatientsPerStage; p++) {
      const patientId = `T${stage}-P${String(p).padStart(2, '0')}`
      rows.push({
        rowId: patientId,
        label: `${STAGE_LABEL[stage]} · P${p}`,
        stage,
        exams: schedule.scheduledExams.filter(e => e.patientId === patientId),
      })
    }
  }
  // Device return patients (Langzeit-Gerät Rückgabe)
  if (schedule.hasDeviceReturn) {
    for (let p = 1; p <= schedule.nPatientsPerStage; p++) {
      const patientId = `Return-P${String(p).padStart(2, '0')}`
      rows.push({
        rowId: patientId,
        label: `↩ Gerät P${p}`,
        stage: 'return',
        exams: schedule.scheduledExams.filter(e => e.patientId === patientId),
      })
    }
  }
  return rows
}

// ---------------------------------------------------------------------------
// Room view row data
// ---------------------------------------------------------------------------

interface RoomEntry {
  name: string
  room: string
  startMin: number
  endMin: number
  patientId: string
  stage: DayNumber | 'return'
  groupId: string
}

interface RoomRow {
  room: string
  lane: number
  totalLanes: number
  entries: RoomEntry[]
}

function buildRoomRows(schedule: WeekdaySchedule): RoomRow[] {
  // Collect all room entries from all scheduled exams
  const entriesByRoom = new Map<string, RoomEntry[]>()

  for (const exam of schedule.scheduledExams) {
    for (const item of exam.items) {
      const entry: RoomEntry = {
        name: item.name,
        room: item.room,
        startMin: exam.startMin,
        endMin: exam.startMin + item.durationMin,
        patientId: exam.patientId,
        stage: exam.stage,
        groupId: item.groupId,
      }
      const list = entriesByRoom.get(item.room) ?? []
      list.push(entry)
      entriesByRoom.set(item.room, list)
    }
  }

  // Sort rooms by preferred order
  const allRooms = [...entriesByRoom.keys()].sort((a, b) => {
    const ia = ROOM_ORDER.indexOf(a)
    const ib = ROOM_ORDER.indexOf(b)
    if (ia === -1 && ib === -1) return a.localeCompare(b)
    if (ia === -1) return 1
    if (ib === -1) return -1
    return ia - ib
  })

  const rows: RoomRow[] = []

  for (const room of allRooms) {
    const entries = (entriesByRoom.get(room) ?? []).sort((a, b) => a.startMin - b.startMin)

    // Pack entries into lanes (greedy interval coloring)
    const laneFreeAt: number[] = []
    const laneAssigned: number[] = []

    for (const entry of entries) {
      let lane = laneFreeAt.findIndex(t => t <= entry.startMin)
      if (lane === -1) {
        lane = laneFreeAt.length
        laneFreeAt.push(0)
      }
      laneFreeAt[lane] = entry.endMin
      laneAssigned.push(lane)
    }

    const totalLanes = Math.max(1, laneFreeAt.length)

    // Build one RoomRow per lane
    const laneEntries: Map<number, RoomEntry[]> = new Map()
    entries.forEach((entry, i) => {
      const lane = laneAssigned[i]
      const list = laneEntries.get(lane) ?? []
      list.push(entry)
      laneEntries.set(lane, list)
    })

    for (let lane = 0; lane < totalLanes; lane++) {
      rows.push({
        room,
        lane,
        totalLanes,
        entries: laneEntries.get(lane) ?? [],
      })
    }
  }

  return rows
}

// ---------------------------------------------------------------------------
// Shared Gantt rendering
// ---------------------------------------------------------------------------

interface GanttBlock {
  startMin: number
  endMin: number
  label: string
  tooltip: string
  bg: string
  textColor: string
}

interface GanttRow {
  rowId: string
  label: string
  bg: string
  altBg: string
  blocks: GanttBlock[]
}

function GanttChart({ rows, openingMinutes }: { rows: GanttRow[]; openingMinutes: number }) {
  const chartWidth = openingMinutes * PX_PER_MIN
  const chartHeight = rows.length * ROW_HEIGHT

  // Time tick marks every 30 min
  const ticks: number[] = []
  for (let t = 0; t <= openingMinutes; t += 30) ticks.push(t)

  return (
    <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: '600px', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
      <div style={{ display: 'flex', minWidth: LABEL_WIDTH + chartWidth }}>

        {/* Left label column */}
        <div style={{ width: LABEL_WIDTH, flexShrink: 0, zIndex: 3 }}>
          <div style={{ height: TIME_HEADER, borderBottom: '1px solid #e2e8f0', borderRight: '1px solid #e2e8f0', background: '#f8fafc' }} />
          {rows.map((row, i) => (
            <div
              key={row.rowId}
              style={{
                height: ROW_HEIGHT,
                display: 'flex',
                alignItems: 'center',
                padding: '0 0.5rem',
                fontSize: '0.72rem',
                fontWeight: 500,
                color: '#374151',
                background: i % 2 === 0 ? row.bg : row.altBg,
                borderBottom: '1px solid #f1f5f9',
                borderRight: '1px solid #e2e8f0',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
              }}
            >
              {row.label}
            </div>
          ))}
        </div>

        {/* Chart area */}
        <div style={{ position: 'relative', flex: 1 }}>

          {/* Sticky time axis header */}
          <div style={{
            position: 'sticky',
            top: 0,
            height: TIME_HEADER,
            background: '#f8fafc',
            borderBottom: '2px solid #e2e8f0',
            zIndex: 2,
            width: chartWidth,
          }}>
            {ticks.map(t => (
              <div key={t} style={{ position: 'absolute', left: t * PX_PER_MIN, top: 0, height: '100%' }}>
                <div style={{ width: 1, height: '45%', background: '#cbd5e1' }} />
                <div style={{
                  fontSize: '0.62rem',
                  color: '#64748b',
                  whiteSpace: 'nowrap',
                  transform: 'translateX(-50%)',
                  paddingTop: '1px',
                }}>
                  {fmtTime(t)}
                </div>
              </div>
            ))}
          </div>

          {/* Chart body */}
          <div style={{ position: 'relative', width: chartWidth, height: chartHeight }}>

            {/* Vertical grid lines */}
            {ticks.map(t => (
              <div
                key={t}
                style={{
                  position: 'absolute',
                  left: t * PX_PER_MIN,
                  top: 0,
                  bottom: 0,
                  width: 1,
                  background: t % 60 === 0 ? '#cbd5e1' : '#f1f5f9',
                  zIndex: 0,
                }}
              />
            ))}

            {/* Row backgrounds */}
            {rows.map((row, i) => (
              <div
                key={row.rowId}
                style={{
                  position: 'absolute',
                  left: 0,
                  top: i * ROW_HEIGHT,
                  width: chartWidth,
                  height: ROW_HEIGHT,
                  background: i % 2 === 0 ? row.bg : row.altBg,
                  borderBottom: '1px solid #f1f5f9',
                }}
              />
            ))}

            {/* Exam blocks */}
            {rows.map((row, rowIdx) =>
              row.blocks.map((block, blockIdx) => {
                const left = block.startMin * PX_PER_MIN
                const width = Math.max((block.endMin - block.startMin) * PX_PER_MIN - 2, 3)
                const top = rowIdx * ROW_HEIGHT + 3
                const height = ROW_HEIGHT - 6
                return (
                  <div
                    key={`${row.rowId}-${blockIdx}`}
                    title={block.tooltip}
                    style={{
                      position: 'absolute',
                      left,
                      top,
                      width,
                      height,
                      background: block.bg,
                      color: block.textColor,
                      borderRadius: '3px',
                      display: 'flex',
                      alignItems: 'center',
                      padding: '0 3px',
                      fontSize: '0.62rem',
                      fontWeight: 600,
                      overflow: 'hidden',
                      whiteSpace: 'nowrap',
                      cursor: 'default',
                      zIndex: 1,
                      boxShadow: '0 1px 2px rgba(0,0,0,0.15)',
                    }}
                  >
                    {width > 36 ? block.label : ''}
                  </div>
                )
              })
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface Props {
  scenario: Scenario
  nPatients: number
}

const WEEK_LABELS: Record<1 | 2 | 3, string> = {
  1: 'Woche 1 (Anlauf)',
  2: 'Woche 2 (Steady State)',
  3: 'Woche 3 (Auslauf)',
}

export function DayScheduleGantt({ scenario, nPatients }: Props) {
  const [selectedWeek, setSelectedWeek] = useState<1 | 2 | 3>(2)
  const [selectedDay, setSelectedDay] = useState<Weekday>('Mon')
  const [viewMode, setViewMode] = useState<'patient' | 'room'>('patient')

  const allSchedules = useMemo(
    () => buildWeekSchedule(scenario.examinations, scenario.resourceGroups, scenario.resourceConfig, nPatients),
    [scenario, nPatients],
  )

  // Filter to the selected week
  const weekSchedules = allSchedules.filter(s => s.week === selectedWeek)
  const availableDays = weekSchedules.map(s => s.weekday)

  // Ensure selected day is valid for the current week
  const currentSchedule =
    weekSchedules.find(s => s.weekday === selectedDay) ??
    weekSchedules[0]

  if (allSchedules.length === 0 || !currentSchedule) {
    return <div style={{ color: '#64748b', padding: '1rem' }}>Keine aktiven Phasen konfiguriert.</div>
  }

  // Build view-specific rows
  const ganttRows: GanttRow[] = viewMode === 'patient'
    ? buildPatientRows(currentSchedule).map(row => ({
        rowId: row.rowId,
        label: row.label,
        bg: STAGE_BG[row.stage],
        altBg: STAGE_ROW_ALT[row.stage],
        blocks: row.exams.map(exam => {
          const c = GROUP_COLORS[exam.primaryGroupId] ?? DEFAULT_COLOR
          const names = exam.items.map(i => i.name).join(' + ')
          const rooms = [...new Set(exam.items.map(i => i.room))].join(', ')
          return {
            startMin: exam.startMin,
            endMin: exam.endMin,
            label: exam.items[0].name.split(' ').slice(0, 2).join(' '),
            tooltip: `${names}\n${fmtTime(exam.startMin)} – ${fmtTime(exam.endMin)} (${exam.endMin - exam.startMin} min)\nRaum: ${rooms}`,
            bg: c.bg,
            textColor: c.text,
          }
        }),
      }))
    : buildRoomRows(currentSchedule).map((row, idx, arr) => {
        const prevRoom = idx > 0 ? arr[idx - 1].room : null
        const label = row.totalLanes === 1
          ? row.room
          : row.lane === 0 && prevRoom !== row.room
            ? `${row.room} (${row.totalLanes}×)`
            : row.lane === 0
              ? row.room
              : `  · Platz ${row.lane + 1}`
        return {
          rowId: `${row.room}-${row.lane}`,
          label,
          bg: '#f8fafc',
          altBg: '#f1f5f9',
          blocks: row.entries.map(entry => {
            const c = STAGE_COLOR[entry.stage]
            return {
              startMin: entry.startMin,
              endMin: entry.endMin,
              label: entry.name.split(' ').slice(0, 2).join(' '),
              tooltip: `${entry.name}\n${fmtTime(entry.startMin)} – ${fmtTime(entry.endMin)} (${entry.endMin - entry.startMin} min)\nPatient: ${entry.patientId}`,
              bg: c.bg,
              textColor: c.text,
            }
          }),
        }
      })

  const { openingMinutes, activeStages } = currentSchedule

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

      {/* Week tabs */}
      <div style={{ display: 'flex', gap: '0.25rem', background: '#f1f5f9', borderRadius: '8px', padding: '3px', width: 'fit-content' }}>
        {([1, 2, 3] as const).map(w => (
          <button
            key={w}
            onClick={() => setSelectedWeek(w)}
            style={{
              padding: '0.35rem 0.9rem',
              borderRadius: '6px',
              border: 'none',
              background: selectedWeek === w ? '#fff' : 'transparent',
              color: selectedWeek === w ? '#1e293b' : '#64748b',
              cursor: 'pointer',
              fontSize: '0.8rem',
              fontWeight: selectedWeek === w ? 600 : 400,
              boxShadow: selectedWeek === w ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
            }}
          >
            {WEEK_LABELS[w]}
          </button>
        ))}
      </div>

      {/* Controls row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>

        {/* Day selector */}
        <div style={{ display: 'flex', gap: '0.25rem' }}>
          {WEEKDAY_ORDER.filter(wd => availableDays.includes(wd)).map(wd => {
            const sched = weekSchedules.find(s => s.weekday === wd)
            const stages = [...(sched?.activeStages ?? [])].sort().map(s => `T${s}`).join('+') ?? ''
            const isActive = selectedDay === wd
            return (
              <button
                key={wd}
                onClick={() => setSelectedDay(wd)}
                style={{
                  padding: '0.3rem 0.65rem',
                  borderRadius: '6px',
                  border: '1px solid',
                  borderColor: isActive ? '#3b82f6' : '#e2e8f0',
                  background: isActive ? '#3b82f6' : '#fff',
                  color: isActive ? '#fff' : '#64748b',
                  cursor: 'pointer',
                  fontSize: '0.8rem',
                  fontWeight: isActive ? 600 : 400,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  lineHeight: 1.2,
                }}
              >
                <span>{WD_SHORT[wd]}</span>
                <span style={{ fontSize: '0.62rem', opacity: 0.8 }}>{stages}</span>
              </button>
            )
          })}
        </div>

        {/* View toggle */}
        <div style={{ display: 'flex', gap: '0.25rem', background: '#f1f5f9', borderRadius: '6px', padding: '2px' }}>
          {(['patient', 'room'] as const).map(mode => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              style={{
                padding: '0.3rem 0.75rem',
                borderRadius: '4px',
                border: 'none',
                background: viewMode === mode ? '#fff' : 'transparent',
                color: viewMode === mode ? '#1e293b' : '#64748b',
                cursor: 'pointer',
                fontSize: '0.8rem',
                fontWeight: viewMode === mode ? 600 : 400,
                boxShadow: viewMode === mode ? '0 1px 2px rgba(0,0,0,0.1)' : 'none',
              }}
            >
              {mode === 'patient' ? 'Patientenplan' : 'Raumplan'}
            </button>
          ))}
        </div>
      </div>

      {/* Day info bar */}
      <div style={{
        fontSize: '0.8rem',
        color: '#64748b',
        padding: '0.4rem 0.75rem',
        background: '#f8fafc',
        borderRadius: '6px',
        border: '1px solid #e2e8f0',
        display: 'flex',
        gap: '1.25rem',
        flexWrap: 'wrap',
      }}>
        <span><strong style={{ color: '#1e293b' }}>{WD_LABELS[currentSchedule.weekday]}</strong></span>
        <span>Öffnungszeit: {fmtTime(0)} – {fmtTime(openingMinutes)}</span>
        <span>Aktive Phasen: {[...activeStages].sort().map(s => STAGE_LABEL[s]).join(', ')}{currentSchedule.hasDeviceReturn ? ' + Geräterückgabe' : ''}</span>
        <span>{nPatients} Patient{nPatients !== 1 ? 'en' : ''}/Kohorte</span>
        <span style={{ color: '#94a3b8' }}>Überfahren Sie Blöcke für Details</span>
      </div>

      {/* Gantt chart */}
      <GanttChart rows={ganttRows} openingMinutes={openingMinutes} />

      {/* Legend */}
      <div style={{ display: 'flex', gap: '0.5rem 1rem', flexWrap: 'wrap', fontSize: '0.75rem' }}>
        {viewMode === 'patient'
          ? Object.entries(GROUP_COLORS).map(([groupId, color]) => {
              const group = scenario.resourceGroups.find(g => g.id === groupId)
              if (!group) return null
              return (
                <div key={groupId} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                  <div style={{ width: 12, height: 12, borderRadius: 2, background: color.bg, flexShrink: 0 }} />
                  <span style={{ color: '#64748b' }}>{group.name}</span>
                </div>
              )
            })
          : ([1, 2, 3, 'return'] as (DayNumber | 'return')[]).map(stage => (
              <div key={stage} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                <div style={{ width: 12, height: 12, borderRadius: 2, background: STAGE_COLOR[stage].bg, flexShrink: 0 }} />
                <span style={{ color: '#64748b' }}>{STAGE_LABEL[stage]} Patienten</span>
              </div>
            ))
        }
      </div>
    </div>
  )
}
