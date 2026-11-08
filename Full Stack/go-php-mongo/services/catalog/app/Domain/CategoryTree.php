<?php

namespace App\Domain;

/**
 * Categories are stored flat, each with its parentId and the list of its ancestors
 * ("path"). That "materialized path" makes the two common questions cheap:
 * "what's under Apparel?" is {path: apparelId}, and breadcrumbs are just path in order.
 */
final class CategoryTree
{
    /**
     * Nest a flat list for the navigation menu.
     *
     * @param  list<array<string, mixed>>  $flat
     * @return list<array<string, mixed>>
     */
    public static function nest(array $flat): array
    {
        usort($flat, fn ($a, $b) => [$a['position'] ?? 0, $a['name']] <=> [$b['position'] ?? 0, $b['name']]);
        $byParent = [];
        foreach ($flat as $c) {
            $byParent[$c['parentId'] ?? ''][] = $c;
        }
        $build = function (string $parent) use (&$build, $byParent): array {
            $out = [];
            foreach ($byParent[$parent] ?? [] as $c) {
                $c['children'] = $build($c['id']);
                $out[] = $c;
            }

            return $out;
        };

        return $build('');
    }

    /**
     * IDs of a category and everything below it.
     *
     * @param  list<array<string, mixed>>  $flat
     * @return list<string>
     */
    public static function descendantsAndSelf(array $flat, string $id): array
    {
        $ids = [$id];
        foreach ($flat as $c) {
            if (in_array($id, $c['path'] ?? [], true)) {
                $ids[] = $c['id'];
            }
        }

        return $ids;
    }

    /**
     * The path for a new or moved category, refusing moves that would create a loop.
     *
     * @param  list<array<string, mixed>>  $flat
     * @return list<string>|null null when the parent is unknown or would be its own ancestor
     */
    public static function pathFor(array $flat, ?string $parentId, ?string $selfId = null): ?array
    {
        if ($parentId === null || $parentId === '') {
            return [];
        }
        foreach ($flat as $c) {
            if ($c['id'] === $parentId) {
                $path = array_merge($c['path'] ?? [], [$parentId]);
                if ($selfId !== null && in_array($selfId, $path, true)) {
                    return null;
                }

                return $path;
            }
        }

        return null;
    }
}
