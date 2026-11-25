import { useEffect, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Alert, Box, Button, Chip, CircularProgress, Link, Paper, Stack, Tab, Tabs, TextField, Typography,
} from '@mui/material';
import {
  REPORT_REASONS, REPORTS_PAGE_SIZE, fetchIsAdmin, fetchOpenReportCount, fetchReports, resolveReport,
} from '../lib/moderation';
import { useToast } from '../hooks/useToast';
import LoadMore from '../components/LoadMore';
import PageTitle from '../components/PageTitle';
import TimeAgo from '../components/TimeAgo';
import NotFound from './NotFound';

const REASONS = Object.fromEntries(REPORT_REASONS.map((r) => [r.value, r.label]));
const RESOLUTIONS = { dismissed: 'Dismissed', content_removed: 'Content removed', noted: 'Handled' };

function ReportCard({ report, working, onResolve }) {
  const [note, setNote] = useState('');
  const [confirming, setConfirming] = useState(false);

  const open = !report.handled_at;
  const kind = report.post_id ? 'post' : report.comment_id ? 'comment' : 'person';
  const canRemove = open && kind !== 'person' && report.content_exists;

  return (
    <Paper sx={{ p: 2 }}>
      <Stack spacing={1}>
        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
          <Chip size="small" variant="outlined" label={REASONS[report.reason] ?? report.reason} />
          {open && report.other_reports > 0 && (
            <Chip
              size="small"
              variant="outlined"
              label={`${report.other_reports} other open report${report.other_reports === 1 ? '' : 's'}`}
            />
          )}
          <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
            <TimeAgo date={report.created_at} />
          </Typography>
        </Stack>

        <Typography variant="body2">
          <b>@{report.reporter_username}</b> reported {kind === 'person' ? 'the person' : `a ${kind} by`}{' '}
          <Link component={RouterLink} to={`/profile/${report.reported_username}`} underline="always">
            @{report.reported_username}
          </Link>
        </Typography>

        {report.details && (
          <Typography variant="body2" color="text.secondary">
            &ldquo;{report.details}&rdquo;
          </Typography>
        )}

        {report.content_snapshot && (
          <Box sx={{ p: 1.5, borderRadius: 1, bgcolor: 'action.hover', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
            <Typography variant="body2">{report.content_snapshot}</Typography>
          </Box>
        )}

        {kind === 'post' && report.content_exists && (
          <Link component={RouterLink} to={`/post/${report.post_id}`} underline="always" variant="body2">
            Open the post
          </Link>
        )}
        {kind !== 'person' && !report.content_exists && (
          <Typography variant="caption" color="text.secondary">The {kind} has been removed.</Typography>
        )}

        {open ? (
          <>
            <TextField
              size="small"
              label="Note (optional)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={working}
              slotProps={{ htmlInput: { maxLength: 300 } }}
            />
            <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
              <Button variant="outlined" disabled={working} onClick={() => onResolve(report, 'dismissed', note)}>
                Dismiss
              </Button>
              {canRemove && !confirming && (
                <Button variant="outlined" color="error" disabled={working} onClick={() => setConfirming(true)}>
                  Remove {kind}
                </Button>
              )}
              {canRemove && confirming && (
                <>
                  <Button
                    variant="contained"
                    color="error"
                    disabled={working}
                    onClick={() => onResolve(report, 'content_removed', note)}
                  >
                    Yes, remove the {kind}
                  </Button>
                  <Button disabled={working} onClick={() => setConfirming(false)}>Cancel</Button>
                </>
              )}
              <Button variant="outlined" disabled={working} onClick={() => onResolve(report, 'noted', note)}>
                Mark as handled
              </Button>
            </Stack>
          </>
        ) : (
          <Typography variant="caption" color="text.secondary">
            {RESOLUTIONS[report.resolution]} by @{report.handled_by_username ?? 'a removed account'},{' '}
            <TimeAgo date={report.handled_at} />
            {report.handler_note ? `: ${report.handler_note}` : ''}
          </Typography>
        )}
      </Stack>
    </Paper>
  );
}

export default function AdminReports() {
  const { showToast } = useToast();
  const [isAdmin, setIsAdmin] = useState(undefined);
  const [status, setStatus] = useState('open');
  const [reports, setReports] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [openCount, setOpenCount] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [workingId, setWorkingId] = useState(null);
  const [version, setVersion] = useState(0); // goes up when the list must be fetched again

  useEffect(() => {
    let active = true;
    fetchIsAdmin().then((value) => {
      if (active) setIsAdmin(value);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!isAdmin) return undefined;
    let active = true;

    Promise.all([fetchReports(status), fetchOpenReportCount()]).then(([page, count]) => {
      if (!active) return;
      setLoading(false);
      setOpenCount(count.error ? null : count.count);
      if (page.error) {
        setLoadError(page.error.message);
        setReports([]);
        setHasMore(false);
        return;
      }
      setLoadError('');
      setReports(page.data);
      setHasMore(page.data.length === REPORTS_PAGE_SIZE);
    });

    return () => {
      active = false;
    };
  }, [isAdmin, status, version]);

  function reload() {
    setLoading(true);
    setVersion((v) => v + 1);
  }

  function handleTab(_event, value) {
    setLoading(true);
    setStatus(value);
  }

  async function loadMore() {
    const last = reports.at(-1);
    if (!last) return undefined;

    setLoadingMore(true);
    const page = await fetchReports(status, last.id);
    setLoadingMore(false);

    if (page.error) {
      showToast(`Could not load more reports: ${page.error.message}`);
      return false;
    }
    setReports((prev) => {
      const seen = new Set(prev.map((r) => r.id));
      return [...prev, ...page.data.filter((r) => !seen.has(r.id))];
    });
    setHasMore(page.data.length === REPORTS_PAGE_SIZE);
    return true;
  }

  async function handleResolve(report, resolution, note) {
    setWorkingId(report.id);
    const { error } = await resolveReport(report.id, resolution, note);
    setWorkingId(null);

    if (error) {
      showToast(`Could not handle the report: ${error.message}`);
      return;
    }
    showToast('Report handled.', 'success');
    reload(); // the other reports about the same thing are handled too
  }

  if (isAdmin === undefined) {
    return <Box sx={{ display: 'flex', justifyContent: 'center' }}><CircularProgress aria-label="Loading" /></Box>;
  }
  // Nobody else learns that this page exists
  if (!isAdmin) return <NotFound />;

  return (
    <>
      <PageTitle>Reports</PageTitle>
      <Tabs value={status} onChange={handleTab} aria-label="Reports" sx={{ mb: 2 }}>
        <Tab value="open" label={`Open${openCount === null ? '' : ` (${openCount})`}`} />
        <Tab value="handled" label="Handled" />
      </Tabs>

      {loading && <Box sx={{ display: 'flex', justifyContent: 'center' }}><CircularProgress aria-label="Loading" /></Box>}
      {!loading && loadError && <Alert severity="error">Could not load the reports: {loadError}</Alert>}
      {!loading && !loadError && reports.length === 0 && (
        <Typography color="text.secondary" align="center">
          {status === 'open' ? 'No open reports.' : 'Nothing has been handled yet.'}
        </Typography>
      )}
      {!loading && reports.length > 0 && (
        <Stack spacing={2}>
          {reports.map((report) => (
            <ReportCard
              key={report.id}
              report={report}
              working={workingId === report.id}
              onResolve={handleResolve}
            />
          ))}
          {hasMore && <LoadMore onLoad={loadMore} loading={loadingMore} />}
        </Stack>
      )}
    </>
  );
}