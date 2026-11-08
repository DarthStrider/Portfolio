<?php

namespace App\Http\Controllers;

use App\Data\CatalogRepository;
use App\Data\ProductRepository;
use App\Domain\CategoryTree;
use App\Domain\Placeholder;
use App\Domain\ProductQuery;
use App\Domain\Slug;
use App\Support\ApiException;
use App\Support\Present;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\BinaryFileResponse;
use Illuminate\Http\Response;

/** Public, read-only endpoints the storefront calls. */
final class StorefrontController
{
    public function __construct(private ProductRepository $products, private CatalogRepository $catalog) {}

    /** GET /catalog/products?q=&category=&minPrice=&maxPrice=&inStock=1&sort=&page= */
    public function products(Request $request): JsonResponse
    {
        $categoryIds = null;
        if ($slug = $request->query('category')) {
            $cat = $this->catalog->categoryBySlug((string) $slug);
            if ($cat === null) {
                throw ApiException::notFound('category');
            }
            // Choosing "Apparel" also shows products filed under T-shirts and Hoodies.
            $categoryIds = CategoryTree::descendantsAndSelf($this->catalog->categories(), $cat['_id']);
        }
        $q = ProductQuery::build($request->query(), $categoryIds);
        $res = $this->products->search($q);

        return response()->json([
            'items' => Present::docs($res['items']),
            'total' => $res['total'],
            'page' => $q['page'],
            'perPage' => $q['perPage'],
            'priceRange' => ['minCents' => $res['priceMin'], 'maxCents' => $res['priceMax']],
        ]);
    }

    /** GET /catalog/products/{slug}: the product page, with breadcrumbs. */
    public function product(string $slug): JsonResponse
    {
        $p = $this->products->findBySlug($slug);
        if ($p === null) {
            throw ApiException::notFound('product');
        }
        $cats = $this->catalog->categories();
        $byId = array_column($cats, null, 'id');
        $crumbs = [];
        if ($first = ($p['categoryIds'][0] ?? null)) {
            foreach ([...($byId[$first]['path'] ?? []), $first] as $cid) {
                if (isset($byId[$cid])) {
                    $crumbs[] = ['id' => $cid, 'name' => $byId[$cid]['name'], 'slug' => $byId[$cid]['slug']];
                }
            }
        }

        return response()->json(Present::doc($p) + ['breadcrumbs' => $crumbs]);
    }

    /** GET /catalog/categories: the navigation tree. */
    public function categories(): JsonResponse
    {
        return response()->json(['items' => CategoryTree::nest($this->catalog->categories())]);
    }

    /** GET /content/pages/{slug} */
    public function page(string $slug): JsonResponse
    {
        $page = $this->catalog->page($slug);
        if ($page === null || ! ($page['published'] ?? false)) {
            throw ApiException::notFound('page');
        }

        return response()->json(Present::doc($page));
    }

    /** GET /catalog/placeholder/{slug}.svg: generated artwork, cached by browsers for a day. */
    public function placeholder(string $slug): Response
    {
        return response(Placeholder::svg(Slug::from($slug)), 200, [
            'Content-Type' => 'image/svg+xml',
            'Cache-Control' => 'public, max-age=86400',
            'X-Content-Type-Options' => 'nosniff',
        ]);
    }

    /** GET /catalog/images/{file}: an uploaded product photo. */
    public function image(string $file): BinaryFileResponse
    {
        // The route pattern only allows [a-f0-9]+\.(jpg|png|webp), so no ../ can reach here.
        $path = rtrim(config('catalog.upload_dir'), '/').'/'.$file;
        if (! is_file($path)) {
            throw ApiException::notFound('image');
        }

        return response()->file($path, ['Cache-Control' => 'public, max-age=31536000, immutable']);
    }
}
