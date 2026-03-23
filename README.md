# Checkup-Engpassanalyse

Kapazitätsplanungstool für medizinische Vorsorgeuntersuchungen (Check-ups). Modelliert ein 3-Tage-Patientenprogramm mit überlappenden Kohorten, berechnet Ressourcenengpässe und visualisiert den Tagesablauf.

---

## Screenshots

### Dashboard — Kapazitätsübersicht

![Dashboard](docs/screenshots/dashboard.png)

Das Dashboard zeigt die berechnete Wochenkapazität, den limitierenden Engpass, Umsatzschätzungen und die wichtigsten Steuerparameter auf einen Blick.

### Untersuchungen — Tagesplan-Editor

![Untersuchungen](docs/screenshots/untersuchungen.png)

Alle Untersuchungen werden per Drag & Drop in drei Tages-Spalten (Tag 1 / Tag 2 / Tag 3) angeordnet. Neue Untersuchungen lassen sich direkt in der jeweiligen Spalte anlegen.

![Untersuchungen Detail](docs/screenshots/untersuchungen-detail.png)

Jede Untersuchungskarte zeigt Dauer, Rolle, Beteiligungsquote (% der Patienten) und Umsatz. Aufgeklappt werden alle Parameter inline bearbeitet — inklusive Ressourcengruppe, Parallelisierung und Abhängigkeit zu einer Vorgängeruntersuchung.

### Ressourcen — Öffnungszeiten & Personal

![Ressourcen](docs/screenshots/ressourcen.png)

Öffnungszeiten werden als echte Uhrzeiten (HH:MM) eingegeben. Pro Wochentag können mehrere Zeitintervalle definiert werden (z. B. 08:00–12:00 und 15:00–18:00). Zusätzlich werden Personalstärken und der Patientenplan konfiguriert.

### Szenarien — Vergleich mehrerer Konfigurationen

![Szenarien](docs/screenshots/szenarien.png)

Beliebig viele Szenarien lassen sich anlegen, benennen und nebeneinander vergleichen. So können z. B. unterschiedliche Gerätezahlen oder Öffnungszeiten direkt gegenübergestellt werden.

### Diagramme — Sensitivitätsanalyse & Tagesplan

![Diagramme](docs/screenshots/diagramme.png)

Die Sensitivitätsdiagramme zeigen, wie sich die Kapazität bei variierenden Gerätezahlen oder Personalstärken verändert.

![Diagramme Tagesplan](docs/screenshots/diagramme-tagesplan.png)

Der Tagesplan-Tab visualisiert den geplanten Ablauf eines Besuchstages mit allen Untersuchungen und Patienten.

---

## Features

- **Drag & Drop Tagesplan**: Untersuchungen per Maus zwischen Tag 1 / 2 / 3 verschieben und innerhalb eines Tages sortieren
- **Vollständiges CRUD für Untersuchungen**: Neue Untersuchungen anlegen, bearbeiten, löschen; Abhängigkeiten ("folgt nach") konfigurieren
- **Beteiligungsquote pro Untersuchung**: Für jede Untersuchung einzeln einstellbar, bei wie viel Prozent der Patienten sie stattfindet (z. B. 60 % für LZ-EKG)
- **Flexible Öffnungszeiten**: Mehrere Zeitintervalle pro Tag (Vor- und Nachmittagszeiten), Eingabe als HH:MM
- **Gerätekonfiguration im Untersuchungsreiter**: Anzahl der Geräte/Räume direkt bei der jeweiligen Ressourcengruppe
- **3-Wochen-Kapazitätsmodell**: Woche 1 (Anlauf), Woche 2 (Steady State, bindend), Woche 3 (Auslauf)
- **Engpassanalyse**: Identifiziert automatisch die limitierende Ressource
- **Szenario-Vergleich**: Mehrere Konfigurationen parallel verwalten und gegenüberstellen
- **Sensitivitätsanalyse**: Diagramme für Geräte- und Personalvariationen
- **Gantt-Tagesplan**: Simulierter Ablauf eines Besuchstages
- **Export-fähig**: Vollständige Neuberechnung bei jeder Parameteränderung, keine manuellen Refreshs nötig

---

## Ressourcenmodell

| Typ | Formel | Beispiel |
|-----|--------|----------|
| `time_based` | `⌊Geräte × Öffnungsminuten / Gesamtbedarf pro Patient⌋` | Ultraschall, Ergometrie, Funktionsraum |
| `staff_multiplied` | `⌊Personal × Öffnungsminuten / Gesamtbedarf pro Patient⌋` | Arzt-Sprechzeit, MFA-Kapazität |
| `device_count` | `⌊Geräteanzahl / Beteiligungsquote⌋` | Langzeit-EKG, Langzeit-RR |

Die optimalen Besuchsabstände (Tag-2-Abstand, Tag-3-Abstand, LZ-Anlegen-Tag) werden automatisch berechnet — das System wählt die Kombination mit der höchsten Kapazität.

---

## Architektur

```
defaultData.ts  →  appStore.ts  →  calculator.ts  →  UI-Komponenten
(Standarddaten)    (Zustand/immer)   (Kapazität)      (Dashboard, Diagramme, …)
                                  →  scheduler.ts
                                     (Tagesplanung)
```

- **State** lebt vollständig in `src/store/appStore.ts` (Zustand + immer, persistiert in `localStorage`)
- **Jede Parameteränderung** löst sofort eine Neuberechnung aus (`calculateCapacity()`)
- **Keine Backend-Abhängigkeit** — läuft vollständig im Browser

### Verzeichnisstruktur

```
src/
  data/         # Standarddaten (Untersuchungen, Ressourcengruppen)
  lib/          # Kapazitätsrechner (calculator.ts) und Scheduler (scheduler.ts)
  pages/        # Dashboard, Untersuchungen, Ressourcen, Szenarien, Diagramme
  components/   # Charts, Layout (Sidebar), Szenario-Vergleich
  store/        # Zustand-Store mit allen Aktionen
  types/        # TypeScript-Interfaces
```

---

## Tech Stack

- **React 19** + TypeScript
- **Zustand 5** (State Management mit immer + localStorage-Persistenz)
- **@dnd-kit/core + @dnd-kit/sortable** (Drag & Drop)
- **Vite** + **Tailwind CSS v4**
- Keine externen Chart-Libraries — Gantt und Balkendiagramme sind custom SVG/DOM

---

## Entwicklung

```bash
npm install
npm run dev        # Dev-Server auf http://localhost:5173
npm run build      # TypeScript-Check + Vite-Build
npm run lint       # ESLint
npm run preview    # Produktions-Build vorschauen
```

---

## Hinweise

- Die App ist für den **internen Praxisbetrieb** konzipiert, nicht für den öffentlichen Einsatz.
- Alle Daten bleiben lokal im Browser (`localStorage`). Es werden keine Daten an externe Server übertragen.
- Beim ersten Start werden Standardwerte geladen, die direkt angepasst werden können.

---

© Dr. Jan Görtzen-Patin 2026. All rights reserved. Internal use only.
