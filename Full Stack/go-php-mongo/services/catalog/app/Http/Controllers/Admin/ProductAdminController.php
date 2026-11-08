<?php

namespace App\Http\Controllers\Admin;

use App\Data\CatalogRepository;
use App\Data\Mongo;
use App\Data\Outbox;
use App\Data\ProductRepository;
use App\Domain\Event;
use App\Domain\Ids;
use App\Domain\ProductInput;
use App\Domain\ProductQuery;
use App\Support\ApiException;
use App\Support\Present;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** Staff product management. Every write publishes product.updated (or .deleted). */
final class ProductAdminController
{
    public function __construct(
        private Mongo $mongo,
        private ProductRepository $products,
        private CatalogRepository $catalog,
        private Outbox $outbox,
    ) {}

    public function index(Request $request): JsonResponse
    {
        $q = ProductQuery::build($request->query() + ['sort' => 'newest', 'perPage' => 48], null, includeHidden: true);
        $res = $this->products->search($q);

        return response()->json(['items' => Present::docs($res['items']), 'total' => $res['total'], 'page' => $q['page']]);
    }

    public function show(string $id): JsonResponse
    {
        $p = $this->products->find($id);
        if ($p === null) {
            throw ApiException::notFound('product');
        }

        return response()->json(Present::doc($p));
    }

    public function store(Request $request): JsonResponse
    {
        [$doc, $initialStock] = $this->validated($request);
        $doc['_id'] = Ids::new();
        $doc['variants'] = ProductInput::storedVariants($doc['variants'], []);
        $doc['inStock'] = false; // becomes true when order-service reports stock

        $this->write(function (array $opts) use ($doc, $initialStock) {
            $this->products->insert($doc, $opts);
            $this->outbox->add(Event::productUpdated($doc, $initialStock), $opts);
        });

        return response()->json(Present::doc($this->products->find($doc['_id'])), 201);
    }

    public function update(Request $request, string $id): JsonResponse
    {
        $existing = $this->products->find($id);
        if ($existing === null) {
            throw ApiException::notFound('product');
        }
        [$doc, $initialStock] = $this->validated($request, $id);
        $available = $this->products->availability($existing);
        // Starting stock only applies to SKUs order-service hasn't seen yet; it ignores
        // the rest. Sending only new SKUs' values keeps the event honest.
        $initialStock = array_diff_key($initialStock, $available);
        $doc['variants'] = ProductInput::storedVariants($doc['variants'], $available);
        $doc['inStock'] = array_sum(array_column($doc['variants'], 'available')) > 0;

        $this->write(function (array $opts) use ($id, $doc, $initialStock) {
            $this->products->update($id, $doc, $opts);
            $this->outbox->add(Event::productUpdated(['_id' => $id] + $doc, $initialStock), $opts);
        });

        return response()->json(Present::doc($this->products->find($id)));
    }

    public function destroy(string $id): JsonResponse
    {
        $p = $this->products->find($id);
        if ($p === null) {
            throw ApiException::notFound('product');
        }
        $this->mongo->transaction(function (array $opts) use ($id) {
            $this->products->delete($id, $opts);
            $this->outbox->add(Event::make(Event::PRODUCT_DELETED, ['productId' => $id]), $opts);
        });

        return response()->json(null, 204);
    }

    /** POST /admin/catalog/images: multipart upload, returns the URL to put in the form. */
    public function upload(Request $request): JsonResponse
    {
        $request->validate(['file' => ['required', 'file', 'mimes:jpg,jpeg,png,webp', 'max:4096']]);
        $file = $request->file('file');
        $ext = $file->guessExtension() === 'jpeg' ? 'jpg' : $file->guessExtension();
        // A random name: never trust the uploaded filename on disk.
        $name = Ids::new().'.'.$ext;
        $file->move(config('catalog.upload_dir'), $name);

        return response()->json(['url' => '/api/v1/catalog/images/'.$name], 201);
    }

    /** @return array{0: array<string, mixed>, 1: array<string, int>} */
    private function validated(Request $request, ?string $id = null): array
    {
        $categoryIds = array_column($this->catalog->categories(), 'id');
        [$doc, $errors] = ProductInput::validate($request->json()->all(), $categoryIds);
        if ($doc === null) {
            throw ApiException::invalid($errors);
        }
        if ($this->products->slugTaken($doc['slug'], $id)) {
            throw ApiException::invalid(['slug' => 'Another product already uses this URL.']);
        }
        $initialStock = array_column($doc['variants'], 'initialStock', 'sku');

        return [$doc, $initialStock];
    }

    private function write(callable $fn): void
    {
        try {
            $this->mongo->transaction($fn);
        } catch (\Throwable $e) {
            // The unique index on slug is the real guard against two admins racing.
            if (Mongo::isDuplicateKey($e)) {
                throw ApiException::invalid(['slug' => 'Another product already uses this URL.']);
            }
            throw $e;
        }
    }
}
