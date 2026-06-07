// lib/utils.ts
import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * isPaperComplete and isRelatedPaperComplete are defined canonically in
 * src/shared/utils.ts and re-exported here so frontend code continues to
 * import from '@/lib/utils' without change.
 */
export { isPaperComplete, isRelatedPaperComplete } from '@/src/shared/utils';
