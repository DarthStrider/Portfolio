<?php

namespace App\Console\Commands;

use App\Data\CatalogRepository;
use App\Data\Outbox;
use App\Data\ProductRepository;
use App\Domain\Event;
use Illuminate\Console\Command;
use PhpAmqpLib\Channel\AMQPChannel;
use PhpAmqpLib\Connection\AMQPStreamConnection;
use PhpAmqpLib\Exception\AMQPTimeoutException;
use PhpAmqpLib\Message\AMQPMessage;

/**
 * php artisan events:work -- the catalog's background worker (its own container).
 *
 * One loop does two jobs, about once a second:
 *  1. publish anything waiting in the outbox (product.updated / product.deleted);
 *  2. handle incoming events: stock.changed (show sold-out) and order.placed
 *     (remember verified buyers for reviews).
 */
final class EventsWork extends Command
{
    protected $signature = 'events:work';

    protected $description = 'Publish the outbox and consume events from RabbitMQ';

    private const EXCHANGE = 'shop.events';

    private const QUEUE = 'catalog-service';

    public function handle(Outbox $outbox, ProductRepository $products, CatalogRepository $catalog): int
    {
        [$connection, $channel] = $this->connect();
        $channel->exchange_declare(self::EXCHANGE, 'topic', false, true, false);
        $channel->queue_declare(self::QUEUE, false, true, false, false);
        foreach ([Event::STOCK_CHANGED, Event::ORDER_PLACED] as $key) {
            $channel->queue_bind(self::QUEUE, self::EXCHANGE, $key);
        }
        $channel->basic_qos(0, 16, false);

        $handlers = [
            Event::STOCK_CHANGED => function (array $data) use ($products) {
                $products->applyStock(array_column($data['items'] ?? [], 'available', 'sku'));
            },
            Event::ORDER_PLACED => function (array $data) use ($catalog) {
                if (($data['userId'] ?? '') === '') {
                    return; // guest checkout: no account to attach a review to
                }
                foreach ($data['items'] ?? [] as $item) {
                    $catalog->recordPurchase($data['userId'], $item['productId'], $data['orderId']);
                }
            },
        ];

        $channel->basic_consume(self::QUEUE, '', false, false, false, false, function (AMQPMessage $msg) use ($handlers, $outbox) {
            $event = json_decode($msg->getBody(), true);
            if (! is_array($event) || ! isset($event['eventId'], $event['type'])) {
                $msg->nack(false); // undecodable: retrying can't help
                return;
            }
            if ($outbox->seen($event['eventId'])) {
                $msg->ack();
                return;
            }
            try {
                ($handlers[$event['type']] ?? fn () => null)($event['data'] ?? []);
                $outbox->markProcessed($event['eventId']);
                $msg->ack();
            } catch (\Throwable $e) {
                $this->error("handler failed for {$event['type']}: {$e->getMessage()}");
                sleep(1);
                $msg->nack(true); // requeue
            }
        });

        $this->info('events:work running');
        while (true) {
            $this->relay($outbox, $channel);
            try {
                $channel->wait(null, false, 1.0);
            } catch (AMQPTimeoutException) {
                // no message this second; loop round to the outbox again
            }
            if (! $connection->isConnected()) {
                $this->error('RabbitMQ connection lost; exiting so Docker restarts the worker');

                return self::FAILURE;
            }
        }
    }

    private function relay(Outbox $outbox, AMQPChannel $channel): void
    {
        foreach ($outbox->pending() as $row) {
            $channel->basic_publish(new AMQPMessage($row['payload'], [
                'content_type' => 'application/json',
                'delivery_mode' => AMQPMessage::DELIVERY_MODE_PERSISTENT,
                'message_id' => $row['_id'],
                'type' => $row['type'],
            ]), self::EXCHANGE, $row['type']);
            $outbox->markSent($row['_id']);
        }
    }

    /** @return array{0: AMQPStreamConnection, 1: AMQPChannel} */
    private function connect(): array
    {
        $url = parse_url(config('catalog.rabbitmq_url'));
        $vhost = isset($url['path']) && $url['path'] !== '/' ? urldecode(substr($url['path'], 1)) : '/';
        for ($attempt = 1; ; $attempt++) {
            try {
                $connection = new AMQPStreamConnection($url['host'], $url['port'] ?? 5672,
                    urldecode($url['user'] ?? 'guest'), urldecode($url['pass'] ?? 'guest'), $vhost);

                return [$connection, $connection->channel()];
            } catch (\Throwable $e) {
                if ($attempt >= 60) {
                    throw $e;
                }
                $this->line('waiting for RabbitMQ...');
                sleep(2);
            }
        }
    }
}
