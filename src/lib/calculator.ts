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

function timeForGroupAndStage(
  group: ResourceGroup,
  stage: DayNumber,
  examinations: Examination[],
  allSteps: Step[],
): number {
  const stageExamIds = new Set(
    examinations.filter(e => e.day === stage && group.examinationIds.includes(e.id)).map(e => e.id),
  );
  if (stageExamIds.size === 0) return 0;

  return allSteps
    .filter(s => s.resourceGroupId === group.id && s.examinationIds.some(id => stageExamIds.has(id)))
    .reduce((sum, s) => sum + s.durationMin, 0);
}

// ---------------------------------------------------------------------------
// Abs-day helpers (3-week model)
// ---------------------------------------------------------------------------

/**
 * Cohort start abs days: W1 cohorts (days 0–4) + W2 cohorts (days 5–9).
 * No W3 cohorts (ramp-down week — existing cohorts finish, no new ones start).
 */
function getCohortStartAbsDays(startDays: Weekday[]): number[] {
  const result: number[] = [];
  for (let w = 0; w < 2; w++) {
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

function hasDeviceReturnOnAbsDay(
  absDay: number,
  cohortStartAbsDays: number[],
  visitDayOffsets: [0, number, number],
  lzAnlegenDay: 1 | 2,
): boolean {
  const lzAnlegenOffset = visitDayOffsets[lzAnlegenDay - 1];
  const lzReturnOffset = lzAnlegenOffset + 1;
  return cohortStartAbsDays.some(S => absDay - S === lzReturnOffset);
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
): ResourceCapacityResult[] {
  const { staff, groupOverrides } = config;
  const resourceResults: ResourceCapacityResult[] = [];

  for (const group of resourceGroups) {
    let limitingCapacity: number;
    let timePerPatientMin: number;

    if (group.groupType === 'device_count') {
      if (!hasAnlegenStage) continue;
      const deviceCount = groupOverrides[group.id]?.deviceCount ?? group.slotsPerDay;
      limitingCapacity = deviceCount;
      timePerPatientMin = 0;
    } else {
      const hasExamsThisDay = activeStages.some(stage =>
        examinations.some(e => e.day === stage && group.examinationIds.includes(e.id)),
      );
      if (!hasExamsThisDay) continue;

      timePerPatientMin = activeStages.reduce(
        (sum, stage) => sum + timeForGroupAndStage(group, stage, examinations, allSteps),
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

export function calculateCapacity(
  examinations: Examination[],
  resourceGroups: ResourceGroup[],
  config: ResourceConfig,
): WeeklyCapacityResult {
  const allSteps = resolveSteps(examinations);
  const { scheduleConfig, openingHours } = config;
  const { startDays, visitDayOffsets, lzAnlegenDay } = scheduleConfig;

  const cohortStartAbsDays = getCohortStartAbsDays(startDays);

  // --- Week 2 calculation (absDays 5–9) — the binding capacity constraint ---
  const weekdayResults: WeekdayCapacityResult[] = [];

  for (let absDay = 5; absDay <= 9; absDay++) {
    const weekday = WEEKDAY_ORDER[absDay % 5];
    const openingMinutes = openingHours[weekday];
    const activeStages = activeStagesOnAbsDay(absDay, cohortStartAbsDays, visitDayOffsets);

    if (activeStages.length === 0) continue;

    const hasAnlegenStage = activeStages.includes(lzAnlegenDay as DayNumber);

    const resourceResults = computeDayResources(
      weekday, activeStages, hasAnlegenStage, openingMinutes,
      examinations, resourceGroups, config, allSteps,
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

  // Global max N from Week 2
  const globalMaxN =
    weekdayResults.length > 0
      ? Math.min(...weekdayResults.map(d => d.maxPatientsPerCohort))
      : 0;

  // Post-process Week 2 results with global N
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
  const threeWeekData: DayCapacityResult[] = [];

  for (let absDay = 0; absDay <= 14; absDay++) {
    const weekday = WEEKDAY_ORDER[absDay % 5];
    const week = (Math.floor(absDay / 5) + 1) as 1 | 2 | 3;
    const openingMinutes = openingHours[weekday];
    const activeStages = activeStagesOnAbsDay(absDay, cohortStartAbsDays, visitDayOffsets);
    const hasDeviceReturn = hasDeviceReturnOnAbsDay(absDay, cohortStartAbsDays, visitDayOffsets, lzAnlegenDay);

    if (activeStages.length === 0 && !hasDeviceReturn) continue;

    const hasAnlegenStage = activeStages.includes(lzAnlegenDay as DayNumber);

    const resourceResults = computeDayResources(
      weekday, activeStages, hasAnlegenStage, openingMinutes,
      examinations, resourceGroups, config, allSteps,
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
      hasDeviceReturn,
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
  };
}
