<?php

namespace App\Domain;

/** URL-safe identifiers made from names: "Trailhead Hoodie (Navy)" -> "trailhead-hoodie-navy". */
final class Slug
{
    public static function from(string $text): string
    {
        // Strip accents first so "Café Crème" becomes "cafe-creme", not "caf-cr-me".
        $ascii = strtr($text, [
            'à' => 'a', 'á' => 'a', 'â' => 'a', 'ä' => 'a', 'ç' => 'c', 'è' => 'e', 'é' => 'e', 'ê' => 'e',
            'ë' => 'e', 'î' => 'i', 'ï' => 'i', 'ô' => 'o', 'ö' => 'o', 'ù' => 'u', 'û' => 'u', 'ü' => 'u',
            'À' => 'a', 'É' => 'e', 'È' => 'e', 'Ç' => 'c', 'Ô' => 'o', '&' => ' and ',
        ]);
        $slug = strtolower($ascii);
        $slug = preg_replace('/[^a-z0-9]+/', '-', $slug) ?? '';

        return substr(trim($slug, '-'), 0, 80);
    }

    public static function valid(string $slug): bool
    {
        return preg_match('/^[a-z0-9]+(?:-[a-z0-9]+)*$/', $slug) === 1 && strlen($slug) <= 80;
    }
}
