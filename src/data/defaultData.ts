import type { Examination, ResourceGroup, ResourceConfig } from '@/types';

export const defaultExaminations: Examination[] = [
  // Day 1
  { id: 'e01', day: 1, name: 'Blutabnahme', room: 'Labor', deviceCount: null, staffRole: 'MFA', durationMin: 5, parallelWith: null, resourceGroupId: 'mfa-kapazitat', revenueEur: 25 },
  { id: 'e02', day: 1, name: 'EKG', room: 'Funktionsraum', deviceCount: null, staffRole: 'MFA', durationMin: 10, parallelWith: 'ABI-Messung', resourceGroupId: 'funktionsraum-tag1', revenueEur: 20 },
  { id: 'e03', day: 1, name: 'ABI-Messung', room: 'Funktionsraum', deviceCount: null, staffRole: 'MFA', durationMin: 10, parallelWith: 'EKG', resourceGroupId: 'funktionsraum-tag1', revenueEur: 15 },
  { id: 'e04', day: 1, name: 'Lungenfunktion', room: 'Funktionsraum', deviceCount: null, staffRole: 'MFA', durationMin: 5, parallelWith: null, resourceGroupId: 'funktionsraum-tag1', revenueEur: 25 },
  { id: 'e05', day: 1, name: 'Abdomen-Sonographie', room: 'Sono', deviceCount: null, staffRole: 'Arzt', durationMin: 15, parallelWith: 'Körperliche Untersuchung', resourceGroupId: 'arzt-sono', revenueEur: 60 },
  { id: 'e06', day: 1, name: 'Körperliche Untersuchung', room: 'Sprechzimmer', deviceCount: null, staffRole: 'Arzt', durationMin: 5, parallelWith: 'Abdomen-Sonographie', resourceGroupId: 'arzt-sprechzeit', revenueEur: 30 },
  { id: 'e07', day: 1, name: 'Langzeit-EKG anlegen', room: 'Geräteraum', deviceCount: 4, staffRole: 'MFA', durationMin: 5, parallelWith: 'Langzeit-Blutdruck anlegen', resourceGroupId: 'langzeit-ekg', revenueEur: 50 },
  { id: 'e08', day: 1, name: 'Langzeit-Blutdruck anlegen', room: 'Geräteraum', deviceCount: 4, staffRole: 'MFA', durationMin: 5, parallelWith: 'Langzeit-EKG anlegen', resourceGroupId: 'langzeit-rr', revenueEur: 30 },
  // Day 2
  { id: 'e09', day: 2, name: 'Langzeit-EKG abnehmen', room: 'Geräteraum', deviceCount: 4, staffRole: 'MFA', durationMin: 2, parallelWith: 'Langzeit-Blutdruck abnehmen', resourceGroupId: 'langzeit-ekg', revenueEur: 0 },
  { id: 'e10', day: 2, name: 'Langzeit-Blutdruck abnehmen', room: 'Geräteraum', deviceCount: 4, staffRole: 'MFA', durationMin: 2, parallelWith: 'Langzeit-EKG abnehmen', resourceGroupId: 'langzeit-rr', revenueEur: 0 },
  { id: 'e12', day: 2, name: 'Echokardiographie', room: 'Sono', deviceCount: null, staffRole: 'Arzt', durationMin: 15, parallelWith: 'Duplex hirnversorgende Gefäße', resourceGroupId: 'arzt-sono', revenueEur: 80 },
  { id: 'e13', day: 2, name: 'Duplex hirnversorgende Gefäße', room: 'Sono', deviceCount: null, staffRole: 'Arzt', durationMin: 15, parallelWith: 'Echokardiographie', resourceGroupId: 'arzt-sono', revenueEur: 60 },
  // Ergometrie muss nach Echo/Duplex stattfinden (Reihenfolge ist relevant für Scheduler)
  { id: 'e11', day: 2, name: 'Fahrradergometrie', room: 'Ergometrieraum', deviceCount: 1, staffRole: 'MFA', durationMin: 20, parallelWith: null, resourceGroupId: 'ergometrie', revenueEur: 40 },
  // Day 3
  { id: 'e14', day: 3, name: 'Schilddrüsen-Sonographie', room: 'Sono', deviceCount: null, staffRole: 'Arzt', durationMin: 5, parallelWith: null, resourceGroupId: 'arzt-sono', revenueEur: 40 },
  { id: 'e15', day: 3, name: 'Abschlussgespräch', room: 'Sprechzimmer', deviceCount: null, staffRole: 'Arzt', durationMin: 10, parallelWith: null, resourceGroupId: 'arzt-sprechzeit', revenueEur: 50 },
];

export const defaultResourceGroups: ResourceGroup[] = [
  {
    id: 'funktionsraum-tag1',
    name: 'Funktionsraum Tag 1',
    examinationIds: ['e02', 'e03', 'e04'],
    slotsPerDay: 16,
    groupType: 'time_based',
    note: '1 MFA Funktionsdiagnostik',
  },
  {
    id: 'arzt-sono',
    name: 'Ultraschall',
    examinationIds: ['e05', 'e12', 'e13', 'e14'],
    slotsPerDay: 16,
    groupType: 'time_based',
    note: '1 Ultraschallgerät — serialisiert alle Sono-Untersuchungen',
  },
  {
    id: 'arzt-sprechzeit',
    name: 'Arztgespräch',
    examinationIds: ['e06', 'e15'],
    slotsPerDay: 16,
    groupType: 'staff_multiplied',
    note: '5 Ärzte',
  },
  {
    id: 'mfa-kapazitat',
    name: 'Blutentnahmen',
    examinationIds: ['e01'],
    slotsPerDay: 16,
    groupType: 'staff_multiplied',
    note: '1 MFA Labor',
  },
  {
    id: 'langzeit-ekg',
    name: 'Langzeit-EKG-Geräte',
    examinationIds: ['e07', 'e09'],
    slotsPerDay: 4,
    groupType: 'device_count',
    note: '4 LZ-EKG-Geräte (Patienten nehmen Gerät mit)',
  },
  {
    id: 'langzeit-rr',
    name: 'Langzeit-RR-Geräte',
    examinationIds: ['e08', 'e10'],
    slotsPerDay: 4,
    groupType: 'device_count',
    note: '4 LZ-RR-Geräte (Patienten nehmen Gerät mit)',
  },
  {
    id: 'ergometrie',
    name: 'Ergometrie',
    examinationIds: ['e11'],
    slotsPerDay: 4,
    groupType: 'time_based',
    note: '1 Ergometer',
  },
];

export const defaultResourceConfig: ResourceConfig = {
  openingHours: {
    Mon: 360,
    Tue: 360,
    Wed: 240,
    Thu: 360,
    Fri: 300,
  },
  staff: {
    doctorCount: 5,
    mfaFunktionsdiagnostik: 1,
    mfaLabor: 1,
  },
  groupOverrides: {
    'arzt-sono': { deviceCount: 1 },
    ergometrie: { deviceCount: 1 },
    'langzeit-ekg': { deviceCount: 4 },
    'langzeit-rr': { deviceCount: 4 },
  },
  scheduleConfig: {
    // New patients can start any weekday
    startDays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    // Visits on consecutive days (Tag 1 = start, Tag 2 = start+1, Tag 3 = start+2)
    visitDayOffsets: [0, 1, 2],
    // Langzeit devices are attached on Tag 1 and returned the following calendar day
    lzAnlegenDay: 1,
    // 3-day program by default (Tag 1, 2, 3)
    programDays: 3,
    // 100% of patients receive Langzeit measurements by default
    lzPercent: 100,
    // 100% of patients receive Ergometrie by default
    ergoPercent: 100,
    // Maximum patient stay per visit day: 2 hours
    maxStayMinutes: 120,
    // No break between exams by default
    breakBetweenExams: false,
  },
};
