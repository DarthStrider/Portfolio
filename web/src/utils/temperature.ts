import type { TemperatureUnit } from '../types/recipe';

export type OvenScale = 'original' | TemperatureUnit;

export function toCelsius(fahrenheit: number): number {
    return Math.round(((fahrenheit - 32) * 5) / 9 / 5) * 5;
}

export function toFahrenheit(celsius: number): number {
    return Math.round(((celsius * 9) / 5 + 32) / 25) * 25;
}

export function formatOvenTemperature(value: number, unit: TemperatureUnit, scale: OvenScale): string {
    if (scale === 'C') return `${unit === 'C' ? value : toCelsius(value)}°C`;
    if (scale === 'F') return `${unit === 'F' ? value : toFahrenheit(value)}°F`; 
    return `${value}°${unit}`;
}

const TEMPERATURE = /(\d{2,3})(?:\s*°\s*|\s*[Dd]egrees\s+|)([FC])(?:ahrenheit|elsius)?\b/g;

export function formatStepTemperatures(text: string, scale: OvenScale): string {
    const found = [...text.matchAll(TEMPERATURE)];
    if (found.some((m) => m[2] === 'F') && found.some((m) => m[2] === 'C')) return text;

    return text.replace(TEMPERATURE, (_match, digits: string, unit: TemperatureUnit) => {
        const value = Number(digits);
        const f = unit === 'F' ? value : toFahrenheit(value);
        const c = unit === 'C' ? value : toCelsius(value);

        // The chosen scale first (or as written), the other in brackets
        const first = scale === 'original' ? unit : scale;
        return first === 'F' ? `${f}°F (${c}°C)` : `${c}°C (${f}°F)`;
    });
}
