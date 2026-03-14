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
} from '@/types';
import { buildWeekSchedule } from './scheduler';

const WEEKDAY_ORDER: Weekday[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

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

function getStaffCount(
  group: ResourceGroup,
  examinations: Examination[],
  staff: ResourceConfig['staff'],
): number {
  const groupExams = examinations.filter(e => group.examinationIds.includes(e.id));
  if (groupExams.some(e => e.staffRole === 'Arzt')) return staff.doctorCount;
  if (group.id === 'mfa-kapazitat') return staff.mfaLabor;
  return staff.mfaFunktionsdiagnostik;
}

// ---------------------------------------------------------------------------
// Time per patient for a resource group × specific patient stage
// ---------------------------------------------------------------------------

/** True when exam belongs to a Langzeit device group and is an "anlegen" step */
function isLzAnlegen(exam: Examination): boolean {
  return (
    (exam.resourceGroupId === 'langzeit-ekg' || exam.resourceGroupId === 'langzeit-rr') &&
    exam.name.toLowerCase().includes('anlegen')
  );
}

/** True when exam belongs to a Langzeit device group and is an "abnehmen" step */
function isLzAbnehmen(exam: Examination): boolean {
  return (
    (exam.resourceGroupId === 'langzeit-ekg' || exam.resourceGroupId === 'langzeit-rr') &&
    (exam.name.toLowerCase().includes('abnehmen') || exam.name.toLowerCase().includes('abnahme'))
  );
}

/**
 * Compute time demand per patient for a resource group on a specific visit stage.
 *
 * LZ anlegen exams are attributed to the effective lzAnlegenDay stage
 * (not necessarily their static exam.day), and LZ abnehmen exams are
 * excluded entirely (no device return scheduling).
 */
function timeForGroupAndStage(
  group: ResourceGroup,
  stage: DayNumber,
  examinations: Examination[],
  allSteps: Step[],
  lzAnlegenDay: 1 | 2,
  lzPercent: number = 100,
  ergoPercent: number = 100,
): number {
  const stageExamIds = new Set(
    examinations.filter(e => {
      if (!group.examinationIds.includes(e.id)) return false;

      // LZ abnehmen is excluded (no device return)
      if (isLzAbnehmen(e)) return false;

      // LZ anlegen counts only on the configured lzAnlegenDay stage
      if (isLzAnlegen(e)) return stage === lzAnlegenDay;

      // Normal exams: use their static day
      return e.day === stage;
    }).map(e => e.id),
  );
  if (stageExamIds.size === 0) return 0;

  // Identify LZ and Ergometrie exams for percentage scaling
  const lzExamIds = new Set(
    examinations.filter(e => isLzAnlegen(e) || isLzAbnehmen(e)).map(e => e.id),
  );
  const ergoExamIds = new Set(
    examinations.filter(e => e.resourceGroupId === 'ergometrie').map(e => e.id),
  );
  const lzScale = lzPercent / 100;
  const ergoScale = ergoPercent / 100;

  return allSteps
    .filter(s => s.resourceGroupId === group.id && s.examinationIds.some(id => stageExamIds.has(id)))
    .reduce((sum, s) => {
      const isLzStep = s.examinationIds.some(id => lzExamIds.has(id));
      const isErgoStep = s.examinationIds.some(id => ergoExamIds.has(id));
      const scale = isLzStep ? lzScale : isErgoStep ? ergoScale : 1;
      return sum + s.durationMin * scale;
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
): DayNumber[] {
  const stages: DayNumber[] = [];
  for (const S of cohortStartAbsDays) {
    const offset = absDay - S;
    if (offset < 0) continue;
    for (let i = 0; i < 3; i++) {
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
  const { staff, groupOverrides } = config;
  const lzPercent = config.scheduleConfig.lzPercent ?? 100;
  const ergoPercent = config.scheduleConfig.ergoPercent ?? 100;
  const resourceResults: ResourceCapacityResult[] = [];

  for (const group of resourceGroups) {
    let limitingCapacity: number;
    let timePerPatientMin: number;

    if (group.groupType === 'device_count') {
      if (!hasAnlegenStage) continue;
      const deviceCount = groupOverrides[group.id]?.deviceCount ?? group.slotsPerDay;
      if (lzPercent === 0) {
        continue;
      }
      limitingCapacity = Math.floor(deviceCount / (lzPercent / 100));
      timePerPatientMin = 0;
    } else {
      timePerPatientMin = activeStages.reduce(
        (sum, stage) => sum + timeForGroupAndStage(group, stage, examinations, allSteps, lzAnlegenDay, lzPercent, ergoPercent),
        0,
      );
      if (timePerPatientMin === 0) continue;

      if (group.groupType === 'time_based') {
        const mult = groupOverrides[group.id]?.deviceCount ?? 1;
        limitingCapacity = Math.floor((mult * openingMinutes) / timePerPatientMin);
      } else {
        const staffCount = getStaffCount(group, examinations, staff);
        limitingCapacity = Math.floor((staffCount * openingMinutes) / timePerPatientMin);
      }
    }

    resourceResults.push({
      resourceGroupId: group.id,
      resourceGroupName: group.name,
      weekday,
      openingMinutes,
      timePerPatientMin,
      rawCapacity: limitingCapacity,
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
  const maxOffset = visitDayOffsets[2];
  const cohortStartAbsDays = getCohortStartAbsDays(startDays, maxOffset);

  const weekdayResults: WeekdayCapacityResult[] = [];

  for (let absDay = 5; absDay <= 9; absDay++) {
    const weekday = WEEKDAY_ORDER[absDay % 5];
    const openingMinutes = openingHours[weekday];
    const activeStages = activeStagesOnAbsDay(absDay, cohortStartAbsDays, visitDayOffsets);

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
 * Tag 2: offset 1–5, Tag 3: offset tag2+1 to tag2+5.
 */
function allVisitDayOffsets(): [0, number, number][] {
  const combos: [0, number, number][] = [];
  for (let t2 = 1; t2 <= 5; t2++) {
    for (let t3 = t2 + 1; t3 <= t2 + 5; t3++) {
      combos.push([0, t2, t3]);
    }
  }
  return combos;
}

export function calculateCapacity(
  examinations: Examination[],
  resourceGroups: ResourceGroup[],
  config: ResourceConfig,
): WeeklyCapacityResult {
  const allSteps = resolveSteps(examinations);
  const { scheduleConfig, openingHours } = config;
  const { startDays } = scheduleConfig;

  // --- Auto-determine best (visitDayOffsets, lzAnlegenDay) combination ---
  let bestN = 0;
  let bestLzDay: 1 | 2 = 1;
  let bestOffsets: [0, number, number] = [0, 1, 2];
  let bestResult: { weekdayResults: WeekdayCapacityResult[]; globalMaxN: number } | null = null;

  for (const offsets of allVisitDayOffsets()) {
    for (const lzDay of [1, 2] as const) {
      const result = computeAnalyticalCapacity(examinations, resourceGroups, config, allSteps, offsets, lzDay);
      if (result.globalMaxN > bestN) {
        bestN = result.globalMaxN;
        bestLzDay = lzDay;
        bestOffsets = offsets;
        bestResult = result;
      }
    }
  }

  const bestLzAnlegenDay = bestLzDay;
  const bestVisitDayOffsets = bestOffsets;
  let { weekdayResults, globalMaxN } = bestResult ?? { weekdayResults: [], globalMaxN: 0 };

  // --- Validate capacity with scheduler (respects maxStayMinutes) ---
  while (globalMaxN > 1 && !scheduleFitsOpeningHours(examinations, resourceGroups, config, globalMaxN, bestVisitDayOffsets, bestLzAnlegenDay)) {
    globalMaxN--;
  }

  // Post-process Week 2 results with validated global N
  for (const wd of weekdayResults) {
    wd.maxPatientsPerCohort = globalMaxN;
    for (const r of wd.resourceResults) {
      r.isBottleneck = r.limitingCapacity === globalMaxN;
      r.utilizationPct =
        r.limitingCapacity > 0 ? Math.round((globalMaxN / r.limitingCapacity) * 100) : 0;
    }
    wd.bottleneckResourceId =
      wd.resourceResults.find(r => r.isBottleneck)?.resourceGroupId ?? wd.bottleneckResourceId;
  }

  // --- Three-week data (absDays 0–14) ---
  const maxOffset = bestVisitDayOffsets[2];
  const cohortStartAbsDays = getCohortStartAbsDays(startDays, maxOffset);
  const threeWeekData: DayCapacityResult[] = [];

  for (let absDay = 0; absDay <= 14; absDay++) {
    const weekday = WEEKDAY_ORDER[absDay % 5];
    const week = (Math.floor(absDay / 5) + 1) as 1 | 2 | 3;
    const openingMinutes = openingHours[weekday];
    const activeStages = activeStagesOnAbsDay(absDay, cohortStartAbsDays, bestVisitDayOffsets);

    if (activeStages.length === 0) continue;

    const hasAnlegenStage = activeStages.includes(bestLzAnlegenDay as DayNumber);

    const resourceResults = computeDayResources(
      weekday, activeStages, hasAnlegenStage, openingMinutes,
      examinations, resourceGroups, config, allSteps, bestLzAnlegenDay,
    );

    const maxPatientsThisDay =
      resourceResults.length > 0 ? Math.min(...resourceResults.map(r => r.limitingCapacity)) : 0;

    for (const r of resourceResults) {
      r.isBottleneck = r.limitingCapacity === globalMaxN && week === 2;
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
    description: `${bottleneckRes?.resourceGroupName ?? '—'} begrenzt auf ${globalMaxN} Patienten/Kohorte`,
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
 * Quickly compute weekly throughput for a given config.
 * Runs the same grid search over all (visitDayOffsets, lzAnlegenDay) combos
 * as calculateCapacity, but skips the expensive scheduler validation.
 * Used for sensitivity analysis where many configs are compared.
 */
export function computeQuickThroughput(
  examinations: Examination[],
  resourceGroups: ResourceGroup[],
  config: ResourceConfig,
): number {
  const allSteps = resolveSteps(examinations);
  let bestN = 0;

  for (const offsets of allVisitDayOffsets()) {
    for (const lzDay of [1, 2] as const) {
      const { globalMaxN } = computeAnalyticalCapacity(
        examinations, resourceGroups, config, allSteps, offsets, lzDay,
      );
      if (globalMaxN > bestN) bestN = globalMaxN;
    }
  }

  return bestN * config.scheduleConfig.startDays.length;
}
