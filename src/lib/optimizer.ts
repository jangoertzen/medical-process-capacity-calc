import type { Examination, Scenario } from '@/types';
import { calculateCapacity, analyticCapacity, type CapacityOptions } from './calculator';

/**
 * Revenue optimizer: which share of patients (in 10 % steps) should get each examination so
 * that the weekly revenue is maximal under the capacity model?
 *
 *   weekly revenue = min(weekly capacity(participation), demand cap) × Σ revenueEur × participation
 *
 * Capacity itself depends on the participation levels (fewer exams per patient free up
 * capacity for more patients), so both are optimized together. Without a demand cap the
 * optimum degenerates (strip everything, serve masses), hence `maxWeeklyPatients`.
 * The search is a heuristic (greedy descent + local search), not a proof of optimality.
 *
 * Speed: during the search the visit-offset / LZ-day combination is held fixed (searching it
 * on every evaluation costs ~50×). Candidates are then re-evaluated with the full model, and
 * the reported numbers always come from the full model.
 */

const STEP = 10;
const SEARCH_BOTTLENECK_TOLERANCE = 1.02;

type Combo = NonNullable<CapacityOptions['fixedCombo']>;

export interface OptimizerMetrics {
  patientsPerCohort: number;
  /** What the resources can serve per week (uncapped by demand) */
  weeklyCapacity: number;
  /** Patients actually served: min(capacity, demand cap) */
  weeklyPatients: number;
  revenuePerPatient: number;
  weeklyRevenue: number;
  monthlyRevenue: number;
  bottlenecks: string[];
}

export interface OptimizerResult {
  /** examId → recommended percentage (return exams mirror their attach exam) */
  levels: Record<string, number>;
  current: OptimizerMetrics;
  optimal: OptimizerMetrics;
}

export function optimizeParticipation(scenario: Scenario, maxWeeklyPatients: number): OptimizerResult {
  const { examinations, resourceGroups, resourceConfig } = scenario;
  const starts = Math.max(1, resourceConfig.scheduleConfig.startDays.length);
  const cohortCap = Math.max(1, Math.ceil(maxWeeklyPatients / starts));

  // Device "return" exams have no capacity effect; they mirror the "attach" exam of their group.
  const isReturn = (e: Examination) => e.deviceRole === 'return';
  const vars = examinations.filter(e => !isReturn(e));
  const attachOfGroup = new Map<string, string>();
  for (const e of vars) {
    if (e.deviceRole === 'attach' && !attachOfGroup.has(e.resourceGroupId)) attachOfGroup.set(e.resourceGroupId, e.id);
  }

  const clamp10 = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(v / STEP) * STEP));
  const bounds = vars.map(e => {
    const min = Math.min(100, Math.max(0, e.participationMin ?? 0));
    const max = Math.min(100, Math.max(0, e.participationMax ?? 100));
    const lo = Math.ceil(min / STEP) * STEP;
    const hi = Math.floor(max / STEP) * STEP;
    return lo <= hi ? { lo, hi } : { lo: Math.round(min / STEP) * STEP, hi: Math.round(min / STEP) * STEP };
  });
  const n = vars.length;

  /** Exams with the given levels applied (vars by index, return exams mirrored). */
  const applyLevels = (levels: number[]): Examination[] => {
    const byId = new Map(vars.map((e, i) => [e.id, levels[i]]));
    return examinations.map(e => {
      if (!isReturn(e)) return { ...e, participationPercent: byId.get(e.id) ?? e.participationPercent };
      const partner = attachOfGroup.get(e.resourceGroupId);
      return partner ? { ...e, participationPercent: byId.get(partner) ?? e.participationPercent } : e;
    });
  };

  const metricsOf = (exams: Examination[], fixedCombo?: Combo): OptimizerMetrics => {
    const r = calculateCapacity(exams, resourceGroups, resourceConfig, { maxPatientsPerCohort: cohortCap, fixedCombo });
    const revenuePerPatient = exams.reduce((s, e) => s + e.revenueEur * ((e.participationPercent ?? 100) / 100), 0);
    const weeklyPatients = Math.min(r.weeklyThroughput, maxWeeklyPatients);
    const weeklyRevenue = weeklyPatients * revenuePerPatient;
    const bottlenecks = [...new Set(
      r.weekdayResults.flatMap(wd => wd.resourceResults.filter(x => x.isBottleneck).map(x => x.resourceGroupName)),
    )];
    return {
      patientsPerCohort: r.maxPatientsPerCohort,
      weeklyCapacity: r.weeklyThroughput,
      weeklyPatients,
      revenuePerPatient,
      weeklyRevenue,
      monthlyRevenue: weeklyRevenue * 4,
      bottlenecks,
    };
  };

  const withLevel = (p: number[], i: number, v: number) => p.map((x, k) => (k === i ? v : x));
  const levelsFor = (i: number) => {
    const out: number[] = [];
    for (let v = bounds[i].lo; v <= bounds[i].hi; v += STEP) out.push(v);
    return out;
  };
  const comboOf = (levels: number[]): Combo => {
    const a = analyticCapacity(applyLevels(levels), resourceGroups, resourceConfig);
    return { offsets: a.offsets, lzDay: a.lzDay };
  };

  /** Greedy descent + local search with the visit combination held fixed. Returns the best levels found. */
  const search = (startPoints: number[][], combo: Combo): number[] => {
    const cache = new Map<string, OptimizerMetrics>();
    const evaluate = (levels: number[]) => {
      const key = levels.join(',');
      let m = cache.get(key);
      if (!m) { m = metricsOf(applyLevels(levels), combo); cache.set(key, m); }
      return m;
    };

    // Phase 1: take away the exam whose 10 % reduction relieves the binding resources most per
    // lost euro. Uses the UNROUNDED capacity so ties and rounding plateaus don't stall the search.
    const rawCaps = (levels: number[]) => {
      const map = new Map<string, number>();
      const a = analyticCapacity(applyLevels(levels), resourceGroups, resourceConfig, combo);
      for (const wd of a.weekdayResults) {
        for (const r of wd.resourceResults) map.set(`${r.resourceGroupId}|${r.weekday}`, r.rawCapacity);
      }
      return map;
    };
    const greedy = (start: number[]) => {
      let p = start;
      let best = { p, m: evaluate(p) };
      for (let iter = 0; iter < 400; iter++) {
        const caps = rawCaps(p);
        if (caps.size === 0) break;
        const minRaw = Math.min(...caps.values());
        const binding = [...caps].filter(([, v]) => v <= minRaw * SEARCH_BOTTLENECK_TOLERANCE);

        let bestScore = 0;
        let next: number[] | null = null;
        for (let i = 0; i < n; i++) {
          if (p[i] - STEP < bounds[i].lo) continue;
          const q = withLevel(p, i, p[i] - STEP);
          const caps2 = rawCaps(q);
          const relief = binding.reduce((s, [k, v]) => s + Math.min(1, (caps2.get(k) ?? v * 2) / v - 1), 0);
          if (relief <= 1e-9) continue;
          const score = relief / Math.max(vars[i].revenueEur * (STEP / 100), 0.01);
          if (score > bestScore) { bestScore = score; next = q; }
        }
        if (!next) break;
        p = next;
        const m = evaluate(p);
        if (m.weeklyRevenue > best.m.weeklyRevenue) best = { p, m };
      }
      return best;
    };

    // Phase 2: local search on the (scheduler-validated) objective
    const polish = (start: number[]) => {
      let p = start;
      let cur = evaluate(p);
      const tryAccept = (q: number[]) => {
        const m = evaluate(q);
        if (m.weeklyRevenue > cur.weeklyRevenue + 1e-9) { p = q; cur = m; return true; }
        return false;
      };
      for (let round = 0; round < 12; round++) {
        let improved = false;
        // single exam: any level
        for (let i = 0; i < n; i++) {
          for (const v of levelsFor(i)) if (v !== p[i] && tryAccept(withLevel(p, i, v))) improved = true;
        }
        // two exams at once (needed when two resources bind together)
        for (let i = 0; i < n; i++) {
          for (let j = i + 1; j < n; j++) {
            for (const [di, dj] of [[-STEP, -STEP], [-STEP, STEP], [STEP, -STEP]]) {
              const a = p[i] + di, b = p[j] + dj;
              if (a < bounds[i].lo || a > bounds[i].hi || b < bounds[j].lo || b > bounds[j].hi) continue;
              if (tryAccept(withLevel(withLevel(p, i, a), j, b))) improved = true;
            }
          }
        }
        if (!improved) break;
      }
      return { p, m: cur };
    };

    const results = startPoints.map(s => polish(greedy(s).p));
    return results.reduce((a, b) => (b.m.weeklyRevenue > a.m.weeklyRevenue ? b : a)).p;
  };

  const upper = bounds.map(b => b.hi);
  const currentRounded = vars.map((e, i) => clamp10(e.participationPercent ?? 100, bounds[i].lo, bounds[i].hi));
  const startPoints = upper.every((v, i) => v === currentRounded[i]) ? [upper] : [upper, currentRounded];

  // First pass with the combination of the unreduced program; second pass with the combination
  // that fits the first result (offsets can shift once resources are relieved).
  const comboUpper = comboOf(upper);
  const first = search(startPoints, comboUpper);
  const candidates = [first];
  const comboFirst = comboOf(first);
  if (JSON.stringify(comboFirst) !== JSON.stringify(comboUpper)) candidates.push(search([first, ...startPoints], comboFirst));

  // Re-evaluate candidates with the full model (visit combination searched again)
  const scored = candidates.map(p => ({ p, m: metricsOf(applyLevels(p)) }));
  const best = scored.reduce((a, b) => (b.m.weeklyRevenue > a.m.weeklyRevenue ? b : a));

  // Never recommend something worse than the current setting (which may be off the 10 % grid).
  const current = metricsOf(examinations);
  const useBest = best.m.weeklyRevenue > current.weeklyRevenue;
  const finalExams = useBest ? applyLevels(best.p) : examinations;

  const levels: Record<string, number> = {};
  for (const e of finalExams) levels[e.id] = e.participationPercent ?? 100;

  return { levels, current, optimal: useBest ? best.m : current };
}
