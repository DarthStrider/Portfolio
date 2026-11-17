const API_URL = import.meta.env.VITE_API_URL;

//GET a URL and return the JSON, typed as T
export async function apiGet<T>(path: string): Promise<T> {
    const response = await fetch(`${API_URL}${path}`);

    if (!response.ok) {
        throw new ApiError(response.status, `Request failed: ${response.status} ${response.statusText}`);
    }

    return (await response.json()) as T;
}

export class ApiError extends Error {
    status: number;

    constructor(status: number, message: string) {
        super(message);
        this.status = status;
    }
}
