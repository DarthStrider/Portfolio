<?php

namespace Tests\Unit;

use App\Domain\ProductInput;
use PHPUnit\Framework\TestCase;

final class ProductInputTest extends TestCase
{
    private function valid(array $overrides = []): array
    {
        return array_replace([
            'name' => 'Trailhead Hoodie',
            'description' => 'Warm.',
            'status' => 'active',
            'categoryIds' => ['c1'],
            'images' => [['url' => '/api/v1/catalog/placeholder/trailhead-hoodie.svg']],
            'attributes' => ['material' => 'Fleece', 'empty' => ''],
            'variants' => [
                ['sku' => 'hood-m', 'options' => ['Size' => 'M'], 'priceCents' => 7200, 'initialStock' => 5],
                ['sku' => 'HOOD-L', 'options' => ['size' => 'L'], 'priceCents' => 7500],
            ],
        ], $overrides);
    }

    public function test_normalizes_a_valid_product(): void
    {
        [$doc, $errors] = ProductInput::validate($this->valid(), ['c1']);

        $this->assertSame([], $errors);
        $this->assertSame('trailhead-hoodie', $doc['slug']);
        $this->assertSame('HOOD-M', $doc['variants'][0]['sku']);
        $this->assertSame(['size' => 'M'], $doc['variants'][0]['options']);
        $this->assertSame(7200, $doc['priceMin']);
        $this->assertSame(7500, $doc['priceMax']);
        $this->assertSame(['material' => 'Fleece'], (array) $doc['attributes']);
        $this->assertSame('Trailhead Hoodie', $doc['images'][0]['alt']);
    }

    public function test_reports_errors_per_field(): void
    {
        [$doc, $errors] = ProductInput::validate($this->valid([
            'name' => '',
            'status' => 'live',
            'categoryIds' => ['gone'],
            'images' => [['url' => 'javascript:alert(1)']],
            'variants' => [
                ['sku' => 'A1', 'priceCents' => 100],
                ['sku' => 'a1', 'priceCents' => '100'],
                ['sku' => 'B!', 'priceCents' => 500, 'compareAtCents' => 400],
            ],
        ]), ['c1']);

        $this->assertNull($doc);
        foreach (['name', 'status', 'categoryIds', 'images.0.url', 'variants.1.sku', 'variants.1.priceCents',
            'variants.2.sku', 'variants.2.compareAtCents'] as $field) {
            $this->assertArrayHasKey($field, $errors, "missing error for $field");
        }
    }

    public function test_requires_a_variant(): void
    {
        [, $errors] = ProductInput::validate($this->valid(['variants' => []]), ['c1']);
        $this->assertArrayHasKey('variants', $errors);
    }

    public function test_stored_variants_drop_initial_stock_and_keep_availability(): void
    {
        $stored = ProductInput::storedVariants(
            [['sku' => 'A', 'priceCents' => 1, 'initialStock' => 9], ['sku' => 'B', 'priceCents' => 1, 'initialStock' => 0]],
            ['A' => 4],
        );
        $this->assertArrayNotHasKey('initialStock', $stored[0]);
        $this->assertSame(4, $stored[0]['available']);
        $this->assertSame(0, $stored[1]['available']);
    }
}
