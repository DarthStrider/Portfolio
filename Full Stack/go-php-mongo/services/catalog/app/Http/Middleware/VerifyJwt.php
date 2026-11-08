<?php

namespace App\Http\Middleware;

use App\Support\ApiException;
use Closure;
use Firebase\JWT\JWT;
use Firebase\JWT\Key;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Verifies the access token auth-service (Go) signed, using only its public key.
 * Usage in routes: "jwt:optional", "jwt" (signed in), "jwt:staff", "jwt:admin".
 *
 * The PHP and Go services agree on the token because both follow the JWT standard:
 * RS256 signature, "sub", "roles", "iss" = shop-auth, "exp".
 */
final class VerifyJwt
{
    private static ?string $publicKey = null;

    public function handle(Request $request, Closure $next, string $mode = 'user'): Response
    {
        $user = $this->userFrom($request);
        if ($user === null && $mode !== 'optional') {
            throw ApiException::unauthorized();
        }
        if ($mode === 'staff' && ! self::has($user, 'staff')) {
            throw ApiException::forbidden();
        }
        if ($mode === 'admin' && ! self::has($user, 'admin')) {
            throw ApiException::forbidden();
        }
        $request->attributes->set('user', $user);

        return $next($request);
    }

    /** @return array{id: string, email: string, roles: list<string>}|null */
    private function userFrom(Request $request): ?array
    {
        $header = (string) $request->header('Authorization', '');
        if ($header === '') {
            return null;
        }
        if (! str_starts_with($header, 'Bearer ')) {
            throw ApiException::unauthorized('expected a Bearer token');
        }
        JWT::$leeway = 5; // seconds of clock skew between containers
        try {
            // Passing the algorithm with the key is what pins RS256: a token whose
            // header says "none" or "HS256" is rejected before any signature check.
            $claims = JWT::decode(substr($header, 7), new Key(self::publicKey(), 'RS256'));
        } catch (\Throwable $e) {
            throw new ApiException(401, 'invalid_token', 'token: '.$e->getMessage());
        }
        if (($claims->iss ?? null) !== 'shop-auth' || empty($claims->sub)) {
            throw new ApiException(401, 'invalid_token', 'token: invalid claims');
        }

        return [
            'id' => (string) $claims->sub,
            'email' => (string) ($claims->email ?? ''),
            'roles' => array_values(array_map('strval', (array) ($claims->roles ?? []))),
        ];
    }

    /** Admin implies staff, the same rule as httpx.Principal.Has in Go. */
    public static function has(?array $user, string $role): bool
    {
        if ($user === null) {
            return false;
        }

        return in_array($role, $user['roles'], true) || ($role === 'staff' && in_array('admin', $user['roles'], true));
    }

    private static function publicKey(): string
    {
        if (self::$publicKey === null) {
            $pem = @file_get_contents(config('catalog.jwt_public_key'));
            if ($pem === false) {
                throw new ApiException(503, 'unavailable', 'auth key not available yet');
            }
            self::$publicKey = $pem;
        }

        return self::$publicKey;
    }
}
