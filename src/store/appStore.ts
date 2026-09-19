import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { persist } from 'zustand/middleware';
import { current } from 'immer';
import type {
  Scenario,
  Examination,
  ResourceConfig,
  ResourceGroup,
  AppPage,
  Weekday,
  StaffConfig,
  WeeklyCapacityResult,
  ScheduleConfig,
  DayNumber,
  TimeInterval,
  DailyBusinessConfig,
} from '@/types';
import { defaultExaminations, defaultResourceGroups, defaultResourceConfig } from '@/data/defaultData';
import { calculateCapacity } from '@/lib/calculator';
import { normalizeScenario } from '@/lib/normalize';

function makeDefaultScenario(): Scenario {
  const exams = defaultExaminations;
  const groups = defaultResourceGroups;
  const config = defaultResourceConfig;
  const results = calculateCapacity(exams, groups, config);
  return {
    id: 'default',
    name: 'Basis-Szenario',
    createdAt: new Date().toISOString(),
    examinations: exams,
    resourceGroups: groups,
    resourceConfig: config,
    results,
  };
}

interface AppState {
  activePage: AppPage;
  scenarios: Scenario[];
  activeScenarioId: string;
  compareScenarioIds: string[];

  setActivePage: (page: AppPage) => void;
  setActiveScenario: (id: string) => void;

  updateExamination: (examId: string, patch: Partial<Examination>) => void;
  addExamination: (patch: Omit<Examination, 'id'>) => void;
  deleteExamination: (examId: string) => void;
  reorderExaminationsForDay: (day: DayNumber, orderedIds: string[]) => void;
  /** Sets participationPercent for many exams at once (examId → percent), one recalculation */
  applyParticipation: (levels: Record<string, number>) => void;

  updateOpeningHours: (weekday: Weekday, intervals: TimeInterval[]) => void;
  updateStaff: (patch: Partial<StaffConfig>) => void;
  updateScheduleConfig: (patch: Partial<ScheduleConfig>) => void;
  updateDailyBusiness: (patch: Partial<DailyBusinessConfig>) => void;

  updateResourceGroup: (groupId: string, patch: Partial<ResourceGroup>) => void;
  addResourceGroup: (group: Omit<ResourceGroup, 'id'>) => void;
  deleteResourceGroup: (groupId: string) => void;

  createScenario: (name: string, baseId?: string) => void;
  deleteScenario: (id: string) => void;
  renameScenario: (id: string, name: string) => void;
  toggleCompareScenario: (id: string) => void;

  recalculate: () => void;
  getActiveScenario: () => Scenario | undefined;
  getResults: () => WeeklyCapacityResult | null;
}

// Suppress unused import warnings
type _ResourceConfig = ResourceConfig;
void (0 as unknown as _ResourceConfig);

export const useAppStore = create<AppState>()(
  persist(
    immer((set, get) => ({
      activePage: 'dashboard' as AppPage,
      scenarios: [makeDefaultScenario()],
      activeScenarioId: 'default',
      compareScenarioIds: [] as string[],

      setActivePage: (page) => set(state => { state.activePage = page; }),
      setActiveScenario: (id) => set(state => { state.activeScenarioId = id; }),

      getActiveScenario: () => {
        const state = get();
        return state.scenarios.find(s => s.id === state.activeScenarioId);
      },

      getResults: () => {
        const state = get();
        const scenario = state.scenarios.find(s => s.id === state.activeScenarioId);
        return scenario?.results ?? null;
      },

      recalculate: () => set(state => {
        const scenario = state.scenarios.find(s => s.id === state.activeScenarioId);
        if (!scenario) return;
        scenario.results = calculateCapacity(
          scenario.examinations,
          scenario.resourceGroups,
          scenario.resourceConfig,
        );
      }),

      updateExamination: (examId, patch) => set(state => {
        const scenario = state.scenarios.find(s => s.id === state.activeScenarioId);
        if (!scenario) return;
        const exam = scenario.examinations.find(e => e.id === examId);
        if (!exam) return;
        Object.assign(exam, patch);
        // The device role only exists inside device_count groups
        if (patch.resourceGroupId) {
          const isDevice = scenario.resourceGroups.find(g => g.id === exam.resourceGroupId)?.groupType === 'device_count';
          exam.deviceRole = isDevice ? (exam.deviceRole ?? 'attach') : undefined;
        }
        scenario.results = calculateCapacity(scenario.examinations, scenario.resourceGroups, scenario.resourceConfig);
      }),

      addExamination: (patch) => set(state => {
        const scenario = state.scenarios.find(s => s.id === state.activeScenarioId);
        if (!scenario) return;
        const newId = `exam-${Date.now()}`;
        const newExam: Examination = { id: newId, ...patch };
        scenario.examinations.push(newExam);
        // Add to resource group's examinationIds
        const group = scenario.resourceGroups.find(g => g.id === patch.resourceGroupId);
        if (group && !group.examinationIds.includes(newId)) {
          group.examinationIds.push(newId);
        }
        scenario.results = calculateCapacity(scenario.examinations, scenario.resourceGroups, scenario.resourceConfig);
      }),

      deleteExamination: (examId) => set(state => {
        const scenario = state.scenarios.find(s => s.id === state.activeScenarioId);
        if (!scenario) return;
        scenario.examinations = scenario.examinations.filter(e => e.id !== examId);
        // Remove from all resource groups
        for (const group of scenario.resourceGroups) {
          group.examinationIds = group.examinationIds.filter(id => id !== examId);
        }
        // Clear any mustFollowExamId references to this exam
        for (const exam of scenario.examinations) {
          if (exam.mustFollowExamId === examId) {
            exam.mustFollowExamId = null;
          }
        }
        scenario.results = calculateCapacity(scenario.examinations, scenario.resourceGroups, scenario.resourceConfig);
      }),

      applyParticipation: (levels) => set(state => {
        const scenario = state.scenarios.find(s => s.id === state.activeScenarioId);
        if (!scenario) return;
        for (const exam of scenario.examinations) {
          if (exam.id in levels) exam.participationPercent = levels[exam.id];
        }
        scenario.results = calculateCapacity(scenario.examinations, scenario.resourceGroups, scenario.resourceConfig);
      }),

      reorderExaminationsForDay: (day, orderedIds) => set(state => {
        const scenario = state.scenarios.find(s => s.id === state.activeScenarioId);
        if (!scenario) return;
        orderedIds.forEach((id, index) => {
          const exam = scenario.examinations.find(e => e.id === id);
          if (exam) exam.order = index + 1;
        });
        // Order is the scheduler's tie-breaker, so it can change validated capacity
        scenario.results = calculateCapacity(scenario.examinations, scenario.resourceGroups, scenario.resourceConfig);
      }),

      updateOpeningHours: (weekday, intervals) => set(state => {
        const scenario = state.scenarios.find(s => s.id === state.activeScenarioId);
        if (!scenario) return;
        scenario.resourceConfig.openingHours[weekday] = intervals;
        scenario.results = calculateCapacity(scenario.examinations, scenario.resourceGroups, scenario.resourceConfig);
      }),

      updateStaff: (patch) => set(state => {
        const scenario = state.scenarios.find(s => s.id === state.activeScenarioId);
        if (!scenario) return;
        Object.assign(scenario.resourceConfig.staff, patch);
        scenario.results = calculateCapacity(scenario.examinations, scenario.resourceGroups, scenario.resourceConfig);
      }),

      updateScheduleConfig: (patch) => set(state => {
        const scenario = state.scenarios.find(s => s.id === state.activeScenarioId);
        if (!scenario) return;
        Object.assign(scenario.resourceConfig.scheduleConfig, patch);
        scenario.results = calculateCapacity(scenario.examinations, scenario.resourceGroups, scenario.resourceConfig);
      }),

      updateDailyBusiness: (patch) => set(state => {
        const scenario = state.scenarios.find(s => s.id === state.activeScenarioId);
        if (!scenario?.resourceConfig.dailyBusiness) return;
        Object.assign(scenario.resourceConfig.dailyBusiness, patch);
        scenario.results = calculateCapacity(scenario.examinations, scenario.resourceGroups, scenario.resourceConfig);
      }),

      updateResourceGroup: (groupId, patch) => set(state => {
        const scenario = state.scenarios.find(s => s.id === state.activeScenarioId);
        if (!scenario) return;
        const group = scenario.resourceGroups.find(g => g.id === groupId);
        if (!group) return;
        Object.assign(group, patch);
        scenario.results = calculateCapacity(scenario.examinations, scenario.resourceGroups, scenario.resourceConfig);
      }),

      addResourceGroup: (group) => set(state => {
        const scenario = state.scenarios.find(s => s.id === state.activeScenarioId);
        if (!scenario) return;
        const newId = `group-${Date.now()}`;
        scenario.resourceGroups.push({ id: newId, ...group });
        scenario.results = calculateCapacity(scenario.examinations, scenario.resourceGroups, scenario.resourceConfig);
      }),

      deleteResourceGroup: (groupId) => set(state => {
        const scenario = state.scenarios.find(s => s.id === state.activeScenarioId);
        if (!scenario) return;
        const group = scenario.resourceGroups.find(g => g.id === groupId);
        if (!group || group.examinationIds.length > 0) return; // Cannot delete if exams assigned
        scenario.resourceGroups = scenario.resourceGroups.filter(g => g.id !== groupId);
        scenario.results = calculateCapacity(scenario.examinations, scenario.resourceGroups, scenario.resourceConfig);
      }),

      createScenario: (name, baseId) => set(state => {
        const base = state.scenarios.find(s => s.id === (baseId ?? state.activeScenarioId));
        if (!base) return;
        const newScenario: Scenario = structuredClone(current(base));
        newScenario.id = `scenario-${Date.now()}`;
        newScenario.name = name;
        newScenario.createdAt = new Date().toISOString();
        newScenario.results = calculateCapacity(newScenario.examinations, newScenario.resourceGroups, newScenario.resourceConfig);
        state.scenarios.push(newScenario);
        state.activeScenarioId = newScenario.id;
      }),

      deleteScenario: (id) => set(state => {
        if (state.scenarios.length <= 1) return;
        state.scenarios = state.scenarios.filter(s => s.id !== id);
        if (state.activeScenarioId === id) {
          state.activeScenarioId = state.scenarios[0].id;
        }
        state.compareScenarioIds = state.compareScenarioIds.filter(sid => sid !== id);
      }),

      renameScenario: (id, name) => set(state => {
        const scenario = state.scenarios.find(s => s.id === id);
        if (scenario) scenario.name = name;
      }),

      toggleCompareScenario: (id) => set(state => {
        const idx = state.compareScenarioIds.indexOf(id);
        if (idx >= 0) {
          state.compareScenarioIds.splice(idx, 1);
        } else if (state.compareScenarioIds.length < 2) {
          state.compareScenarioIds.push(id);
        }
      }),
    })),
    {
      name: 'process-calc-v18',
      partialize: (state) => ({
        scenarios: state.scenarios,
        activeScenarioId: state.activeScenarioId,
        compareScenarioIds: state.compareScenarioIds,
      }),
      // Saved data may predate newer fields and code: fill them in and recompute the results.
      merge: (persisted, current) => {
        const saved = persisted as Partial<AppState> | undefined;
        if (!saved?.scenarios?.length) return current;
        const scenarios = saved.scenarios.map(s => {
          const n = normalizeScenario(s);
          return { ...n, results: calculateCapacity(n.examinations, n.resourceGroups, n.resourceConfig) };
        });
        return { ...current, ...saved, scenarios };
      },
    },
  ),
);
