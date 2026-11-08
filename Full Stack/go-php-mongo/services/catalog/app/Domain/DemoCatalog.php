<?php

namespace App\Domain;

/**
 * The demo store's data: categories as [name, parent, position] and products as
 * [name, category, description, variants, attributes]. Kept apart from the seed command
 * so a unit test can check every product passes the same validation as the admin form.
 */
final class DemoCatalog
{
    public const CATEGORIES = [
        ['Apparel', null, 0], ['T-Shirts', 'Apparel', 0], ['Hoodies & Jackets', 'Apparel', 1], ['Socks', 'Apparel', 2],
        ['Home', null, 1], ['Mugs & Coffee', 'Home', 0], ['Prints', 'Home', 1],
        ['Accessories', null, 2], ['Bags', 'Accessories', 0], ['Hats', 'Accessories', 1], ['Stationery', 'Accessories', 2],
    ];

    /** @return list<array{0: string, 1: string, 2: string, 3: list<array<string, mixed>>, 4: array<string, string>}> */
    public static function products(): array
    {
        $sizes = fn (string $prefix, int $price, array $stock) => array_map(
            fn ($size, $n) => ['sku' => "$prefix-$size", 'options' => ['size' => $size], 'priceCents' => $price, 'initialStock' => $n],
            array_keys($stock), $stock);

        return [
            ['Northline Classic Tee', 'T-Shirts', 'Heavyweight 100% organic cotton tee with a relaxed fit. Pre-shrunk, garment-dyed, and made to soften with every wash.',
                $sizes('NL-TEE', 2800, ['S' => 14, 'M' => 22, 'L' => 18, 'XL' => 6]), ['material' => 'Organic cotton', 'fit' => 'Relaxed']],
            ['Trailhead Hoodie', 'Hoodies & Jackets', 'Brushed-back fleece hoodie with a lined hood, kangaroo pocket and ribbed cuffs. Warm without the bulk.',
                $sizes('NL-HOOD', 7200, ['S' => 4, 'M' => 9, 'L' => 3, 'XL' => 0]), ['material' => 'Cotton/poly fleece', 'weight' => '400 gsm']],
            ['Coastline Rain Jacket', 'Hoodies & Jackets', 'Packable, fully seam-sealed shell with pit zips and an adjustable hood. Folds into its own chest pocket.',
                $sizes('NL-RAIN', 14900, ['S' => 3, 'M' => 5, 'L' => 5, 'XL' => 2]), ['waterproof' => '10,000 mm', 'packs into' => 'chest pocket']],
            ['Merino Hiking Sock', 'Socks', 'Midweight merino socks with cushioned soles and a reinforced heel and toe. Naturally odour-resistant.',
                $sizes('NL-SOCK', 2400, ['S' => 30, 'M' => 40, 'L' => 25]), ['material' => '70% merino wool']],
            ['Enamel Camp Mug', 'Mugs & Coffee', 'Steel mug with a speckled enamel finish. Campfire-safe and dishwasher-safe. Holds 350 ml.',
                [['sku' => 'NL-MUG-NAVY', 'options' => ['colour' => 'Navy'], 'priceCents' => 1800, 'initialStock' => 40],
                    ['sku' => 'NL-MUG-SAGE', 'options' => ['colour' => 'Sage'], 'priceCents' => 1800, 'initialStock' => 2]], ['capacity' => '350 ml']],
            ['Ceramic Pour-Over Kettle', 'Mugs & Coffee', 'Gooseneck stovetop kettle for slow, even pours. Brushed steel with a heat-resistant handle.',
                [['sku' => 'NL-KETTLE', 'options' => [], 'priceCents' => 5400, 'initialStock' => 8]], ['capacity' => '1 L', 'stovetops' => 'Gas, electric, induction']],
            ['Topographic Print', 'Prints', 'Contour-line art print on archival matte paper. Ships rolled in a tube; frame not included.',
                [['sku' => 'NL-TOPO-12X16', 'options' => ['size' => '12×16 in'], 'priceCents' => 3500, 'initialStock' => 15],
                    ['sku' => 'NL-TOPO-18X24', 'options' => ['size' => '18×24 in'], 'priceCents' => 5500, 'initialStock' => 7]], ['paper' => '230 gsm archival matte']],
            ['Great Lakes Map Poster', 'Prints', 'Vintage-style map of the five Great Lakes with depth shading and historic lighthouse markers.',
                [['sku' => 'NL-MAP-LAKES', 'options' => ['size' => '18×24 in'], 'priceCents' => 4200, 'initialStock' => 12]], ['paper' => '200 gsm satin']],
            ['Waxed Canvas Tote', 'Bags', 'Water-resistant waxed canvas tote with leather handles and an inside zip pocket. Gets better with age.',
                [['sku' => 'NL-TOTE-OLIVE', 'options' => ['colour' => 'Olive'], 'priceCents' => 6800, 'initialStock' => 10],
                    ['sku' => 'NL-TOTE-TAN', 'options' => ['colour' => 'Tan'], 'priceCents' => 6800, 'initialStock' => 6]], ['material' => '16 oz waxed canvas']],
            ['Wool Toque', 'Hats', 'Rib-knit merino toque with a fold-over cuff. Warm, breathable and itch-free.',
                [['sku' => 'NL-TOQUE-CHAR', 'options' => ['colour' => 'Charcoal'], 'priceCents' => 3200, 'initialStock' => 20],
                    ['sku' => 'NL-TOQUE-RUST', 'options' => ['colour' => 'Rust'], 'priceCents' => 3200, 'initialStock' => 14]], ['material' => '100% merino wool']],
            ['Six-Panel Field Cap', 'Hats', 'Unstructured cotton twill cap with an embroidered pine logo and brass buckle strap.',
                [['sku' => 'NL-CAP', 'options' => [], 'priceCents' => 3000, 'initialStock' => 25]], ['fit' => 'One size, adjustable']],
            ['Field Notebook Set', 'Stationery', 'Three pocket notebooks with dot-grid pages and recycled kraft covers. 48 pages each.',
                [['sku' => 'NL-BOOK-3PK', 'options' => [], 'priceCents' => 1500, 'initialStock' => 60]], ['pages' => '3 × 48, dot grid']],
        ];

    }
}
