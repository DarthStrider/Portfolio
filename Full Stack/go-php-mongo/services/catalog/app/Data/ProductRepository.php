<?php

namespace App\Data;

use MongoDB\BSON\UTCDateTime;
use MongoDB\Collection;

final class ProductRepository
{
    private Collection $products;

    public function __construct(Mongo $mongo)
    {
        $this->products = $mongo->collection('products');
    }

    /**
     * Runs a ProductQuery in one aggregation: $facet returns the page of items, the
     * total for pagination and the price range for the filter slider together.
     *
     * @param  array<string, mixed>  $q  from ProductQuery::build
     * @return array{items: list<array<string, mixed>>, total: int, priceMin: int, priceMax: int}
     */
    public function search(array $q): array
    {
        $pipeline = [
            ['$match' => $q['filter']],
            ['$facet' => [
                'items' => [
                    ['$sort' => $q['sort']],
                    ['$skip' => $q['skip']],
                    ['$limit' => $q['limit']],
                    ['$project' => ['description' => 0]], // listings don't need the long text
                ],
                'total' => [['$count' => 'n']],
                'price' => [['$group' => ['_id' => null, 'min' => ['$min' => '$priceMin'], 'max' => ['$max' => '$priceMax']]]],
            ]],
        ];
        $res = iterator_to_array($this->products->aggregate($pipeline), false)[0] ?? [];

        return [
            'items' => $res['items'] ?? [],
            'total' => $res['total'][0]['n'] ?? 0,
            'priceMin' => $res['price'][0]['min'] ?? 0,
            'priceMax' => $res['price'][0]['max'] ?? 0,
        ];
    }

    /** @return array<string, mixed>|null */
    public function find(string $id): ?array
    {
        return $this->products->findOne(['_id' => $id]);
    }

    /** @return array<string, mixed>|null */
    public function findBySlug(string $slug, bool $activeOnly = true): ?array
    {
        $filter = ['slug' => $slug];
        if ($activeOnly) {
            $filter['status'] = 'active';
        }

        return $this->products->findOne($filter);
    }

    /** @param list<string> $ids @return list<array<string, mixed>> */
    public function findMany(array $ids): array
    {
        return iterator_to_array($this->products->find(['_id' => ['$in' => array_values($ids)], 'status' => 'active']), false);
    }

    /** Any status, for admin screens that name products. @param list<string> $ids @return list<array<string, mixed>> */
    public function findManyAnyStatus(array $ids): array
    {
        return iterator_to_array($this->products->find(['_id' => ['$in' => array_values(array_unique($ids))]],
            ['projection' => ['name' => 1, 'slug' => 1]]), false);
    }

    public function slugTaken(string $slug, ?string $exceptId = null): bool
    {
        $filter = ['slug' => $slug];
        if ($exceptId !== null) {
            $filter['_id'] = ['$ne' => $exceptId];
        }

        return $this->products->countDocuments($filter, ['limit' => 1]) > 0;
    }

    /** Current available stock by SKU for a product, to carry across an edit. @return array<string, int> */
    public function availability(?array $product): array
    {
        $out = [];
        foreach ($product['variants'] ?? [] as $v) {
            $out[$v['sku']] = (int) ($v['available'] ?? 0);
        }

        return $out;
    }

    /** @param array<string, mixed> $doc @param array<string, mixed> $opts */
    public function insert(array $doc, array $opts = []): void
    {
        $now = new UTCDateTime;
        $doc += ['rating' => ['average' => 0, 'count' => 0]];
        $doc['createdAt'] = $now;
        $doc['updatedAt'] = $now;
        $this->products->insertOne($doc, $opts);
    }

    /** @param array<string, mixed> $doc @param array<string, mixed> $opts */
    public function update(string $id, array $doc, array $opts = []): void
    {
        $doc['updatedAt'] = new UTCDateTime;
        $this->products->updateOne(['_id' => $id], ['$set' => $doc], $opts);
    }

    /** @param array<string, mixed> $opts */
    public function delete(string $id, array $opts = []): void
    {
        $this->products->deleteOne(['_id' => $id], $opts);
    }

    /**
     * Applies stock.changed: sets each variant's available count with the positional
     * operator ($ matches the array element the filter found), then recomputes inStock
     * for the products touched.
     *
     * @param  array<string, int>  $available  SKU => available
     */
    public function applyStock(array $available): void
    {
        foreach ($available as $sku => $n) {
            $this->products->updateOne(['variants.sku' => (string) $sku], ['$set' => ['variants.$.available' => max(0, (int) $n)]]);
        }
        $touched = $this->products->find(['variants.sku' => ['$in' => array_map('strval', array_keys($available))]],
            ['projection' => ['variants' => 1]]);
        foreach ($touched as $p) {
            $inStock = false;
            foreach ($p['variants'] as $v) {
                $inStock = $inStock || (($v['available'] ?? 0) > 0);
            }
            $this->products->updateOne(['_id' => $p['_id']], ['$set' => ['inStock' => $inStock]]);
        }
    }

    public function setRating(string $id, float $average, int $count): void
    {
        $this->products->updateOne(['_id' => $id], ['$set' => ['rating' => ['average' => $average, 'count' => $count]]]);
    }

    public function countInCategory(string $categoryId): int
    {
        return $this->products->countDocuments(['categoryIds' => $categoryId]);
    }

    public function isEmpty(): bool
    {
        return $this->products->countDocuments([], ['limit' => 1]) === 0;
    }
}
