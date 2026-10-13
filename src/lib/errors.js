// The database refuses posts and comments that come too fast. PostgREST answers with
// HTTP 429 and the error code "PT429".
export function isRateLimited(error) {
  return error?.code === 'PT429';
}