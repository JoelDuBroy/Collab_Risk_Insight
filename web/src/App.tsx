import { useEffect, useMemo, useState } from "react";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import QueryStatsIcon from "@mui/icons-material/QueryStats";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Container,
  Divider,
  LinearProgress,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import { parseGithubInput } from "./githubUrl";
import type { InsightsResponse, NarrativeResponse } from "./types";

const severityColor = {
  risk: "error",
  watch: "warning",
  info: "info",
} as const;

export default function App() {
  const [owner, setOwner] = useState("fastapi");
  const [repo, setRepo] = useState("fastapi");
  const [days, setDays] = useState(30);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [insights, setInsights] = useState<InsightsResponse | null>(null);
  const [narrative, setNarrative] = useState<NarrativeResponse | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/health");
        if (!res.ok) return;
        const data = await res.json();
        if (data?.defaults?.owner) setOwner(data.defaults.owner);
        if (data?.defaults?.repo) setRepo(data.defaults.repo);
        if (data?.defaults?.days) setDays(Number(data.defaults.days));
      } catch {
        // Keep local defaults.
      }
    })();
  }, []);

  const parsed = useMemo(() => parseGithubInput(owner, repo), [owner, repo]);

  async function runInsights() {
    setBusy(true);
    setError(null);
    setNarrative(null);
    setStatus(`Fetching insights for ${parsed.owner}/${parsed.repo}…`);
    try {
      if (!parsed.owner || !parsed.repo) {
        throw new Error("Owner and repo are required (or paste a GitHub URL).");
      }
      const url =
        `/v1/insights?owner=${encodeURIComponent(parsed.owner)}` +
        `&repo=${encodeURIComponent(parsed.repo)}&days=${days}`;
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || data.error || `HTTP ${res.status}`);
      }
      setOwner(parsed.owner);
      setRepo(parsed.repo);
      setInsights(data);
      setStatus(
        data.cached
          ? `Cached insights · ${new Date(data.fetchedAt).toLocaleString()}`
          : `Fresh insights · ${new Date(data.fetchedAt).toLocaleString()}`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  async function runNarrative() {
    setBusy(true);
    setError(null);
    setStatus(`Synthesizing narrative for ${parsed.owner}/${parsed.repo}…`);
    try {
      if (!parsed.owner || !parsed.repo) {
        throw new Error("Owner and repo are required (or paste a GitHub URL).");
      }
      if (!insights || insights.owner !== parsed.owner || insights.repo !== parsed.repo) {
        const insightsUrl =
          `/v1/insights?owner=${encodeURIComponent(parsed.owner)}` +
          `&repo=${encodeURIComponent(parsed.repo)}&days=${days}`;
        const insightsRes = await fetch(insightsUrl);
        const insightsData = await insightsRes.json();
        if (!insightsRes.ok) {
          throw new Error(
            insightsData.message || insightsData.error || `HTTP ${insightsRes.status}`,
          );
        }
        setInsights(insightsData);
      }

      const url =
        `/v1/narrative?owner=${encodeURIComponent(parsed.owner)}` +
        `&repo=${encodeURIComponent(parsed.repo)}&days=${days}`;
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || data.error || `HTTP ${res.status}`);
      }
      setOwner(parsed.owner);
      setRepo(parsed.repo);
      setNarrative(data);
      setStatus(`Narrative ready · ${data.provider}/${data.model}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Box
      sx={{
        minHeight: "100vh",
        background:
          "radial-gradient(900px 420px at 10% -10%, rgba(26,111,150,0.18), transparent 60%), linear-gradient(180deg, #d7e3ef 0%, #eef3f8 40%, #e7edf3 100%)",
        py: { xs: 3, md: 5 },
      }}
    >
      <Container maxWidth="md">
        <Stack spacing={2.5}>
          {/* Line 1: Brand / hero */}
          <Paper elevation={0} sx={{ p: { xs: 2.5, md: 3.5 } }}>
            <Typography
              variant="overline"
              color="primary"
              sx={{ fontWeight: 700, letterSpacing: "0.14em" }}
            >
              Collab Risk Insight
            </Typography>
            <Typography variant="h3" sx={{ mt: 0.5, fontSize: { xs: "1.8rem", md: "2.6rem" } }}>
              Collaboration risk, not vanity charts
            </Typography>
            <Typography color="text.secondary" sx={{ mt: 1.25, maxWidth: 640, lineHeight: 1.6 }}>
              Pull GitHub signals, score contribution and review topology, then ask an LLM for a
              short narrative with hypothesis, confidence, and evidence.
            </Typography>
          </Paper>

          {/* Line 2: Query controls */}
          <Paper elevation={0} sx={{ p: { xs: 2, md: 2.5 } }}>
            <Stack spacing={2}>
              <Typography variant="h6">Repository</Typography>
              <TextField
                label="Owner"
                value={owner}
                onChange={(e) => setOwner(e.target.value)}
                fullWidth
                helperText="Or paste a full GitHub URL into either field"
              />
              <TextField
                label="Repo"
                value={repo}
                onChange={(e) => setRepo(e.target.value)}
                fullWidth
                placeholder="fastapi or https://github.com/fastapi/fastapi"
              />
              <TextField
                label="Days"
                type="number"
                value={days}
                onChange={(e) => setDays(Number(e.target.value) || 30)}
                inputProps={{ min: 1, max: 365 }}
                fullWidth
              />
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
                <Button
                  variant="contained"
                  size="large"
                  startIcon={busy ? <CircularProgress size={18} color="inherit" /> : <QueryStatsIcon />}
                  onClick={() => void runInsights()}
                  disabled={busy}
                  fullWidth
                >
                  Fetch insights
                </Button>
                <Button
                  variant="outlined"
                  size="large"
                  startIcon={<AutoAwesomeIcon />}
                  onClick={() => void runNarrative()}
                  disabled={busy}
                  fullWidth
                >
                  Synthesize narrative
                </Button>
              </Stack>
              {(parsed.owner !== owner.trim() || parsed.repo !== repo.trim()) &&
                parsed.owner &&
                parsed.repo && (
                  <Alert severity="info">
                    Will query <strong>{parsed.owner}/{parsed.repo}</strong>
                  </Alert>
                )}
            </Stack>
          </Paper>

          {/* Line 3: Status */}
          {busy && <LinearProgress />}
          {error && <Alert severity="error">{error}</Alert>}
          {!error && status && <Alert severity="success">{status}</Alert>}

          {/* Line 4: Summary metrics */}
          {insights && (
            <Paper elevation={0} sx={{ p: { xs: 2, md: 2.5 } }}>
              <Stack spacing={2}>
                <Typography variant="h6">Summary</Typography>
                <Stack spacing={1.25}>
                  {summaryRows(insights).map((row) => (
                    <Box
                      key={row.label}
                      sx={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 2,
                        py: 1,
                        borderBottom: "1px solid",
                        borderColor: "divider",
                      }}
                    >
                      <Typography color="text.secondary">{row.label}</Typography>
                      <Typography fontWeight={700} fontFamily='"IBM Plex Mono", monospace'>
                        {row.value}
                      </Typography>
                    </Box>
                  ))}
                </Stack>
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  <Chip
                    size="small"
                    label={insights.reconciliation?.ok ? "reconciliation ok" : "check reconciliation"}
                    color={insights.reconciliation?.ok ? "success" : "warning"}
                    variant="outlined"
                  />
                  {insights.fetchLimits?.truncatedReviews && (
                    <Chip size="small" label="reviews truncated" color="warning" variant="outlined" />
                  )}
                  <Chip
                    size="small"
                    label={`${insights.fetchLimits?.githubRequests ?? "?"} GitHub calls`}
                    variant="outlined"
                  />
                </Stack>
              </Stack>
            </Paper>
          )}

          {/* Line 5: Signals */}
          {insights && (
            <Paper elevation={0} sx={{ p: { xs: 2, md: 2.5 } }}>
              <Stack spacing={1.5}>
                <Typography variant="h6">Signals</Typography>
                {insights.signals.map((signal) => (
                  <Alert
                    key={signal.id}
                    severity={severityColor[signal.severity]}
                    sx={{ alignItems: "flex-start" }}
                  >
                    <Typography fontWeight={700}>{signal.title}</Typography>
                    <Typography variant="body2">{signal.detail}</Typography>
                  </Alert>
                ))}
              </Stack>
            </Paper>
          )}

          {/* Line 6: Contributors */}
          {insights && (
            <Paper elevation={0} sx={{ p: { xs: 2, md: 2.5 }, overflowX: "auto" }}>
              <Typography variant="h6" sx={{ mb: 1.5 }}>
                Top contributors
              </Typography>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Login</TableCell>
                    <TableCell align="right">Commits</TableCell>
                    <TableCell align="right">PRs</TableCell>
                    <TableCell align="right">Score</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {insights.topContributors.slice(0, 10).map((row) => (
                    <TableRow key={row.login} hover>
                      <TableCell>{row.login}</TableCell>
                      <TableCell align="right">{row.commits}</TableCell>
                      <TableCell align="right">{row.prsMerged}</TableCell>
                      <TableCell align="right">{row.score}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Paper>
          )}

          {/* Line 7: Reviewers */}
          {insights && (
            <Paper elevation={0} sx={{ p: { xs: 2, md: 2.5 }, overflowX: "auto" }}>
              <Typography variant="h6" sx={{ mb: 1.5 }}>
                Top reviewers
              </Typography>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Login</TableCell>
                    <TableCell align="right">Reviews</TableCell>
                    <TableCell align="right">Approvals</TableCell>
                    <TableCell align="right">Changes</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {insights.topReviewers.slice(0, 10).map((row) => (
                    <TableRow key={row.login} hover>
                      <TableCell>{row.login}</TableCell>
                      <TableCell align="right">{row.reviews}</TableCell>
                      <TableCell align="right">{row.approvals}</TableCell>
                      <TableCell align="right">{row.changesRequested}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Paper>
          )}

          {/* Line 8: Narrative */}
          <Paper elevation={0} sx={{ p: { xs: 2, md: 2.5 } }}>
            <Stack spacing={1.75}>
              <Typography variant="h6">LLM narrative</Typography>
              {!narrative ? (
                <Typography color="text.secondary">
                  Run synthesis to generate a story over the numbers.
                </Typography>
              ) : (
                <>
                  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                    <Chip label={`confidence ${narrative.confidence.toFixed(2)}`} color="primary" />
                    <Chip label={`${narrative.provider} / ${narrative.model}`} variant="outlined" />
                    <Chip
                      label={`${narrative.owner}/${narrative.repo} · ${narrative.periodDays}d`}
                      variant="outlined"
                    />
                    {narrative.evidenceGrounded && (
                      <Chip label="evidence grounded" color="success" variant="outlined" />
                    )}
                  </Stack>
                  <Typography sx={{ lineHeight: 1.7 }}>{narrative.narrative}</Typography>
                  <Divider />
                  <Typography>
                    <strong>Hypothesis.</strong> {narrative.hypothesis}
                  </Typography>
                  <Stack spacing={1}>
                    {narrative.evidence.map((item) => (
                      <Paper
                        key={`${item.signalId}-${item.claim}`}
                        variant="outlined"
                        sx={{ p: 1.5, bgcolor: "rgba(16,35,58,0.03)" }}
                      >
                        <Typography fontWeight={600}>{item.claim}</Typography>
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{ fontFamily: '"IBM Plex Mono", monospace', display: "block", mt: 0.5 }}
                        >
                          {item.signalId} · {JSON.stringify(item.numbers)}
                        </Typography>
                      </Paper>
                    ))}
                  </Stack>
                </>
              )}
            </Stack>
          </Paper>
        </Stack>
      </Container>
    </Box>
  );
}

function summaryRows(insights: InsightsResponse) {
  return [
    { label: "Commits", value: String(insights.summary.commits) },
    { label: "PRs opened", value: String(insights.summary.prsOpened) },
    { label: "PRs merged", value: String(insights.summary.prsMerged) },
    { label: "Reviews", value: String(insights.summary.reviews) },
    { label: "Bus factor", value: String(insights.summary.busFactor) },
    {
      label: "Median cycle (h)",
      value:
        insights.summary.medianPrCycleHours == null
          ? "—"
          : String(insights.summary.medianPrCycleHours),
    },
    {
      label: "Review top-2 share",
      value: `${Math.round(insights.summary.reviewConcentrationTop2 * 100)}%`,
    },
    { label: "Contributors", value: String(insights.summary.activeContributors) },
    { label: "Issues closed", value: String(insights.summary.issuesClosed) },
  ];
}
