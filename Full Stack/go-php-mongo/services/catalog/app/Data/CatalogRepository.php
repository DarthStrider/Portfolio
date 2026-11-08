<?php

namespace App\Data;

use App\Domain\Ids;
use MongoDB\BSON\UTCDateTime;
use MongoDB\Collection;

/**
 * Categories, reviews, purchases and CMS pages: the smaller collections, kept together.
 */
final class CatalogRepository
{
    private Collection $categories;

    private Collection $reviews;

    private Collection $purchases;

    private Collection $pages;

    public function __construct(Mongo $mongo)
    {
        $this->categories = $mongo->collection('categories');
        $this->reviews = $mongo->collection('reviews');
        $this->purchases = $mongo->collection('purchases');
        $this->pages = $mongo->collection('pages');
    }

    // ---------- categories ----------

    /** @return list<array<string, mixed>> flat list with "id" instead of "_id" */
    public function categories(): array
    {
        $out = [];
        foreach ($this->categories->find([], ['sort' => ['position' => 1, 'name' => 1]]) as $c) {
            $c['id'] = $c['_id'];
            unset($c['_id']);
            $out[] = $c;
        }

        return $out;
    }

    /** @return array<string, mixed>|null */
    public function category(string $id): ?array
    {
        return $this->categories->findOne(['_id' => $id]);
    }

    /** @return array<string, mixed>|null */
    public function categoryBySlug(string $slug): ?array
    {
        return $this->categories->findOne(['slug' => $slug]);
    }

    /** @param array<string, mixed> $doc */
    public function saveCategory(array $doc): void
    {
        $this->categories->replaceOne(['_id' => $doc['_id']], $doc, ['upsert' => true]);
    }

    /**
     * Moving a category changes the path of everything under it. One updateMany per
     * descendant level keeps the materialized paths consistent.
     *
     * @param  list<string>  $oldPath
     * @param  list<string>  $newPath
     */
    public function rebaseDescendants(string $id, array $oldPath, array $newPath): void
    {
        foreach ($this->categories->find(['path' => $id]) as $c) {
            $suffix = array_slice($c['path'], count($oldPath));
            $this->categories->updateOne(['_id' => $c['_id']], ['$set' => ['path' => array_merge($newPath, $suffix)]]);
        }
    }

    public function hasChildren(string $id): bool
    {
        return $this->categories->countDocuments(['parentId' => $id], ['limit' => 1]) > 0;
    }

    public function deleteCategory(string $id): void
    {
        $this->categories->deleteOne(['_id' => $id]);
    }

    // ---------- reviews ----------

    /** @return list<array<string, mixed>> */
    public function reviews(string $productId, ?string $status = 'approved', int $limit = 50): array
    {
        $filter = ['productId' => $productId];
        if ($status !== null) {
            $filter['status'] = $status;
        }

        return iterator_to_array($this->reviews->find($filter, ['sort' => ['createdAt' => -1], 'limit' => $limit]), false);
    }

    /** @return list<array<string, mixed>> */
    public function reviewsByStatus(string $status, int $limit = 100): array
    {
        return iterator_to_array($this->reviews->find(['status' => $status], ['sort' => ['createdAt' => -1], 'limit' => $limit]), false);
    }

    /** @return array<string, mixed>|null */
    public function review(string $id): ?array
    {
        return $this->reviews->findOne(['_id' => $id]);
    }

    public function hasReviewed(string $userId, string $productId): bool
    {
        return $this->reviews->countDocuments(['userId' => $userId, 'productId' => $productId], ['limit' => 1]) > 0;
    }

    /** @param array<string, mixed> $doc */
    public function insertReview(array $doc): void
    {
        $doc['_id'] = Ids::new();
        $doc['createdAt'] = new UTCDateTime;
        $this->reviews->insertOne($doc);
    }

    public function setReviewStatus(string $id, string $status): void
    {
        $this->reviews->updateOne(['_id' => $id], ['$set' => ['status' => $status, 'moderatedAt' => new UTCDateTime]]);
    }

    /** Average and count of approved reviews, computed by the database. @return array{0: float, 1: int} */
    public function ratingFor(string $productId): array
    {
        $res = iterator_to_array($this->reviews->aggregate([
            ['$match' => ['productId' => $productId, 'status' => 'approved']],
            ['$group' => ['_id' => null, 'avg' => ['$avg' => '$rating'], 'n' => ['$sum' => 1]]],
        ]), false);

        return [round((float) ($res[0]['avg'] ?? 0), 1), (int) ($res[0]['n'] ?? 0)];
    }

    // ---------- purchases (verified buyers) ----------

    public function recordPurchase(string $userId, string $productId, string $orderId): void
    {
        $this->purchases->updateOne(
            ['_id' => $userId.':'.$productId],
            ['$setOnInsert' => ['userId' => $userId, 'productId' => $productId, 'orderId' => $orderId, 'at' => new UTCDateTime]],
            ['upsert' => true],
        );
    }

    public function hasPurchased(string $userId, string $productId): bool
    {
        return $this->purchases->countDocuments(['_id' => $userId.':'.$productId], ['limit' => 1]) > 0;
    }

    // ---------- pages ----------

    /** @return array<string, mixed>|null */
    public function page(string $slug): ?array
    {
        return $this->pages->findOne(['_id' => $slug]);
    }

    /** @return list<array<string, mixed>> */
    public function pages(): array
    {
        return iterator_to_array($this->pages->find([], ['sort' => ['_id' => 1], 'projection' => ['body' => 0]]), false);
    }

    public function savePage(string $slug, string $title, string $body, bool $published): void
    {
        $this->pages->replaceOne(['_id' => $slug], [
            '_id' => $slug, 'title' => $title, 'body' => $body, 'published' => $published, 'updatedAt' => new UTCDateTime,
        ], ['upsert' => true]);
    }
}
