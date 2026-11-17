import { ApiError } from '../api/client';


//Shape of ASP.NET;s validation ProblemDetails
interface ValidationProblem {
    title?: string;
    errors?: Record<string, string[]>;
}

export function FormErrors({ error }: { error: Error | null }) {
    if (!error) return null;

    //400 with field errors -> list then
    if (error instanceof ApiError && error.status == 400) {
        const problem = error.problem as ValidationProblem | null;
        const messages = Object.values(problem?.errors ?? {}).flat();

        return (
            <div className="form-errors" role="alert">
                <strong>Please fux tge following:</strong>
                <ul>
                    {messages.length > 0
                        ? messages.map((message) => <li key={message}>{message}</li>)
                        : <li>{problem?.title ?? 'THe recipe is not valid'}</li>}
                </ul>
            </div>
        );
    }

    // Anything else (API down, 500...)
    return(
    <div className="form-errors" role="alert">
        Couldn't save the recipe: {error.message}</div>
    );
}
