<?php

namespace App\Support;

use MongoDB\BSON\UTCDateTime;

/**
 * Turns stored documents into API JSON: "_id" becomes "id" and BSON dates become
 * ISO 8601 strings, matching what the Go services return.
 */
final class Present
{
    /** @param array<string, mixed> $doc @return array<string, mixed> */
    public static function doc(array $doc): array
    {
        if (array_key_exists('_id', $doc)) {
            $doc = ['id' => $doc['_id']] + $doc;
            unset($doc['_id']);
        }

        return self::walk($doc);
    }

    /** @param list<array<string, mixed>> $docs @return list<array<string, mixed>> */
    public static function docs(array $docs): array
    {
        return array_map([self::class, 'doc'], $docs);
    }

    private static function walk(mixed $v): mixed
    {
        if ($v instanceof UTCDateTime) {
            return $v->toDateTime()->format('Y-m-d\TH:i:s.v\Z');
        }
        if (is_array($v)) {
            foreach ($v as $k => $item) {
                $v[$k] = self::walk($item);
            }
        }

        return $v;
    }
}
