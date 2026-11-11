import { describe, it, expect } from 'vitest';
import { CrawlQueue } from '../../../src/main/scanner/crawler/queue.js';
import type { CrawlQueueItem } from '../../../src/main/scanner/crawler/types.js';

describe('CrawlQueue', () => {
  it('enqueues and dequeues items in strict FIFO order', () => {
    const queue = new CrawlQueue();

    const item1: CrawlQueueItem = {
      url: 'https://example.com/page-1',
      depth: 0,
      parentUrl: null,
      discoveredAt: 100,
    };
    const item2: CrawlQueueItem = {
      url: 'https://example.com/page-2',
      depth: 1,
      parentUrl: 'https://example.com/page-1',
      discoveredAt: 200,
    };

    expect(queue.enqueue(item1)).toBe(true);
    expect(queue.enqueue(item2)).toBe(true);
    expect(queue.size).toBe(2);
    expect(queue.isEmpty).toBe(false);

    expect(queue.dequeue()).toEqual(item1);
    expect(queue.dequeue()).toEqual(item2);
    expect(queue.dequeue()).toBeUndefined();
    expect(queue.isEmpty).toBe(true);
  });

  it('rejects duplicate URLs from being scheduled or re-queued', () => {
    const queue = new CrawlQueue();
    const url = 'https://example.com/about';

    const item: CrawlQueueItem = {
      url,
      depth: 1,
      parentUrl: 'https://example.com/',
      discoveredAt: Date.now(),
    };

    expect(queue.enqueue(item)).toBe(true);
    // Duplicate attempt
    expect(queue.enqueue(item)).toBe(false);
    expect(queue.size).toBe(1);

    // Dequeue item and mark visited
    const dequeued = queue.dequeue();
    expect(dequeued).toEqual(item);
    queue.markVisited(url);

    // Re-enqueue after visited must still be rejected
    expect(queue.enqueue(item)).toBe(false);
    expect(queue.isVisited(url)).toBe(true);
    expect(queue.isScheduled(url)).toBe(true);
  });

  it('preserves scheduled URL history when queue is cleared', () => {
    const queue = new CrawlQueue();
    const item1: CrawlQueueItem = {
      url: 'https://example.com/1',
      depth: 0,
      parentUrl: null,
      discoveredAt: 1,
    };
    const item2: CrawlQueueItem = {
      url: 'https://example.com/2',
      depth: 1,
      parentUrl: null,
      discoveredAt: 2,
    };

    queue.enqueue(item1);
    queue.enqueue(item2);
    expect(queue.size).toBe(2);

    queue.clear();
    expect(queue.size).toBe(0);
    expect(queue.isEmpty).toBe(true);

    // Historical tracking persists
    expect(queue.isScheduled('https://example.com/1')).toBe(true);
    expect(queue.isScheduled('https://example.com/2')).toBe(true);
    expect(queue.getAllDiscoveredUrls()).toEqual([
      'https://example.com/1',
      'https://example.com/2',
    ]);
  });
});
