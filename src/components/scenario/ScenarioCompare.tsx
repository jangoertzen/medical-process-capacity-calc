import { useMemo } from 'react'
import { useAppStore } from '@/store/appStore'
import type { Scenario } from '@/types'
import { buildWeekSchedule, analyzeScheduleDay } from '@/lib/scheduler'
import { applyBestSchedule } from '@/lib/calculator'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function computeRevenue(scenario: Scenario): { perPatient: number; monthly: number } {
  const perPatient = scenario.examinations.reduce((sum, exam) => {
    return sum + exam.revenueEur * ((exam.participationPercent ?? 100) / 100)
  }, 0)
  const weekly = scenario.results?.weeklyThroughput ?? 0
  return { perPatient: Math.round(perPatient), monthly: Math.round(perPatient * weekly * 4) }
}

function computeWaitAnalysis(scenario: Scenario) {
  const results = scenario.results
  if (!results) return { avgWaitPerPatient: 0, waitByGroup: [] as { name: string; waitMin: number }[] }

  const nPatients = Math.max(1, results.maxPatientsPerCohort)
  const best = applyBestSchedule(scenario)
  const allSchedules = buildWeekSchedule(
    best.examinations, best.resourceGroups, best.resourceConfig, nPatients,
  )

  const waitTotals: Record<string, number> = {}
  const w2Schedules = allSchedules.filter(s => s.week === 2)
  for (const s of w2Schedules) {
    const a = analyzeScheduleDay(s)
    for (const [gid, wt] of Object.entries(a.waitMinByGroup)) {
      waitTotals[gid] = (waitTotals[gid] ?? 0) + wt
    }
  }

  const w2Days = w2Schedules.length
  const totalWait = Object.values(waitTotals).reduce((s, v) => s + v, 0)
  const avgWaitPerPatient = (w2Days > 0 && nPatients > 0)
    ? Math.round(totalWait / (nPatients * w2Days) * 10) / 10
    : 0

  const waitByGroup = Object.entries(waitTotals)
    .sort((a, b) => b[1] - a[1])
    .map(([gid, waitMin]) => ({
      name: scenario.resourceGroups.find(g => g.id === gid)?.name ?? gid,
      waitMin: Math.round(waitMin / (nPatients * w2Days) * 10) / 10,
    }))

  return { avgWaitPerPatient, waitByGroup }
}

function computeResourceUtilization(scenario: Scenario) {
  const results = scenario.results
  if (!results) return [] as { name: string; utilPct: number; isBottleneck: boolean }[]

  // Aggregate max utilization per resource group across Week 2
  const groupUtil = new Map<string, { name: string; maxUtil: number; isBottleneck: boolean }>()
  for (const r of results.allResourceUtilization) {
    const existing = groupUtil.get(r.resourceGroupId)
    if (!existing || r.utilizationPct > existing.maxUtil) {
      groupUtil.set(r.resourceGroupId, {
        name: r.resourceGroupName,
        maxUtil: r.utilizationPct,
        isBottleneck: r.isBottleneck,
      })
    }
  }

  return [...groupUtil.values()]
    .sort((a, b) => b.maxUtil - a.maxUtil)
    .map(g => ({ name: g.name, utilPct: g.maxUtil, isBottleneck: g.isBottleneck }))
}

function fmt(n: number): string {
  return n.toLocaleString('de-DE')
}

function diffColor(diff: number, higherIsBetter: boolean): string {
  if (diff === 0) return '#64748b'
  const positive = higherIsBetter ? diff > 0 : diff < 0
  return positive ? '#15803d' : '#dc2626'
}

function diffBg(diff: number, higherIsBetter: boolean): string {
  if (diff === 0) return 'transparent'
  const positive = higherIsBetter ? diff > 0 : diff < 0
  return positive ? '#f0fdf4' : '#fef2f2'
}

function formatDiff(diff: number, unit: string): string {
  const sign = diff > 0 ? '+' : ''
  return `${sign}${fmt(diff)}${unit ? ' ' + unit : ''}`
}

// ---------------------------------------------------------------------------
// Utilization bar
// ---------------------------------------------------------------------------

function UtilBar({ pct, isBottleneck }: { pct: number; isBottleneck: boolean }) {
  const color = isBottleneck ? '#dc2626' : pct >= 80 ? '#f59e0b' : '#22c55e'
  const bg = isBottleneck ? '#fef2f2' : pct >= 80 ? '#fffbeb' : '#f0fdf4'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: 140 }}>
      <div style={{ flex: 1, height: 8, borderRadius: 4, background: '#f1f5f9', overflow: 'hidden' }}>
        <div style={{ width: `${Math.min(pct, 100)}%`, height: '100%', borderRadius: 4, background: color, transition: 'width 0.3s' }} />
      </div>
      <span style={{
        fontSize: '0.75rem', fontWeight: 600, color,
        background: bg, padding: '0.1rem 0.4rem', borderRadius: 4, minWidth: 38, textAlign: 'right',
      }}>
        {pct}%
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ScenarioCompare() {
  const scenarios = useAppStore(s => s.scenarios)
  const compareIds = useAppStore(s => s.compareScenarioIds)
  const compareScenarios = scenarios.filter(s => compareIds.includes(s.id))

  const analysis = useMemo(() => {
    if (compareScenarios.length < 2) return null
    const [a, b] = compareScenarios
    return {
      revenue: [computeRevenue(a), computeRevenue(b)] as const,
      wait: [computeWaitAnalysis(a), computeWaitAnalysis(b)] as const,
      resources: [computeResourceUtilization(a), computeResourceUtilization(b)] as const,
    }
  }, [compareScenarios])

  if (compareScenarios.length < 2 || !analysis) {
    return (
      <div style={{ padding: '2.5rem', textAlign: 'center', color: '#94a3b8', fontSize: '0.875rem' }}>
        Wähle 2 Szenarien (Checkbox) für den Vergleich.
      </div>
    )
  }

  const [a, b] = compareScenarios
  const [revA, revB] = analysis.revenue
  const [waitA, waitB] = analysis.wait
  const [resA, resB] = analysis.resources

  // Collect all resource names across both scenarios
  const allResourceNames = [...new Set([...resA.map(r => r.name), ...resB.map(r => r.name)])]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* Header */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
        {[a, b].map((s, i) => (
          <div key={s.id} style={{
            padding: '0.75rem 1rem', borderRadius: 8,
            background: i === 0 ? '#eff6ff' : '#faf5ff',
            border: `1px solid ${i === 0 ? '#bfdbfe' : '#e9d5ff'}`,
          }}>
            <div style={{ fontWeight: 700, color: i === 0 ? '#1d4ed8' : '#7c3aed', fontSize: '0.95rem' }}>
              {s.name}
            </div>
            <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: 2 }}>
              {s.results?.weeklyThroughput ?? 0} Pat./Woche
            </div>
          </div>
        ))}
      </div>

      {/* KPI comparison cards */}
      <SectionTitle>Umsatz & Durchsatz</SectionTitle>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem' }}>
        <CompareCard
          label="Wochendurchsatz"
          valA={`${fmt(a.results?.weeklyThroughput ?? 0)} Pat.`}
          valB={`${fmt(b.results?.weeklyThroughput ?? 0)} Pat.`}
          diff={(b.results?.weeklyThroughput ?? 0) - (a.results?.weeklyThroughput ?? 0)}
          diffStr={formatDiff((b.results?.weeklyThroughput ?? 0) - (a.results?.weeklyThroughput ?? 0), 'Pat.')}
          higherIsBetter
        />
        <CompareCard
          label="Monatsumsatz"
          valA={`${fmt(revA.monthly)} €`}
          valB={`${fmt(revB.monthly)} €`}
          diff={revB.monthly - revA.monthly}
          diffStr={formatDiff(revB.monthly - revA.monthly, '€')}
          higherIsBetter
        />
        <CompareCard
          label="Umsatz/Patient"
          valA={`${fmt(revA.perPatient)} €`}
          valB={`${fmt(revB.perPatient)} €`}
          diff={revB.perPatient - revA.perPatient}
          diffStr={formatDiff(revB.perPatient - revA.perPatient, '€')}
          higherIsBetter
        />
      </div>

      {/* Wait times */}
      <SectionTitle>Wartezeiten (Ø pro Patient, Woche 2)</SectionTitle>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem' }}>
        <CompareCard
          label="Ø Gesamtwartezeit"
          valA={`${waitA.avgWaitPerPatient} min`}
          valB={`${waitB.avgWaitPerPatient} min`}
          diff={waitB.avgWaitPerPatient - waitA.avgWaitPerPatient}
          diffStr={formatDiff(Math.round((waitB.avgWaitPerPatient - waitA.avgWaitPerPatient) * 10) / 10, 'min')}
          higherIsBetter={false}
        />
      </div>

      {/* Wait by resource */}
      {(waitA.waitByGroup.length > 0 || waitB.waitByGroup.length > 0) && (
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
            <thead>
              <tr style={{ background: '#f8fafc' }}>
                <th style={thS}>Wartezeit-Verursacher</th>
                <th style={{ ...thS, color: '#1d4ed8' }}>{a.name}</th>
                <th style={{ ...thS, color: '#7c3aed' }}>{b.name}</th>
                <th style={thS}>Diff</th>
              </tr>
            </thead>
            <tbody>
              {allWaitGroups(waitA.waitByGroup, waitB.waitByGroup).map(row => {
                const d = row.b - row.a
                return (
                  <tr key={row.name}>
                    <td style={tdS}>{row.name}</td>
                    <td style={tdS}>{row.a > 0 ? `${row.a} min` : '–'}</td>
                    <td style={tdS}>{row.b > 0 ? `${row.b} min` : '–'}</td>
                    <td style={{
                      ...tdS, fontWeight: d !== 0 ? 600 : 400,
                      color: diffColor(d, false),
                      background: diffBg(d, false),
                    }}>
                      {d !== 0 ? formatDiff(Math.round(d * 10) / 10, 'min') : '–'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Resource utilization */}
      <SectionTitle>Ressourcenauslastung (Woche 2)</SectionTitle>
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
          <thead>
            <tr style={{ background: '#f8fafc' }}>
              <th style={thS}>Ressource</th>
              <th style={{ ...thS, color: '#1d4ed8' }}>{a.name}</th>
              <th style={{ ...thS, color: '#7c3aed' }}>{b.name}</th>
            </tr>
          </thead>
          <tbody>
            {allResourceNames.map(name => {
              const rA = resA.find(r => r.name === name)
              const rB = resB.find(r => r.name === name)
              return (
                <tr key={name}>
                  <td style={{ ...tdS, fontWeight: (rA?.isBottleneck || rB?.isBottleneck) ? 600 : 400 }}>
                    {name}
                    {(rA?.isBottleneck || rB?.isBottleneck) && (
                      <span style={{
                        marginLeft: 6, fontSize: '0.68rem', fontWeight: 700,
                        color: '#dc2626', background: '#fef2f2',
                        padding: '0.1rem 0.35rem', borderRadius: 4,
                      }}>
                        ENGPASS
                      </span>
                    )}
                  </td>
                  <td style={tdS}>
                    {rA ? <UtilBar pct={rA.utilPct} isBottleneck={rA.isBottleneck} /> : <span style={{ color: '#94a3b8' }}>–</span>}
                  </td>
                  <td style={tdS}>
                    {rB ? <UtilBar pct={rB.utilPct} isBottleneck={rB.isBottleneck} /> : <span style={{ color: '#94a3b8' }}>–</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Engpass-Vergleich */}
      <SectionTitle>Primärer Engpass</SectionTitle>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
        {[a, b].map((s, i) => {
          const bn = s.results?.primaryBottleneck
          return (
            <div key={s.id} style={{
              padding: '0.875rem 1rem', borderRadius: 8,
              background: '#fef2f2', border: '1px solid #fecaca',
            }}>
              <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: 4 }}>
                {i === 0 ? a.name : b.name}
              </div>
              <div style={{ fontWeight: 700, color: '#dc2626', fontSize: '0.95rem' }}>
                {bn?.resourceGroupName ?? '—'}
              </div>
              <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: 2 }}>
                {bn?.description ?? ''}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: '0.8rem', fontWeight: 700, color: '#475569',
      textTransform: 'uppercase', letterSpacing: '0.05em',
      borderBottom: '1px solid #e2e8f0', paddingBottom: 4,
    }}>
      {children}
    </div>
  )
}

function CompareCard({ label, valA, valB, diff, diffStr, higherIsBetter }: {
  label: string; valA: string; valB: string;
  diff: number; diffStr: string; higherIsBetter: boolean;
}) {
  return (
    <div style={{
      background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8,
      padding: '0.875rem 1rem', display: 'flex', flexDirection: 'column', gap: 6,
    }}>
      <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 500 }}>{label}</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontWeight: 700, color: '#1d4ed8', fontSize: '1rem' }}>{valA}</span>
        <span style={{ color: '#94a3b8', fontSize: '0.75rem' }}>vs</span>
        <span style={{ fontWeight: 700, color: '#7c3aed', fontSize: '1rem' }}>{valB}</span>
      </div>
      {diff !== 0 && (
        <div style={{
          fontSize: '0.78rem', fontWeight: 600,
          color: diffColor(diff, higherIsBetter),
          background: diffBg(diff, higherIsBetter),
          padding: '0.2rem 0.5rem', borderRadius: 4, textAlign: 'center',
        }}>
          {diffStr}
        </div>
      )}
    </div>
  )
}

// Merge wait groups from both scenarios into a single list
function allWaitGroups(
  a: { name: string; waitMin: number }[],
  b: { name: string; waitMin: number }[],
) {
  const names = [...new Set([...a.map(x => x.name), ...b.map(x => x.name)])]
  return names.map(name => ({
    name,
    a: a.find(x => x.name === name)?.waitMin ?? 0,
    b: b.find(x => x.name === name)?.waitMin ?? 0,
  })).sort((x, y) => Math.max(y.a, y.b) - Math.max(x.a, x.b))
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const thS: React.CSSProperties = {
  padding: '0.6rem 0.75rem', textAlign: 'left', fontWeight: 600,
  color: '#475569', borderBottom: '1px solid #e2e8f0', fontSize: '0.78rem',
}
const tdS: React.CSSProperties = {
  padding: '0.6rem 0.75rem', borderBottom: '1px solid #f1f5f9', color: '#1e293b',
}
