import type { Scenario } from '@/types';
import { defaultDailyBusiness } from '@/data/defaultData';

/**
 * Fills the data fields that replaced name/id heuristics (Examination.deviceRole,
 * Examination.scheduleLast, ResourceGroup.staffType) for scenarios saved or exported
 * before those fields existed. Only fills what is missing, so it is idempotent and never
 * overrides an explicit choice. This is the ONLY place the old heuristics live.
 */
export function normalizeScenario(scenario: Scenario): Scenario {
  const groupById = new Map(scenario.resourceGroups.map(g => [g.id, g]));

  const examinations = scenario.examinations.map(e => {
    const name = e.name.toLowerCase();
    const inDeviceGroup = groupById.get(e.resourceGroupId)?.groupType === 'device_count';
    return {
      ...e,
      deviceRole: e.deviceRole ?? (inDeviceGroup
        ? (name.includes('abnehmen') || name.includes('abnahme') ? 'return' as const : 'attach' as const)
        : undefined),
      scheduleLast: e.scheduleLast ?? name.includes('abschlussgespräch'),
    };
  });

  const resourceGroups = scenario.resourceGroups.map(g => {
    if (g.groupType !== 'staff_multiplied' || g.staffType) return g;
    const hasDoctor = examinations.some(e => e.resourceGroupId === g.id && e.staffRole === 'Arzt');
    return {
      ...g,
      staffType: hasDoctor ? 'doctorCount' as const
        : g.id === 'mfa-kapazitat' ? 'mfaLabor' as const
        : 'mfaFunktionsdiagnostik' as const,
    };
  });

  // Daily business (added later): off by default, doctor groups get the default 15 min per appointment
  const resourceConfig = scenario.resourceConfig.dailyBusiness
    ? scenario.resourceConfig
    : {
        ...scenario.resourceConfig,
        dailyBusiness: {
          ...structuredClone(defaultDailyBusiness),
          minutesPerAppointment: Object.fromEntries(
            resourceGroups.filter(g => g.staffType === 'doctorCount').map(g => [g.id, 15]),
          ),
        },
      };

  return { ...scenario, examinations, resourceGroups, resourceConfig };
}
