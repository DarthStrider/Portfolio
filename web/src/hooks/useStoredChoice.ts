import { useState } from 'react';

export function useStoredChoice<T extends string>(key: string, options: readonly T[], fallback: T): [T, (value: T) => void]{
    const [value, setValue] = useState<T>(() => {
        try {
            const saved = localStorage.getItem(key);
            return options.includes(saved as T) ? (saved as T) : fallback;
        }
        catch {
            return fallback;
        }
    });

    const choose = (next: T) => {
        setValue(next);
        try {
            localStorage.setItem(key, next);
        }
        catch {
            //Storage Blocked: Still work until page is closed
        }
    };
    return [value, choose];
}
