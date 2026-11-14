'use strict';
/*
 * Pure decision + accounting logic, kept free of I/O so it can be
 * tested exactly. The numbers here are the product: a customer is
 * paying for cancelled duplicates and for this arithmetic.
 */

/* GitHub bills each job rounded UP to the nearest whole minute.
 * The Pugliese audit that anchors this product measured the round-up
 * alone at 48% of one org's bill (831 actual minutes billed as 1,586),
 * so the rounding waste is a first-class output, not a footnote. */
function jobMinutes(job) {
  const start = Date.parse(job.started_at);
  const end = Date.parse(job.completed_at);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return { actual: 0, billed: 0 };
  }
  const actualSeconds = (end - start) / 1000;
  return { actual: actualSeconds / 60, billed: Math.ceil(actualSeconds / 60) };
}

/*
 * Aggregate one day of workflow runs + their jobs for one repo.
 * runs: [{ id, workflow_id, head_sha, tree_sha (may be null), status,
 *          conclusion, run_attempt, html_url, name }]
 * jobsByRun: { runId: [job, ...] }
 *
 * Waste lanes:
 *  - rounding:  billed - actual across all jobs (the per-job ceil tax)
 *  - reruns:    billed minutes of runs with run_attempt > 1
 *  - duplicateTrees: billed minutes of completed runs whose tree was
 *    ALSO completed (any conclusion... no: success) by another run of
 *    the same workflow that day — work the canceller would have saved.
 */
function aggregateDay(runs, jobsByRun) {
  let actual = 0, billed = 0;
  const perWorkflow = {};
  for (const run of runs) {
    const jobs = jobsByRun[run.id] || [];
    let runBilled = 0, runActual = 0;
    for (const job of jobs) {
      const m = jobMinutes(job);
      runActual += m.actual;
      runBilled += m.billed;
    }
    actual += runActual;
    billed += runBilled;
    run._billed = runBilled;
    const w = perWorkflow[run.workflow_id] || (perWorkflow[run.workflow_id] = { name: run.name, runs: 0, billed: 0 });
    w.runs++;
    w.billed += runBilled;
  }

  const rerunMinutes = runs.filter((r) => (r.run_attempt || 1) > 1).reduce((s, r) => s + r._billed, 0);

  // Duplicate-tree waste: group completed runs by (workflow, tree).
  // Within a group with at least one success, every completed run
  // beyond the FIRST success is duplicated proof of the same tree.
  const groups = new Map();
  for (const run of runs) {
    if (run.status !== 'completed' || !run.tree_sha) continue;
    const key = `${run.workflow_id}:${run.tree_sha}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(run);
  }
  let duplicateMinutes = 0;
  let duplicateRuns = 0;
  for (const group of groups.values()) {
    const successes = group.filter((r) => r.conclusion === 'success');
    if (successes.length === 0) continue;
    const firstSuccessAt = Math.min(...successes.map((r) => Date.parse(r.updated_at || r.created_at)));
    for (const run of group) {
      if (run.conclusion === 'success' && Date.parse(run.updated_at || run.created_at) === firstSuccessAt) continue;
      duplicateMinutes += run._billed;
      duplicateRuns++;
    }
  }

  return {
    runs: runs.length,
    actualMinutes: Math.round(actual * 10) / 10,
    billedMinutes: billed,
    roundingWaste: Math.round((billed - actual) * 10) / 10,
    rerunMinutes,
    duplicateTreeMinutes: duplicateMinutes,
    duplicateTreeRuns: duplicateRuns,
    perWorkflow,
  };
}

/* A rough dollar figure for the digest. GitHub's blended per-minute
 * price varies by runner OS/size; Linux standard is $0.008/min. The
 * digest labels this an estimate every time it prints. */
const USD_PER_MINUTE_LINUX = 0.008;
function estimateUsd(minutes) {
  return Math.round(minutes * USD_PER_MINUTE_LINUX * 100) / 100;
}

function buildDigestMarkdown(repoFullName, week) {
  // week: [{ date, aggregate }] oldest -> newest
  const tot = { billed: 0, rounding: 0, rerun: 0, dup: 0, dupRuns: 0, runs: 0 };
  const lanes = {};
  for (const { aggregate } of week) {
    if (!aggregate) continue;
    tot.billed += aggregate.billedMinutes;
    tot.rounding += aggregate.roundingWaste;
    tot.rerun += aggregate.rerunMinutes;
    tot.dup += aggregate.duplicateTreeMinutes;
    tot.dupRuns += aggregate.duplicateTreeRuns;
    tot.runs += aggregate.runs;
    for (const [wid, w] of Object.entries(aggregate.perWorkflow || {})) {
      const l = lanes[wid] || (lanes[wid] = { name: w.name, billed: 0 });
      l.billed += w.billed;
    }
  }
  const waste = tot.rounding + tot.rerun + tot.dup;
  const topLanes = Object.values(lanes).sort((a, b) => b.billed - a.billed).slice(0, 5);
  const lines = [
    `## SameTree weekly waste report — ${repoFullName}`,
    '',
    `Last 7 days: **${tot.billed} billed minutes** across ${tot.runs} workflow runs (≈ $${estimateUsd(tot.billed)} at Linux standard rates — estimate).`,
    '',
    `Identified waste: **${Math.round(waste)} minutes (≈ $${estimateUsd(waste)})**`,
    `- Duplicate-tree reruns: ${tot.dup} min across ${tot.dupRuns} runs — the same tree proven green more than once. SameTree cancels these in real time when installed before the fact.`,
    `- Rerun attempts: ${tot.rerun} min billed to run_attempt > 1.`,
    `- Per-job minute rounding: ${Math.round(tot.rounding)} min — GitHub bills every job rounded up to the next whole minute.`,
    '',
    `### Top workflows by billed minutes`,
    ...topLanes.map((l) => `- ${l.name}: ${l.billed} min`),
    '',
    `_Generated by SameTree. Dollar figures use GitHub's Linux standard $0.008/min and are estimates._`,
  ];
  return lines.join('\n');
}

module.exports = { jobMinutes, aggregateDay, estimateUsd, buildDigestMarkdown, USD_PER_MINUTE_LINUX };
