<?php

use App\Http\Controllers\Admin\ContentAdminController;
use App\Http\Controllers\Admin\ProductAdminController;
use App\Http\Controllers\ReviewController;
use App\Http\Controllers\StorefrontController;
use Illuminate\Support\Facades\Route;

// All routes are under /api/v1 (set in bootstrap/app.php). The gateway sends
// /api/v1/catalog, /api/v1/content and the matching /api/v1/admin paths here.

Route::pattern('id', '[0-9a-f]{24}');
Route::pattern('slug', '[a-z0-9]+(?:-[a-z0-9]+)*');

// ---------- storefront (public) ----------
Route::get('catalog/products', [StorefrontController::class, 'products']);
Route::get('catalog/products/{slug}', [StorefrontController::class, 'product']);
Route::get('catalog/categories', [StorefrontController::class, 'categories']);
Route::get('catalog/placeholder/{slug}.svg', [StorefrontController::class, 'placeholder']);
Route::get('catalog/images/{file}', [StorefrontController::class, 'image'])->where('file', '[a-f0-9]{24}\.(jpg|png|webp)');
Route::get('content/pages/{slug}', [StorefrontController::class, 'page']);

Route::get('catalog/products/{id}/reviews', [ReviewController::class, 'index'])->middleware('jwt:optional');
Route::post('catalog/products/{id}/reviews', [ReviewController::class, 'store'])
    ->middleware(['jwt', 'throttle:10,1']);

// ---------- admin (staff) ----------
Route::prefix('admin')->middleware('jwt:staff')->group(function () {
    Route::get('catalog/products', [ProductAdminController::class, 'index']);
    Route::post('catalog/products', [ProductAdminController::class, 'store']);
    Route::get('catalog/products/{id}', [ProductAdminController::class, 'show']);
    Route::put('catalog/products/{id}', [ProductAdminController::class, 'update']);
    Route::delete('catalog/products/{id}', [ProductAdminController::class, 'destroy'])->middleware('jwt:admin');
    Route::post('catalog/images', [ProductAdminController::class, 'upload']);

    Route::get('catalog/categories', [ContentAdminController::class, 'categories']);
    Route::post('catalog/categories', [ContentAdminController::class, 'saveCategory']);
    Route::put('catalog/categories/{id}', [ContentAdminController::class, 'saveCategory']);
    Route::delete('catalog/categories/{id}', [ContentAdminController::class, 'deleteCategory']);

    Route::get('catalog/reviews', [ContentAdminController::class, 'reviews']);
    Route::post('catalog/reviews/{id}/status', [ContentAdminController::class, 'moderate']);

    Route::get('content/pages', [ContentAdminController::class, 'pages']);
    Route::get('content/pages/{slug}', [ContentAdminController::class, 'page']);
    Route::put('content/pages/{slug}', [ContentAdminController::class, 'savePage']);
});
