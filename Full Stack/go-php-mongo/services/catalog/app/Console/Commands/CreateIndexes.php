<?php

namespace App\Console\Commands;

use App\Data\Mongo;
use Illuminate\Console\Command;

/** php artisan catalog:indexes -- idempotent, run at every container start. */
final class CreateIndexes extends Command
{
    protected $signature = 'catalog:indexes';

    protected $description = 'Create the MongoDB indexes the catalog needs';

    public function handle(Mongo $mongo): int
    {
        $mongo->collection('products')->createIndexes([
            ['key' => ['slug' => 1], 'unique' => true],
            ['key' => ['status' => 1, 'priceMin' => 1]],
            ['key' => ['categoryIds' => 1, 'status' => 1]],
            ['key' => ['variants.sku' => 1]],
            ['key' => ['createdAt' => -1]],
            // One text index per collection. Weights make a match in the name count
            // ten times more than a match in the description when ranking results.
            ['key' => ['name' => 'text', 'brand' => 'text', 'description' => 'text'],
                'weights' => ['name' => 10, 'brand' => 5, 'description' => 1], 'name' => 'product_text'],
        ]);
        $mongo->collection('categories')->createIndexes([
            ['key' => ['slug' => 1], 'unique' => true],
            ['key' => ['path' => 1]],
            ['key' => ['parentId' => 1]],
        ]);
        $mongo->collection('reviews')->createIndexes([
            ['key' => ['productId' => 1, 'status' => 1, 'createdAt' => -1]],
            ['key' => ['status' => 1, 'createdAt' => -1]],
            ['key' => ['userId' => 1, 'productId' => 1], 'unique' => true], // one review per buyer
        ]);
        $mongo->collection('outbox')->createIndexes([['key' => ['sentAt' => 1, 'occurredAt' => 1]]]);
        $mongo->collection('processed_events')->createIndexes([['key' => ['expiresAt' => 1], 'expireAfterSeconds' => 0]]);

        $this->info('Indexes ready.');

        return self::SUCCESS;
    }
}
