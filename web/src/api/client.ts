const API_URL = import.meta.env.VITE_API_URL;

//GET a URL and return the JSON, typed as T
export async function apiGet<T>(path: string): Promise<T> {
    const response = await fetch(`${API_URL}${path}`);

    if (!response.ok) {
        throw new Error(`Request failed: ${response.status} ${response.statusText}`);
    }

    return (await response.json()) as T;
}