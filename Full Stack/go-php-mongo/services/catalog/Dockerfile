# catalog-service (Laravel 12, PHP 8.3) and its events worker share this image.
FROM composer:2 AS composer

FROM php:8.3-cli-bookworm AS base
# mongodb: the MongoDB driver extension. sockets: needed by php-amqplib. pcntl: lets
# artisan commands handle stop signals.
RUN apt-get update && apt-get install -y --no-install-recommends git unzip libssl-dev \
 && rm -rf /var/lib/apt/lists/* \
 && pecl install mongodb && docker-php-ext-enable mongodb \
 && docker-php-ext-install sockets pcntl
COPY --from=composer /usr/bin/composer /usr/bin/composer
ENV COMPOSER_ALLOW_SUPERUSER=1
WORKDIR /app

# Test stage: dev dependencies + PHPUnit. The final stage copies a file from here,
# which forces the tests to run (and pass) on every image build.
FROM base AS test
# `composer install` with a lock file installs exactly the locked versions. The lock is
# resolved for PHP 8.3 because composer.json's config.platform says so.
COPY composer.json composer.lock ./
RUN composer install --no-scripts --no-interaction --prefer-dist
COPY . .
RUN composer dump-autoload && vendor/bin/phpunit && touch /tmp/tests-passed

FROM base AS app
COPY composer.json composer.lock ./
RUN composer install --no-dev --no-scripts --no-interaction --prefer-dist
COPY . .
COPY --from=test /tmp/tests-passed /tmp/tests-passed
RUN composer dump-autoload --optimize --no-dev \
 && mkdir -p storage/app/uploads storage/framework/cache storage/framework/views storage/logs bootstrap/cache \
 && chown -R www-data:www-data storage bootstrap/cache
USER www-data
ENV PHP_CLI_SERVER_WORKERS=4
EXPOSE 8000
HEALTHCHECK --interval=10s --timeout=3s --start-period=60s --retries=6 \
  CMD php -r 'exit(@file_get_contents("http://127.0.0.1:8000/healthz") === false ? 1 : 0);'
# Indexes and the demo seed are idempotent, so they run on every start.
# `artisan serve` with several workers is fine for a demo; production would use
# php-fpm behind nginx, or FrankenPHP.
CMD ["sh", "-c", "php artisan catalog:indexes && php artisan catalog:seed && exec php artisan serve --host=0.0.0.0 --port=8000"]
