'use strict';
/*
 * Nightly audit + weekly digest, run as a CLI by the host's cron:
 *   node src/audit.js nightly   — aggregate yesterday for every repo
 *   node src/audit.js digest    — post this week's issue for digest-on repos
 *
 * The audit needs each run's tree SHA, which the runs list API does
 * not return directly: we reuse the tree registry the webhook side
 * built (passedTrees), and resolve any missing head commits live.
 */
const fs = require('fs');
const path = require('path');
const { Store } = require('./store');
const { makeGithubClient } = require('./github');
const { aggregateDay, buildDigestMarkdown } = require('./logic');

function yesterdayUtc() {
  const d = new Date(Date.now() - 24 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}

async function runNightly({ store, github, date, log }) {
  const day = date || yesterdayUtc();
  const created = `${day}..${day}`;
  for (const repo of Object.values(store.data.repos)) {
    try {
      const runs = await github.listWorkflowRunsCreated(repo.installationId, repo.owner, repo.name, created);
      const jobsByRun = {};
      for (const run of runs) {
        const commit = run.head_sha;
        // Tree from the registry when a passed entry matches this run,
        // else resolve the commit (cheap, one call per run at v1 scale).
        let tree = null;
        for (const [key, val] of Object.entries(store.data.passedTrees)) {
          if (val.runId === run.id) { tree = key.split(':')[2]; break; }
        }
        if (!tree) tree = await github.getTreeSha(repo.installationId, repo.owner, repo.name, commit);
        run.tree_sha = tree;
        jobsByRun[run.id] = await github.listJobsForRun(repo.installationId, repo.owner, repo.name, run.id);
      }
      const aggregate = aggregateDay(runs, jobsByRun);
      store.setDailyAudit(repo.id, day, aggregate);
      log(`audit ${repo.owner}/${repo.name} ${day}: ${aggregate.billedMinutes} billed, ${aggregate.duplicateTreeMinutes} dup-tree, ${aggregate.roundingWaste} rounding`);
    } catch (err) {
      log(`audit failed for ${repo.owner}/${repo.name}: ${err.message}`);
    }
  }
}

async function runDigest({ store, github, log }) {
  for (const repo of Object.values(store.data.repos)) {
    if (!repo.digest) continue;
    const week = [];
    for (let i = 7; i >= 1; i--) {
      const d = new Date(Date.now() - i * 24 * 3600 * 1000).toISOString().slice(0, 10);
      week.push({ date: d, aggregate: store.getDailyAudit(repo.id, d) });
    }
    if (!week.some((w) => w.aggregate)) continue;
    const body = buildDigestMarkdown(`${repo.owner}/${repo.name}`, week);
    const issue = await github.createIssue(repo.installationId, repo.owner, repo.name,
      `SameTree weekly waste report — ${new Date().toISOString().slice(0, 10)}`, body);
    log(`digest posted for ${repo.owner}/${repo.name}: ${issue.html_url}`);
  }
}

async function main() {
  const mode = process.argv[2];
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY_PATH
    ? fs.readFileSync(process.env.GITHUB_APP_PRIVATE_KEY_PATH, 'utf8')
    : process.env.GITHUB_APP_PRIVATE_KEY;
  const store = new Store(process.env.SAMETREE_STORE || path.join(__dirname, '..', 'data', 'store.json'));
  const github = makeGithubClient({ appId: process.env.GITHUB_APP_ID, privateKeyPem: privateKey });
  const log = (m) => console.log(new Date().toISOString(), m);
  if (mode === 'nightly') await runNightly({ store, github, log });
  else if (mode === 'digest') await runDigest({ store, github, log });
  else { console.error('usage: node src/audit.js nightly|digest'); process.exit(2); }
}

if (require.main === module) main();

module.exports = { runNightly, runDigest, yesterdayUtc };
