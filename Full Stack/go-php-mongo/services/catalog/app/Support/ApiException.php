<?php

namespace App\Support;

use Illuminate\Http\JsonResponse;

/** An error with an HTTP status, rendered in the shared {"error": {...}} shape. */
final class ApiException extends \RuntimeException
{
    /** @param array<string, string> $fields */
    public function __construct(
        public readonly int $status,
        public readonly string $errorCode,
        string $message,
        public readonly array $fields = [],
    ) {
        parent::__construct($message);
    }

    public static function notFound(string $what): self
    {
        return new self(404, 'not_found', "$what not found");
    }

    public static function unauthorized(string $message = 'sign in required'): self
    {
        return new self(401, 'unauthorized', $message);
    }

    public static function forbidden(): self
    {
        return new self(403, 'forbidden', 'not allowed');
    }

    public static function conflict(string $code, string $message): self
    {
        return new self(409, $code, $message);
    }

    /** @param array<string, string> $fields */
    public static function invalid(array $fields): self
    {
        return new self(422, 'validation_failed', 'some fields are invalid', $fields);
    }

    public function toResponse(): JsonResponse
    {
        $error = ['code' => $this->errorCode, 'message' => $this->getMessage()];
        if ($this->fields !== []) {
            $error['fields'] = $this->fields;
        }

        return response()->json(['error' => $error], $this->status);
    }
}
