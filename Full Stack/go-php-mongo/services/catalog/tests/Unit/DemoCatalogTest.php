<?php

namespace Tests\Unit;

use App\Domain\DemoCatalog;
use App\Domain\ProductInput;
use App\Domain\Slug;
use PHPUnit\Framework\TestCase;

final class DemoCatalogTest extends TestCase
{
    public function test_every_demo_product_passes_admin_validation(): void
    {
        $categories = array_column(DemoCatalog::CATEGORIES, 0);
        $skus = [];
        foreach (DemoCatalog::products() as [$name, $category, $description, $variants, $attributes]) {
            $this->assertTrue(in_array($category, $categories, true), "$name: unknown category $category");
            $slug = Slug::from($name);
            [$doc, $errors] = ProductInput::validate([
                'name' => $name, 'description' => $description, 'status' => 'active', 'categoryIds' => ['c'],
                'images' => [['url' => "/api/v1/catalog/placeholder/$slug.svg"]], 'attributes' => $attributes, 'variants' => $variants,
            ], ['c']);
            $this->assertSame([], $errors, $name);
            foreach ($doc['variants'] as $v) {
                $this->assertFalse(isset($skus[$v['sku']]), "duplicate SKU {$v['sku']}");
                $skus[$v['sku']] = true;
            }
        }
    }
}
