import type {
  Examination,
  ResourceGroup,
  ResourceConfig,
  ResourceCapacityResult,
  WeekdayCapacityResult,
  WeeklyCapacityResult,
  DayCapacityResult,
  BottleneckSummary,
  DayNumber,
  Weekday,
  TimeInterval,
  Scenario,
} from '@/types';
import { buildWeekSchedule } from './scheduler';

/** Sum of all open interval durations for a day */
export function getTotalOpeningMinutes(intervals: TimeInterval[]): number {
  return intervals.reduce((sum, iv) => sum + Math.max(0, iv.endMin - iv.startMin), 0);
}

/**
 * Convert "minutes since opening" (the scheduler's timeline, closed gaps removed)
 * to minutes since midnight. `asEnd` maps a value on an interval boundary to the
 * END of the earlier interval (use for the end of a block), otherwise to the
 * START of the next one. Values beyond closing time continue after the last interval.
 */
export function toClockMin(intervals: TimeInterval[], m: number, asEnd = false): number {
  if (intervals.length === 0) return 480 + m;
  let acc = 0;
  for (const iv of intervals) {
    const len = Math.max(0, iv.endMin - iv.startMin);
    if (m < acc + len || (asEnd && m <= acc + len)) return iv.startMin + (m - acc);
    acc += len;
  }
  return intervals[intervals.length - 1].endMin + (m - acc);
}

const WEEKDAY_ORDER: Weekday[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

// ---------------------------------------------------------------------------
// 2-day program helper: remap Tag 3 exams to Tag 2
// ---------------------------------------------------------------------------

export function applyProgramDays(examinations: Examination[], programDays: 2 | 3): Examination[] {
  if (programDays === 3) return examinations;
  return examinations.map(e => e.day === 3 ? { ...e, day: 2 as DayNumber } : e);
}

// ---------------------------------------------------------------------------
// Step resolution
// ---------------------------------------------------------------------------

interface Step {
  type: 'single' | 'parallel';
  examinationIds: string[];
  durationMin: number;
  resourceGroupId: string;
}

function resolveSteps(examinations: Examination[]): Step[] {
  const byName = new Map<string, Examination>();
  for (const e of examinations) byName.set(e.name, e);

  const visited = new Set<string>();
  const steps: Step[] = [];

  for (const exam of examinations) {
    if (visited.has(exam.id)) continue;
    visited.add(exam.id);

    if (exam.parallelWith) {
      const partner = byName.get(exam.parallelWith);
      if (partner && partner.parallelWith === exam.name && !visited.has(partner.id)) {
        if (partner.resourceGroupId === exam.resourceGroupId) {
          visited.add(partner.id);
          steps.push({
            type: 'parallel',
            examinationIds: [exam.id, partner.id],
            durationMin: Math.max(exam.durationMin, partner.durationMin),
            resourceGroupId: exam.resourceGroupId,
          });
          continue;
        }
      }
    }

    steps.push({
      type: 'single',
      examinationIds: [exam.id],
      durationMin: exam.durationMin,
      resourceGroupId: exam.resourceGroupId,
    });
  }

  return steps;
}

// ---------------------------------------------------------------------------
// Staff resolution
// ---------------------------------------------------------------------------

/** Staff pool size serving a `staff_multiplied` group (falls back to Funktionsdiagnostik-MFA). */
export function getStaffCount(group: ResourceGroup, staff: ResourceConfig['staff']): number {
  return staff[group.staffType ?? 'mfaFunktionsdiagnostik'];
}

// ---------------------------------------------------------------------------
// Time per patient for a resource group × specific patient stage
// ---------------------------------------------------------------------------

/** Device cycle: exam that hands out the device (counts on the lzAnlegenDay visit) */
export function isDeviceAttach(exam: Examination): boolean {
  return exam.deviceRole === 'attach';
}

/** Device cycle: exam that takes the device back (not scheduled) */
export function isDeviceReturn(exam: Examination): boolean {
  return exam.deviceRole === 'return';
}

/**
 * Compute time demand per patient for a resource group on a specific visit stage.
 *
 * LZ anlegen exams are attributed to the effective lzAnlegenDay stage
 * (not necessarily their static exam.day), and LZ abnehmen exams are
 * excluded entirely (no device return scheduling).
 * Per-exam participationPercent is used for scaling.
 */
function timeForGroupAndStage(
  group: ResourceGroup,
  stage: DayNumber,
  examinations: Examination[],
  allSteps: Step[],
  lzAnlegenDay: 1 | 2,
): number {
  const stageExamIds = new Set(
    examinations.filter(e => {
      if (!group.examinationIds.includes(e.id)) return false;

      // LZ abnehmen is excluded (no device return)
      if (isDeviceReturn(e)) return false;

      // LZ anlegen counts only on the configured lzAnlegenDay stage
      if (isDeviceAttach(e)) return stage === lzAnlegenDay;

      // Normal exams: use their static day
      return e.day === stage;
    }).map(e => e.id),
  );
  if (stageExamIds.size === 0) return 0;

  const examById = new Map(examinations.map(e => [e.id, e]));

  return allSteps
    .filter(s => s.resourceGroupId === group.id && s.examinationIds.some(id => stageExamIds.has(id)))
    .reduce((sum, s) => {
      // Scale by average participationPercent of exams in this step
      const stepExams = s.examinationIds.map(id => examById.get(id)).filter(Boolean) as Examination[];
      const avgParticipation = stepExams.length > 0
        ? stepExams.reduce((p, e) => p + (e.participationPercent ?? 100), 0) / stepExams.length
        : 100;
      return sum + s.durationMin * (avgParticipation / 100);
    }, 0);
}

// ---------------------------------------------------------------------------
// Abs-day helpers (3-week model)
// ---------------------------------------------------------------------------

function getCohortStartAbsDays(
  startDays: Weekday[],
  maxOffset: number,
): number[] {
  const historyWeeks = Math.ceil(maxOffset / 5);
  const result: number[] = [];
  for (let w = -historyWeeks; w < 2; w++) {
    for (const sd of startDays) {
      result.push(w * 5 + WEEKDAY_ORDER.indexOf(sd));
    }
  }
  return result;
}

function activeStagesOnAbsDay(
  absDay: number,
  cohortStartAbsDays: number[],
  visitDayOffsets: [0, number, number],
  numVisits: number = 3,
): DayNumber[] {
  const stages: DayNumber[] = [];
  for (const S of cohortStartAbsDays) {
    const offset = absDay - S;
    if (offset < 0) continue;
    for (let i = 0; i < numVisits; i++) {
      if (offset === visitDayOffsets[i]) {
        const stage = (i + 1) as DayNumber;
        if (!stages.includes(stage)) stages.push(stage);
      }
    }
  }
  return stages;
}

// ---------------------------------------------------------------------------
// Per-day resource capacity computation
// ---------------------------------------------------------------------------

function computeDayResources(
  weekday: Weekday,
  activeStages: DayNumber[],
  hasAnlegenStage: boolean,
  openingMinutes: number,
  examinations: Examination[],
  resourceGroups: ResourceGroup[],
  config: ResourceConfig,
  allSteps: Step[],
  lzAnlegenDay: 1 | 2,
): ResourceCapacityResult[] {
  const { staff } = config;
  const resourceResults: ResourceCapacityResult[] = [];

  for (const group of resourceGroups) {
    let limitingCapacity: number;
    let rawCapacity: number;
    let timePerPatientMin: number;

    if (group.groupType === 'device_count') {
      if (!hasAnlegenStage) continue;
      const deviceCount = group.deviceCount ?? group.slotsPerDay;
      // Use participationPercent from the anlegen exam in this group
      const anlegenExam = examinations.find(e => group.examinationIds.includes(e.id) && isDeviceAttach(e));
      const participation = (anlegenExam?.participationPercent ?? 100) / 100;
      if (participation === 0) continue;
      rawCapacity = deviceCount / participation;
      limitingCapacity = Math.floor(rawCapacity);
      timePerPatientMin = 0;
    } else {
      timePerPatientMin = activeStages.reduce(
        (sum, stage) => sum + timeForGroupAndStage(group, stage, examinations, allSteps, lzAnlegenDay),
        0,
      );
      if (timePerPatientMin === 0) continue;

      if (group.groupType === 'time_based') {
        const mult = group.deviceCount ?? 1;
        rawCapacity = (mult * openingMinutes) / timePerPatientMin;
      } else {
        rawCapacity = (getStaffCount(group, staff) * openingMinutes) / timePerPatientMin;
      }
      limitingCapacity = Math.floor(rawCapacity);
    }

    resourceResults.push({
      resourceGroupId: group.id,
      resourceGroupName: group.name,
      weekday,
      openingMinutes,
      timePerPatientMin,
      rawCapacity,
      limitingCapacity,
      isBottleneck: false,
      utilizationPct: 0,
    });
  }

  return resourceResults;
}

// ---------------------------------------------------------------------------
// Main calculation
// ---------------------------------------------------------------------------

/**
 * Compute analytical capacity for a specific (visitDayOffsets, lzAnlegenDay) combo.
 * Returns the weekday results and globalMaxN without post-processing.
 */
function computeAnalyticalCapacity(
  examinations: Examination[],
  resourceGroups: ResourceGroup[],
  config: ResourceConfig,
  allSteps: Step[],
  visitDayOffsets: [0, number, number],
  lzAnlegenDay: 1 | 2,
): { weekdayResults: WeekdayCapacityResult[]; globalMaxN: number } {
  const { openingHours, scheduleConfig } = config;
  const { startDays } = scheduleConfig;
  const numVisits = (scheduleConfig.programDays ?? 3) === 2 ? 2 : 3;
  const maxOffset = numVisits === 2 ? visitDayOffsets[1] : visitDayOffsets[2];
  const cohortStartAbsDays = getCohortStartAbsDays(startDays, maxOffset);

  const weekdayResults: WeekdayCapacityResult[] = [];

  for (let absDay = 5; absDay <= 9; absDay++) {
    const weekday = WEEKDAY_ORDER[absDay % 5];
    const openingMinutes = getTotalOpeningMinutes(openingHours[weekday]);
    const activeStages = activeStagesOnAbsDay(absDay, cohortStartAbsDays, visitDayOffsets, numVisits);

    if (activeStages.length === 0) continue;

    const hasAnlegenStage = activeStages.includes(lzAnlegenDay as DayNumber);

    const resourceResults = computeDayResources(
      weekday, activeStages, hasAnlegenStage, openingMinutes,
      examinations, resourceGroups, config, allSteps, lzAnlegenDay,
    );
    if (resourceResults.length === 0) continue;

    const minResCapacity = Math.min(...resourceResults.map(r => r.limitingCapacity));

    weekdayResults.push({
      weekday,
      activeStages,
      openingMinutes,
      resourceResults,
      maxPatientsPerCohort: minResCapacity,
      bottleneckResourceId:
        resourceResults.find(r => r.limitingCapacity === minResCapacity)?.resourceGroupId ?? '',
    });
  }

  const globalMaxN =
    weekdayResults.length > 0
      ? Math.min(...weekdayResults.map(d => d.maxPatientsPerCohort))
      : 0;

  return { weekdayResults, globalMaxN };
}

/**
 * Check whether a given nPatients fits within opening hours using the scheduler.
 */
function scheduleFitsOpeningHours(
  examinations: Examination[],
  resourceGroups: ResourceGroup[],
  config: ResourceConfig,
  nPatients: number,
  visitDayOffsets: [0, number, number],
  lzAnlegenDay: 1 | 2,
): boolean {
  const overriddenConfig: ResourceConfig = {
    ...config,
    scheduleConfig: { ...config.scheduleConfig, visitDayOffsets, lzAnlegenDay },
  };

  const schedules = buildWeekSchedule(examinations, resourceGroups, overriddenConfig, nPatients);
  for (const s of schedules) {
    if (s.week !== 2) continue;
    for (const exam of s.scheduledExams) {
      if (exam.endMin > s.openingMinutes) return false;
    }
  }
  return true;
}

/**
 * Generate all valid visitDayOffset combinations.
 * For 3-day programs: Tag 2 offset 1–5, Tag 3 offset tag2+1 to tag2+5.
 * For 2-day programs: Tag 2 offset 1–5, Tag 3 offset = 99 (never used).
 */
function allVisitDayOffsets(programDays: 2 | 3 = 3): [0, number, number][] {
  const combos: [0, number, number][] = [];
  if (programDays === 2) {
    for (let t2 = 1; t2 <= 5; t2++) {
      combos.push([0, t2, 99]);
    }
  } else {
    for (let t2 = 1; t2 <= 5; t2++) {
      for (let t3 = t2 + 1; t3 <= t2 + 5; t3++) {
        combos.push([0, t2, t3]);
      }
    }
  }
  return combos;
}

/** Grid search over all valid (visitDayOffsets, lzAnlegenDay) combos; first best wins on ties. */
function findBestAnalytic(
  examinations: Examination[],
  resourceGroups: ResourceGroup[],
  config: ResourceConfig,
  allSteps: Step[],
  programDays: 2 | 3,
) {
  let bestN = 0;
  let lzDay: 1 | 2 = 1;
  let offsets: [0, number, number] = [0, 1, 2];
  let result: { weekdayResults: WeekdayCapacityResult[]; globalMaxN: number } = { weekdayResults: [], globalMaxN: 0 };

  for (const o of allVisitDayOffsets(programDays)) {
    for (const lz of [1, 2] as const) {
      const r = computeAnalyticalCapacity(examinations, resourceGroups, config, allSteps, o, lz);
      if (r.globalMaxN > bestN) {
        bestN = r.globalMaxN;
        lzDay = lz;
        offsets = o;
        result = r;
      }
    }
  }
  return { lzDay, offsets, result };
}

/**
 * Analytical capacity only (no scheduler validation): the per-weekday resource results of
 * the best visit-offset combination, including unrounded `rawCapacity`. With `fixed`, only that
 * combination is evaluated (about 50× cheaper) — for search loops (optimizer).
 */
export function analyticCapacity(
  rawExaminations: Examination[],
  resourceGroups: ResourceGroup[],
  config: ResourceConfig,
  fixed?: { offsets: [0, number, number]; lzDay: 1 | 2 },
): { globalMaxN: number; weekdayResults: WeekdayCapacityResult[]; offsets: [0, number, number]; lzDay: 1 | 2 } {
  const programDays = config.scheduleConfig.programDays ?? 3;
  const examinations = applyProgramDays(rawExaminations, programDays);
  const allSteps = resolveSteps(examinations);
  if (fixed) {
    const result = computeAnalyticalCapacity(examinations, resourceGroups, config, allSteps, fixed.offsets, fixed.lzDay);
    return { ...result, ...fixed };
  }
  const { result, offsets, lzDay } = findBestAnalytic(examinations, resourceGroups, config, allSteps, programDays);
  return { ...result, offsets, lzDay };
}

/** Search shortcuts for the optimizer; regular callers pass nothing. */
export interface CapacityOptions {
  /** Upper bound for patients per cohort (demand limit) */
  maxPatientsPerCohort?: number;
  /** Evaluate only this visit-offset / LZ-day combination instead of searching all */
  fixedCombo?: { offsets: [0, number, number]; lzDay: 1 | 2 };
}

export function calculateCapacity(
  rawExaminations: Examination[],
  resourceGroups: ResourceGroup[],
  config: ResourceConfig,
  options?: CapacityOptions,
): WeeklyCapacityResult {
  const programDays = config.scheduleConfig.programDays ?? 3;
  const examinations = applyProgramDays(rawExaminations, programDays);
  const allSteps = resolveSteps(examinations);
  const { scheduleConfig, openingHours } = config;
  const { startDays } = scheduleConfig;

  // --- Auto-determine best (visitDayOffsets, lzAnlegenDay) combination ---
  const fixed = options?.fixedCombo;
  const best = fixed
    ? {
        lzDay: fixed.lzDay,
        offsets: fixed.offsets,
        result: computeAnalyticalCapacity(examinations, resourceGroups, config, allSteps, fixed.offsets, fixed.lzDay),
      }
    : findBestAnalytic(examinations, resourceGroups, config, allSteps, programDays);
  const bestLzAnlegenDay = best.lzDay;
  const bestVisitDayOffsets = best.offsets;
  const { weekdayResults, globalMaxN: analyticMaxN } = best.result;
  const nCap = options?.maxPatientsPerCohort;
  let globalMaxN = nCap === undefined ? analyticMaxN : Math.min(analyticMaxN, Math.max(1, nCap));

  // --- Validate capacity with scheduler (respects maxStayMinutes) ---
  const analyticN = analyticMaxN;
  while (globalMaxN > 1 && !scheduleFitsOpeningHours(examinations, resourceGroups, config, globalMaxN, bestVisitDayOffsets, bestLzAnlegenDay)) {
    globalMaxN--;
  }

  // Post-process Week 2 results with validated global N
  for (const wd of weekdayResults) {
    wd.maxPatientsPerCohort = globalMaxN;
    for (const r of wd.resourceResults) {
      // Tightest resource(s) by analytical capacity — still named when the
      // scheduler lowered N below it.
      r.isBottleneck = r.limitingCapacity === analyticN;
      r.utilizationPct =
        r.limitingCapacity > 0 ? Math.round((globalMaxN / r.limitingCapacity) * 100) : 0;
    }
    wd.bottleneckResourceId =
      wd.resourceResults.find(r => r.isBottleneck)?.resourceGroupId ?? wd.bottleneckResourceId;
  }

  // --- Three-week data (absDays 0–14) ---
  const numVisits = programDays === 2 ? 2 : 3;
  const maxOffset = numVisits === 2 ? bestVisitDayOffsets[1] : bestVisitDayOffsets[2];
  const cohortStartAbsDays = getCohortStartAbsDays(startDays, maxOffset);
  const threeWeekData: DayCapacityResult[] = [];

  for (let absDay = 0; absDay <= 14; absDay++) {
    const weekday = WEEKDAY_ORDER[absDay % 5];
    const week = (Math.floor(absDay / 5) + 1) as 1 | 2 | 3;
    const openingMinutes = getTotalOpeningMinutes(openingHours[weekday]);
    const activeStages = activeStagesOnAbsDay(absDay, cohortStartAbsDays, bestVisitDayOffsets, numVisits);

    if (activeStages.length === 0) continue;

    const hasAnlegenStage = activeStages.includes(bestLzAnlegenDay as DayNumber);

    const resourceResults = computeDayResources(
      weekday, activeStages, hasAnlegenStage, openingMinutes,
      examinations, resourceGroups, config, allSteps, bestLzAnlegenDay,
    );

    const maxPatientsThisDay =
      resourceResults.length > 0 ? Math.min(...resourceResults.map(r => r.limitingCapacity)) : 0;

    for (const r of resourceResults) {
      r.isBottleneck = r.limitingCapacity === analyticN && week === 2;
      r.utilizationPct =
        r.limitingCapacity > 0 ? Math.round((globalMaxN / r.limitingCapacity) * 100) : 0;
    }

    threeWeekData.push({
      absDay,
      week,
      weekday,
      activeStages,
      openingMinutes,
      resourceResults,
      maxPatientsThisDay,
    });
  }

  // --- Primary bottleneck (from Week 2) ---
  const weeklyThroughput = globalMaxN * startDays.length;

  const bottleneckWd =
    weekdayResults.find(d => d.resourceResults.some(r => r.isBottleneck)) ?? weekdayResults[0];
  const bottleneckRes = bottleneckWd?.resourceResults.find(r => r.isBottleneck);

  const primaryBottleneck: BottleneckSummary = {
    resourceGroupId: bottleneckRes?.resourceGroupId ?? '',
    resourceGroupName: bottleneckRes?.resourceGroupName ?? '',
    limitingCapacity: globalMaxN,
    affectedWeekday: bottleneckWd?.weekday ?? 'Mon',
    description: globalMaxN < analyticN
      ? `${bottleneckRes?.resourceGroupName ?? '—'}: Kapazität ${analyticN}, durch Ablaufplanung (Wartezeit/Aufenthalt) auf ${globalMaxN} Patienten/Kohorte begrenzt`
      : `${bottleneckRes?.resourceGroupName ?? '—'} begrenzt auf ${globalMaxN} Patienten/Kohorte`,
  };

  const allResourceUtilization = weekdayResults.flatMap(d => d.resourceResults);

  return {
    weekdayResults,
    maxPatientsPerCohort: globalMaxN,
    weeklyThroughput,
    startDaysCount: startDays.length,
    primaryBottleneck,
    allResourceUtilization,
    threeWeekData,
    bestLzAnlegenDay,
    bestVisitDayOffsets,
  };
}

/**
 * Weekly throughput for a given config — identical to
 * `calculateCapacity(...).weeklyThroughput` (including scheduler validation),
 * so sensitivity analyses match the dashboard value.
 */
export function computeQuickThroughput(
  rawExaminations: Examination[],
  resourceGroups: ResourceGroup[],
  config: ResourceConfig,
): number {
  return calculateCapacity(rawExaminations, resourceGroups, config).weeklyThroughput;
}

/**
 * Scenario with the automatically determined visit offsets / LZ day applied to
 * its schedule config. Use this before feeding a scenario to the scheduler or
 * Gantt, otherwise they run on the (unoptimised) stored defaults.
 */
export function applyBestSchedule(scenario: Scenario): Scenario {
  const r = scenario.results;
  if (!r) return scenario;
  return {
    ...scenario,
    resourceConfig: {
      ...scenario.resourceConfig,
      scheduleConfig: {
        ...scenario.resourceConfig.scheduleConfig,
        lzAnlegenDay: r.bestLzAnlegenDay,
        visitDayOffsets: r.bestVisitDayOffsets,
      },
    },
  };
}
