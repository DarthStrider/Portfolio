<?php

namespace Tests\Unit;

use App\Domain\CategoryTree;
use App\Domain\Event;
use App\Domain\Placeholder;
use App\Domain\Slug;
use PHPUnit\Framework\TestCase;

final class CategoryAndEventTest extends TestCase
{
    private array $flat = [
        ['id' => 'apparel', 'name' => 'Apparel', 'parentId' => null, 'path' => [], 'position' => 0],
        ['id' => 'tees', 'name' => 'T-Shirts', 'parentId' => 'apparel', 'path' => ['apparel'], 'position' => 0],
        ['id' => 'vintage', 'name' => 'Vintage', 'parentId' => 'tees', 'path' => ['apparel', 'tees'], 'position' => 0],
        ['id' => 'home', 'name' => 'Home', 'parentId' => null, 'path' => [], 'position' => 1],
    ];

    public function test_nests_for_navigation(): void
    {
        $tree = CategoryTree::nest($this->flat);

        $this->assertSame(['apparel', 'home'], array_column($tree, 'id'));
        $this->assertSame('vintage', $tree[0]['children'][0]['children'][0]['id']);
    }

    public function test_descendants_use_the_materialized_path(): void
    {
        $this->assertSame(['apparel', 'tees', 'vintage'], CategoryTree::descendantsAndSelf($this->flat, 'apparel'));
        $this->assertSame(['home'], CategoryTree::descendantsAndSelf($this->flat, 'home'));
    }

    public function test_refuses_moving_a_category_under_itself(): void
    {
        $this->assertSame(['apparel', 'tees'], CategoryTree::pathFor($this->flat, 'tees'));
        $this->assertNull(CategoryTree::pathFor($this->flat, 'vintage', 'apparel'));
        $this->assertNull(CategoryTree::pathFor($this->flat, 'missing'));
        $this->assertSame([], CategoryTree::pathFor($this->flat, null));
    }

    public function test_slugs(): void
    {
        $this->assertSame('cafe-creme-and-co', Slug::from('Café Crème & Co.'));
        $this->assertSame('hoodies-and-jackets', Slug::from('Hoodies & Jackets'));
        $this->assertTrue(Slug::valid('trailhead-hoodie'));
        $this->assertFalse(Slug::valid('Trailhead Hoodie'));
        $this->assertFalse(Slug::valid('../etc'));
    }

    public function test_product_event_matches_what_order_service_reads(): void
    {
        $ev = Event::productUpdated([
            '_id' => 'p1', 'slug' => 'tee', 'name' => 'Tee', 'status' => 'active',
            'images' => [['url' => '/img.svg']],
            'variants' => [['sku' => 'T-M', 'options' => [], 'priceCents' => 2500]],
        ], ['T-M' => 7]);
        $json = json_decode(json_encode($ev), true);

        $this->assertSame('product.updated', $json['type']);
        $this->assertMatchesRegularExpression('/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/', $json['occurredAt']);
        $this->assertSame(7, $json['data']['variants'][0]['initialStock']);
        // Empty options must encode as {} (a Go map), never [] (which Go can't decode into a map).
        $this->assertStringContainsString('"options":{}', json_encode($ev));
    }

    public function test_placeholder_is_escaped_svg(): void
    {
        $svg = Placeholder::svg(Slug::from('Trailhead Hoodie'));
        $this->assertStringStartsWith('<svg', $svg);
        $this->assertStringContainsString('>TH<', $svg);
    }
}
