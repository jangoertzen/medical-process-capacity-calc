import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { persist } from 'zustand/middleware';
import type {
  Scenario,
  Examination,
  ResourceConfig,
  AppPage,
  Weekday,
  StaffConfig,
  GroupOverride,
  WeeklyCapacityResult,
  ScheduleConfig,
} from '@/types';
import { defaultExaminations, defaultResourceGroups, defaultResourceConfig } from '@/data/defaultData';
import { calculateCapacity } from '@/lib/calculator';

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
  updateOpeningHours: (weekday: Weekday, minutes: number) => void;
  updateStaff: (patch: Partial<StaffConfig>) => void;
  updateGroupOverride: (groupId: string, patch: GroupOverride) => void;
  updateScheduleConfig: (patch: Partial<ScheduleConfig>) => void;

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
        scenario.results = calculateCapacity(scenario.examinations, scenario.resourceGroups, scenario.resourceConfig);
      }),

      updateOpeningHours: (weekday, minutes) => set(state => {
        const scenario = state.scenarios.find(s => s.id === state.activeScenarioId);
        if (!scenario) return;
        scenario.resourceConfig.openingHours[weekday] = minutes;
        scenario.results = calculateCapacity(scenario.examinations, scenario.resourceGroups, scenario.resourceConfig);
      }),

      updateStaff: (patch) => set(state => {
        const scenario = state.scenarios.find(s => s.id === state.activeScenarioId);
        if (!scenario) return;
        Object.assign(scenario.resourceConfig.staff, patch);
        scenario.results = calculateCapacity(scenario.examinations, scenario.resourceGroups, scenario.resourceConfig);
      }),

      updateGroupOverride: (groupId, patch) => set(state => {
        const scenario = state.scenarios.find(s => s.id === state.activeScenarioId);
        if (!scenario) return;
        const current = scenario.resourceConfig.groupOverrides[groupId] ?? {};
        scenario.resourceConfig.groupOverrides[groupId] = { ...current, ...patch };
        scenario.results = calculateCapacity(scenario.examinations, scenario.resourceGroups, scenario.resourceConfig);
      }),

      updateScheduleConfig: (patch) => set(state => {
        const scenario = state.scenarios.find(s => s.id === state.activeScenarioId);
        if (!scenario) return;
        Object.assign(scenario.resourceConfig.scheduleConfig, patch);
        scenario.results = calculateCapacity(scenario.examinations, scenario.resourceGroups, scenario.resourceConfig);
      }),

      createScenario: (name, baseId) => set(state => {
        const base = state.scenarios.find(s => s.id === (baseId ?? state.activeScenarioId));
        if (!base) return;
        const newScenario: Scenario = structuredClone(base);
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
      name: 'process-calc-v11',
      partialize: (state) => ({
        scenarios: state.scenarios,
        activeScenarioId: state.activeScenarioId,
        compareScenarioIds: state.compareScenarioIds,
      }),
    },
  ),
);
