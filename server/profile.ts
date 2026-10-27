export type Profile = {
  currentFat: number | null;
  targetFat: number | null;
  currentWeight: number | null;
  targetWeight: number | null;
  startWeight: number | null;
};
export type ProfileInput = Omit<Profile, 'startWeight'>;

export function validateProfile(input: unknown): ProfileInput {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid profile');
  const result: Record<string, number | null> = {};
  for (const key of ['currentFat', 'targetFat', 'currentWeight', 'targetWeight'] as const) {
    const value = (input as Record<string, unknown>)[key];
    const [min, max] = key.includes('Fat') ? [1, 70] : [20, 400];
    if (value !== null && (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || Math.abs(value * 10 - Math.round(value * 10)) > 0.000001)) {
      throw new Error('Invalid measurement');
    }
    result[key] = value as number | null;
  }
  return result as ProfileInput;
}

export function weightProgress(profile: Profile): number | null {
  const { startWeight: start, currentWeight: current, targetWeight: target } = profile;
  if (start === null || current === null || target === null) return null;
  if (start === target) return current === target ? 100 : 0;
  return Math.round(Math.max(0, Math.min(100, (current - start) / (target - start) * 100)));
}
