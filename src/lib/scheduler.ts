import type { Examination, ResourceGroup, ResourceConfig, DayNumber, Weekday } from '@/types';

const WEEKDAY_ORDER: Weekday[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ExamItem {
  name: string;
  room: string;
  groupId: string;
  durationMin: number;
}

export interface ScheduledExam {
  patientId: string;
  /** DayNumber for regular visit patients; 'return' for device-return mini-visit */
  stage: DayNumber | 'return';
  items: ExamItem[];
  startMin: number;
  endMin: number;
  primaryGroupId: string;
}

export interface WeekdaySchedule {
  absDay: number;       // 0–14 (Mon W1=0 … Fri W3=14)
  week: 1 | 2 | 3;
  weekday: Weekday;
  openingMinutes: number;
  activeStages: DayNumber[];
  /** True if one or more cohorts have a Langzeit device return event on this day */
  hasDeviceReturn: boolean;
  scheduledExams: ScheduledExam[];
  nPatientsPerStage: number;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface ExamBlock {
  items: ExamItem[];
  duration: number;
  groupIds: string[];
  primaryGroupId: string;
}

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

function buildExamBlocks(exams: Examination[]): ExamBlock[] {
  const byName = new Map<string, Examination>();
  for (const e of exams) byName.set(e.name, e);

  const visited = new Set<string>();
  const blocks: ExamBlock[] = [];

  for (const exam of exams) {
    if (visited.has(exam.id)) continue;
    visited.add(exam.id);

    if (exam.parallelWith) {
      const partner = byName.get(exam.parallelWith);
      if (partner && partner.parallelWith === exam.name && !visited.has(partner.id)) {
        visited.add(partner.id);
        const groupIds = [...new Set([exam.resourceGroupId, partner.resourceGroupId])];
        blocks.push({
          items: [
            { name: exam.name, room: exam.room, groupId: exam.resourceGroupId, durationMin: exam.durationMin },
            { name: partner.name, room: partner.room, groupId: partner.resourceGroupId, durationMin: partner.durationMin },
          ],
          duration: Math.max(exam.durationMin, partner.durationMin),
          groupIds,
          primaryGroupId: exam.resourceGroupId,
        });
        continue;
      }
    }

    blocks.push({
      items: [{ name: exam.name, room: exam.room, groupId: exam.resourceGroupId, durationMin: exam.durationMin }],
      duration: exam.durationMin,
      groupIds: [exam.resourceGroupId],
      primaryGroupId: exam.resourceGroupId,
    });
  }

  return blocks;
}

function getGroupSlots(
  group: ResourceGroup,
  examinations: Examination[],
  config: ResourceConfig,
): number {
  const override = config.groupOverrides[group.id];
  switch (group.groupType) {
    case 'time_based':
      return Math.max(1, override?.deviceCount ?? 1);
    case 'device_count':
      return 1; // setup is serial (1 MFA in Geräteraum at a time)
    case 'staff_multiplied': {
      const groupExams = examinations.filter(e => group.examinationIds.includes(e.id));
      if (groupExams.some(e => e.staffRole === 'Arzt')) return config.staff.doctorCount;
      if (group.id === 'mfa-kapazitat') return config.staff.mfaLabor;
      return config.staff.mfaFunktionsdiagnostik;
    }
  }
}

function lockSlot(slots: number[], endTime: number): void {
  let bestIdx = 0;
  for (let i = 1; i < slots.length; i++) {
    if (slots[i] < slots[bestIdx]) bestIdx = i;
  }
  slots[bestIdx] = endTime;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build a 3-week schedule (absDays 0–14).
 * W1 cohorts start in week 1; W2 cohorts start in week 2; no W3 cohorts (ramp-down).
 */
export function buildWeekSchedule(
  examinations: Examination[],
  resourceGroups: ResourceGroup[],
  config: ResourceConfig,
  nPatients: number,
): WeekdaySchedule[] {
  const { startDays, visitDayOffsets, lzAnlegenDay } = config.scheduleConfig;

  // Cohort start abs days: W1 (days 0–4) + W2 (days 5–9)
  const cohortStartAbsDays: number[] = [];
  for (let w = 0; w < 2; w++) {
    for (const startDay of startDays) {
      cohortStartAbsDays.push(w * 5 + WEEKDAY_ORDER.indexOf(startDay));
    }
  }

  const lzAnlegenOffset = visitDayOffsets[lzAnlegenDay - 1];
  const lzReturnOffset = lzAnlegenOffset + 1;

  const schedules: WeekdaySchedule[] = [];

  for (let absDay = 0; absDay <= 14; absDay++) {
    const weekday = WEEKDAY_ORDER[absDay % 5];
    const week = (Math.floor(absDay / 5) + 1) as 1 | 2 | 3;
    const openingMinutes = config.openingHours[weekday];

    const activeStages: DayNumber[] = [];
    let hasDeviceReturn = false;

    for (const S of cohortStartAbsDays) {
      const offset = absDay - S;
      if (offset < 0) continue;

      for (let i = 0; i < 3; i++) {
        if (offset === visitDayOffsets[i]) {
          const stage = (i + 1) as DayNumber;
          if (!activeStages.includes(stage)) activeStages.push(stage);
        }
      }

      if (offset === lzReturnOffset) hasDeviceReturn = true;
    }

    if (activeStages.length === 0 && !hasDeviceReturn) continue;

    const scheduledExams = scheduleDay(
      activeStages,
      hasDeviceReturn,
      lzAnlegenDay,
      examinations,
      resourceGroups,
      config,
      nPatients,
    );

    schedules.push({
      absDay,
      week,
      weekday,
      openingMinutes,
      activeStages,
      hasDeviceReturn,
      scheduledExams,
      nPatientsPerStage: nPatients,
    });
  }

  return schedules;
}

// ---------------------------------------------------------------------------
// Per-day scheduler
// ---------------------------------------------------------------------------

function scheduleDay(
  activeStages: DayNumber[],
  hasDeviceReturn: boolean,
  lzAnlegenDay: 1 | 2,
  examinations: Examination[],
  resourceGroups: ResourceGroup[],
  config: ResourceConfig,
  nPatients: number,
): ScheduledExam[] {
  // Shared resource slots across all patient groups
  const resourceSlots = new Map<string, number[]>();
  for (const group of resourceGroups) {
    const slotCount = getGroupSlots(group, examinations, config);
    resourceSlots.set(group.id, Array(Math.max(1, slotCount)).fill(0));
  }

  // Build exam blocks per visit stage
  const stageBlocks = new Map<DayNumber, ExamBlock[]>();

  for (const stage of activeStages) {
    let stageExams = examinations.filter(e => {
      if (e.day !== stage) return false;
      if (isLzAbnehmen(e)) return false;
      if (isLzAnlegen(e) && lzAnlegenDay !== stage) return false;
      return true;
    });

    if (stage === lzAnlegenDay) {
      const anlegen = examinations.filter(
        e => isLzAnlegen(e) && !stageExams.includes(e),
      );
      stageExams = [...stageExams, ...anlegen];
    }

    stageBlocks.set(stage, buildExamBlocks(stageExams));
  }

  // Exam blocks for device return mini-visit
  const returnBlocks: ExamBlock[] = hasDeviceReturn
    ? buildExamBlocks(examinations.filter(isLzAbnehmen))
    : [];

  const result: ScheduledExam[] = [];

  // Schedule visit patients (interleaved across stages)
  for (let p = 0; p < nPatients; p++) {
    for (const stage of activeStages) {
      const patientId = `T${stage}-P${String(p + 1).padStart(2, '0')}`;
      let patientFree = 0;
      const blocks = stageBlocks.get(stage) ?? [];

      for (const block of blocks) {
        let start = patientFree;
        for (const groupId of block.groupIds) {
          const slots = resourceSlots.get(groupId);
          if (slots && slots.length > 0) start = Math.max(start, Math.min(...slots));
        }
        const end = start + block.duration;
        for (const groupId of block.groupIds) {
          const slots = resourceSlots.get(groupId);
          if (slots) lockSlot(slots, end);
        }
        patientFree = end;
        result.push({ patientId, stage, items: block.items, startMin: start, endMin: end, primaryGroupId: block.primaryGroupId });
      }
    }
  }

  // Schedule device-return patients
  if (hasDeviceReturn && returnBlocks.length > 0) {
    for (let p = 0; p < nPatients; p++) {
      const patientId = `Return-P${String(p + 1).padStart(2, '0')}`;
      let patientFree = 0;

      for (const block of returnBlocks) {
        let start = patientFree;
        for (const groupId of block.groupIds) {
          const slots = resourceSlots.get(groupId);
          if (slots && slots.length > 0) start = Math.max(start, Math.min(...slots));
        }
        const end = start + block.duration;
        for (const groupId of block.groupIds) {
          const slots = resourceSlots.get(groupId);
          if (slots) lockSlot(slots, end);
        }
        patientFree = end;
        result.push({ patientId, stage: 'return', items: block.items, startMin: start, endMin: end, primaryGroupId: block.primaryGroupId });
      }
    }
  }

  return result;
}
