import { useStoredChoice } from './useStoredChoice';
import type { OvenScale } from '../utils/temperature';

const SCALES = ['original', 'F', 'C'] as const;

export function useOvenScale() {
    return useStoredChoice<OvenScale>('oven-scale', SCALES, 'original');
}
