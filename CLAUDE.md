# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Deep dive on the model (formulas, scheduler, worked example, known limits): [`docs/FUNKTIONSWEISE.md`](docs/FUNKTIONSWEISE.md) (German). UI/user docs: [`README.md`](README.md).

## Commands

```bash
npm run dev        # Start dev server at localhost:5173
npm run build      # Type-check (tsc -b) then Vite build
npm run preview    # Preview production build
npm run lint       # ESLint 9 flat config (eslint.config.js); passes on a clean checkout
node scripts/take-screenshots.mjs   # Regenerates docs/screenshots; expects the app on :5173
```

There are no tests and no test runner. `npx tsc -b` and `npm run lint` are the only automated checks (both pass on a clean checkout).

## Architecture

Single-page React 19 app (all UI text is German) for medical check-up capacity analysis. It models a 3-day patient program (Tag 1/2/3, optionally 2 days) with overlapping patient cohorts running concurrently across the week. No backend; all data lives in the browser.

### Data Flow

```
defaultData.ts  →  appStore.ts  →  calculator.ts  →  UI components
(typed defaults)   (Zustand/immer)   (pure fn)        (pages + components)
                                  →  scheduler.ts (called by calculator for validation, and by UI for Gantt/wait times)
```

State lives in **`src/store/appStore.ts`** (Zustand + immer + `persist` to `localStorage` key **`process-calc-v18`**). Nearly every mutation calls `calculateCapacity()` immediately and stores the result in `scenario.results` (exceptions: `reorderExaminationsForDay`, `renameScenario`, compare toggles). Components read only via `useAppStore(selector)`.

A **Scenario** = examinations + resource groups + resource config + `results`. The header dropdown switches the active scenario; all edits apply to the active one. Comparison is limited to exactly 2 scenarios (`toggleCompareScenario`).

### Core Calculation Model (`src/lib/calculator.ts`)

**Concurrent cohorts**: on any weekday, patients from several cohorts (started on different days) are present, each in a different stage (Tag 1/2/3). Time is counted in **working days** (Mon–Fri, no weekends); offset 5 = same weekday next week.

- **`startDays`**: weekdays on which cohorts start. `weeklyThroughput = maxPatientsPerCohort × startDays.length`.
- **`visitDayOffsets` / `lzAnlegenDay`**: NOT user inputs. `calculateCapacity` grid-searches all valid combos (Tag 2: 1–5 d; Tag 3: Tag2+1…Tag2+5 d; `lzAnlegenDay` 1 or 2; for 2-day programs only Tag 2) and keeps the highest capacity (first wins on ties). Result: `results.bestVisitDayOffsets`, `results.bestLzAnlegenDay`. Always run a scenario through `applyBestSchedule(scenario)` (calculator.ts) before handing it to the scheduler/Gantt; Dashboard, Diagramme > Tagesplan and ScenarioCompare do.
- **`programDays` (2|3)**: when 2, `applyProgramDays` moves all Tag-3 exams to Tag 2. Toggle "Programmdauer" on Dashboard and Ressourcen.
- **Capacity per `groupType`** (patients per cohort):
  - `device_count` (Langzeit-EKG/RR): `floor(deviceCount / participation)`, only on weekdays where the attach stage (`deviceRole='attach'`) is active. `deviceRole='return'` exams are ignored (no device-return scheduling).
  - `time_based` (Funktionsraum, Ultraschall, Ergometrie): `floor(deviceCount × openingMinutes / demandPerPatient)`. `arzt-sono` has `deviceCount=1` because there is one ultrasound machine — all sono exams serialize through it.
  - `staff_multiplied` (Arztgespräch, Blutentnahmen): `floor(staffCount × openingMinutes / demandPerPatient)`; `getStaffCount` reads `group.staffType`.
  - Every `ResourceCapacityResult` carries `rawCapacity` (unrounded) next to `limitingCapacity` (its floor).
- **Demand per patient** = sum over active stages of step durations × `participationPercent/100`.
- **Bottleneck**: capacity is evaluated for Week 2 (steady state) only; `N` = min over all resources and weekdays (one `N` for the whole week). `isBottleneck` marks the resource(s) with the tightest *analytical* capacity (before scheduler validation), so a name exists even if the scheduler lowered `N`. The dashboard's *displayed* bottlenecks come from a +1-unit sensitivity run (`computeQuickThroughput`, which is now just `calculateCapacity(...).weeklyThroughput`, i.e. validated), not from `isBottleneck`.
- **Scheduler validation**: after the analytical `N`, `scheduleFitsOpeningHours` builds the Week-2 schedule and decrements `N` while any exam ends after `openingMinutes` (this is where `maxStayMinutes`, `breakBetweenExams` and waiting take effect).

**Parallel step resolution** (`resolveSteps`): exams A and B merge into one step (`duration = max`) only if `A.parallelWith=B`, `B.parallelWith=A` **and** same `resourceGroupId`. Cross-group partners (LZ-EKG ↔ LZ-RR anlegen) stay separate steps in the calculator. The scheduler (`buildExamBlocks`) merges mutual partners regardless of group and occupies both groups at once.

### Scheduler (`src/lib/scheduler.ts`)

`buildWeekSchedule(exams, groups, config, nPatients)` → `WeekdaySchedule[]` for abs days 0–14 (Week 1 ramp-up, Week 2 steady state, Week 3 ramp-down). Times are **minutes since opening** on a timeline with closed gaps between opening intervals removed; blocks never straddle a gap; `toClockMin` (calculator.ts) converts back to clock times (Gantt uses it). Exams are sorted by `order` (tie-breaker of the greedy choice). Greedy per patient: contended blocks first, independent blocks into gaps, then blocks with a `mustFollowExamId` predecessor (after it), "Abschlussgespräch" last; stages with more exams are scheduled first. Resource lanes = `deviceCount` / `getStaffCount` (`device_count` groups = 1 lane). `analyzeScheduleDay` derives `actualSlots` and wait times per group.

### Data-driven special behaviour (no name/id matching)

Special cases are data fields, editable in the Untersuchungen page: `Examination.deviceRole` (`attach`/`return`, only in `device_count` groups; drives Langzeit attach/return handling), `Examination.scheduleLast` (scheduled last, e.g. Abschlussgespräch), `ResourceGroup.staffType` (which `StaffConfig` pool serves a `staff_multiplied` group), `Examination.participationPercent` (per-exam, also in the scheduler: patient `p` gets the exam if `p < round(N × pct)`). Groups/exams can be renamed freely. Saved/imported data that predates these fields is upgraded by `normalizeScenario` (`src/lib/normalize.ts`, the only place with the old name/id heuristics); the store's `persist.merge` also recomputes all results on load. New optional fields belong there. Only cosmetic leftovers remain: `ROOM_ORDER` in the Gantt (room display order) and the default group ids in `defaultData.ts`. Sensitivity/bottleneck analysis raises all `device_count` groups together. `Examination.deviceCount` (optional, > 0) gives one exam its own devices: an extra capacity row `device:<examId>` in `computeDayResources` (`deviceCount × opening / (duration × participation)`, only when the exam's stage is active) and an extra scheduler lane set under the same key (`resourceKeys` in scheduler.ts, `examDeviceKey`/`hasOwnDevices` in calculator.ts); it is additive to the group's shared room/staff. Not used for exams in `device_count` groups (the store clears it when an exam moves there). Dashboard bottleneck detection and Diagramme sensitivity include these devices.

### Fields stored but not used by the model

`Examination.isAssumedDefault`, `ResourceGroup.note`; `ResourceGroup.slotsPerDay` only serves as fallback device count. (`mustFollowExamId` and `order` are used by the scheduler only, not by the analytical calculator.)

### Revenue optimizer (`src/lib/optimizer.ts`, page `src/pages/Optimierung.tsx`)

`optimizeParticipation(scenario, maxWeeklyPatients)` maximizes `min(weeklyCapacity, demandCap) × Σ revenueEur × pct` over per-exam participation levels in 10 % steps within `Examination.participationMin/Max` (default 0/100). Both patient count and percentages are free; the demand cap is what keeps it sensible (without it the optimum strips nearly all exams). Heuristic: greedy descent (uses unrounded `rawCapacity` of the binding resources to break rounding plateaus) + local search (single and pair moves), started from the upper bounds and from the current values. `return`-role exams are not variables; they mirror their attach exam. For speed the search holds the visit-offset/LZ-day combination fixed (`CapacityOptions.fixedCombo`, `analyticCapacity`) and uses the demand cap as `CapacityOptions.maxPatientsPerCohort`; candidates and all reported numbers are re-evaluated with the full `calculateCapacity`. It never recommends less revenue than the current setting. The page runs it on click (about 0.3–2 s), marks the result stale on any scenario change, and applies levels via the store action `applyParticipation` (optionally into a new scenario first). Quality check used during development: matches the best of 40 random-restart hill climbs.

### Daily business (`ResourceConfig.dailyBusiness`, `src/lib/dailyBusiness.ts`, page `src/pages/Tagesgeschaeft.tsx`)

Regular 15-min patient appointments next to the check-ups; switch `enabled` (default off, so results are unchanged). Config: `appointmentsPerDay` (demand, per weekday), `fluctuationPercent`, `valuePerAppointmentEur`, `minutesPerAppointment` (per resource group id; only `time_based`/`staff_multiplied` groups; default: doctor groups 15), optional `reservedPerDay`. When enabled, `calculator.ts` subtracts `reservedMinutes(config, groupId, weekday)` from each group's day capacity before dividing by the check-up demand per patient (`computeDayResources`), so it flows into N, bottlenecks, dashboard, sensitivity and the participation optimizer. Reserved appointments per day = `reservedPerDay[wd]` if set, else the peak demand `appointmentsPerDay × (1 + fluctuation)`. The scheduler is unaffected (it only places check-ups). `analyzeDailyBusiness(scenario)` (pure) returns three plans (check-ups only / current / optimal); optimum = argmax over check-up cohort size N of `N × starts × revenuePerPatient + Σ_wd value × E[min(D, r_wd(N))]` with `r_wd(N)` = largest reservation ≤ peak that fits next to N patients; demand `D` is uniform on `d(1±f)`, closed form in `expectedServed`. The result is re-verified with `calculateCapacity`. `blockedSlots(scenario, calc, reserved)` derives per weekday and 15-min slot how many appointments fit next to the Week-2 check-up schedule (from the scheduler) and spreads the reserved appointments over the free slots (largest remainder); this is the heatmap. Old scenarios get the config via `normalizeScenario`; store action `updateDailyBusiness`. Slot view treats the reservation per slot fractionally (fragmentation of 5/10-min check-up blocks is not modelled).

### Types (`src/types/index.ts`)

All interfaces in one file: `Examination`, `ResourceGroup` (`groupType` picks the formula), `ResourceConfig` (`openingHours` = intervals per weekday in minutes since midnight, `staff`, `scheduleConfig`), `Scenario`, `WeeklyCapacityResult` → `WeekdayCapacityResult[]` → `ResourceCapacityResult[]`, plus `threeWeekData: DayCapacityResult[]`.

### Routing & Pages (`src/App.tsx`)

`BrowserRouter` (path-based, not hash-based) with `Sidebar` + `Header` layout and an `ErrorBoundary`. Routes: `/dashboard` (default), `/untersuchungen`, `/ressourcen`, `/szenarien`, `/diagramme`, `/optimierung`, `/tagesgeschaeft`, `/import-export`. The `AppPage`/`activePage` state in the store is vestigial; navigation is driven by the URL. `components/dashboard/WeeklyGrid.tsx` is an empty stub.

### Styling

**Tailwind CSS v4** via `@tailwindcss/vite` (no `tailwind.config.js`), but nearly all components use inline `style={{...}}`. Match that. Charts: `recharts` only in `ResourceSensitivityChart`; the Gantt is custom DOM.

### State Persistence & Import/Export

Persisted: `scenarios`, `activeScenarioId`, `compareScenarioIds` (via `partialize`). When the persisted shape changes, bump the key **in two places**: `name` in `appStore.ts` and `version` + `storeKey` in `src/pages/ImportExport.tsx`. Import validates minimal shape, recomputes results, writes straight to `localStorage`, then reloads the page.

### Path Alias

`@/` resolves to `src/` (configured in both `vite.config.ts` and `tsconfig.json`).

### Repo extras

`Checkup_Engpassanalyse_einfach.xlsx` is the original slot-based Excel model the defaults came from (sheets Untersuchungen / Ressourcen / Anleitung); the app supersedes it. Not read by any code.
