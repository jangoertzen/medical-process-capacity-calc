# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev        # Start dev server at localhost:5173
npm run build      # Type-check (tsc -b) then Vite build
npm run lint       # ESLint
npm run preview    # Preview production build
```

There are no tests. There is no test runner configured.

## Architecture

This is a **single-page React app** for medical check-up capacity analysis. It models a 3-day patient program (Tag 1/2/3) with overlapping patient cohorts running concurrently across the week.

### Data Flow

```
defaultData.ts  →  appStore.ts  →  calculator.ts  →  UI components
(typed defaults)   (Zustand/immer)   (pure fn)        (pages + components)
```

State lives entirely in **`src/store/appStore.ts`** (Zustand + immer + persist to `localStorage` key `process-calc-v6`). Every mutation calls `calculateCapacity()` immediately and stores results in `scenario.results`. The store is never read directly from components — always via `useAppStore(selector)`.

### Core Calculation Model (`src/lib/calculator.ts`)

The capacity model is **concurrent cohorts**: on any weekday, patients from multiple cohorts (started on different days) are present simultaneously, each at a different stage (Tag 1, 2, or 3).

Key concepts:
- **`stageOrder`** (`[1,2,3]` or `[1,3,2]`): which patient stage occurs at each day-offset from the cohort start day. Swapping T2/T3 moves the Abschlussgespräch earlier.
- **`startDays`**: which weekdays new cohorts begin (e.g. Mon/Tue/Wed). `weeklyThroughput = maxPatientsPerCohort × startDays.length`.
- **`device_count` groups** (Langzeit-EKG, Langzeit-RR): hard cap = `floor(deviceCount / maxConcurrentDeviceCohorts)`. The device is loaned overnight — `deviceLoanDurationNights` determines how many cohorts hold devices simultaneously.
- **`time_based` groups** (Funktionsraum, Ultraschall/arzt-sono): `floor(deviceCount × openingMinutes / totalDemandPerPatient)`. `arzt-sono` is `time_based` with `deviceCount=1` because there is only 1 ultrasound machine — all sono exams queue through it regardless of how many doctors are available.
- **`staff_multiplied` groups** (Arzt-Sprechzeit, MFA-Kapazität): `floor(staffCount × openingMinutes / totalDemandPerPatient)`.

**Parallel step resolution** (`resolveSteps`): When exam A has `parallelWith=B` AND B has `parallelWith=A` AND they share the same `resourceGroupId`, they merge into one step with `duration = max(A, B)`. Cross-group parallel exams (e.g. LZ-EKG anlegen ↔ LZ-RR anlegen, which are in different groups) each create independent steps in their own group.

### Types (`src/types/index.ts`)

All interfaces are in one file. Key ones:
- `Examination`: one row in the exam table — `day` (1/2/3), `parallelWith` (exam name), `resourceGroupId`
- `ResourceGroup`: groups exams for capacity calculation — `groupType` determines the formula
- `ScheduleConfig`: `startDays` + `visitDayOffsets` + `lzAnlegenDay`
- `WeeklyCapacityResult` → `WeekdayCapacityResult[]` → `ResourceCapacityResult[]`

### Routing & Pages (`src/App.tsx`)

Hash-based navigation via react-router-dom. Pages: `dashboard`, `untersuchungen`, `ressourcen`, `szenarien`, `diagramme`, `import`.

### Styling

**Tailwind CSS v4** via `@tailwindcss/vite` plugin — no `tailwind.config.js`. Most components use inline styles (`style={{...}}`) rather than Tailwind class names. Radix UI primitives are available but rarely used — prefer inline styles for consistency.

### State Persistence

localStorage key is **`process-calc-v6`**. Bump the version key in `appStore.ts` when making breaking changes to the persisted state shape (`scenarios`, `activeScenarioId`, `compareScenarioIds`).

### Path Alias

`@/` resolves to `src/` (configured in both `vite.config.ts` and `tsconfig.json`).
