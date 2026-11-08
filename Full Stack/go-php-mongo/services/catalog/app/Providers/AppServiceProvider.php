<?php

namespace App\Providers;

use App\Data\CatalogRepository;
use App\Data\Mongo;
use App\Data\Outbox;
use App\Data\ProductRepository;
use Illuminate\Support\ServiceProvider;
use MongoDB\Client;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        // One connection pool per PHP worker. Repositories get it injected by the
        // container, so controllers just type-hint what they need.
        $this->app->singleton(Mongo::class, fn () => new Mongo(
            new Client(config('catalog.mongo_uri')),
            config('catalog.mongo_db'),
        ));
        $this->app->singleton(ProductRepository::class);
        $this->app->singleton(CatalogRepository::class);
        $this->app->singleton(Outbox::class);
    }
}
