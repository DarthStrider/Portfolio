<?php

namespace Tests\Unit;

use App\Domain\ProductQuery;
use PHPUnit\Framework\TestCase;

final class ProductQueryTest extends TestCase
{
    public function test_defaults_show_active_products_featured_first(): void
    {
        $q = ProductQuery::build([]);

        $this->assertSame(['status' => 'active'], $q['filter']);
        $this->assertSame(['rating.count' => -1, 'name' => 1, '_id' => 1], $q['sort']);
        $this->assertSame([0, 12, 1], [$q['skip'], $q['limit'], $q['page']]);
    }

    public function test_price_range_matches_any_variant_inside_it(): void
    {
        $q = ProductQuery::build(['minPrice' => '20', 'maxPrice' => '49.99']);

        $this->assertSame(['$gte' => 2000], $q['filter']['priceMax']);
        $this->assertSame(['$lte' => 4999], $q['filter']['priceMin']);
    }

    public function test_text_search_sorts_by_relevance_unless_asked_otherwise(): void
    {
        $q = ProductQuery::build(['q' => 'hoodie']);
        $this->assertSame(['$search' => 'hoodie'], $q['filter']['$text']);
        $this->assertSame(['$meta' => 'textScore'], $q['sort']['score']);

        $q = ProductQuery::build(['q' => 'hoodie', 'sort' => 'price_asc']);
        $this->assertArrayNotHasKey('score', $q['sort']);
        $this->assertSame(1, $q['sort']['priceMin']);
    }

    public function test_category_page_and_bad_input(): void
    {
        $q = ProductQuery::build(['page' => '3', 'perPage' => '500', 'minPrice' => '-5', 'sort' => 'nope', 'inStock' => '1'], ['a', 'b']);

        $this->assertSame(['$in' => ['a', 'b']], $q['filter']['categoryIds']);
        $this->assertTrue($q['filter']['inStock']);
        $this->assertArrayNotHasKey('priceMax', $q['filter'], 'negative price ignored');
        $this->assertSame(ProductQuery::MAX_PER_PAGE, $q['limit']);
        $this->assertSame(2 * ProductQuery::MAX_PER_PAGE, $q['skip']);
        $this->assertSame(1, $q['sort']['name'], 'unknown sort falls back to featured');
    }

    public function test_admin_sees_every_status_or_one(): void
    {
        $this->assertSame([], ProductQuery::build([], null, includeHidden: true)['filter']);
        $this->assertSame(['status' => 'draft'], ProductQuery::build(['status' => 'draft'], null, includeHidden: true)['filter']);
    }
}
