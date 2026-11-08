<?php

namespace App\Http\Controllers;

use App\Data\CatalogRepository;
use App\Data\ProductRepository;
use App\Support\ApiException;
use App\Support\Present;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Reviews from verified buyers only. "Verified" comes from order.placed events: when
 * someone pays for a product, order-service announces it and this service records
 * the purchase. No call to order-service is needed to check.
 */
final class ReviewController
{
    public function __construct(private ProductRepository $products, private CatalogRepository $catalog) {}

    /** GET /catalog/products/{id}/reviews (token optional: it decides canReview) */
    public function index(Request $request, string $id): JsonResponse
    {
        if ($this->products->find($id) === null) {
            throw ApiException::notFound('product');
        }
        $user = $request->attributes->get('user');
        $canReview = $user !== null
            && $this->catalog->hasPurchased($user['id'], $id)
            && ! $this->catalog->hasReviewed($user['id'], $id);
        [$avg, $count] = $this->catalog->ratingFor($id);
        $reviews = array_map(function ($r) {
            unset($r['userId']); // reviewers are shown by first name only

            return $r;
        }, $this->catalog->reviews($id));

        return response()->json([
            'items' => Present::docs($reviews),
            'average' => $avg,
            'count' => $count,
            'canReview' => $canReview,
        ]);
    }

    /** POST /catalog/products/{id}/reviews */
    public function store(Request $request, string $id): JsonResponse
    {
        $user = $request->attributes->get('user');
        if ($this->products->find($id) === null) {
            throw ApiException::notFound('product');
        }
        $data = $request->validate([
            'rating' => ['required', 'integer', 'between:1,5'],
            'title' => ['required', 'string', 'max:120'],
            'body' => ['required', 'string', 'max:3000'],
            'name' => ['required', 'string', 'max:60'],
        ]);
        if (! $this->catalog->hasPurchased($user['id'], $id)) {
            throw new ApiException(403, 'not_a_buyer', 'Only customers who bought this product can review it.');
        }
        if ($this->catalog->hasReviewed($user['id'], $id)) {
            throw ApiException::conflict('already_reviewed', 'You have already reviewed this product.');
        }
        $this->catalog->insertReview([
            'productId' => $id,
            'userId' => $user['id'],
            'name' => strtok(trim($data['name']), ' ') ?: 'Customer',
            'rating' => (int) $data['rating'],
            'title' => trim($data['title']),
            'body' => trim($data['body']),
            'status' => 'pending', // staff approve before it appears
        ]);

        return response()->json(['message' => 'Thanks! Your review will appear once it has been checked.'], 202);
    }
}
