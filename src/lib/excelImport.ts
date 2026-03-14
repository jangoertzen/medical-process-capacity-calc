import * as XLSX from 'xlsx';
import type { Examination, DayNumber } from '@/types';

export interface ParsedSheet {
  name: string;
  data: Record<string, unknown>[];
}

export function parseExcelFile(buffer: ArrayBuffer): ParsedSheet[] {
  const workbook = XLSX.read(buffer, { type: 'array' });
  return workbook.SheetNames.map(name => ({
    name,
    data: XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[name], { defval: '' }),
  }));
}

export function mapRowsToExaminations(
  rows: Record<string, unknown>[],
  mapping: {
    day: string;
    name: string;
    staffRole: string;
    durationMin: string;
    parallelWith: string;
    resourceGroupId: string;
  }
): { examinations: Examination[]; errors: string[] } {
  const errors: string[] = [];
  const examinations: Examination[] = [];

  rows.forEach((row, i) => {
    const day = Number(row[mapping.day]);
    const name = String(row[mapping.name] ?? '').trim();
    const staffRole = String(row[mapping.staffRole] ?? '').trim();
    const durationMin = Number(row[mapping.durationMin]);
    const parallelWith = String(row[mapping.parallelWith] ?? '').trim() || null;
    const resourceGroupId = String(row[mapping.resourceGroupId] ?? '').trim().toLowerCase().replace(/\s+/g, '-');

    if (![1, 2, 3].includes(day)) {
      errors.push(`Zeile ${i + 1}: Ungültiger Tag "${row[mapping.day]}"`);
      return;
    }
    if (!name) {
      errors.push(`Zeile ${i + 1}: Name fehlt`);
      return;
    }
    if (!['MFA', 'Arzt'].includes(staffRole)) {
      errors.push(`Zeile ${i + 1}: Ungültige Rolle "${staffRole}" (erwartet: MFA oder Arzt)`);
      return;
    }
    if (isNaN(durationMin) || durationMin <= 0) {
      errors.push(`Zeile ${i + 1}: Ungültige Dauer "${row[mapping.durationMin]}"`);
      return;
    }

    examinations.push({
      id: `import-${i}`,
      day: day as DayNumber,
      name,
      room: '',
      deviceCount: null,
      staffRole: staffRole as 'MFA' | 'Arzt',
      durationMin,
      parallelWith,
      resourceGroupId,
      isAssumedDefault: false,
      revenueEur: 0,
    });
  });

  return { examinations, errors };
}
