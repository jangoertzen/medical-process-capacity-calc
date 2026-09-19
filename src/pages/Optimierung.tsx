import { useEffect, useState } from 'react'
import { useAppStore } from '@/store/appStore'
import { optimizeParticipation, type OptimizerResult, type OptimizerMetrics } from '@/lib/optimizer'
import type { DayNumber } from '@/types'

const STEPS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]
const eur = (v: number) => `${Math.round(v).toLocaleString('de-DE')} €`

export default function Optimierung() {
  const scenario = useAppStore(s => s.getActiveScenario())
  const updateExamination = useAppStore(s => s.updateExamination)
  const applyParticipation = useAppStore(s => s.applyParticipation)
  const createScenario = useAppStore(s => s.createScenario)

  const [capInput, setCapInput] = useState<number | null>(null)
  const [result, setResult] = useState<OptimizerResult | null>(null)
  const [running, setRunning] = useState(false)

  // Any change to the scenario (including the limits edited below) makes a result stale
  useEffect(() => { setResult(null) }, [scenario])

  if (!scenario || !scenario.results) return <div style={{ color: '#94a3b8', padding: '2rem' }}>Keine Daten</div>

  const currentWeekly = scenario.results.weeklyThroughput
  const cap = Math.max(1, capInput ?? Math.round(currentWeekly * 1.5))
  // "Abnehmen" exams follow their "Anlegen" exam and are not optimized on their own
  const exams = [...scenario.examinations]
    .filter(e => e.deviceRole !== 'return')
    .sort((a, b) => a.day - b.day || a.order - b.order)

  const run = () => {
    setRunning(true)
    // let the button repaint before the (about one second long) calculation blocks the thread
    setTimeout(() => {
      setResult(optimizeParticipation(scenario, cap))
      setRunning(false)
    }, 30)
  }

  const apply = (asNewScenario: boolean) => {
    if (!result) return
    if (asNewScenario) createScenario(`Optimiert (max. ${cap} Pat./Wo.)`)
    applyParticipation(result.levels)
  }

  const changedCount = result ? exams.filter(e => (e.participationPercent ?? 100) !== result.levels[e.id]).length : 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <div>
        <h1 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#1e293b', margin: 0 }}>Umsatzoptimierung</h1>
        <p style={{ fontSize: '0.85rem', color: '#64748b', marginTop: '0.25rem', marginBottom: 0 }}>
          Bei wie viel Prozent der Patienten sollte jede Untersuchung stattfinden, damit der Wochenumsatz unter den Kapazitäten maximal wird?
        </p>
      </div>

      <Card title="Einstellungen">
        <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <label style={labelS}>Max. Patienten pro Woche (Nachfrage)</label>
            <input
              type="number" min={1} max={500} value={cap}
              onChange={e => setCapInput(Number(e.target.value))}
              style={{ ...inputS, width: '110px' }}
            />
            <div style={hintS}>
              Mehr Patienten kann die Praxis nicht gewinnen. Vorbelegt mit dem 1,5-fachen des heutigen Durchsatzes ({currentWeekly}).
              Ohne diese Grenze würde die Optimierung fast alle Untersuchungen streichen und sehr viele Patienten durchschleusen.
            </div>
          </div>
          <button onClick={run} disabled={running} style={{ ...btnPrimaryS, opacity: running ? 0.6 : 1 }}>
            {running ? 'Berechne …' : 'Optimierung starten'}
          </button>
        </div>
      </Card>

      {result && <ResultSummary current={result.current} optimal={result.optimal} cap={cap} />}

      <Card title="Untersuchungen">
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.83rem' }}>
            <thead>
              <tr style={{ background: '#f8fafc' }}>
                <th style={thS}>Untersuchung</th>
                <th style={{ ...thS, textAlign: 'right' }}>Umsatz</th>
                <th style={thS} title="Untergrenze für die Optimierung">Min. %</th>
                <th style={thS} title="Obergrenze für die Optimierung">Max. %</th>
                <th style={{ ...thS, textAlign: 'right' }}>Aktuell</th>
                <th style={{ ...thS, minWidth: '210px' }}>Empfohlen</th>
              </tr>
            </thead>
            <tbody>
              {exams.map(e => {
                const now = e.participationPercent ?? 100
                const rec = result?.levels[e.id]
                return (
                  <tr key={e.id} style={{ borderTop: '1px solid #f1f5f9' }}>
                    <td style={tdS}>
                      <span style={dayBadge(e.day)}>T{e.day}</span> {e.name}
                    </td>
                    <td style={{ ...tdS, textAlign: 'right', color: '#16a34a' }}>{e.revenueEur > 0 ? `${e.revenueEur} €` : '—'}</td>
                    <td style={tdS}>
                      <PercentSelect value={e.participationMin ?? 0} onChange={v => updateExamination(e.id, { participationMin: v })} />
                    </td>
                    <td style={tdS}>
                      <PercentSelect value={e.participationMax ?? 100} onChange={v => updateExamination(e.id, { participationMax: v })} />
                    </td>
                    <td style={{ ...tdS, textAlign: 'right', fontWeight: 600 }}>{now} %</td>
                    <td style={tdS}>
                      {rec === undefined ? <span style={{ color: '#cbd5e1' }}>—</span> : <RecommendationBar now={now} rec={rec} />}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div style={hintS}>
          „Abnehmen“-Untersuchungen (Geräterückgabe) folgen automatisch dem Anteil ihrer „Anlegen“-Untersuchung und stehen deshalb nicht in der Liste.
          Min./Max. gelten nur für die Optimierung; sie ändern die aktuellen Werte nicht. Setze z. B. das Abschlussgespräch auf Min. 100 %, wenn es immer stattfinden muss.
        </div>
      </Card>

      {result && (
        <Card title="Übernehmen">
          <div style={{ fontSize: '0.85rem', color: '#475569', marginBottom: '0.75rem' }}>
            {changedCount === 0
              ? 'Die aktuellen Werte sind bereits optimal (bei diesen Grenzen und dieser Nachfrage).'
              : `${changedCount} Untersuchung${changedCount !== 1 ? 'en' : ''} würde${changedCount !== 1 ? 'n' : ''} sich ändern.`}
          </div>
          <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
            <button onClick={() => apply(true)} disabled={changedCount === 0} style={{ ...btnPrimaryS, opacity: changedCount === 0 ? 0.4 : 1 }}>
              Als neues Szenario übernehmen
            </button>
            <button onClick={() => apply(false)} disabled={changedCount === 0} style={{ ...btnSecondaryS, opacity: changedCount === 0 ? 0.4 : 1 }}>
              In aktuelles Szenario übernehmen
            </button>
          </div>
        </Card>
      )}

      <div style={{ padding: '0.75rem 1rem', background: '#eff6ff', borderRadius: '8px', border: '1px solid #bfdbfe', fontSize: '0.8rem', color: '#1e293b', lineHeight: 1.5 }}>
        <strong>So wird gerechnet:</strong> Wochenumsatz = min(Kapazität, max. Patienten pro Woche) × Σ (Umsatz × Anteil). Weniger Untersuchungen pro Patient
        geben Kapazität frei und erlauben mehr Patienten; mehr Untersuchungen bringen mehr Umsatz je Patient. Die Kapazität kommt aus demselben
        Modell wie das Dashboard (inklusive Tagesplan-Prüfung). Gesucht wird in 10-%-Schritten mit einem Näherungsverfahren; das Ergebnis ist sehr gut,
        aber nicht mathematisch bewiesen optimal. Der Umsatz je Untersuchung wird als fest angenommen.
      </div>
    </div>
  )
}

function ResultSummary({ current, optimal, cap }: { current: OptimizerMetrics; optimal: OptimizerMetrics; cap: number }) {
  const delta = optimal.monthlyRevenue - current.monthlyRevenue
  const pct = current.monthlyRevenue > 0 ? (delta / current.monthlyRevenue) * 100 : 0
  const cards: { title: string; now: string; rec: string; sub?: string }[] = [
    { title: 'Patienten pro Woche', now: String(current.weeklyPatients), rec: String(optimal.weeklyPatients), sub: `Kapazität ${optimal.weeklyCapacity}, Nachfrage max. ${cap}` },
    { title: 'Umsatz pro Patient', now: eur(current.revenuePerPatient), rec: eur(optimal.revenuePerPatient) },
    { title: 'Monatsumsatz (extrapol.)', now: eur(current.monthlyRevenue), rec: eur(optimal.monthlyRevenue), sub: `${delta >= 0 ? '+' : ''}${eur(delta)} (${delta >= 0 ? '+' : ''}${pct.toFixed(1).replace('.', ',')} %)` },
  ]
  return (
    <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
      {cards.map(c => (
        <div key={c.title} style={{ flex: '1 1 220px', background: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '1rem 1.25rem' }}>
          <div style={{ fontSize: '0.72rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.03em' }}>{c.title}</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', marginTop: '0.35rem', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.95rem', color: '#94a3b8', textDecoration: 'line-through' }}>{c.now}</span>
            <span style={{ fontSize: '1.4rem', fontWeight: 700, color: '#15803d' }}>{c.rec}</span>
          </div>
          {c.sub && <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.25rem' }}>{c.sub}</div>}
        </div>
      ))}
      <div style={{ flex: '1 1 220px', background: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '1rem 1.25rem' }}>
        <div style={{ fontSize: '0.72rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.03em' }}>Engpass danach</div>
        <div style={{ fontSize: '0.95rem', fontWeight: 600, color: '#c2410c', marginTop: '0.35rem' }}>
          {optimal.weeklyCapacity >= cap ? 'Nachfrage erreicht' : optimal.bottlenecks.join(' + ') || '—'}
        </div>
        <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.25rem' }}>
          {optimal.weeklyCapacity >= cap
            ? `Die Kapazität (${optimal.weeklyCapacity}) reicht für die angenommene Nachfrage.`
            : 'Diese Ressource begrenzt die Patientenzahl.'}
        </div>
      </div>
    </div>
  )
}

function RecommendationBar({ now, rec }: { now: number; rec: number }) {
  const diff = rec - now
  const color = diff === 0 ? '#94a3b8' : diff > 0 ? '#16a34a' : '#dc2626'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
      <div style={{ flex: 1, height: 8, borderRadius: 4, background: '#f1f5f9', position: 'relative', minWidth: '90px' }}>
        <div style={{ width: `${rec}%`, height: '100%', borderRadius: 4, background: color, opacity: 0.85 }} />
        <div title={`Aktuell ${now} %`} style={{ position: 'absolute', left: `${Math.min(now, 99)}%`, top: -2, width: 2, height: 12, background: '#1e293b' }} />
      </div>
      <span style={{ fontWeight: 700, minWidth: '42px', textAlign: 'right', color }}>{rec} %</span>
      <span style={{ fontSize: '0.72rem', color, minWidth: '46px' }}>
        {diff === 0 ? '±0' : `${diff > 0 ? '▲ +' : '▼ '}${diff}`}
      </span>
    </div>
  )
}

function PercentSelect({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const options = STEPS.includes(value) ? STEPS : [...STEPS, value].sort((a, b) => a - b)
  return (
    <select value={value} onChange={e => onChange(Number(e.target.value))} style={{ ...inputS, width: '72px' }}>
      {options.map(v => <option key={v} value={v}>{v} %</option>)}
    </select>
  )
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '1.25rem' }}>
      <div style={{ fontWeight: 600, color: '#1e293b', marginBottom: '1rem', fontSize: '0.95rem' }}>{title}</div>
      {children}
    </div>
  )
}

const DAY_BADGE: Record<DayNumber, { bg: string; fg: string }> = {
  1: { bg: '#dbeafe', fg: '#1d4ed8' },
  2: { bg: '#dcfce7', fg: '#15803d' },
  3: { bg: '#fef9c3', fg: '#92400e' },
}
const dayBadge = (d: DayNumber): React.CSSProperties => ({
  display: 'inline-block', padding: '0 5px', borderRadius: '4px', marginRight: '0.4rem',
  fontSize: '0.68rem', fontWeight: 700, background: DAY_BADGE[d].bg, color: DAY_BADGE[d].fg,
})

const labelS: React.CSSProperties = { fontSize: '0.8rem', fontWeight: 500, color: '#475569', display: 'block', marginBottom: '0.25rem' }
const hintS: React.CSSProperties = { fontSize: '0.75rem', color: '#94a3b8', marginTop: '0.4rem', maxWidth: '560px', lineHeight: 1.45 }
const inputS: React.CSSProperties = { padding: '0.3rem 0.5rem', border: '1px solid #cbd5e1', borderRadius: '4px', fontSize: '0.85rem', color: '#1e293b', background: '#fff' }
const btnPrimaryS: React.CSSProperties = { padding: '0.45rem 1.1rem', borderRadius: '6px', border: 'none', background: '#3b82f6', color: '#fff', fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer' }
const btnSecondaryS: React.CSSProperties = { padding: '0.45rem 1.1rem', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#f8fafc', color: '#374151', fontWeight: 500, fontSize: '0.85rem', cursor: 'pointer' }
const thS: React.CSSProperties = { padding: '0.5rem 0.75rem', textAlign: 'left', fontWeight: 600, color: '#475569', fontSize: '0.78rem', borderBottom: '2px solid #e2e8f0' }
const tdS: React.CSSProperties = { padding: '0.45rem 0.75rem', color: '#1e293b' }
