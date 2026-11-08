<?php

namespace App\Domain;

/**
 * Turns storefront query parameters into a MongoDB filter, sort and page.
 *
 * Kept free of the database client so the translation is unit-tested: the
 * repository only executes what this class builds.
 */
final class ProductQuery
{
    public const SORTS = [
        'featured' => ['rating.count' => -1, 'name' => 1],
        'newest' => ['createdAt' => -1],
        'price_asc' => ['priceMin' => 1, 'name' => 1],
        'price_desc' => ['priceMax' => -1, 'name' => 1],
        'rating' => ['rating.average' => -1, 'rating.count' => -1],
    ];

    public const MAX_PER_PAGE = 48;

    /**
     * @param  array<string, mixed>  $params  raw query string values
     * @param  list<string>|null  $categoryIds  the chosen category plus its descendants, or null
     * @return array{filter: array<string, mixed>, sort: array<string, int>, skip: int, limit: int, page: int, perPage: int, text: bool}
     */
    public static function build(array $params, ?array $categoryIds = null, bool $includeHidden = false): array
    {
        $filter = $includeHidden ? [] : ['status' => 'active'];
        if ($includeHidden && in_array($params['status'] ?? null, ProductInput::STATUSES, true)) {
            $filter['status'] = $params['status'];
        }
        if ($categoryIds !== null) {
            // categoryIds is an array on each product; $in matches if any element matches.
            $filter['categoryIds'] = ['$in' => array_values($categoryIds)];
        }

        $min = self::dollarsToCents($params['minPrice'] ?? null);
        $max = self::dollarsToCents($params['maxPrice'] ?? null);
        // A product matches a price range if any of its variants could fall inside it.
        if ($min !== null) {
            $filter['priceMax'] = ['$gte' => $min];
        }
        if ($max !== null) {
            $filter['priceMin'] = ['$lte' => $max];
        }
        if (($params['inStock'] ?? '') === '1') {
            $filter['inStock'] = true;
        }

        $q = trim((string) ($params['q'] ?? ''));
        $text = false;
        if ($q !== '') {
            // Uses the text index on name, description and brand. Text search
            // understands word stems ("hoodies" finds "hoodie") and ranks by relevance.
            $filter['$text'] = ['$search' => mb_substr($q, 0, 100)];
            $text = true;
        }

        $sortKey = (string) ($params['sort'] ?? '');
        if ($text && ($sortKey === '' || $sortKey === 'relevance')) {
            $sort = ['score' => ['$meta' => 'textScore']];
        } else {
            $sort = self::SORTS[$sortKey] ?? self::SORTS['featured'];
        }
        $sort['_id'] = 1; // a unique tiebreaker, so pages never repeat or skip items

        $perPage = (int) ($params['perPage'] ?? 12);
        $perPage = max(1, min($perPage, self::MAX_PER_PAGE));
        $page = max(1, (int) ($params['page'] ?? 1));

        return [
            'filter' => $filter,
            'sort' => $sort,
            'skip' => ($page - 1) * $perPage,
            'limit' => $perPage,
            'page' => $page,
            'perPage' => $perPage,
            'text' => $text,
        ];
    }

    private static function dollarsToCents(mixed $v): ?int
    {
        if ($v === null || $v === '' || ! is_numeric($v) || (float) $v < 0) {
            return null;
        }

        return (int) round(((float) $v) * 100);
    }
}
