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

  // Cohort start abs days: include enough historical weeks so that even
  // the longest check-up has its final stage land within the display window.
  const maxOffset = visitDayOffsets[2];
  const historyWeeks = Math.ceil(maxOffset / 5);
  const cohortStartAbsDays: number[] = [];
  for (let w = -historyWeeks; w < 2; w++) {
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
  const lzPercent = config.scheduleConfig.lzPercent ?? 100;
  const nLzPatients = Math.round(nPatients * lzPercent / 100);

  // Shared resource slots across all patient groups
  const resourceSlots = new Map<string, number[]>();
  for (const group of resourceGroups) {
    const slotCount = getGroupSlots(group, examinations, config);
    resourceSlots.set(group.id, Array(Math.max(1, slotCount)).fill(0));
  }

  /** True if this block involves LZ anlegen or abnehmen exams */
  function isLzBlock(block: ExamBlock): boolean {
    return block.groupIds.some(gid => gid === 'langzeit-ekg' || gid === 'langzeit-rr');
  }

  // Build exam blocks per visit stage — separate LZ and non-LZ blocks
  const stageBlocksAll = new Map<DayNumber, ExamBlock[]>();
  const stageBlocksNoLz = new Map<DayNumber, ExamBlock[]>();

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

    const allBlocks = buildExamBlocks(stageExams);
    stageBlocksAll.set(stage, allBlocks);
    stageBlocksNoLz.set(stage, allBlocks.filter(b => !isLzBlock(b)));
  }

  // Exam blocks for device return mini-visit
  const returnBlocks: ExamBlock[] = hasDeviceReturn
    ? buildExamBlocks(examinations.filter(isLzAbnehmen))
    : [];

  const result: ScheduledExam[] = [];

  // ---------------------------------------------------------------------------
  // 1) Schedule device-return patients FIRST (only nLzPatients need to return).
  //    Patients returning Langzeit devices come in first thing in the morning.
  //    This frees devices before new ones are attached, so we never need more
  //    devices than deviceCount (even when one cohort returns and another
  //    attaches on the same day — the common case with consecutive startDays).
  // ---------------------------------------------------------------------------
  if (hasDeviceReturn && returnBlocks.length > 0) {
    for (let p = 0; p < nLzPatients; p++) {
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

  // ---------------------------------------------------------------------------
  // 2) Schedule visit patients (interleaved across stages).
  //    First nLzPatients get all blocks (incl. LZ anlegen); rest skip LZ blocks.
  //    maxStayMinutes constrains the patient's total stay per visit day.
  //
  //    Optimization: blocks whose resource groups are NOT shared with any other
  //    block on the same stage ("flexible" blocks, e.g. Blutabnahme in its own
  //    Lab room with a dedicated MFA) are deferred and inserted into wait gaps
  //    between main-sequence blocks to minimize patient idle time.
  // ---------------------------------------------------------------------------
  const maxStay = config.scheduleConfig.maxStayMinutes ?? 120;
  const breakMin = (config.scheduleConfig.breakBetweenExams ?? false) ? 5 : 0;

  for (let p = 0; p < nPatients; p++) {
    const hasLz = p < nLzPatients;
    for (const stage of activeStages) {
      const patientId = `T${stage}-P${String(p + 1).padStart(2, '0')}`;
      const blocks = hasLz
        ? (stageBlocksAll.get(stage) ?? [])
        : (stageBlocksNoLz.get(stage) ?? []);

      // Separate blocks into main sequence and flexible (gap-fillable).
      // A block is flexible if NONE of its groupIds are used by any other block
      // on this stage — it uses a completely independent resource.
      const mainBlocks: ExamBlock[] = [];
      const flexBlocks: ExamBlock[] = [];
      for (const block of blocks) {
        const isIndependent = block.groupIds.every(gid =>
          !blocks.some(other => other !== block && other.groupIds.includes(gid)),
        );
        if (isIndependent) {
          flexBlocks.push(block);
        } else {
          mainBlocks.push(block);
        }
      }

      let patientFree = 0;
      let patientArrival = -1;
      let blockIdx = 0;
      const pendingFlex = [...flexBlocks];

      /** Schedule a single block: lock resources, emit result, advance patientFree */
      const scheduleBlock = (block: ExamBlock, start: number) => {
        if (patientArrival < 0) {
          patientArrival = start;
        } else if (start + block.duration > patientArrival + maxStay) {
          patientArrival = start + block.duration - maxStay;
        }
        const end = start + block.duration;
        for (const groupId of block.groupIds) {
          const slots = resourceSlots.get(groupId);
          if (slots) lockSlot(slots, end);
        }
        patientFree = end;
        blockIdx++;
        result.push({ patientId, stage, items: block.items, startMin: start, endMin: end, primaryGroupId: block.primaryGroupId });
      };

      /** Earliest time a block can start given patient availability and resource slots */
      const earliestStart = (block: ExamBlock, earliest: number) => {
        let start = earliest;
        for (const groupId of block.groupIds) {
          const slots = resourceSlots.get(groupId);
          if (slots && slots.length > 0) start = Math.max(start, Math.min(...slots));
        }
        return start;
      };

      for (const block of mainBlocks) {
        if (breakMin > 0 && blockIdx > 0) patientFree += breakMin;

        const mainStart = earliestStart(block, patientFree);

        // Try to fill the wait gap [patientFree, mainStart) with flexible blocks
        if (mainStart > patientFree && pendingFlex.length > 0) {
          for (let f = 0; f < pendingFlex.length; f++) {
            const flex = pendingFlex[f];
            const flexAfterBreak = (breakMin > 0 && blockIdx > 0) ? patientFree : patientFree;
            const flexStart = earliestStart(flex, flexAfterBreak);
            const flexEnd = flexStart + flex.duration;
            // Flexible block fits in the gap if it finishes before main block starts
            // (with room for a break before the main block if needed)
            const needed = flexEnd + (breakMin > 0 ? breakMin : 0);
            if (flexStart < mainStart && needed <= mainStart) {
              scheduleBlock(flex, flexStart);
              pendingFlex.splice(f, 1);
              f--;
              // After scheduling flex, recalculate patientFree for next flex
              if (breakMin > 0) patientFree += breakMin;
            }
          }
        }

        // Schedule the main block (recalculate start — patientFree may have advanced)
        const finalStart = earliestStart(block, patientFree);
        scheduleBlock(block, finalStart);
      }

      // Schedule remaining flexible blocks at the end
      for (const flex of pendingFlex) {
        if (breakMin > 0 && blockIdx > 0) patientFree += breakMin;
        const start = earliestStart(flex, patientFree);
        scheduleBlock(flex, start);
      }
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Schedule analysis — actual slot utilization & wait-time attribution
// ---------------------------------------------------------------------------

export interface DayAnalysis {
  /** groupId → number of exam blocks completing within opening hours */
  actualSlots: Record<string, number>;
  /** groupId → total wait time (min) patients spend waiting for this resource */
  waitMinByGroup: Record<string, number>;
}

export function analyzeScheduleDay(schedule: WeekdaySchedule): DayAnalysis {
  const actualSlots: Record<string, number> = {};
  const waitMinByGroup: Record<string, number> = {};

  // 1. Count exam blocks that complete within opening hours
  for (const exam of schedule.scheduledExams) {
    if (exam.endMin <= schedule.openingMinutes) {
      actualSlots[exam.primaryGroupId] = (actualSlots[exam.primaryGroupId] ?? 0) + 1;
    }
  }

  // 2. Compute wait times: gap between consecutive exams for the same patient.
  //    The wait is attributed to the NEXT exam's resource group (the patient
  //    is waiting for THAT resource to become available).
  const byPatient = new Map<string, ScheduledExam[]>();
  for (const exam of schedule.scheduledExams) {
    const list = byPatient.get(exam.patientId) ?? [];
    list.push(exam);
    byPatient.set(exam.patientId, list);
  }

  for (const [, exams] of byPatient) {
    const sorted = [...exams].sort((a, b) => a.startMin - b.startMin);
    for (let i = 1; i < sorted.length; i++) {
      const gap = sorted[i].startMin - sorted[i - 1].endMin;
      if (gap > 0) {
        const groupId = sorted[i].primaryGroupId;
        waitMinByGroup[groupId] = (waitMinByGroup[groupId] ?? 0) + gap;
      }
    }
  }

  return { actualSlots, waitMinByGroup };
}
