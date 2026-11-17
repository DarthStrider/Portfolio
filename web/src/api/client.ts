const API_URL = import.meta.env.VITE_API_URL;

//GET a URL and return the JSON, typed as T
export async function apiGet<T>(path: string): Promise<T> {
    const response = await fetch(`${API_URL}${path}`);

    if (!response.ok) {
        throw new ApiError(response.status, `Request failed: ${response.status} ${response.statusText}`);
    }

    return (await response.json()) as T;
}

//POST / PUT / DELETE an optional JSON body
//Returns the parsed JSON or undefined for 204 No Content
export async function apiSend<T = void>(
    method: 'POST' | 'PUT' | 'DELETE',
    path: string,
    body?: unknown,
): Promise<T> {
    const response = await fetch(`${API_URL}${path}`, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
        //keep the API's errors error body (ex. validation errors) for the form to show
        const problem = await response.json().catch(() => null);
        throw new ApiError(response.status, `Request failed: ${response.status} ${response.statusText}`, problem);
    }

    return (response.status == 204 ? undefined : await response.json()) as T;
}

export class ApiError extends Error {
    status: number;
    problem: unknown;
    constructor(status: number, message: string, problem: unknown = null) {
        super(message);
        this.status = status;
        this.problem = problem;
    }
}
