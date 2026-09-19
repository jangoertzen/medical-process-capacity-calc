# Funktionsweise der Kapazitätsberechnung

Dieses Dokument erklärt, **wie die App rechnet** und warum sie bestimmte Zahlen anzeigt. Es beschreibt den Stand des Codes (Store-Version `process-calc-v18`) und nennt am Ende bekannte Grenzen. Für Installation und Überblick siehe [README](../README.md).

---

## 1. Worum es geht

Ein Check-up besteht aus **3 Besuchstagen** (Tag 1, Tag 2, Tag 3), optional 2. Neue Patienten starten an bestimmten Wochentagen (**Startdays**). Eine Gruppe, die am selben Tag startet, heißt **Kohorte**. Weil Kohorten an mehreren Tagen starten und die Besuchstage zeitlich versetzt liegen, sind an einem normalen Wochentag **Patienten aus mehreren Kohorten gleichzeitig in der Praxis**, jede in einer anderen Phase:

```
            Mo      Di      Mi      Do      Fr
Kohorte Mo  Tag 1   Tag 2   Tag 3
Kohorte Di          Tag 1   Tag 2   Tag 3
Kohorte Mi                  Tag 1   Tag 2   Tag 3
Kohorte Do                          Tag 1   Tag 2   (Tag 3 in der Folgewoche)
Kohorte Fr                                  Tag 1   (Tag 2/3 in der Folgewoche)
```

Am Mittwoch laufen also Tag 1 (Kohorte Mi), Tag 2 (Kohorte Di) und Tag 3 (Kohorte Mo) parallel und teilen sich Ärzte, Ultraschall, Funktionsraum usw. Das Schema gilt bei Abstand 1 (aufeinanderfolgende Tage); der Rechner wählt den Abstand selbst (Abschnitt 4.4).

**Die zentrale Frage:** Wie viele Patienten (`N`) darf jede Kohorte höchstens haben, damit an *jedem* Wochentag *jede* Ressource ausreicht? Daraus folgt:

```
Wochendurchsatz = N × Anzahl Kohortenstart-Wochentage
```

Zeit wird in **Arbeitstagen** gerechnet (Mo–Fr, kein Wochenende). „Abstand 5“ bedeutet: gleicher Wochentag der Folgewoche.

---

## 2. Datenfluss

```
defaultData.ts ──► appStore.ts ──► calculator.ts ──► Seiten/Komponenten
  Startwerte        Zustand          Kapazität          Anzeige
                    + Persistenz  ──► scheduler.ts ──►  (Gantt, Wartezeiten)
```

- **`src/store/appStore.ts`** hält alle Szenarien (Zustand + immer) und speichert sie in `localStorage` unter `process-calc-v18`. **Jede Mutation** (Untersuchung ändern, Öffnungszeit, Personal, Gerätezahl …) ruft sofort `calculateCapacity()` auf und legt das Ergebnis in `scenario.results` ab. Nur Szenario-Umbenennen und -Auswahl rechnen nicht neu (Umsortieren per Drag & Drop schon, weil `order` den Scheduler beeinflusst).
- **`calculator.ts`** ist eine reine Funktion ohne Seiteneffekte. Sie liefert die *analytische* Kapazität und ruft zur Absicherung den Scheduler auf.
- **`scheduler.ts`** baut einen konkreten Tagesablauf (wer steht wann in welchem Raum). Er dient zwei Zwecken: (a) Plausibilitätsprüfung der Kapazität, (b) Anzeige (Gantt, Wartezeiten).
- Komponenten lesen ausschließlich per Selektor `useAppStore(s => …)`.

---

## 3. Das Datenmodell (`src/types/index.ts`)

| Typ | Bedeutung |
|---|---|
| `Examination` | Eine Untersuchung: Tag (1/2/3), Dauer, Rolle (MFA/Arzt), Raum, Ressourcengruppe, **Patientenanteil** (`participationPercent`), `deviceCount` (eigene Geräte, optional), Umsatz, `parallelWith` (Name der Partner-Untersuchung), `order`, `mustFollowExamId`, `deviceRole` (`attach`/`return`, nur in Gerätegruppen), `scheduleLast` (immer zuletzt), `participationMin`/`participationMax` (Grenzen für die Umsatzoptimierung) |
| `ResourceGroup` | Ein gemeinsamer Engpass (z. B. „Ultraschall“). `groupType` bestimmt die Formel, `deviceCount` die Anzahl Geräte/Räume, `staffType` (nur `staff_multiplied`) das bedienende Personal |
| `ResourceConfig` | `openingHours` (Intervalle pro Wochentag), `staff` (Ärzte, MFA Funktionsdiagnostik, MFA Labor), `scheduleConfig`, `dailyBusiness` (Tagesgeschäft, siehe Abschnitt 11) |
| `ScheduleConfig` | `startDays`, `programDays` (2 oder 3), `maxStayMinutes`, `breakBetweenExams`; außerdem `visitDayOffsets` und `lzAnlegenDay`, die der Rechner **selbst überschreibt** (siehe 4.4) |
| `Scenario` | Untersuchungen + Gruppen + Konfiguration + berechnetes `results` |
| `WeeklyCapacityResult` | Ergebnis: `maxPatientsPerCohort`, `weeklyThroughput`, Ergebnisse je Wochentag, 3-Wochen-Daten, beste Besuchsabstände |

Öffnungszeiten sind Listen von Intervallen in Minuten seit Mitternacht (`480` = 08:00). Die analytische Rechnung nutzt die **Summe** der Intervalle je Tag; der Scheduler berücksichtigt zusätzlich die Lücken dazwischen (siehe 4.6).

---

## 4. Die Berechnung (`calculator.ts`)

### 4.1 Schritt 1 – Untersuchungen zu Schritten zusammenfassen (`resolveSteps`)

Zwei Untersuchungen laufen als **ein Schritt** mit `Dauer = max(A, B)`, wenn
- A `parallelWith = B` hat **und** B `parallelWith = A` (gegenseitig) **und**
- beide dieselbe Ressourcengruppe belegen.

Beispiel: EKG ↔ ABI-Messung (beide „Funktionsraum Tag 1“, je 10 min) = ein Schritt à 10 min statt 20 min.

Liegen die Partner in **verschiedenen** Gruppen (Langzeit-EKG ↔ Langzeit-RR anlegen), bleiben es zwei Schritte, jeder in seiner Gruppe. Im **Scheduler** dagegen werden gegenseitig parallele Untersuchungen auch gruppenübergreifend zu einem Block zusammengefasst, der beide Gruppen gleichzeitig belegt.

### 4.2 Schritt 2 – Zeitbedarf pro Patient und Ressource

Für jede Ressourcengruppe und jeden Wochentag wird der **Zeitbedarf pro Patient** summiert – über alle Phasen (Tag 1/2/3), die an diesem Wochentag aktiv sind. Jeder Schritt zählt mit `Dauer × Patientenanteil` (Mittelwert der Anteile der beteiligten Untersuchungen).

Sonderregeln für Gerätezyklen (Gruppen vom Typ `device_count`, z. B. Langzeit-EKG/-RR; gesteuert über das Feld `deviceRole` der Untersuchung, in der UI „Gerätezyklus“):
- Untersuchungen mit `deviceRole = attach` („Gerät anlegen“) zählen nur an der Phase `lzAnlegenDay` (1 oder 2), unabhängig davon, unter welchem Tag sie eingetragen sind.
- Untersuchungen mit `deviceRole = return` („Gerät abnehmen“) werden **ignoriert**. Es gibt kein Geräterückgabe-Scheduling; das Gerät gilt als am Folgetag wieder verfügbar.

### 4.3 Schritt 3 – Kapazität je Gruppentyp

| `groupType` | Formel (Patienten pro Kohorte) | Bemerkung |
|---|---|---|
| `time_based` | `⌊ Geräte × Öffnungsminuten ÷ Zeitbedarf/Patient ⌋` | `Geräte = deviceCount` (Standard 1). Ultraschall hat 1 Gerät: **alle** Sono-Untersuchungen laufen durch dieses eine Gerät, egal wie viele Ärzte da sind |
| `staff_multiplied` | `⌊ Personal × Öffnungsminuten ÷ Zeitbedarf/Patient ⌋` | Personalzahl aus `staff` (siehe unten) |
| `device_count` | `⌊ Geräteanzahl ÷ Patientenanteil ⌋` | Reine Geräte-Obergrenze, unabhängig von Öffnungszeiten. Nur an Wochentagen, an denen die „anlegen“-Phase aktiv ist |

**Geräte je Untersuchung.** Zusätzlich zur Gruppe kann jede Untersuchung eine eigene Geräteanzahl `deviceCount` haben (Feld „Anzahl Geräte“ auf der Karte; leer = kein Limit). Beispiel: EKG, ABI-Messung und Lungenfunktion teilen sich die Gruppe „Funktionsraum Tag 1“ (gemeinsamer Raum und MFA), das EKG hat aber nur 2 Geräte. Das ist eine **zusätzliche** Grenze; der gemeinsame Raum bzw. das Personal der Gruppe bleibt ein eigener Engpass:

```
Kapazität (Untersuchung) = ⌊ Geräte × Öffnungsminuten ÷ (Dauer × Patientenanteil) ⌋
```

Sie erscheint in den Ergebnissen als eigene Zeile „<Name> (Geräte)“ und zählt nur an Tagen, an denen die Phase der Untersuchung aktiv ist. Bei Untersuchungen in Gerätegruppen (`device_count`, z. B. Langzeit-EKG) gibt es das Feld nicht; sie werden über die Gerätezahl der Gruppe begrenzt. Im Scheduler hat jede Untersuchung mit Geräten so viele Bahnen wie Geräte: Zwei EKG-Termine dürfen nur dann gleichzeitig laufen, wenn mindestens 2 EKG-Geräte (und ein freier Platz in der Gruppe) da sind. Bei zwei parallelen Untersuchungen in einem Block (EKG ∥ ABI) sind die Geräte beider bis zum Ende des Blocks belegt.

Welche Personalzahl gilt (`getStaffCount`)? Die der Gruppe zugeordnete `staffType` (`doctorCount`, `mfaFunktionsdiagnostik` oder `mfaLabor`; in der UI im Panel „Ressourcengruppen konfigurieren“ wählbar). Fehlt sie, gilt `mfaFunktionsdiagnostik`.

### 4.4 Schritt 4 – Beste Besuchsabstände automatisch finden

`visitDayOffsets` (Abstand Tag 1→2 und Tag 1→3 in Arbeitstagen) und `lzAnlegenDay` sind **keine Eingaben**. Der Rechner probiert alle gültigen Kombinationen durch und nimmt die mit dem höchsten `N`:

- 3-Tage-Programm: Tag 2 nach 1–5 Tagen, Tag 3 nach `Tag2+1` bis `Tag2+5` Tagen → 25 Kombinationen
- 2-Tage-Programm (Schalter „Programmdauer“ auf Dashboard und Ressourcen): nur Tag 2 nach 1–5 Tagen (Tag 3 = 99, nie aktiv); **alle Tag-3-Untersuchungen werden auf Tag 2 verschoben** (`applyProgramDays`). In der Untersuchungen-Ansicht bleibt die Tag-3-Spalte sichtbar und trägt den Hinweis „zählt als Tag 2“
- je × `lzAnlegenDay ∈ {1, 2}`

Bei Gleichstand gewinnt die erste gefundene Kombination (also kleine Abstände, Anlegen an Tag 1). Das Ergebnis steht in `bestVisitDayOffsets` und `bestLzAnlegenDay`; Dashboard und Gantt verwenden diese Werte.

### 4.5 Schritt 5 – Welche Phasen sind wann aktiv? (Steady State)

Bewertet wird **Woche 2** (Arbeitstage 5–9 im 15-Tage-Modell, Tage 0–14 = Woche 1–3). Aktive Phasen liefern alle Kohorten, die davor, in Woche 1 oder in Woche 2 gestartet sind (die „Vorgeschichte“ reicht `⌈größter Abstand ÷ 5⌉` Wochen zurück). So sind in Woche 2 alle Phasen eingeschwungen. Im 3-Wochen-Modell:

| Woche | Bedeutung |
|---|---|
| 1 | Anlauf – noch keine Kohorten aus Vorwochen |
| 2 | **Steady State – bindend für `N`** |
| 3 | Auslauf – es starten keine neuen Kohorten mehr |

Je Wochentag ergibt sich `N_Tag = min` über alle Ressourcen; `N = min` über alle Wochentage. **Der schwächste Tag bestimmt alle Kohorten**, ein einziges `N` für die gesamte Woche.

### 4.6 Schritt 6 – Scheduler-Validierung

Die analytische Rechnung kennt keine Wartezeiten oder maximale Aufenthaltsdauer. Deshalb wird `N` mit dem Scheduler geprüft: Endet in Woche 2 irgendeine Untersuchung nach `openingMinutes`, wird `N` um 1 gesenkt und erneut geprüft (bis `N = 1`).

Der Scheduler rechnet auf einer Zeitachse „Minuten seit Öffnung“, in der Schließzeiten zwischen zwei Intervallen herausgekürzt sind. Ein Block darf keine solche Lücke überspannen (er rutscht an den Beginn des nächsten Intervalls); der Vergleich `endMin > openingMinutes` nutzt die Summe der Öffnungsminuten. Für die Anzeige rechnet `toClockMin` (in `calculator.ts`) die Achse wieder in Uhrzeiten um.

### 4.7 Ergebnis

- `maxPatientsPerCohort` = validiertes `N`
- `weeklyThroughput = N × startDays.length`
- `limitingCapacity` je Ressource = abgerundete Kapazität; `rawCapacity` = ungerundeter Wert (wird vom Optimierer genutzt)
- `utilizationPct` je Ressource = `N ÷ limitingCapacity × 100`
- `isBottleneck` = Ressource, deren *analytische* Kapazität dem kleinsten Wert vor der Scheduler-Validierung entspricht (mehrere möglich). So bleibt auch dann ein Engpassname erhalten, wenn der Scheduler `N` weiter gesenkt hat; die Beschreibung (`primaryBottleneck.description`) weist dann darauf hin („durch Ablaufplanung … begrenzt“)

---

## 5. Der Scheduler (`scheduler.ts`)

`buildWeekSchedule(exams, groups, config, nPatients)` erzeugt für jeden Arbeitstag 0–14 einen Tagesplan mit `nPatients` Patienten **je aktiver Phase**. Zeiten sind **Minuten seit Öffnung** (0 = Öffnungsbeginn), nicht Uhrzeiten.

**Ressourcen-Slots:** Jede Gruppe hat so viele parallele „Bahnen“, wie sie Geräte/Personal hat (`time_based` → `deviceCount`, `staff_multiplied` → Personalzahl, `device_count` → 1, weil das Anlegen seriell durch eine MFA läuft). Ein Block startet, sobald seine Patienten frei sind **und** eine Bahn aller benötigten Gruppen frei ist.

**Reihenfolge der Patienten** (pro Tag):
1. Phasen mit mehr Untersuchungen zuerst (meist Tag 1), damit sie nicht von Echo-Terminen an Tag 2 ausgebremst werden.
2. Untersuchungen werden nach `order` (Position per Drag & Drop) sortiert; bei gleichem frühestem Start gewinnt die weiter oben stehende. Umsortieren löst deshalb eine Neuberechnung aus.
3. Je Patient vier Stufen:
   1. **Umkämpfte Blöcke** (Gruppe kommt am selben Tag mehrfach oder in mehreren Phasen vor) greedy: jeweils der Block mit frühestem möglichen Start.
   2. **Unkritische Blöcke** werden in Lücken zwischen die umkämpften eingefügt (kleinste Verschwendung); wenn keine Lücke passt, ans Ende.
   3. **„Folgt nach“-Blöcke** (`mustFollowExamId`): Untersuchungen, deren Vorgänger am selben Tag beim selben Patienten stattfindet, werden erst danach eingeplant. Liegt der Vorgänger an einem anderen Tag oder wird der Patient nicht untersucht (Patientenanteil), entfällt die Regel. Zyklen werden abgefangen (dann keine Reihenfolge erzwungen).
   4. **Untersuchungen mit `scheduleLast`** („Immer zuletzt“, im Standard das Abschlussgespräch) am Ende des Besuchs, in der Reihenfolge ihrer Position.
3. **Max. Aufenthalt** (`maxStayMinutes`): Überschreitet ein Patient sein Fenster, wird seine „Ankunft“ nachgezogen (er kam später), sodass die Verweildauer eingehalten bleibt.
4. **Pause** (`breakBetweenExams`): optional 5 min zwischen zwei Untersuchungen desselben Patienten.

Patientenanteil: Für **jede** Untersuchung erhalten nur die ersten `round(N × Anteil)` Patienten je Phase diese Untersuchung (nested: Patient 1 bekommt alles, spätere weniger). Ein Block aus zwei parallelen Untersuchungen bleibt bestehen, solange mindestens eine davon stattfindet (siehe 8.2 zur Rundung).

`analyzeScheduleDay` wertet einen Tag aus: wie viele Blöcke enden innerhalb der Öffnungszeit (`actualSlots`) und wie lange Patienten zwischen zwei Untersuchungen warten (`waitMinByGroup`, der Wartegrund wird der *folgenden* Untersuchung zugeschrieben).

---

## 6. Was das Dashboard zeigt (und wie)

| Element | Herkunft |
|---|---|
| **Wochendurchsatz**, **Pat. pro Kohorte** | `results.weeklyThroughput`, `results.maxPatientsPerCohort` |
| **Engpass-Alert / Engpass-KPI** | **Sensitivitätsanalyse**, nicht `isBottleneck`: für jede Ressource wird +1 Einheit simuliert (`computeQuickThroughput`, identisch zu `calculateCapacity(...).weeklyThroughput` inkl. Scheduler-Validierung); alle mit Zuwachs > 0 sind Engpässe. Alle Gerätegruppen (`device_count`, im Standard Langzeit-EKG und -RR) werden gemeinsam erhöht; Personal-Gruppen werden je Personaltyp einmal betrachtet |
| **Monatsumsatz** | `Σ (Umsatz × Anteil) × Wochendurchsatz × 4` – grobe Extrapolation |
| **Wartezeitverursacher** | Scheduler, Woche 2: Ressource mit der größten summierten Wartezeit; Ø min/Patient = Summe ÷ (N × Anzahl Tage) |
| **Kapazitätstabelle** | `WeeklyCalendar`: je Woche/Wochentag/Ressource Kapazität („Slots“), Auslastung, ggf. „(x geplant)“ aus dem Scheduler |
| **Wochenkalender (Gantt)** | `DayScheduleGantt`: Patienten- oder Raumansicht, mit Wochen- und Tagesauswahl |

Die Zeile „Besuchsabstände“ und „Langzeit-Gerät anlegen“ zeigen die **automatisch** ermittelten Werte (nicht editierbar).

---

## 7. Beispiel mit den Standardwerten

Standardkonfiguration: alle 5 Wochentage als Starttage, 3-Tage-Programm, Öffnungszeiten Mo/Di/Do 6 h, Mi 4 h, Fr 5 h, 5 Ärzte, je 1 MFA, 1 Sono-Gerät, 1 Ergometer, 4 LZ-EKG + 4 LZ-RR, 120 min max. Aufenthalt, alle Patientenanteile 100 %.

Ergebnis (berechnet mit dem Code): beste Abstände **Tag 1→2 = 1, Tag 1→3 = 2** (aufeinanderfolgende Tage), Langzeitgeräte werden an **Tag 1** angelegt. An jedem Wochentag sind alle drei Phasen aktiv.

Zeitbedarf pro Patient und Kapazität pro Kohorte:

| Ressource | min/Patient | Mo/Di/Do (360) | Mi (240) | Fr (300) |
|---|---|---|---|---|
| Funktionsraum Tag 1 | 15 (EKG∥ABI 10 + Lunge 5) | 24 | 16 | 20 |
| Ultraschall | 35 (Abdomen 15 + Echo∥Duplex 15 + Schilddrüse 5) | 10 | **6** | 8 |
| Arztgespräch | 15 (Körperl. U. 5 + Abschluss 10) | 120 | 80 | 100 |
| Blutentnahmen | 5 | 72 | 48 | 60 |
| Ergometrie | 20 | 18 | 12 | 15 |
| LZ-EKG / LZ-RR-Geräte | – | **4** | **4** | **4** |

→ Die Geräte-Obergrenze **4** ist die kleinste Zahl, also `N = 4`, **Wochendurchsatz = 4 × 5 = 20 Check-ups/Woche**, Engpass: Langzeitgeräte. Die Scheduler-Prüfung bestätigt: bei `N = 4` endet der letzte Termin an jedem Wochentag nach 190 min (Mittwoch hat nur 240 min Öffnung), bei `N = 5` nach 230 min, also noch innerhalb der Öffnungszeit.

Sensitivität: Ein weiteres Gerät nur bei EKG **oder** nur bei RR bringt nichts (0); beide gemeinsam +1 bringt `N = 5` → **25 Check-ups/Woche**. Danach wäre am Mittwoch der Ultraschall (Kapazität 6) der nächste Engpass; bei 6 Geräten lässt die Scheduler-Validierung trotzdem nur `N = 5` zu, der Durchsatz bleibt bei 25 (Diagramme und Dashboard zeigen denselben Wert).

Das 2-Tage-Programm ergibt mit denselben Werten ebenfalls `N = 4` (Bindung an den LZ-Geräten).

---

## 8. Bekannte Grenzen und Fallstricke

Diese Punkte ergeben sich aus dem Code und sind bewusst dokumentiert, damit sie nicht überraschen:

1. **Aufenthaltsdauer und Mittagslücke:** `maxStayMinutes` wird auf der Zeitachse ohne Lücken gemessen; eine Schließzeit zählt also nicht als Aufenthalt. Untersuchungen dürfen die Lücke nicht überspannen, wohl aber ein Patient kann davor und danach Termine haben.
2. **Rundung des Patientenanteils:** Die analytische Rechnung skaliert den Zeitbedarf stetig mit dem Anteil, der Scheduler rundet auf ganze Patienten (`round(N × Anteil)`; 25 % bei `N = 4` ergibt 1 Patient, 10 % ergibt 0). Bei kleinem `N` können beide daher leicht abweichen.
3. **Einheitliches `N`:** Alle Kohorten und Wochentage bekommen dieselbe Patientenzahl; der schwächste Wochentag begrenzt die Woche (im Beispiel Mittwoch). Kürzere Öffnungszeiten an einzelnen Tagen wirken daher auf die ganze Woche.
4. **Abstände in Arbeitstagen:** Wochenenden existieren im Modell nicht. Ein Abstand von 3 Tagen von Do ist Di, nicht Sonntag.
5. **Szenario-Vergleich** ist auf **genau 2** Szenarien begrenzt.
6. **Import** überschreibt den gesamten Zustand, schreibt direkt in `localStorage` und lädt die Seite neu. Ergebnisse werden beim Import neu berechnet.
7. **Rechenzeit:** Weil auch die Sensitivitätsanalysen den Scheduler nutzen, kostet jede Variante etwas mehr Zeit (Größenordnung 2 ms pro Berechnung mit den Standardwerten). Bei sehr großen Patientenzahlen wächst sie merklich.

---

## 9. Erweitern – worauf achten

- **Neue Untersuchung / Gruppe:** in der UI anlegen. Sonderverhalten hängt an Datenfeldern statt an Namen/IDs: `deviceRole` (Gerätezyklus), `scheduleLast` (immer zuletzt), `staffType` (Personal einer Personalgruppe). Gruppen und Untersuchungen dürfen daher frei umbenannt werden.
- **Neues Datenfeld für alte Speicherstände:** In `src/lib/normalize.ts` ergänzen. `normalizeScenario` füllt fehlende Felder beim Laden aus `localStorage` und beim Import (dort leben die früheren Namens-Heuristiken, nur für Altdaten); der Store berechnet beim Laden alle Ergebnisse neu. Ein Hochzählen des Storage-Schlüssels ist für rein additive Felder nicht nötig.
- **Neue Formel / Gruppentyp:** `ResourceGroupType` in `types/index.ts` erweitern und die Fälle in `calculator.ts` (`computeDayResources`) sowie `scheduler.ts` (`getGroupSlots`) ergänzen.
- **Änderung der persistierten Struktur:** Schlüssel in `appStore.ts` **und** `ImportExport.tsx` (`version` und `storeKey`) hochzählen, sonst passen alte Daten nicht mehr zu den Typen.
- **Tests:** Es gibt keine. Für Änderungen am Rechner die Standardwerte aus Abschnitt 7 als Referenz nutzen (`N = 4`, 20/Woche, +1 LZ → 25). Zusätzlich `npm run lint` und `npx tsc -b` ausführen.

---

## 10. Umsatzoptimierung

Menüpunkt **Optimierung** (`src/pages/Optimierung.tsx`, Logik in `src/lib/optimizer.ts`). Frage: *Bei wie viel Prozent der Patienten sollte jede Untersuchung stattfinden, damit der Umsatz unter den Kapazitäten maximal ist?*

**Zielfunktion**

```
Wochenumsatz = min(Wochenkapazität, Nachfrage-Obergrenze) × Σ (Umsatz je Untersuchung × Anteil)
```

- Patientenzahl **und** Anteile sind frei: Weniger Untersuchungen pro Patient geben Kapazität frei und erlauben mehr Patienten, mehr Untersuchungen bringen mehr Umsatz je Patient.
- Die **Nachfrage-Obergrenze** (Patienten pro Woche) ist zwingend, sonst würde die Optimierung fast alle Untersuchungen streichen und sehr viele Patienten durchschleusen (mit den Standardwerten: 480 Patienten je Kohorte für 19 € pro Kopf). Die Seite belegt sie mit dem 1,5-fachen des heutigen Durchsatzes vor.
- Anteile werden in **10-%-Schritten** gewählt, jede Untersuchung hat ein **Min.** und **Max.** (Standard 0–100 %). Ein Abschlussgespräch, das immer stattfinden muss, bekommt Min. 100 %.
- „Abnehmen“-Untersuchungen (`deviceRole = return`) sind keine eigenen Variablen; sie übernehmen den Anteil ihrer „Anlegen“-Untersuchung.
- Der Umsatz je Untersuchung gilt als fest; Monatsumsatz = Wochenumsatz × 4 (wie im Dashboard).

**Verfahren** (Näherung, kein Optimalitätsbeweis)
1. **Gieriger Abstieg** ab den Obergrenzen: Jeweils wird die Untersuchung um 10 % gesenkt, die die *engpassbindenden* Ressourcen pro verlorenem Euro am stärksten entlastet. Bewertet wird mit der ungerundeten Kapazität (`rawCapacity`); nur so kommt die Suche über Rundungsstufen hinweg, und Engpässe, die gleichzeitig binden (Langzeit-EKG und -RR), lösen sich gemeinsam auf.
2. **Lokale Suche** auf dem echten, scheduler-geprüften Wochenumsatz: einzelne Untersuchungen auf jeden erlaubten Wert, Paare gleichzeitig.
3. Start einmal von den Obergrenzen und einmal von den aktuellen Werten; das beste Ergebnis gewinnt. Die Empfehlung ist nie schlechter als der heutige Stand.
4. **Geschwindigkeit:** Während der Suche bleiben Besuchsabstände und Langzeit-Tag fest (die Suche darüber kostet je Bewertung das 50-fache); Kandidaten und alle angezeigten Zahlen werden anschließend mit dem vollen Modell (`calculateCapacity`) berechnet. Die Nachfrage-Obergrenze begrenzt zusätzlich die Patientenzahl je Kohorte, damit der Scheduler nur kleine Fälle prüft. Laufzeit typisch 0,3–2 s.

**Beispiel (Standardwerte)**

| Obergrenze | Empfehlung | Patienten/Woche | Umsatz/Patient | Monatsumsatz |
|---|---|---|---|---|
| 20 (= heute) | keine Änderung | 20 | 525 € | 42.000 € |
| 30 | Langzeit-EKG/-RR 100→60 %, Abdomen-Sono 100→90 %, Ergometrie 100→90 % | 30 | 483 € | 57.960 € (+38 %) |
| 45 | Langzeit-EKG/-RR 100→40 %, Abdomen-Sono 100→0 % | 45 | 417 € | 75.060 € (+79 %) |

Die Langzeitgeräte sind der wertvollste Engpass: Bei 4 Geräten und 60 % Teilnahme reichen sie für `⌊4 ÷ 0,6⌋ = 6` Patienten je Kohorte (30 pro Woche). Bei der Kontrolle liefern 40 zufällig gestartete Bergsteiger-Läufe kein besseres Ergebnis.

**Grenzen:** Die Nachfrage-Obergrenze muss der Nutzer schätzen. Es gibt keinen Wechselwirkungseffekt zwischen Angebot und Preis. Medizinische Zusammenhänge zwischen Untersuchungen (z. B. dass Untersuchung B nur mit A sinnvoll ist) kennt der Optimierer nicht; solche Fälle über Min./Max. abbilden. „Folgt nach“ wirkt nur im Tagesplan, nicht als Abhängigkeit der Anteile.

**Übernehmen:** *Als neues Szenario übernehmen* legt eine Kopie des aktuellen Szenarios („Optimiert (max. N Pat./Wo.)“) an und setzt die Anteile dort (empfohlen; das Basisszenario bleibt unverändert). *In aktuelles Szenario übernehmen* überschreibt die Anteile im aktiven Szenario. Jede Änderung am Szenario, auch an Min./Max., macht ein angezeigtes Ergebnis ungültig; dann erneut starten.

---

## 11. Tagesgeschäft

Menüpunkt **Tagesgeschäft** (`src/pages/Tagesgeschaeft.tsx`, Logik in `src/lib/dailyBusiness.ts`, Wirkung auf die Kapazität in `calculator.ts`). Neben den Check-ups laufen reguläre Patiententermine (je 15 Minuten). Sie belegen dieselben Ressourcen und nehmen den Check-ups Kapazität weg.

**Einstellungen** (je Szenario, `resourceConfig.dailyBusiness`)

| Feld | Bedeutung |
|---|---|
| Schalter `enabled` | Aus (Standard): Das Modell ignoriert das Tagesgeschäft, alle Ergebnisse bleiben wie ohne diese Funktion. An: Die freigehaltenen Termine verringern die Check-up-Kapazität überall (Dashboard, Diagramme, Optimierung). |
| Termine pro Tag | Nachfrage (Durchschnitt), je Wochentag ein Wert |
| Schwankung in % | Spitzentag = Durchschnitt × (1 + Schwankung) |
| Wert je Patiententermin | Umsatz je Termin in € |
| Minuten je Termin und Ressource | Wie lange ein Termin welche Ressourcengruppe belegt (0 = gar nicht). Standard: Arztgespräch 15 Minuten. Ärzte, MFA und Ultraschall sind einzeln einstellbar, indem du bei der jeweiligen Gruppe (z. B. Arztgespräch, Blutentnahmen, Ultraschall) Minuten einträgst. |
| Freihalten je Wochentag (optional) | Termine pro Tag, für die Kapazität freigehalten (blockiert) wird. Leer = Spitzentag. |

**Wirkung im Modell.** Für jede Ressourcengruppe und jeden Wochentag gilt:

```
Kapazität für Check-ups = ⌊ (Einheiten × Öffnungsminuten − freigehaltene Termine × Minuten je Termin) ÷ Zeitbedarf je Patient ⌋
```

Der Scheduler bleibt unverändert; er plant nur Check-ups. Die Slot-Ansicht (unten) macht die Verteilung über den Tag sichtbar.

**Schwankung.** Die Nachfrage `D` eines Tages ist gleichverteilt zwischen `Ø × (1 − s)` und `Ø × (1 + s)`. Werden `r` Termine freigehalten, sind im Erwartungswert `E[min(D, r)]` Termine belegt (geschlossene Formel, gegen eine Monte-Carlo-Simulation geprüft). Wer für den Spitzentag freihält (`r = Ø × (1 + s)`), bedient jede Nachfrage, bekommt im Mittel aber nur `Ø` Termine bezahlt.

**Empfehlung (optimale Terminzahl).** Gemeinsam gewählt werden die Zahl der Check-up-Patienten je Kohorte `N` und die freigehaltenen Termine `r` je Wochentag (höchstens der Spitzentag), so dass der Wochenumsatz maximal ist:

```
Wochenumsatz = N × Starttage × Umsatz je Check-up + Σ Wochentage (Wert je Termin × E[min(D, r)])
```

Zu jedem `N` ist `r` die größte Zahl, die neben `N` Check-up-Patienten in allen belegten Ressourcen noch Platz hat. Die Suche läuft über alle `N` von 0 bis zur Kapazität ohne Tagesgeschäft. Das Ergebnis wird mit dem vollen Modell (`calculateCapacity`) nachgerechnet. Die Seite vergleicht drei Varianten: nur Check-ups, aktuelle Einstellung (Spitzentag oder eigene Werte) und Empfehlung. *Empfehlung übernehmen* schreibt die Werte in „Freihalten“ und schaltet das Tagesgeschäft ein.

**Wann und wo blockieren (Slot-Ansicht).** Aus dem Tagesplan der Steady-State-Woche wird je Wochentag und 15-Minuten-Slot berechnet, wie viele Termine neben den Check-ups noch Platz haben (frei = Einheiten × Slotlänge − Check-up-Belegung, geteilt durch die Minuten je Termin, das Minimum über alle belegten Ressourcen). Rot = durch Check-ups belegt, gelb = teilweise frei, grün = frei. Die freizuhaltenden Termine werden proportional zum freien Platz auf die Slots verteilt (Zahl im Feld, grüner Rahmen). Rechts steht „Freihalten / Platz“; wird die Zahl rot, passt die geforderte Reservierung an diesem Tag nicht in die freien Slots.

**Beispiel (Standardwerte, Ultraschall 15 Minuten je Termin, 45 € je Termin, Nachfrage 40/40/30/40/30, Schwankung 20 %).**

| Variante | Check-ups/Woche | Termine/Woche (erwartet) | Umsatz/Woche |
|---|---|---|---|
| Nur Check-ups | 20 | 0 | 10.500 € |
| Spitzentag freihalten (48/48/36/48/36) | 0 | 180 | 8.100 € |
| Empfehlung (14/14/6/14/10) | 20 | 58 | 13.110 € |

Der Ultraschall (ein Gerät, 360 Minuten) ist der gemeinsame Engpass: Wer für jeden Spitzentermin Ultraschall freihält, verdrängt alle Check-ups. Die Slot-Ansicht der Empfehlung zeigt, dass die Check-ups den Ultraschall am Montag von 08:15 bis 10:45 belegen; freigehalten wird um 08:00 und ab 10:45. Mit nur Arztzeit (Standard) entsteht kein Konflikt, weil 5 Ärzte weit mehr Zeit haben, als Check-ups und Termine brauchen.

**Grenzen.** Die Nachfrage und der Wert je Termin sind Annahmen. Es wird keine Zeit vor Ort pro Termin modelliert außer den eingetragenen Minuten; jeder Termin belegt alle eingetragenen Ressourcen gemeinsam. Die Slot-Ansicht rechnet mit Bruchteilen eines Termins je Slot und ignoriert, dass kurze Check-up-Blöcke (5 oder 10 Minuten) einen 15-Minuten-Slot zerstückeln können. Ob die Empfehlung praktisch umsetzbar ist (z. B. Terminbuch-Software), prüft die App nicht. „Freihalten“ bedeutet Blockieren für Check-ups, nicht Ablehnen von Patienten. Die Umsatzoptimierung der Untersuchungen (Menü „Optimierung“) rechnet weiter nur den Check-up-Umsatz, nutzt aber bei eingeschaltetem Tagesgeschäft die verringerte Kapazität.
