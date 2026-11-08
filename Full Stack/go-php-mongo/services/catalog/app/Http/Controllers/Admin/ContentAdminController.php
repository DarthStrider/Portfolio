<?php

namespace App\Http\Controllers\Admin;

use App\Data\CatalogRepository;
use App\Data\ProductRepository;
use App\Domain\CategoryTree;
use App\Domain\Ids;
use App\Domain\Slug;
use App\Support\ApiException;
use App\Support\Present;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** Staff management of categories, reviews and CMS pages. */
final class ContentAdminController
{
    public function __construct(private CatalogRepository $catalog, private ProductRepository $products) {}

    // ---------- categories ----------

    public function categories(): JsonResponse
    {
        return response()->json(['items' => $this->catalog->categories()]);
    }

    public function saveCategory(Request $request, ?string $id = null): JsonResponse
    {
        $data = $request->validate([
            'name' => ['required', 'string', 'max:60'],
            'slug' => ['nullable', 'string', 'max:60'],
            'parentId' => ['nullable', 'string'],
            'description' => ['nullable', 'string', 'max:500'],
            'position' => ['nullable', 'integer', 'between:0,1000'],
        ]);
        $existing = $id !== null ? $this->catalog->category($id) : null;
        if ($id !== null && $existing === null) {
            throw ApiException::notFound('category');
        }
        $id ??= Ids::new();
        $slug = Slug::from(($data['slug'] ?? '') ?: $data['name']);
        $other = $this->catalog->categoryBySlug($slug);
        if ($other !== null && $other['_id'] !== $id) {
            throw ApiException::invalid(['slug' => 'Another category already uses this URL.']);
        }
        $flat = $this->catalog->categories();
        $path = CategoryTree::pathFor($flat, $data['parentId'] ?? null, $id);
        if ($path === null) {
            throw ApiException::invalid(['parentId' => 'Choose a parent that is not this category or one inside it.']);
        }
        $this->catalog->saveCategory([
            '_id' => $id,
            'name' => trim($data['name']),
            'slug' => $slug,
            'parentId' => ($data['parentId'] ?? null) ?: null,
            'path' => $path,
            'description' => trim($data['description'] ?? ''),
            'position' => $data['position'] ?? 0,
        ]);
        if ($existing !== null && ($existing['path'] ?? []) !== $path) {
            $this->catalog->rebaseDescendants($id, [...($existing['path'] ?? []), $id], [...$path, $id]);
        }

        return response()->json(Present::doc($this->catalog->category($id)), $existing ? 200 : 201);
    }

    public function deleteCategory(string $id): JsonResponse
    {
        if ($this->catalog->hasChildren($id)) {
            throw ApiException::conflict('has_children', 'Move or delete the categories inside it first.');
        }
        if (($n = $this->products->countInCategory($id)) > 0) {
            throw ApiException::conflict('has_products', "$n products are filed here; move them first.");
        }
        $this->catalog->deleteCategory($id);

        return response()->json(null, 204);
    }

    // ---------- reviews ----------

    public function reviews(Request $request): JsonResponse
    {
        $status = (string) $request->query('status', 'pending');
        if (! in_array($status, ['pending', 'approved', 'rejected'], true)) {
            throw ApiException::invalid(['status' => 'Unknown status.']);
        }
        $items = $this->catalog->reviewsByStatus($status);
        $names = array_column($this->products->findManyAnyStatus(array_column($items, 'productId')), 'name', '_id');
        foreach ($items as &$r) {
            $r['productName'] = $names[$r['productId']] ?? '(deleted product)';
        }

        return response()->json(['items' => Present::docs($items)]);
    }

    /** Approving or rejecting a review recalculates the product's rating. */
    public function moderate(Request $request, string $id): JsonResponse
    {
        $data = $request->validate(['status' => ['required', 'in:approved,rejected']]);
        $review = $this->catalog->review($id);
        if ($review === null) {
            throw ApiException::notFound('review');
        }
        $this->catalog->setReviewStatus($id, $data['status']);
        [$avg, $count] = $this->catalog->ratingFor($review['productId']);
        $this->products->setRating($review['productId'], $avg, $count);

        return response()->json(Present::doc($this->catalog->review($id)));
    }

    // ---------- pages ----------

    public function pages(): JsonResponse
    {
        return response()->json(['items' => Present::docs($this->catalog->pages())]);
    }

    public function page(string $slug): JsonResponse
    {
        $page = $this->catalog->page($slug);
        if ($page === null) {
            throw ApiException::notFound('page');
        }

        return response()->json(Present::doc($page));
    }

    public function savePage(Request $request, string $slug): JsonResponse
    {
        if (! Slug::valid($slug)) {
            throw ApiException::invalid(['slug' => 'Use lowercase letters, digits and dashes.']);
        }
        $data = $request->validate([
            'title' => ['required', 'string', 'max:120'],
            'body' => ['required', 'string', 'max:20000'],
            'published' => ['required', 'boolean'],
        ]);
        $this->catalog->savePage($slug, trim($data['title']), $data['body'], (bool) $data['published']);

        return response()->json(Present::doc($this->catalog->page($slug)));
    }
}
