<?php

namespace App\Domain;

/**
 * Document IDs: 24 random hex characters, the same format the Go services use, so an
 * ID means the same thing in every service, in events and in URLs.
 */
final class Ids
{
    public static function new(): string
    {
        return bin2hex(random_bytes(12));
    }

    public static function valid(mixed $id): bool
    {
        return is_string($id) && preg_match('/^[0-9a-f]{24}$/', $id) === 1;
    }
}
