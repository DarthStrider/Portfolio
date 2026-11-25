import { useStoredChoice } from './useStoredChoice';
import type { UnitSystem } from '../utils/units';

const SYSTEMS = ['original', 'metric', 'us'] as const;

export function useUnitSystem() {
    return useStoredChoice<UnitSystem>('unit-system', SYSTEMS, 'original');
}
