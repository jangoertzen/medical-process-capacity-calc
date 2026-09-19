import type { Scenario, Weekday, DailyBusinessConfig, WeeklyCapacityResult, ResourceGroup } from '@/types';
import {
  calculateCapacity,
  applyBestSchedule,
  getTotalOpeningMinutes,
  groupCapacityMinutes,
  toClockMin,
} from './calculator';
import { buildWeekSchedule } from './scheduler';

/**
 * Daily business ("Tagesgeschäft"): regular patient appointments next to the check-ups.
 *
 * Model
 * - Demand per weekday D ~ uniform on [d(1−f), d(1+f)] (d = average, f = fluctuation).
 * - The practice holds `r` appointments per day free (blocked for check-ups). Expected served
 *   appointments = E[min(D, r)]; revenue = that × value per appointment.
 * - Each appointment occupies minutes on several resource groups (doctors, MFA, ultrasound …).
 *   Held-free minutes reduce the capacity left for check-ups (see `reservedMinutes` in calculator.ts).
 * - Planning for the peak day means r = d(1+f) (default). If capacity is scarce, holding less free
 *   allows more check-up patients; `analyzeDailyBusiness` finds the best trade-off per weekday.
 */

export const WEEKDAYS: Weekday[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
const SLOT_MIN = 15;

/** E[min(D, r)] for D uniform on [d(1−f), d(1+f)] (f as fraction). */
export function expectedServed(d: number, fluctuationPercent: number, r: number): number {
  const f = Math.min(1, Math.max(0, fluctuationPercent / 100));
  const lo = d * (1 - f);
  const hi = d * (1 + f);
  if (r <= 0) return 0;
  if (hi - lo < 1e-9) return Math.min(d, r);
  if (r >= hi) return d;
  if (r <= lo) return r;
  return ((r * r - lo * lo) / 2 + r * (hi - r)) / (hi - lo);
}

export interface WeekdayPlan {
  weekday: Weekday;
  demandAvg: number;
  demandPeak: number;
  /** Appointments held free (blocked for check-ups) */
  reserved: number;
  expectedServed: number;
  revenue: number;
}

export interface Plan {
  patientsPerCohort: number;
  weeklyCheckups: number;
  checkupRevenue: number;
  days: WeekdayPlan[];
  dailyRevenue: number;
  totalRevenue: number;
}

export interface DailyBusinessAnalysis {
  /** Check-ups only, as if there were no daily business */
  withoutDaily: Plan;
  /** With the reservation currently configured */
  current: Plan;
  /** Best trade-off between check-ups and daily business */
  optimal: Plan;
  /** Recommended held-free appointments per weekday (write to `reservedPerDay` to adopt) */
  recommendedReserved: Record<Weekday, number>;
  results: { current: WeeklyCapacityResult; optimal: WeeklyCapacityResult };
}

const revenuePerPatient = (s: Scenario) =>
  s.examinations.reduce((sum, e) => sum + e.revenueEur * ((e.participationPercent ?? 100) / 100), 0);

/** Groups that daily-business appointments can occupy (time_based / staff_multiplied with minutes > 0). */
function usedGroups(scenario: Scenario, db: DailyBusinessConfig): { group: ResourceGroup; minutes: number }[] {
  return scenario.resourceGroups
    .filter(g => g.groupType !== 'device_count' && (db.minutesPerAppointment[g.id] ?? 0) > 0)
    .map(g => ({ group: g, minutes: db.minutesPerAppointment[g.id] }));
}

function makePlan(
  scenario: Scenario,
  db: DailyBusinessConfig,
  calc: WeeklyCapacityResult,
  reserved: Record<Weekday, number> | null,
): Plan {
  const weeklyCheckups = calc.weeklyThroughput;
  const checkupRevenue = weeklyCheckups * revenuePerPatient(scenario);
  const days: WeekdayPlan[] = WEEKDAYS.map(wd => {
    const d = db.appointmentsPerDay[wd] ?? 0;
    const r = reserved ? reserved[wd] : 0;
    const served = expectedServed(d, db.fluctuationPercent, r);
    return {
      weekday: wd,
      demandAvg: d,
      demandPeak: d * (1 + db.fluctuationPercent / 100),
      reserved: r,
      expectedServed: served,
      revenue: served * db.valuePerAppointmentEur,
    };
  });
  const dailyRevenue = days.reduce((s, x) => s + x.revenue, 0);
  return {
    patientsPerCohort: calc.maxPatientsPerCohort,
    weeklyCheckups,
    checkupRevenue,
    days,
    dailyRevenue,
    totalRevenue: checkupRevenue + dailyRevenue,
  };
}

/**
 * Compares check-ups only / current setting / optimum. The optimum picks, jointly, the number of
 * check-up patients per cohort N and the held-free appointments per weekday (at most the peak demand).
 */
export function analyzeDailyBusiness(scenario: Scenario): DailyBusinessAnalysis | null {
  const db = scenario.resourceConfig.dailyBusiness;
  if (!db) return null;
  const { examinations, resourceGroups, resourceConfig } = scenario;
  const cfg = (patch: Partial<DailyBusinessConfig>): typeof resourceConfig => ({
    ...resourceConfig,
    dailyBusiness: { ...db, ...patch },
  });

  // Reference: no daily business
  const off = calculateCapacity(examinations, resourceGroups, cfg({ enabled: false }));
  const starts = Math.max(1, resourceConfig.scheduleConfig.startDays.length);
  const perPatient = revenuePerPatient(scenario);
  const used = usedGroups(scenario, db);

  // Check-up minutes per patient for each (group, weekday), from the reference run
  const tpp = new Map<string, number>();
  for (const wd of off.weekdayResults) {
    for (const r of wd.resourceResults) tpp.set(`${r.resourceGroupId}|${r.weekday}`, r.timePerPatientMin);
  }

  const peakSlots = (wd: Weekday) => Math.ceil((db.appointmentsPerDay[wd] ?? 0) * (1 + db.fluctuationPercent / 100) - 1e-9);
  /** Largest number of appointments (≤ peak) that fits next to N check-up patients per cohort */
  const reservedFor = (N: number): Record<Weekday, number> => {
    const out = {} as Record<Weekday, number>;
    for (const wd of WEEKDAYS) {
      const open = getTotalOpeningMinutes(resourceConfig.openingHours[wd]);
      let r = peakSlots(wd);
      for (const { group, minutes } of used) {
        const free = groupCapacityMinutes(group, resourceConfig.staff, open) - N * (tpp.get(`${group.id}|${wd}`) ?? 0);
        r = Math.min(r, Math.max(0, Math.floor(free / minutes + 1e-9)));
      }
      out[wd] = r;
    }
    return out;
  };
  const totalFor = (N: number) => {
    const r = reservedFor(N);
    const daily = WEEKDAYS.reduce((s, wd) => s + expectedServed(db.appointmentsPerDay[wd] ?? 0, db.fluctuationPercent, r[wd]) * db.valuePerAppointmentEur, 0);
    return { r, total: N * starts * perPatient + daily };
  };

  let best = totalFor(0);
  for (let N = 1; N <= off.maxPatientsPerCohort; N++) {
    const t = totalFor(N);
    if (t.total >= best.total - 1e-9) best = t;
  }
  const recommendedReserved = best.r;

  // Verify with the full model
  const optimalCalc = calculateCapacity(examinations, resourceGroups, cfg({ enabled: true, reservedPerDay: recommendedReserved }));
  const currentCalc = calculateCapacity(examinations, resourceGroups, cfg({ enabled: true }));
  const currentReserved = {} as Record<Weekday, number>;
  for (const wd of WEEKDAYS) {
    currentReserved[wd] = db.reservedPerDay?.[wd] ?? (db.appointmentsPerDay[wd] ?? 0) * (1 + db.fluctuationPercent / 100);
  }

  return {
    withoutDaily: makePlan(scenario, db, off, null),
    current: makePlan(scenario, db, currentCalc, currentReserved),
    optimal: makePlan(scenario, db, optimalCalc, recommendedReserved),
    recommendedReserved,
    results: { current: currentCalc, optimal: optimalCalc },
  };
}

// ---------------------------------------------------------------------------
// Where to block: free capacity per 15-minute slot
// ---------------------------------------------------------------------------

export interface SlotCell {
  /** Clock time label of the slot start, e.g. "08:15" */
  label: string;
  /** Appointments that still fit into this slot next to the check-ups */
  free: number;
  /** Appointments to hold free (block) in this slot */
  reserved: number;
}

export interface SlotDay {
  weekday: Weekday;
  cells: SlotCell[];
  /** Appointments to hold free on this day */
  needed: number;
  /** Total appointments that fit next to the check-ups on this day (slot-wise) */
  available: number;
}

/**
 * For each weekday: how much room the check-up schedule leaves per 15-minute slot, and where the
 * `reserved` appointments should be held free. Uses the Week-2 schedule of `calc`.
 */
export function blockedSlots(
  scenario: Scenario,
  calc: WeeklyCapacityResult,
  reserved: Record<Weekday, number>,
): SlotDay[] {
  const db = scenario.resourceConfig.dailyBusiness;
  if (!db) return [];
  const used = usedGroups(scenario, db);
  if (used.length === 0) return [];

  const best = applyBestSchedule({ ...scenario, results: calc });
  const nPatients = Math.max(0, calc.maxPatientsPerCohort);
  const schedules = buildWeekSchedule(best.examinations, best.resourceGroups, best.resourceConfig, nPatients)
    .filter(s => s.week === 2);

  return WEEKDAYS.map(wd => {
    const intervals = scenario.resourceConfig.openingHours[wd];
    const open = getTotalOpeningMinutes(intervals);
    const sched = schedules.find(s => s.weekday === wd);
    const nSlots = Math.ceil(open / SLOT_MIN);
    const cells: SlotCell[] = [];

    for (let i = 0; i < nSlots; i++) {
      const from = i * SLOT_MIN;
      const to = Math.min(open, from + SLOT_MIN);
      let free = Infinity;
      for (const { group, minutes } of used) {
        const lanes = groupCapacityMinutes(group, scenario.resourceConfig.staff, open) / Math.max(1, open);
        let busy = 0;
        for (const exam of sched?.scheduledExams ?? []) {
          if (!exam.items.some(it => it.groupId === group.id)) continue;
          busy += Math.max(0, Math.min(exam.endMin, to) - Math.max(exam.startMin, from));
        }
        free = Math.min(free, Math.max(0, lanes * (to - from) - busy) / minutes);
      }
      const h = toClockMin(intervals, from);
      cells.push({
        label: `${String(Math.floor(h / 60)).padStart(2, '0')}:${String(h % 60).padStart(2, '0')}`,
        free: Number.isFinite(free) ? free : 0,
        reserved: 0,
      });
    }

    // Spread the held-free appointments over the day in proportion to the room each slot has
    // (largest remainder, so the integer counts add up).
    const available = cells.reduce((s, c) => s + c.free, 0);
    const needed = Math.ceil((reserved[wd] ?? 0) - 1e-9);
    const target = Math.min(needed, Math.floor(available + 1e-9));
    if (target > 0 && available > 0) {
      const raw = cells.map(c => (c.free / available) * target);
      const base = raw.map(Math.floor);
      let left = target - base.reduce((a, b) => a + b, 0);
      raw.map((v, i) => ({ i, rem: v - base[i] }))
        .sort((a, b) => b.rem - a.rem)
        .forEach(({ i }) => { if (left > 0 && base[i] < Math.floor(cells[i].free + 1e-9)) { base[i]++; left--; } });
      cells.forEach((c, i) => { c.reserved = base[i]; });
    }
    return { weekday: wd, cells, needed, available };
  });
}
