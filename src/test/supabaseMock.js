import { vi } from 'vitest';

// Builds a fake Supabase query builder. Every builder method returns the same object,
// and awaiting it resolves to `result`, just like the real client.
export function createQuery(result = { data: null, error: null }) {
  const query = {};
  const methods = [
    'select', 'insert', 'update', 'delete', 'upsert',
    'eq', 'lt', 'in', 'match', 'order', 'limit', 'single', 'maybeSingle',
  ];

  methods.forEach((method) => {
    query[method] = vi.fn(() => query);
  });

  query.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject);
  return query;
}

// Fake realtime channel: supports .on(...).on(...).subscribe()
export function createChannel() {
  const channel = {};
  channel.on = vi.fn(() => channel);
  channel.subscribe = vi.fn(() => channel);
  return channel;
}

// Generates feed rows like the ones returned by the posts_feed view
export function makePosts(count, startId = count) {
  return Array.from({ length: count }, (_, i) => {
    const id = startId - i;
    return {
      id,
      user_id: 'author-1',
      content: `Post ${id}`,
      created_at: '2026-09-30T08:00:00Z',
      username: 'author',
      display_name: 'author',
      like_count: 0,
      comment_count: 0,
      liked_by_me: false,
    };
  });
}
