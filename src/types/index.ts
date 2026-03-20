export type DayNumber = 1 | 2 | 3;
export type Weekday = 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri';
export type OpeningHours = Record<Weekday, number>;
export type ResourceGroupType = 'time_based' | 'device_count' | 'staff_multiplied';
export type AppPage = 'dashboard' | 'untersuchungen' | 'ressourcen' | 'szenarien' | 'diagramme';

export interface Examination {
  id: string;
  day: DayNumber;
  name: string;
  room: string;
  staffRole: 'MFA' | 'Arzt';
  durationMin: number;
  parallelWith: string | null;
  resourceGroupId: string;
  isAssumedDefault?: boolean;
  /** Revenue per examination in EUR */
  revenueEur: number;
  /** Order within the day for drag & drop sorting */
  order: number;
  /** This exam must always be scheduled after the referenced exam id */
  mustFollowExamId: string | null;
}

export interface ResourceGroup {
  id: string;
  name: string;
  examinationIds: string[];
  slotsPerDay: number;
  groupType: ResourceGroupType;
  note?: string;
  /** Number of devices/rooms for this group (device_count and time_based groups) */
  deviceCount: number | null;
}

export interface StaffConfig {
  doctorCount: number;
  mfaFunktionsdiagnostik: number;
  mfaLabor: number;
}

/**
 * Flexible 3-visit program configuration.
 *
 * visitDayOffsets: calendar-day offsets from the cohort start day for each visit.
 *   [0, d1, d2]  where 1 ≤ d1 ≤ 5  and  d1 < d2 ≤ d1+5
 *   Example: [0,1,2] = three consecutive days (original default)
 *            [0,2,4] = visits every other day
 *
 * lzAnlegenDay: which patient visit (1 or 2) the Langzeit devices are attached.
 *   Devices are ALWAYS returned the following calendar day (Folgetag).
 */
export interface ScheduleConfig {
  startDays: Weekday[];
  visitDayOffsets: [0, number, number];
  lzAnlegenDay: 1 | 2;
  /** Number of visit days per patient: 2 or 3. When 2, Tag 3 exams move to Tag 2. */
  programDays: 2 | 3;
  /** Percentage of patients (0–100) who receive Langzeit-EKG & Langzeit-RR */
  lzPercent: number;
  /** Percentage of patients (0–100) who receive Ergometrie */
  ergoPercent: number;
  /** Maximum patient stay per visit day in minutes (default 120) */
  maxStayMinutes: number;
  /** Whether to add a 5-minute break between each examination */
  breakBetweenExams: boolean;
}

export interface ResourceConfig {
  openingHours: OpeningHours;
  staff: StaffConfig;
  scheduleConfig: ScheduleConfig;
}

export interface ResourceCapacityResult {
  resourceGroupId: string;
  resourceGroupName: string;
  weekday: Weekday;
  openingMinutes: number;
  /** Total demand per patient across all active stages for this weekday */
  timePerPatientMin: number;
  /** Max patients per cohort this resource alone can handle */
  limitingCapacity: number;
  rawCapacity: number;
  isBottleneck: boolean;
  /** (globalMaxN / limitingCapacity) × 100 */
  utilizationPct: number;
}

export interface WeekdayCapacityResult {
  weekday: Weekday;
  /** Which patient stages overlap on this weekday */
  activeStages: DayNumber[];
  openingMinutes: number;
  resourceResults: ResourceCapacityResult[];
  /** Minimum across all resources — same as global after post-processing */
  maxPatientsPerCohort: number;
  bottleneckResourceId: string;
}

export interface DayCapacityResult {
  absDay: number;       // 0–14 (Mon W1=0 … Fri W3=14)
  week: 1 | 2 | 3;
  weekday: Weekday;
  activeStages: DayNumber[];
  openingMinutes: number;
  resourceResults: ResourceCapacityResult[];
  /** Min across resources for this specific day */
  maxPatientsThisDay: number;
}

export interface WeeklyCapacityResult {
  weekdayResults: WeekdayCapacityResult[];
  /** Global minimum across all weekdays and the device cap */
  maxPatientsPerCohort: number;
  /** maxPatientsPerCohort × startDays.length */
  weeklyThroughput: number;
  startDaysCount: number;
  primaryBottleneck: BottleneckSummary;
  allResourceUtilization: ResourceCapacityResult[];
  /** Full 3-week per-day data (absDays 0–14) */
  threeWeekData: DayCapacityResult[];
  /** Automatically determined best day (1 or 2) for Langzeit device attachment */
  bestLzAnlegenDay: 1 | 2;
  /** Automatically determined best visit day offsets */
  bestVisitDayOffsets: [0, number, number];
}

export interface BottleneckSummary {
  resourceGroupId: string;
  resourceGroupName: string;
  limitingCapacity: number;
  affectedWeekday: Weekday;
  description: string;
}

export interface Scenario {
  id: string;
  name: string;
  createdAt: string;
  examinations: Examination[];
  resourceGroups: ResourceGroup[];
  resourceConfig: ResourceConfig;
  results: WeeklyCapacityResult | null;
}
