<?php

namespace App\Console\Commands;

use App\Data\CatalogRepository;
use App\Data\Mongo;
use App\Data\Outbox;
use App\Data\ProductRepository;
use App\Domain\CategoryTree;
use App\Domain\DemoCatalog;
use App\Domain\Event;
use App\Domain\Ids;
use App\Domain\ProductInput;
use App\Domain\Slug;
use Illuminate\Console\Command;

/**
 * php artisan catalog:seed -- loads the demo store once (skips if any product exists).
 *
 * Products go through the same validation and the same outbox as the admin panel, so
 * seeding also exercises the event flow: order-service receives product.updated,
 * creates stock records, and answers with stock.changed.
 */
final class SeedCatalog extends Command
{
    protected $signature = 'catalog:seed';

    protected $description = 'Load the demo catalog, categories and pages';

    public function handle(Mongo $mongo, ProductRepository $products, CatalogRepository $catalog, Outbox $outbox): int
    {
        if (! $products->isEmpty()) {
            $this->info('Catalog already has products; skipping seed.');

            return self::SUCCESS;
        }

        $ids = [];
        foreach (DemoCatalog::CATEGORIES as [$name, $parent, $pos]) {
            $id = Ids::new();
            $catalog->saveCategory([
                '_id' => $id, 'name' => $name, 'slug' => Slug::from($name),
                'parentId' => $parent ? $ids[$parent] : null,
                'path' => CategoryTree::pathFor($catalog->categories(), $parent ? $ids[$parent] : null) ?? [],
                'description' => '', 'position' => $pos,
            ]);
            $ids[$name] = $id;
        }

        $items = DemoCatalog::products();

        $categoryIds = array_values($ids);
        foreach ($items as $i => [$name, $category, $description, $variants, $attributes]) {
            $slug = Slug::from($name);
            [$doc, $errors] = ProductInput::validate([
                'name' => $name, 'slug' => $slug, 'description' => $description, 'brand' => 'Northline',
                'status' => 'active', 'categoryIds' => [$ids[$category]],
                'images' => [['url' => "/api/v1/catalog/placeholder/$slug.svg", 'alt' => $name]],
                'attributes' => $attributes, 'variants' => $variants,
            ], $categoryIds);
            if ($doc === null) {
                $this->error("$name: ".json_encode($errors));

                return self::FAILURE;
            }
            $initialStock = array_column($doc['variants'], 'initialStock', 'sku');
            $doc['_id'] = Ids::new();
            $doc['variants'] = ProductInput::storedVariants($doc['variants'], []);
            $doc['inStock'] = false;
            $doc['rating'] = ['average' => 0, 'count' => 0];
            $mongo->transaction(function (array $opts) use ($products, $outbox, $doc, $initialStock) {
                $products->insert($doc, $opts);
                $outbox->add(Event::productUpdated($doc, $initialStock), $opts);
            });
            usleep(2000); // distinct createdAt values, so "newest" sorting is stable
        }

        $catalog->savePage('about', 'About Northline',
            "Northline makes durable, simple goods for people who spend their weekends outside.\n\nEverything we sell is designed in Toronto and built to be repaired, not replaced.", true);
        $catalog->savePage('shipping', 'Shipping',
            "We ship across Canada.\n\nOrders over \$75 ship free. Below that, shipping is a flat \$9.99.\n\nMost orders leave our warehouse within two business days.", true);
        $catalog->savePage('returns', 'Returns',
            "Changed your mind? Return unused items within 30 days for a full refund.\n\nWe refund to the original payment method once the item is back with us.", true);

        $this->info(count($items).' products, '.count($ids).' categories and 3 pages created.');

        return self::SUCCESS;
    }
}
