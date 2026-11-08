<?php

namespace App\Domain;

/**
 * Generated product artwork: a soft gradient with a simple line icon and the product's
 * initials. The demo catalog uses these, so the store looks finished without shipping
 * photos and works offline.
 */
final class Placeholder
{
    private const ICONS = [
        // 24x24 stroke icons, scaled up in the SVG.
        'tee' => 'M8 3l-5 3 2 4 3-1v12h8V9l3 1 2-4-5-3c-1 2-2.5 3-4 3S9 5 8 3z',
        'hoodie' => 'M8 3c0 3 2 5 4 5s4-2 4-5l5 3-2 5-2-1v11H7V10l-2 1-2-5 5-3zM10 14h4',
        'mug' => 'M5 7h11v9a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4V7zM16 9h2a2 2 0 0 1 0 6h-2M8 3v2M11 2v3M14 3v2',
        'print' => 'M4 4h16v16H4zM4 15l5-5 4 4 3-3 4 4M15 8.5a1 1 0 1 0 0-.01',
        'bag' => 'M5 8h14l-1 13H6L5 8zM9 8V6a3 3 0 0 1 6 0v2',
        'hat' => 'M4 16c0-5 3.5-9 8-9s8 4 8 9M2 16h20M12 7V5',
        'book' => 'M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3V4zM5 17a3 3 0 0 1 3-3h11',
        'sock' => 'M9 3h6v9l3 3a3 3 0 0 1-4 4l-5-5V3zM9 7h6',
        'jacket' => 'M8 3l4 3 4-3 5 4-2 4-2-1v11H7V10l-2 1-2-4 5-4zM12 6v15',
        'kettle' => 'M7 9h10l-1 11H8L7 9zM9 9V7a3 3 0 0 1 6 0v2M17 11l3-2',
        'map' => 'M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2V6zM9 4v14M15 6v14',
        'cap' => 'M4 15a8 8 0 0 1 16 0H4zM12 7V5M20 15h2',
        'tote' => 'M5 8h14l-1 13H6L5 8zM9 8V6a3 3 0 0 1 6 0v2',
        'toque' => 'M6 15c0-5 2.5-9 6-9s6 4 6 9M5 15h14v3H5zM12 6V4',
    ];

    public static function svg(string $slug): string
    {
        $hue = crc32($slug) % 360;
        $hue2 = ($hue + 40) % 360;
        $icon = self::ICONS['tee'];
        foreach (self::ICONS as $key => $path) {
            if (str_contains($slug, $key)) {
                $icon = $path;
                break;
            }
        }
        $words = array_values(array_filter(explode('-', $slug)));
        $initials = strtoupper(substr($words[0] ?? 'N', 0, 1).substr($words[1] ?? '', 0, 1));

        return <<<SVG
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600" role="img" aria-label="{$slug}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="hsl({$hue},45%,90%)"/>
      <stop offset="1" stop-color="hsl({$hue2},40%,78%)"/>
    </linearGradient>
  </defs>
  <rect width="600" height="600" fill="url(#g)"/>
  <g transform="translate(150 130) scale(12.5)" fill="none" stroke="hsl({$hue},35%,28%)" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round">
    <path d="{$icon}"/>
  </g>
  <text x="300" y="540" text-anchor="middle" font-family="system-ui, sans-serif" font-size="36" font-weight="600" letter-spacing="6" fill="hsl({$hue},35%,28%)" opacity="0.7">{$initials}</text>
</svg>
SVG;
    }
}
