<?php

namespace App\Domain;

/**
 * Validates and normalizes the product form an admin submits.
 *
 * Plain PHP with no framework, so the rules are unit-tested directly. It returns either
 * a clean document or a map of field errors, keyed the way the React form names its
 * inputs ("variants.1.sku"), so each message appears under the right box.
 */
final class ProductInput
{
    public const STATUSES = ['draft', 'active', 'archived'];

    public const MAX_PRICE_CENTS = 10_000_000;

    /**
     * @param  array<string, mixed>  $in
     * @param  list<string>  $knownCategoryIds
     * @return array{0: array<string, mixed>|null, 1: array<string, string>}
     */
    public static function validate(array $in, array $knownCategoryIds): array
    {
        $errors = [];
        $name = trim((string) ($in['name'] ?? ''));
        if ($name === '' || mb_strlen($name) > 120) {
            $errors['name'] = 'Enter a name up to 120 characters.';
        }
        $slug = trim((string) ($in['slug'] ?? ''));
        $slug = $slug === '' ? Slug::from($name) : $slug;
        if (! Slug::valid($slug)) {
            $errors['slug'] = 'Use lowercase letters, digits and dashes.';
        }
        $description = trim((string) ($in['description'] ?? ''));
        if (mb_strlen($description) > 5000) {
            $errors['description'] = 'Keep the description under 5,000 characters.';
        }
        $status = (string) ($in['status'] ?? 'draft');
        if (! in_array($status, self::STATUSES, true)) {
            $errors['status'] = 'Choose draft, active or archived.';
        }

        $categoryIds = array_values(array_unique(array_map('strval', (array) ($in['categoryIds'] ?? []))));
        foreach ($categoryIds as $cid) {
            if (! in_array($cid, $knownCategoryIds, true)) {
                $errors['categoryIds'] = 'One of the categories no longer exists.';
            }
        }

        $images = [];
        foreach (array_values((array) ($in['images'] ?? [])) as $i => $img) {
            $url = trim((string) ($img['url'] ?? ''));
            // Only our own upload paths or https URLs: never javascript: or data: URLs
            // that would end up in an <img src> on the storefront.
            if (! preg_match('#^(/api/v1/catalog/(images|placeholder)/[A-Za-z0-9._-]+|https://\S+)$#', $url)) {
                $errors["images.$i.url"] = 'Upload an image or use an https:// link.';

                continue;
            }
            $images[] = ['url' => $url, 'alt' => mb_substr(trim((string) ($img['alt'] ?? $name)), 0, 160)];
        }

        $attributes = [];
        foreach ((array) ($in['attributes'] ?? []) as $k => $v) {
            $k = trim((string) $k);
            if ($k !== '' && trim((string) $v) !== '') {
                $attributes[mb_substr($k, 0, 40)] = mb_substr(trim((string) $v), 0, 200);
            }
        }

        $variants = [];
        $seen = [];
        $rawVariants = array_values((array) ($in['variants'] ?? []));
        if ($rawVariants === []) {
            $errors['variants'] = 'Add at least one variant (a SKU with a price).';
        }
        foreach ($rawVariants as $i => $v) {
            $sku = strtoupper(trim((string) ($v['sku'] ?? '')));
            if (! preg_match('/^[A-Z0-9][A-Z0-9-]{1,39}$/', $sku)) {
                $errors["variants.$i.sku"] = 'Use 2 to 40 letters, digits and dashes.';
            } elseif (isset($seen[$sku])) {
                $errors["variants.$i.sku"] = 'This SKU is used twice.';
            }
            $seen[$sku] = true;

            $price = $v['priceCents'] ?? null;
            if (! is_int($price) || $price < 0 || $price > self::MAX_PRICE_CENTS) {
                $errors["variants.$i.priceCents"] = 'Enter a price between $0 and $100,000.';
            }
            $compareAt = $v['compareAtCents'] ?? null;
            if ($compareAt !== null && (! is_int($compareAt) || (is_int($price) && $compareAt <= $price))) {
                $errors["variants.$i.compareAtCents"] = 'A "was" price must be higher than the price.';
            }
            $stock = $v['initialStock'] ?? 0;
            if (! is_int($stock) || $stock < 0 || $stock > 100_000) {
                $errors["variants.$i.initialStock"] = 'Starting stock must be 0 to 100,000.';
            }

            $options = [];
            foreach ((array) ($v['options'] ?? []) as $ok => $ov) {
                $ok = strtolower(trim((string) $ok));
                if ($ok !== '' && trim((string) $ov) !== '') {
                    $options[$ok] = trim((string) $ov);
                }
            }
            $variants[] = [
                'sku' => $sku,
                'options' => $options,
                'priceCents' => is_int($price) ? $price : 0,
                'compareAtCents' => is_int($compareAt) ? $compareAt : null,
                'initialStock' => is_int($stock) ? $stock : 0,
            ];
        }

        if ($errors !== []) {
            return [null, $errors];
        }

        $prices = array_column($variants, 'priceCents');

        return [[
            'name' => $name,
            'slug' => $slug,
            'description' => $description,
            'brand' => mb_substr(trim((string) ($in['brand'] ?? '')), 0, 80),
            'status' => $status,
            'categoryIds' => $categoryIds,
            'images' => $images,
            'attributes' => (object) $attributes, // stays a JSON object even when empty
            'variants' => $variants,
            // Denormalized so listing pages can filter and sort by price with an index,
            // instead of unwinding every product's variants on every request.
            'priceMin' => min($prices),
            'priceMax' => max($prices),
        ], []];
    }

    /**
     * The variant shape that is stored: initialStock is only an instruction for
     * order-service (which owns stock) and is never saved in the catalog.
     *
     * @param  list<array<string, mixed>>  $variants
     * @param  array<string, int>  $available  current stock by SKU, kept from stock.changed events
     * @return list<array<string, mixed>>
     */
    public static function storedVariants(array $variants, array $available): array
    {
        return array_map(function (array $v) use ($available) {
            unset($v['initialStock']);
            $v['available'] = $available[$v['sku']] ?? 0;

            return $v;
        }, $variants);
    }
}
