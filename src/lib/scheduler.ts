import type { Examination, ResourceGroup, ResourceConfig, DayNumber, Weekday } from '@/types';
import { getTotalOpeningMinutes } from './calculator';

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
  stage: DayNumber;
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

interface ScheduledEntry {
  block: ExamBlock;
  start: number;
  end: number;
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

/** True if this block is the Abschlussgespräch (must always be scheduled last) */
function isAbschluss(block: ExamBlock): boolean {
  return block.items.some(it => it.name.toLowerCase().includes('abschlussgespräch'));
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
  switch (group.groupType) {
    case 'time_based':
      return Math.max(1, group.deviceCount ?? 1);
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
  rawExaminations: Examination[],
  resourceGroups: ResourceGroup[],
  config: ResourceConfig,
  nPatients: number,
): WeekdaySchedule[] {
  const programDays = config.scheduleConfig.programDays ?? 3;
  const examinations = programDays === 2
    ? rawExaminations.map(e => e.day === 3 ? { ...e, day: 2 as DayNumber } : e)
    : rawExaminations;
  const { startDays, visitDayOffsets } = config.scheduleConfig;
  const lzAnlegenDay = config.scheduleConfig.lzAnlegenDay;

  const numVisits = programDays === 2 ? 2 : 3;
  const maxOffset = programDays === 2 ? visitDayOffsets[1] : visitDayOffsets[2];
  const historyWeeks = Math.ceil(maxOffset / 5);
  const cohortStartAbsDays: number[] = [];
  for (let w = -historyWeeks; w < 2; w++) {
    for (const startDay of startDays) {
      cohortStartAbsDays.push(w * 5 + WEEKDAY_ORDER.indexOf(startDay));
    }
  }

  const schedules: WeekdaySchedule[] = [];

  for (let absDay = 0; absDay <= 14; absDay++) {
    const weekday = WEEKDAY_ORDER[absDay % 5];
    const week = (Math.floor(absDay / 5) + 1) as 1 | 2 | 3;
    const openingMinutes = getTotalOpeningMinutes(config.openingHours[weekday]);

    const activeStages: DayNumber[] = [];

    for (const S of cohortStartAbsDays) {
      const offset = absDay - S;
      if (offset < 0) continue;

      for (let i = 0; i < numVisits; i++) {
        if (offset === visitDayOffsets[i]) {
          const stage = (i + 1) as DayNumber;
          if (!activeStages.includes(stage)) activeStages.push(stage);
        }
      }
    }

    if (activeStages.length === 0) continue;

    const scheduledExams = scheduleDay(
      activeStages,
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
  lzAnlegenDay: 1 | 2,
  examinations: Examination[],
  resourceGroups: ResourceGroup[],
  config: ResourceConfig,
  nPatients: number,
): ScheduledExam[] {
  // Derive participation rates from per-exam participationPercent
  const lzAnlegenExam = examinations.find(e => isLzAnlegen(e));
  const ergoExam = examinations.find(e => e.resourceGroupId === 'ergometrie');
  const lzParticipation = (lzAnlegenExam?.participationPercent ?? 100) / 100;
  const ergoParticipation = (ergoExam?.participationPercent ?? 100) / 100;
  const nLzPatients = Math.round(nPatients * lzParticipation);
  const nErgoPatients = Math.round(nPatients * ergoParticipation);

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

  /** True if this block involves Ergometrie exams */
  function isErgoBlock(block: ExamBlock): boolean {
    return block.groupIds.some(gid => gid === 'ergometrie');
  }

  // Build exam blocks per visit stage — separate variants for LZ and Ergo
  const stageBlocksAll = new Map<DayNumber, ExamBlock[]>();
  const stageBlocksNoLz = new Map<DayNumber, ExamBlock[]>();
  const stageBlocksNoErgo = new Map<DayNumber, ExamBlock[]>();
  const stageBlocksNoLzNoErgo = new Map<DayNumber, ExamBlock[]>();

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
    stageBlocksNoErgo.set(stage, allBlocks.filter(b => !isErgoBlock(b)));
    stageBlocksNoLzNoErgo.set(stage, allBlocks.filter(b => !isLzBlock(b) && !isErgoBlock(b)));
  }

  const result: ScheduledExam[] = [];

  // ---------------------------------------------------------------------------
  // Sequential per-patient scheduling with CROSS-STAGE contention awareness.
  //
  // A block is "contended" if ANY of its resource groups is used by blocks in
  // OTHER stages on the same day (not just within the patient's own stage).
  // This ensures resources like arzt-sono (Ultraschall), which is used by
  // Tag 1 (Abdomen-Sono), Tag 2 (Echokardiographie), and Tag 3 (Schilddrüsen),
  // are treated as contended for ALL stages — preventing one stage from
  // monopolising the resource and causing long waits for other stages.
  //
  // Strategy (3 phases per patient):
  //  1. Schedule contended blocks greedily (earliest available resource).
  //  2. Insert independent blocks into gaps between contended exams.
  //  3. Schedule Abschlussgespräch last.
  // ---------------------------------------------------------------------------
  const maxStay = config.scheduleConfig.maxStayMinutes ?? 120;
  const breakMin = (config.scheduleConfig.breakBetweenExams ?? false) ? 5 : 0;

  /** Earliest time a block can start given patient availability and resource slots */
  const earliestStart = (block: ExamBlock, earliest: number) => {
    let start = earliest;
    for (const groupId of block.groupIds) {
      const slots = resourceSlots.get(groupId);
      if (slots && slots.length > 0) start = Math.max(start, Math.min(...slots));
    }
    return start;
  };

  // Compute cross-stage contended resource groups.
  // A group is contended if it appears in non-Abschluss blocks from ≥2 stages
  // OR in ≥2 blocks within the same stage.
  const groupBlockCount = new Map<string, number>();
  const groupStageSet = new Map<string, Set<DayNumber>>();
  for (const stage of activeStages) {
    for (const block of (stageBlocksAll.get(stage) ?? [])) {
      if (isAbschluss(block)) continue;
      for (const gid of block.groupIds) {
        groupBlockCount.set(gid, (groupBlockCount.get(gid) ?? 0) + 1);
        if (!groupStageSet.has(gid)) groupStageSet.set(gid, new Set());
        groupStageSet.get(gid)!.add(stage);
      }
    }
  }
  const contendedGroups = new Set<string>();
  for (const [gid, count] of groupBlockCount) {
    const stageCount = groupStageSet.get(gid)?.size ?? 0;
    if (count > 1 || stageCount > 1) contendedGroups.add(gid);
  }

  // Process stages sequentially: stages with MORE exams first (Tag 1 before
  // Tag 2/3). This gives Tag 1 patients priority on shared resources like
  // Ultraschall, so their Funktionsdiagnostik flows directly into Sono
  // without long waits caused by Tag 2 Echokardiographien in between.
  const stagesByExamCount = [...activeStages].sort((a, b) => {
    const aCount = (stageBlocksAll.get(a) ?? []).length;
    const bCount = (stageBlocksAll.get(b) ?? []).length;
    return bCount - aCount; // most exams first
  });

  for (const stage of stagesByExamCount) {
    for (let p = 0; p < nPatients; p++) {
      const hasLz = p < nLzPatients;
      const hasErgo = p < nErgoPatients;
      const patientId = `T${stage}-P${String(p + 1).padStart(2, '0')}`;
      const blocks = hasLz
        ? (hasErgo ? (stageBlocksAll.get(stage) ?? []) : (stageBlocksNoErgo.get(stage) ?? []))
        : (hasErgo ? (stageBlocksNoLz.get(stage) ?? []) : (stageBlocksNoLzNoErgo.get(stage) ?? []));

      if (blocks.length === 0) continue;

      // Classify using cross-stage contention: a block is contended if ANY
      // of its resource groups is globally contended on this day.
      const contendedBlocks: ExamBlock[] = [];
      const independentBlocks: ExamBlock[] = [];
      let abschlussBlock: ExamBlock | null = null;

      for (const block of blocks) {
        if (isAbschluss(block)) {
          abschlussBlock = block;
        } else {
          const isIndep = block.groupIds.every(gid => !contendedGroups.has(gid));
          if (isIndep) {
            independentBlocks.push(block);
          } else {
            contendedBlocks.push(block);
          }
        }
      }

      // Phase 1: Schedule contended blocks greedily (earliest available resource)
      const scheduled: ScheduledEntry[] = [];
      const contendedRemaining = contendedBlocks.map((_, i) => i);
      let patientFree = 0;
      let patientArrival = -1;
      let blockCount = 0;

      while (contendedRemaining.length > 0) {
        const minTime = blockCount > 0 ? patientFree + breakMin : patientFree;
        let bestIdx = -1;
        let bestStart = Infinity;
        for (let r = 0; r < contendedRemaining.length; r++) {
          const start = earliestStart(contendedBlocks[contendedRemaining[r]], minTime);
          if (start < bestStart) {
            bestStart = start;
            bestIdx = r;
          }
        }
        if (bestIdx < 0) break;

        const block = contendedBlocks[contendedRemaining[bestIdx]];
        const end = bestStart + block.duration;

        if (patientArrival < 0) patientArrival = bestStart;
        else if (end > patientArrival + maxStay) patientArrival = end - maxStay;

        for (const groupId of block.groupIds) {
          const slots = resourceSlots.get(groupId);
          if (slots) lockSlot(slots, end);
        }
        patientFree = end;
        blockCount++;
        contendedRemaining.splice(bestIdx, 1);
        scheduled.push({ block, start: bestStart, end });
      }

      // Phase 2: Insert independent blocks into gaps between scheduled exams.
      for (const indepBlock of independentBlocks) {
        scheduled.sort((a, b) => a.start - b.start);

        let bestGapStart = -1;
        let bestGapWaste = Infinity;

        // Try gap before first scheduled block — only if it's tight
        // (prevents scheduling Blutabnahme 2 hours before first exam)
        if (scheduled.length > 0) {
          const gapEnd = scheduled[0].start;
          const resStart = earliestStart(indepBlock, 0);
          const resEnd = resStart + indepBlock.duration;
          const waste = gapEnd - resEnd;
          if (resEnd + breakMin <= gapEnd + breakMin && resStart < gapEnd && waste <= indepBlock.duration) {
            bestGapStart = resStart;
            bestGapWaste = waste;
          }
        }

        // Try each gap between consecutive scheduled blocks
        for (let g = 0; g < scheduled.length - 1; g++) {
          const gapBegin = scheduled[g].end + breakMin;
          const gapEnd = scheduled[g + 1].start;
          if (gapEnd - gapBegin < indepBlock.duration) continue;

          const resStart = earliestStart(indepBlock, gapBegin);
          const resEnd = resStart + indepBlock.duration;
          if (resEnd <= gapEnd) {
            const waste = (gapEnd - gapBegin) - indepBlock.duration;
            if (waste < bestGapWaste) {
              bestGapWaste = waste;
              bestGapStart = resStart;
            }
          }
        }

        // If no gap fits, schedule after the last block
        if (bestGapStart < 0) {
          const minTime = blockCount > 0 ? patientFree + breakMin : patientFree;
          bestGapStart = earliestStart(indepBlock, minTime);
        }

        const end = bestGapStart + indepBlock.duration;
        if (patientArrival < 0) patientArrival = bestGapStart;
        else if (end > patientArrival + maxStay) patientArrival = end - maxStay;

        for (const groupId of indepBlock.groupIds) {
          const slots = resourceSlots.get(groupId);
          if (slots) lockSlot(slots, end);
        }
        if (end > patientFree) patientFree = end;
        blockCount++;
        scheduled.push({ block: indepBlock, start: bestGapStart, end });
      }

      // Phase 3: Schedule Abschlussgespräch last (always the final exam)
      if (abschlussBlock) {
        const minTime = blockCount > 0 ? patientFree + breakMin : patientFree;
        const start = earliestStart(abschlussBlock, minTime);
        const end = start + abschlussBlock.duration;

        if (patientArrival < 0) patientArrival = start;
        else if (end > patientArrival + maxStay) patientArrival = end - maxStay;

        for (const groupId of abschlussBlock.groupIds) {
          const slots = resourceSlots.get(groupId);
          if (slots) lockSlot(slots, end);
        }
        patientFree = end;
        blockCount++;
        scheduled.push({ block: abschlussBlock, start, end });
      }

      // Emit all scheduled entries sorted by time
      scheduled.sort((a, b) => a.start - b.start);
      for (const entry of scheduled) {
        result.push({
          patientId, stage,
          items: entry.block.items,
          startMin: entry.start,
          endMin: entry.end,
          primaryGroupId: entry.block.primaryGroupId,
        });
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
