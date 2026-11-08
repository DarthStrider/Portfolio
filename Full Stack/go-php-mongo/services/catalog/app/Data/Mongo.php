<?php

namespace App\Data;

use MongoDB\Client;
use MongoDB\Collection;
use MongoDB\Database;
use MongoDB\Driver\Exception\BulkWriteException;
use MongoDB\Driver\Exception\CommandException;
use MongoDB\Driver\Session;

/**
 * One MongoDB client for the whole request, registered as a singleton in
 * AppServiceProvider. Documents come back as plain PHP arrays (the type map),
 * which keeps the code simple and the JSON output predictable.
 */
final class Mongo
{
    private Database $db;

    public function __construct(private Client $client, string $database)
    {
        $this->db = $client->selectDatabase($database, [
            'typeMap' => ['root' => 'array', 'document' => 'array', 'array' => 'array'],
        ]);
    }

    public function collection(string $name): Collection
    {
        return $this->db->selectCollection($name);
    }

    /**
     * Runs $fn in a multi-document transaction and retries it on transient errors.
     * $fn receives the options array to pass to every operation, e.g.
     * $coll->insertOne($doc, $opts), which is how a write joins the transaction.
     *
     * @template T
     *
     * @param  callable(array{session: Session}): T  $fn
     * @return T
     */
    public function transaction(callable $fn): mixed
    {
        $session = $this->client->startSession();
        $result = null;
        try {
            \MongoDB\with_transaction($session, function (Session $session) use ($fn, &$result) {
                $result = $fn(['session' => $session]);
            });
        } finally {
            $session->endSession();
        }

        return $result;
    }

    /** E11000: a unique index rejected the write. */
    public static function isDuplicateKey(\Throwable $e): bool
    {
        return ($e instanceof BulkWriteException || $e instanceof CommandException)
            && ($e->getCode() === 11000 || str_contains($e->getMessage(), 'E11000'));
    }
}
