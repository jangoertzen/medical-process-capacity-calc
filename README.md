# Checkup-Engpassanalyse

Kapazitätsplanungstool für medizinische Vorsorgeuntersuchungen (Check-ups). Modelliert ein 3-Tage-Patientenprogramm mit überlappenden Kohorten und berechnet Ressourcenengpässe.

## Features

- **3-Wochen-Kapazitätsmodell**: Woche 1 (Anlauf), Woche 2 (Steady State, bindend), Woche 3 (Auslauf)
- **Gantt-Diagramm**: Tagesplan mit Patienten- und Raumansicht
- **Engpassanalyse**: Identifiziert limitierende Ressourcen und Wartezeitverursacher
- **Szenario-Vergleich**: Mehrere Konfigurationen parallel verwalten
- **Konfigurierbare Parameter**:
  - Kohortenstart-Wochentage und Besuchsabstände
  - Öffnungszeiten, Personal, Geräteanzahl
  - Langzeit-EKG/RR: Anteil der Patienten, Anlegen-Tag
  - Max. Aufenthaltsdauer pro Besuchstag
  - Optionale 5-Minuten-Pause zwischen Untersuchungen
  - Untersuchungsdauer je Examination (Slider + Eingabefeld)

## Ressourcenmodell

| Typ | Formel | Beispiel |
|-----|--------|----------|
| `time_based` | `floor(Geräte × Öffnungszeit / Zeit pro Patient)` | Ultraschall, Ergometrie |
| `staff_multiplied` | `floor(Personal × Öffnungszeit / Zeit pro Patient)` | Arzt-Sprechzeit, Blutentnahmen |
| `device_count` | `floor(Geräteanzahl / LZ-Anteil)` | Langzeit-EKG/-RR |

## Tech Stack

- React 19 + TypeScript
- Zustand (State Management mit immer + persist)
- Vite + Tailwind CSS v4
- Keine externen Chart-Libraries — Gantt ist custom SVG/DOM

## Entwicklung

```bash
npm install
npm run dev        # Dev-Server auf localhost:5173
npm run build      # TypeScript-Check + Vite-Build
npm run lint       # ESLint
```

## Architektur

```
defaultData.ts  →  appStore.ts  →  calculator.ts  →  UI-Komponenten
(Standarddaten)    (Zustand/immer)   (Kapazität)      (Dashboard, Gantt, etc.)
                                  →  scheduler.ts
                                     (Tagesplanung)
```

State wird in `localStorage` persistiert. Jede Konfigurationsänderung löst sofort eine Neuberechnung aus.
