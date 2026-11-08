<?php

use App\Http\Middleware\VerifyJwt;
use App\Support\ApiException;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/healthz',
        // The gateway forwards /api/v1/catalog/... unchanged, so routes live under the same prefix.
        apiPrefix: 'api/v1',
    )
    ->withMiddleware(function (Middleware $middleware) {
        $middleware->alias(['jwt' => VerifyJwt::class]);
    })
    ->withExceptions(function (Exceptions $exceptions) {
        // Every error leaves this service in the same shape the Go services use:
        // {"error": {"code", "message", "fields"}} so the React app handles one format.
        $exceptions->render(function (Throwable $e, Request $request) {
            if ($e instanceof ApiException) {
                return $e->toResponse();
            }
            if ($e instanceof ValidationException) {
                $fields = array_map(fn ($messages) => $messages[0], $e->errors());

                return response()->json(['error' => [
                    'code' => 'validation_failed', 'message' => 'some fields are invalid', 'fields' => $fields,
                ]], 422);
            }
            if ($e instanceof HttpExceptionInterface) {
                $status = $e->getStatusCode();

                return response()->json(['error' => [
                    'code' => $status === 404 ? 'not_found' : 'http_'.$status,
                    'message' => $e->getMessage() ?: ($status === 404 ? 'not found' : 'request failed'),
                ]], $status);
            }
            report($e);

            return response()->json(['error' => ['code' => 'internal', 'message' => 'something went wrong']], 500);
        });
    })
    ->create();
