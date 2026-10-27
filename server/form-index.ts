export function calculateFormIndex(main: number, micro: number, walking: number): number {
  return Math.max(0, Math.min(100, Math.round((50 / 7) * (main + 0.5 * micro) + (50 / 7) * walking)));
}

export function formIndexStart(end: string): string {
  const date = new Date(`${end}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 6);
  return date.toISOString().slice(0, 10);
}
