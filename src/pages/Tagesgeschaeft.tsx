import { useMemo, useState } from 'react'
import { useAppStore } from '@/store/appStore'
import { analyzeDailyBusiness, blockedSlots, WEEKDAYS, type Plan } from '@/lib/dailyBusiness'
import type { Weekday } from '@/types'

const WD_DE: Record<Weekday, string> = { Mon: 'Mo', Tue: 'Di', Wed: 'Mi', Thu: 'Do', Fri: 'Fr' }
const eur = (v: number) => `${Math.round(v).toLocaleString('de-DE')} €`
const num1 = (v: number) => (Math.round(v * 10) / 10).toLocaleString('de-DE')

export default function Tagesgeschaeft() {
  const scenario = useAppStore(s => s.getActiveScenario())
  const updateDailyBusiness = useAppStore(s => s.updateDailyBusiness)
  const [heatmapMode, setHeatmapMode] = useState<'optimal' | 'current'>('optimal')

  const analysis = useMemo(() => (scenario ? analyzeDailyBusiness(scenario) : null), [scenario])
  const slots = useMemo(() => {
    if (!scenario || !analysis) return []
    const calc = analysis.results[heatmapMode]
    const reserved = heatmapMode === 'optimal'
      ? analysis.recommendedReserved
      : Object.fromEntries(analysis.current.days.map(d => [d.weekday, d.reserved])) as Record<Weekday, number>
    return blockedSlots(scenario, calc, reserved)
  }, [scenario, analysis, heatmapMode])

  const db = scenario?.resourceConfig.dailyBusiness
  if (!scenario || !db || !analysis) return <div style={{ color: '#94a3b8', padding: '2rem' }}>Keine Daten</div>

  const groups = scenario.resourceGroups.filter(g => g.groupType !== 'device_count')
  const setDay = (wd: Weekday, v: number) =>
    updateDailyBusiness({ appointmentsPerDay: { ...db.appointmentsPerDay, [wd]: Math.max(0, v) } })
  const setMinutes = (groupId: string, v: number) =>
    updateDailyBusiness({ minutesPerAppointment: { ...db.minutesPerAppointment, [groupId]: Math.max(0, v) } })
  const setReserved = (wd: Weekday, v: number | null) => {
    const next = { ...(db.reservedPerDay ?? {}) }
    if (v === null) delete next[wd]; else next[wd] = Math.max(0, v)
    updateDailyBusiness({ reservedPerDay: Object.keys(next).length ? next : undefined })
  }
  const adoptRecommendation = () => updateDailyBusiness({ enabled: true, reservedPerDay: analysis.recommendedReserved })

  const { withoutDaily, current, optimal } = analysis
  const gain = optimal.totalRevenue - current.totalRevenue
  const sameAsRecommended = WEEKDAYS.every(wd => Math.abs((db.reservedPerDay?.[wd] ?? -1) - analysis.recommendedReserved[wd]) < 1e-9)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <div>
        <h1 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#1e293b', margin: 0 }}>Tagesgeschäft</h1>
        <p style={{ fontSize: '0.85rem', color: '#64748b', marginTop: '0.25rem', marginBottom: 0 }}>
          Neben den Check-ups laufen reguläre Patiententermine. Sie belegen dieselben Ressourcen. Hier siehst du, wie viele Termine sich lohnen und wann/wo Kapazität freigehalten (blockiert) werden sollte.
        </p>
      </div>

      {/* Switch */}
      <div style={{
        background: db.enabled ? '#f0fdf4' : '#fff', border: `1px solid ${db.enabled ? '#bbf7d0' : '#e2e8f0'}`,
        borderRadius: '8px', padding: '1rem 1.25rem', display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap',
      }}>
        <button
          role="switch" aria-checked={db.enabled}
          onClick={() => updateDailyBusiness({ enabled: !db.enabled })}
          style={{
            width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer', position: 'relative',
            background: db.enabled ? '#22c55e' : '#cbd5e1', flexShrink: 0,
          }}
          title={db.enabled ? 'Ausschalten' : 'Einschalten'}
        >
          <span style={{
            position: 'absolute', top: 3, left: db.enabled ? 23 : 3, width: 18, height: 18, borderRadius: '50%',
            background: '#fff', transition: 'left 0.15s',
          }} />
        </button>
        <div>
          <div style={{ fontWeight: 600, color: '#1e293b', fontSize: '0.9rem' }}>
            Tagesgeschäft im Modell {db.enabled ? 'berücksichtigt' : 'ausgeschaltet'}
          </div>
          <div style={{ fontSize: '0.78rem', color: '#64748b' }}>
            {db.enabled
              ? 'Die freigehaltenen Termine verringern die Kapazität für Check-ups (Dashboard, Diagramme, Optimierung).'
              : 'Die Berechnung ignoriert das Tagesgeschäft. Die Analyse unten zeigt trotzdem, was es bedeuten würde.'}
          </div>
        </div>
      </div>

      {/* Settings */}
      <Card title="Einstellungen">
        <div style={{ display: 'flex', gap: '2.5rem', flexWrap: 'wrap' }}>
          <div>
            <div style={labelS}>Termine pro Tag (Nachfrage, Durchschnitt)</div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              {WEEKDAYS.map(wd => (
                <div key={wd} style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '0.72rem', color: '#64748b', marginBottom: '0.15rem' }}>{WD_DE[wd]}</div>
                  <input type="number" min={0} max={500} value={db.appointmentsPerDay[wd] ?? 0}
                    onChange={e => setDay(wd, Number(e.target.value))} style={{ ...inputS, width: '62px' }} />
                </div>
              ))}
            </div>
          </div>
          <div>
            <div style={labelS}>Schwankung</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <input type="number" min={0} max={100} step={5} value={db.fluctuationPercent}
                onChange={e => updateDailyBusiness({ fluctuationPercent: Math.min(100, Math.max(0, Number(e.target.value))) })}
                style={{ ...inputS, width: '70px' }} />
              <span style={{ fontSize: '0.85rem', color: '#64748b' }}>%</span>
            </div>
            <div style={hintS}>Spitzentag = Durchschnitt × (1 + Schwankung).</div>
          </div>
          <div>
            <div style={labelS}>Wert je Patiententermin</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <input type="number" min={0} step={5} value={db.valuePerAppointmentEur}
                onChange={e => updateDailyBusiness({ valuePerAppointmentEur: Math.max(0, Number(e.target.value)) })}
                style={{ ...inputS, width: '80px' }} />
              <span style={{ fontSize: '0.85rem', color: '#64748b' }}>€</span>
            </div>
          </div>
        </div>

        <div style={{ marginTop: '1.25rem' }}>
          <div style={labelS}>Belegte Minuten je Termin und Ressource</div>
          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
            {groups.map(g => (
              <div key={g.id} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <input type="number" min={0} max={120} step={5} value={db.minutesPerAppointment[g.id] ?? 0}
                  onChange={e => setMinutes(g.id, Number(e.target.value))} style={{ ...inputS, width: '62px' }} />
                <span style={{ fontSize: '0.8rem', color: (db.minutesPerAppointment[g.id] ?? 0) > 0 ? '#1e293b' : '#94a3b8' }}>min {g.name}</span>
              </div>
            ))}
          </div>
          <div style={hintS}>
            Ein Termin dauert 15 Minuten. Trage ein, wie lange er welche Ressource belegt (0 = braucht sie nicht), z. B. Arztgespräch 15, Blutentnahmen 5, Ultraschall 10.
          </div>
        </div>
      </Card>

      {/* Comparison */}
      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
        <PlanCard title="Nur Check-ups" subtitle="ohne Tagesgeschäft" plan={withoutDaily} />
        <PlanCard title="Aktuelle Einstellung" subtitle={db.reservedPerDay ? 'eigene Werte für „Freihalten“' : 'Spitzentag wird freigehalten'} plan={current} />
        <PlanCard title="Empfehlung" subtitle="bester Kompromiss" plan={optimal} highlight
          delta={gain} />
      </div>

      {/* Weekday table */}
      <Card title="Termine pro Wochentag">
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.83rem' }}>
            <thead>
              <tr style={{ background: '#f8fafc' }}>
                <th style={thS}>Wochentag</th>
                <th style={{ ...thS, textAlign: 'right' }}>Nachfrage Ø</th>
                <th style={{ ...thS, textAlign: 'right' }}>Spitzentag</th>
                <th style={{ ...thS, textAlign: 'right' }} title="Termine, für die Kapazität freigehalten wird. Leer = Spitzentag.">Freihalten (aktuell)</th>
                <th style={{ ...thS, textAlign: 'right' }}>Freihalten (empfohlen)</th>
                <th style={{ ...thS, textAlign: 'right' }} title="Termine des Spitzentags, für die keine Kapazität freigehalten wird">Nicht abgedeckt</th>
                <th style={{ ...thS, textAlign: 'right' }}>Erwartete Termine</th>
              </tr>
            </thead>
            <tbody>
              {optimal.days.map((d, i) => {
                const cur = current.days[i]
                const uncovered = Math.max(0, d.demandPeak - d.reserved)
                return (
                  <tr key={d.weekday} style={{ borderTop: '1px solid #f1f5f9' }}>
                    <td style={tdS}><strong>{WD_DE[d.weekday]}</strong></td>
                    <td style={{ ...tdS, textAlign: 'right' }}>{num1(d.demandAvg)}</td>
                    <td style={{ ...tdS, textAlign: 'right' }}>{num1(d.demandPeak)}</td>
                    <td style={{ ...tdS, textAlign: 'right' }}>
                      <input type="number" min={0} step={1}
                        value={db.reservedPerDay?.[d.weekday] ?? ''}
                        placeholder={num1(cur.reserved)}
                        onChange={e => setReserved(d.weekday, e.target.value === '' ? null : Number(e.target.value))}
                        style={{ ...inputS, width: '72px', textAlign: 'right' }} />
                    </td>
                    <td style={{ ...tdS, textAlign: 'right', fontWeight: 700, color: '#15803d' }}>{d.reserved}</td>
                    <td style={{ ...tdS, textAlign: 'right', color: uncovered > 0.5 ? '#c2410c' : '#94a3b8' }}>
                      {uncovered > 0.5 ? num1(uncovered) : '—'}
                    </td>
                    <td style={{ ...tdS, textAlign: 'right' }}>{num1(d.expectedServed)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', marginTop: '1rem', alignItems: 'center' }}>
          <button onClick={adoptRecommendation} disabled={sameAsRecommended && db.enabled}
            style={{ ...btnPrimaryS, opacity: sameAsRecommended && db.enabled ? 0.4 : 1 }}>
            Empfehlung übernehmen (und einschalten)
          </button>
          <button onClick={() => updateDailyBusiness({ reservedPerDay: undefined })} disabled={!db.reservedPerDay}
            style={{ ...btnSecondaryS, opacity: db.reservedPerDay ? 1 : 0.4 }}>
            Zurück auf Spitzentag
          </button>
        </div>
        <div style={hintS}>
          „Freihalten“ = Termine pro Tag, für die Slots aus Check-ups herausgehalten (blockiert) werden. Alles darüber steht den Check-ups zur Verfügung.
          Die Empfehlung maximiert Check-up-Umsatz plus Terminumsatz; sie hält höchstens den Spitzentag frei.
        </div>
      </Card>

      {/* Heatmap */}
      <Card title="Wann und wo Slots freihalten (blockieren)">
        <div style={{ display: 'flex', gap: '0.25rem', background: '#f1f5f9', borderRadius: '8px', padding: '3px', width: 'fit-content', marginBottom: '0.75rem' }}>
          {([['optimal', 'Empfehlung'], ['current', 'Aktuelle Einstellung']] as const).map(([mode, label]) => (
            <button key={mode} onClick={() => setHeatmapMode(mode)} style={{
              padding: '0.35rem 0.9rem', borderRadius: '6px', border: 'none', cursor: 'pointer', fontSize: '0.8rem',
              background: heatmapMode === mode ? '#fff' : 'transparent', color: heatmapMode === mode ? '#1e293b' : '#64748b',
              fontWeight: heatmapMode === mode ? 600 : 400, boxShadow: heatmapMode === mode ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
            }}>{label}</button>
          ))}
        </div>
        <Heatmap slots={slots} />
      </Card>

      <div style={{ padding: '0.75rem 1rem', background: '#eff6ff', borderRadius: '8px', border: '1px solid #bfdbfe', fontSize: '0.8rem', color: '#1e293b', lineHeight: 1.5 }}>
        <strong>So wird gerechnet:</strong> Jeder Termin belegt die eingetragenen Minuten je Ressource. Für „Freihalten“-Termine bleibt diese Zeit von den Check-ups unberührt, die Check-up-Kapazität sinkt entsprechend.
        Die Nachfrage schwankt gleichverteilt zwischen Ø × (1 − Schwankung) und Ø × (1 + Schwankung); erwartet werden daher weniger Termine als freigehalten sind, sobald mehr als das Minimum freigehalten wird.
        Die Empfehlung wählt gemeinsam die Zahl der Check-up-Patienten je Kohorte und die freigehaltenen Termine pro Wochentag mit dem höchsten Wochenumsatz.
        Die Slot-Ansicht nutzt den Tagesplan der Steady-State-Woche und zeigt je 15 Minuten, wie viele Termine neben den Check-ups noch Platz haben.
      </div>
    </div>
  )
}

function PlanCard({ title, subtitle, plan, highlight = false, delta }: { title: string; subtitle: string; plan: Plan; highlight?: boolean; delta?: number }) {
  const served = plan.days.reduce((s, d) => s + d.expectedServed, 0)
  return (
    <div style={{
      flex: '1 1 250px', background: '#fff', borderRadius: '8px', padding: '1rem 1.25rem',
      border: `1px solid ${highlight ? '#86efac' : '#e2e8f0'}`, boxShadow: highlight ? '0 0 0 2px #dcfce7' : 'none',
    }}>
      <div style={{ fontWeight: 700, fontSize: '0.9rem', color: highlight ? '#15803d' : '#1e293b' }}>{title}</div>
      <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginBottom: '0.6rem' }}>{subtitle}</div>
      <Row label="Check-ups pro Woche" value={`${plan.weeklyCheckups}`} sub={`${plan.patientsPerCohort} je Kohorte`} />
      <Row label="Termine pro Woche (erwartet)" value={num1(served)} />
      <Row label="Umsatz pro Woche" value={eur(plan.totalRevenue)} sub={`Check-ups ${eur(plan.checkupRevenue)} · Termine ${eur(plan.dailyRevenue)}`} bold />
      <Row label="Umsatz pro Monat (×4)" value={eur(plan.totalRevenue * 4)} />
      {delta !== undefined && Math.abs(delta) >= 1 && (
        <div style={{ marginTop: '0.4rem', fontSize: '0.78rem', fontWeight: 600, color: delta > 0 ? '#15803d' : '#b91c1c' }}>
          {delta > 0 ? '+' : ''}{eur(delta)} pro Woche gegenüber aktueller Einstellung
        </div>
      )}
    </div>
  )
}

function Row({ label, value, sub, bold = false }: { label: string; value: string; sub?: string; bold?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', padding: '0.2rem 0', fontSize: '0.82rem' }}>
      <span style={{ color: '#64748b' }}>{label}{sub && <div style={{ fontSize: '0.68rem', color: '#94a3b8' }}>{sub}</div>}</span>
      <span style={{ fontWeight: bold ? 700 : 600, color: '#1e293b', whiteSpace: 'nowrap' }}>{value}</span>
    </div>
  )
}

function Heatmap({ slots }: { slots: ReturnType<typeof blockedSlots> }) {
  if (slots.length === 0) {
    return <div style={{ fontSize: '0.85rem', color: '#94a3b8' }}>Trage oben bei mindestens einer Ressource Minuten je Termin ein, um die Slots zu sehen.</div>
  }
  const longest = slots.reduce((a, b) => (b.cells.length > a.cells.length ? b : a))
  return (
    <div>
      <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
        <div style={{ display: 'flex', minWidth: 'fit-content' }}>
          <div style={{ width: 44, flexShrink: 0 }}>
            <div style={{ height: 22, borderBottom: '1px solid #e2e8f0', background: '#f8fafc' }} />
            {slots.map(d => (
              <div key={d.weekday} style={{ height: 32, display: 'flex', alignItems: 'center', padding: '0 0.5rem', fontWeight: 600, fontSize: '0.78rem', color: '#1e293b', borderBottom: '1px solid #f1f5f9' }}>
                {WD_DE[d.weekday]}
              </div>
            ))}
          </div>
          <div>
            <div style={{ display: 'flex', height: 22, borderBottom: '1px solid #e2e8f0', background: '#f8fafc' }}>
              {longest.cells.map((c, i) => (
                <div key={i} style={{ width: 34, fontSize: '0.58rem', color: '#64748b', textAlign: 'center', paddingTop: 4 }}>
                  {c.label.endsWith(':00') || c.label.endsWith(':30') ? c.label : ''}
                </div>
              ))}
            </div>
            {slots.map(d => (
              <div key={d.weekday} style={{ display: 'flex', height: 32, borderBottom: '1px solid #f1f5f9' }}>
                {d.cells.map((c, i) => {
                  const capacity = Math.max(0, c.free)
                  const bg = capacity < 0.05 ? '#fee2e2' : capacity < 0.75 ? '#fef3c7' : '#dcfce7'
                  return (
                    <div key={i}
                      title={`${WD_DE[d.weekday]} ${c.label}: Platz für ${num1(c.free)} Termin(e) neben den Check-ups, ${c.reserved} freihalten`}
                      style={{
                        width: 34, boxSizing: 'border-box', background: bg, borderRight: '1px solid #fff',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '0.72rem', fontWeight: 700, color: '#15803d',
                        outline: c.reserved > 0 ? '2px solid #16a34a' : 'none', outlineOffset: -2,
                      }}>
                      {c.reserved > 0 ? c.reserved : ''}
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
          <div style={{ flexShrink: 0 }}>
            <div style={{ height: 22, borderBottom: '1px solid #e2e8f0', background: '#f8fafc', display: 'flex' }}>
              <div style={{ width: 112, fontSize: '0.62rem', color: '#64748b', padding: '4px 0.5rem', whiteSpace: 'nowrap' }} title="Freizuhaltende Termine / Termine, die neben den Check-ups Platz haben">Freihalten / Platz</div>
            </div>
            {slots.map(d => {
              const short = d.needed > Math.floor(d.available + 1e-9)
              return (
                <div key={d.weekday} style={{ height: 32, width: 112, padding: '0 0.5rem', display: 'flex', alignItems: 'center', fontSize: '0.75rem', color: short ? '#b91c1c' : '#475569', borderBottom: '1px solid #f1f5f9', fontWeight: short ? 700 : 500 }}>
                  {d.needed} / {num1(d.available)}
                </div>
              )
            })}
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginTop: '0.6rem', fontSize: '0.72rem', color: '#64748b' }}>
        <Legend color="#fee2e2" label="belegt durch Check-ups" />
        <Legend color="#fef3c7" label="teilweise frei" />
        <Legend color="#dcfce7" label="frei" />
        <span><span style={{ display: 'inline-block', width: 12, height: 12, outline: '2px solid #16a34a', outlineOffset: -2, verticalAlign: 'middle', marginRight: 4 }} />Zahl = Termine, die in diesem 15-Minuten-Slot freigehalten (blockiert) werden sollten</span>
      </div>
    </div>
  )
}

function Legend({ color, label }: { color: string; label: string }) {
  return <span><span style={{ display: 'inline-block', width: 12, height: 12, background: color, verticalAlign: 'middle', marginRight: 4, borderRadius: 2 }} />{label}</span>
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '1.25rem' }}>
      <div style={{ fontWeight: 600, color: '#1e293b', marginBottom: '1rem', fontSize: '0.95rem' }}>{title}</div>
      {children}
    </div>
  )
}

const labelS: React.CSSProperties = { fontSize: '0.8rem', fontWeight: 500, color: '#475569', marginBottom: '0.35rem' }
const hintS: React.CSSProperties = { fontSize: '0.75rem', color: '#94a3b8', marginTop: '0.4rem', maxWidth: '620px', lineHeight: 1.45 }
const inputS: React.CSSProperties = { padding: '0.3rem 0.5rem', border: '1px solid #cbd5e1', borderRadius: '4px', fontSize: '0.85rem', color: '#1e293b', background: '#fff' }
const btnPrimaryS: React.CSSProperties = { padding: '0.45rem 1.1rem', borderRadius: '6px', border: 'none', background: '#3b82f6', color: '#fff', fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer' }
const btnSecondaryS: React.CSSProperties = { padding: '0.45rem 1.1rem', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#f8fafc', color: '#374151', fontWeight: 500, fontSize: '0.85rem', cursor: 'pointer' }
const thS: React.CSSProperties = { padding: '0.5rem 0.75rem', textAlign: 'left', fontWeight: 600, color: '#475569', fontSize: '0.78rem', borderBottom: '2px solid #e2e8f0' }
const tdS: React.CSSProperties = { padding: '0.45rem 0.75rem', color: '#1e293b' }
