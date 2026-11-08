<?php

namespace App\Data;

use MongoDB\BSON\UTCDateTime;

/**
 * The same transactional outbox the Go services use: events are written in the same
 * transaction as the data they describe, and events:work publishes them.
 */
final class Outbox
{
    public function __construct(private Mongo $mongo) {}

    /** @param array<string, mixed> $event @param array<string, mixed> $opts */
    public function add(array $event, array $opts = []): void
    {
        $this->mongo->collection('outbox')->insertOne([
            '_id' => $event['eventId'],
            'type' => $event['type'],
            'occurredAt' => new UTCDateTime,
            'payload' => json_encode($event, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES),
            'sentAt' => null,
        ], $opts);
    }

    /** @return list<array<string, mixed>> */
    public function pending(int $limit = 100): array
    {
        return iterator_to_array($this->mongo->collection('outbox')->find(
            ['sentAt' => null],
            ['sort' => ['occurredAt' => 1, '_id' => 1], 'limit' => $limit],
        ), false);
    }

    public function markSent(string $id): void
    {
        $this->mongo->collection('outbox')->updateOne(['_id' => $id], ['$set' => ['sentAt' => new UTCDateTime]]);
    }

    /** Consumer side: remembers handled event IDs for a week (TTL index). */
    public function seen(string $eventId): bool
    {
        return $this->mongo->collection('processed_events')->countDocuments(['_id' => $eventId], ['limit' => 1]) > 0;
    }

    public function markProcessed(string $eventId): void
    {
        $this->mongo->collection('processed_events')->updateOne(
            ['_id' => $eventId],
            ['$setOnInsert' => ['expiresAt' => new UTCDateTime((time() + 7 * 86400) * 1000)]],
            ['upsert' => true],
        );
    }
}
