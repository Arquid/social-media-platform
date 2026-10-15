import { useNow } from '../hooks/useNow';
import { formatRelativeTime, formatFullDate } from '../lib/time';

export default function TimeAgo({ date }) {
  const now = useNow();
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return null;

  return (
    <time dateTime={parsed.toISOString()} title={formatFullDate(parsed)}>
      {formatRelativeTime(parsed, now)}
    </time>
  );
}