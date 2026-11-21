import type { StructuralRisk } from '../src/model.ts';

const ordered = ['low', 'medium', 'high', 'critical'] as const;
export function highestRisk(risks: StructuralRisk[]) {
  return [...ordered].reverse().find(severity => risks.some(risk => risk.severity === severity)) ?? 'unclassified';
}

export function formatTime(iso: string) {
  return new Intl.DateTimeFormat('en-GB', {
    month: 'short', day: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
  }).format(new Date(iso)) + ' UTC';
}
