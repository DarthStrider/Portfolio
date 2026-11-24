import { useState } from 'react';
import type { UnitSystem } from '../utils/units';

const KEY = 'unit-system';
const SYSTEMS: UnitSystem[] = ['original', 'metric', 'us'];

//the chosen unit system, remembered in this browser (localStorage) across visits
export function useUnitSystem(): [UnitSystem, (system: UnitSystem) => void] {
    const [system, setSystem] = useState<UnitSystem>(() => {
        try {
            const saved = localStorage.getItem(KEY);
            return SYSTEMS.includes(saved as UnitSystem) ? (saved as UnitSystem) : 'original';
        } catch {
            return 'original';
        }
    });

    const choose = (next: UnitSystem) => {
        setSystem(next);
        try {
            localStorage.setItem(KEY, next);
        } catch {//Storage blocked 
        }
    };

    return [system, choose];
}
