/**
 * Deterministic FIFO Queue with URL deduplication, depth-frontier ordering,
 * and state tracking for web crawling.
 */

import type { CrawlQueueItem } from './types.js';

export class CrawlQueue {
  private readonly itemsByDepth = new Map<number, CrawlQueueItem[]>();
  private readonly scheduledUrls = new Set<string>();
  private readonly visitedUrls = new Set<string>();
  private itemCount = 0;

  /**
   * Enqueues a new item if its URL has not already been scheduled or visited.
   * Returns true if enqueued, false if skipped as duplicate.
   */
  enqueue(item: CrawlQueueItem): boolean {
    if (this.scheduledUrls.has(item.url) || this.visitedUrls.has(item.url)) {
      return false;
    }
    this.scheduledUrls.add(item.url);

    let bucket = this.itemsByDepth.get(item.depth);
    if (!bucket) {
      bucket = [];
      this.itemsByDepth.set(item.depth, bucket);
    }
    bucket.push(item);
    this.itemCount++;
    return true;
  }

  /**
   * Returns the depth of the lowest available pending item in the queue,
   * or undefined if the queue is empty.
   */
  peekDepth(): number | undefined {
    if (this.itemCount === 0) {
      return undefined;
    }
    const depths = this.getSortedDepths();
    return depths.length > 0 ? depths[0] : undefined;
  }

  /**
   * Peeks at the next item in lowest-depth FIFO order without removing it.
   */
  peek(): CrawlQueueItem | undefined {
    if (this.itemCount === 0) {
      return undefined;
    }
    const depths = this.getSortedDepths();
    for (const depth of depths) {
      const bucket = this.itemsByDepth.get(depth);
      if (bucket && bucket.length > 0) {
        return bucket[0];
      }
    }
    return undefined;
  }

  /**
   * Dequeues the next item in lowest-depth FIFO order.
   */
  dequeue(): CrawlQueueItem | undefined {
    if (this.itemCount === 0) {
      return undefined;
    }
    const depths = this.getSortedDepths();
    for (const depth of depths) {
      const bucket = this.itemsByDepth.get(depth);
      if (bucket && bucket.length > 0) {
        const item = bucket.shift();
        this.itemCount--;
        if (bucket.length === 0) {
          this.itemsByDepth.delete(depth);
        }
        return item;
      }
    }
    return undefined;
  }

  /**
   * Dequeues the next item strictly matching the specified depth.
   * Returns undefined if no items exist at that depth.
   */
  dequeueForDepth(depth: number): CrawlQueueItem | undefined {
    const bucket = this.itemsByDepth.get(depth);
    if (bucket && bucket.length > 0) {
      const item = bucket.shift();
      this.itemCount--;
      if (bucket.length === 0) {
        this.itemsByDepth.delete(depth);
      }
      return item;
    }
    return undefined;
  }

  /**
   * Returns number of items pending at a specific depth.
   */
  sizeForDepth(depth: number): number {
    return this.itemsByDepth.get(depth)?.length ?? 0;
  }

  /**
   * Marks a URL as visited.
   */
  markVisited(url: string): void {
    this.visitedUrls.add(url);
  }

  /**
   * Checks if a URL has already been scheduled for crawling.
   */
  isScheduled(url: string): boolean {
    return this.scheduledUrls.has(url);
  }

  /**
   * Checks if a URL has already been visited.
   */
  isVisited(url: string): boolean {
    return this.visitedUrls.has(url);
  }

  /**
   * Current number of pending items in queue across all depths.
   */
  get size(): number {
    return this.itemCount;
  }

  /**
   * Returns true if no items are pending.
   */
  get isEmpty(): boolean {
    return this.itemCount === 0;
  }

  /**
   * Total number of unique URLs scheduled.
   */
  get totalScheduledCount(): number {
    return this.scheduledUrls.size;
  }

  /**
   * Total number of unique URLs marked visited.
   */
  get totalVisitedCount(): number {
    return this.visitedUrls.size;
  }

  /**
   * Returns all unique discovered/scheduled URLs.
   */
  getAllDiscoveredUrls(): string[] {
    return Array.from(this.scheduledUrls);
  }

  /**
   * Clears pending queue items across all depths. Preserves visited/scheduled history.
   */
  clear(): void {
    this.itemsByDepth.clear();
    this.itemCount = 0;
  }

  private getSortedDepths(): number[] {
    return Array.from(this.itemsByDepth.keys()).sort((a, b) => a - b);
  }
}
