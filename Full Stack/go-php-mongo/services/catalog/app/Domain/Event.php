<?php

namespace App\Domain;

/** The event envelope, identical to the Go services' events.Event. */
final class Event
{
    public const PRODUCT_UPDATED = 'product.updated';

    public const PRODUCT_DELETED = 'product.deleted';

    public const STOCK_CHANGED = 'stock.changed';

    public const ORDER_PLACED = 'order.placed';

    /**
     * @param  array<string, mixed>  $data
     * @return array{eventId: string, type: string, occurredAt: string, data: array<string, mixed>}
     */
    public static function make(string $type, array $data): array
    {
        return [
            'eventId' => Ids::new(),
            'type' => $type,
            // RFC 3339 in UTC with milliseconds: what Go's time.Time decodes from JSON.
            'occurredAt' => (new \DateTimeImmutable('now', new \DateTimeZone('UTC')))->format('Y-m-d\TH:i:s.v\Z'),
            'data' => $data,
        ];
    }

    /**
     * product.updated carries what order-service needs to sell the product.
     *
     * @param  array<string, mixed>  $product  stored product document
     * @param  array<string, int>  $initialStock  starting stock for new SKUs
     * @return array<string, mixed>
     */
    public static function productUpdated(array $product, array $initialStock = []): array
    {
        return self::make(self::PRODUCT_UPDATED, [
            'productId' => $product['_id'],
            'slug' => $product['slug'],
            'name' => $product['name'],
            'status' => $product['status'],
            'image' => $product['images'][0]['url'] ?? '',
            'variants' => array_map(fn ($v) => [
                'sku' => $v['sku'],
                'options' => (object) ($v['options'] ?? []),
                'priceCents' => $v['priceCents'],
                'initialStock' => $initialStock[$v['sku']] ?? 0,
            ], $product['variants']),
        ]);
    }
}
