//Remember the recipe list's filters/search

const KEY = 'recipe-list-search';

export function rememberListSearch(search: string): void {
    try {
        sessionStorage.setItem(KEY, search);
    } catch {
// Storage can be blocked (e.g. some private modes); then we just go back to the plain list
    }
}

export function listPath(): string {
    try {
        return `/${sessionStorage.getItem(KEY) ?? ''}`;
    }
    catch {
        return '/';
    }
}
