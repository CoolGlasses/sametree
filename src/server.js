'use strict';
/*
 * SameTree server: the webhook receiver + the real-time canceller.
 *
 * Event flow (workflow_run):
 *  - action "requested": resolve the run's head commit to its TREE
 *    sha. If this workflow already has a completed SUCCESS for the
 *    same tree (any ref, any trigger — that cross-trigger blindness
 *    is exactly what GitHub's native concurrency groups cannot do),
 *    cancel the new run and record the save. Conservative by design:
 *    a tree is only "proven" by a completed success, never by an
 *    in-flight run, so cancelling can never leave a tree unchecked.
 *  - action "completed" with conclusion "success": record the tree
 *    as passed for that workflow.
 *
 * Also handles installation bookkeeping. Everything else is logged
 * and ignored.
 */
const http = require('http');
const { verifyWebhookSignature } = require('./github');

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function createServer({ store, github, webhookSecret, log }) {
  const logger = log || (() => {});

  async function handleWorkflowRun(payload) {
    const run = payload.workflow_run;
    const repo = payload.repository;
    const installationId = payload.installation && payload.installation.id;
    if (!run || !repo || !installationId) return;
    store.recordRepo(repo, installationId);
    const owner = repo.owner.login;

    const treeSha = await github.getTreeSha(installationId, owner, repo.name, run.head_sha);
    if (!treeSha) return;

    if (payload.action === 'completed' && run.conclusion === 'success') {
      store.recordPassed(repo.id, run.workflow_id, treeSha, {
        runId: run.id,
        runUrl: run.html_url,
        headSha: run.head_sha,
        completedAt: new Date().toISOString(),
      });
      logger(`passed: ${repo.full_name} workflow ${run.workflow_id} tree ${treeSha.slice(0, 8)} (run ${run.id})`);
      return;
    }

    if (payload.action === 'requested' || payload.action === 'in_progress') {
      if (run.status === 'completed') return;
      const passed = store.getPassed(repo.id, run.workflow_id, treeSha);
      if (passed && passed.runId !== run.id) {
        await github.cancelWorkflowRun(installationId, owner, repo.name, run.id);
        store.recordCancellation({
          repoId: repo.id,
          runId: run.id,
          treeSha,
          savedByRunUrl: passed.runUrl,
          at: new Date().toISOString(),
        });
        logger(`cancelled duplicate: ${repo.full_name} run ${run.id} tree ${treeSha.slice(0, 8)} already green in run ${passed.runId}`);
      }
    }
  }

  async function route(event, payload) {
    if (event === 'installation') {
      if (payload.action === 'created') store.recordInstallation(payload.installation);
      if (payload.action === 'deleted' || payload.action === 'suspend') store.suspendInstallation(payload.installation.id);
      return;
    }
    if (event === 'workflow_run') {
      await handleWorkflowRun(payload);
    }
  }

  const server = http.createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, service: 'sametree' }));
      return;
    }
    if (req.method !== 'POST' || req.url !== '/webhooks') {
      res.writeHead(404); res.end('not found'); return;
    }
    const raw = await readBody(req);
    if (!verifyWebhookSignature(raw, req.headers['x-hub-signature-256'], webhookSecret)) {
      res.writeHead(401); res.end('bad signature'); return;
    }
    // Acknowledge fast; process async so slow API calls don't make
    // GitHub mark the delivery failed.
    res.writeHead(202); res.end('accepted');
    try {
      const payload = JSON.parse(raw.toString('utf8'));
      await route(req.headers['x-github-event'], payload);
    } catch (err) {
      logger(`handler error: ${err.message}`);
    }
  });
  return server;
}

function main() {
  const fs = require('fs');
  const { Store } = require('./store');
  const { makeGithubClient } = require('./github');
  const config = {
    port: parseInt(process.env.PORT || '8931', 10),
    appId: process.env.GITHUB_APP_ID,
    privateKey: process.env.GITHUB_APP_PRIVATE_KEY_PATH
      ? fs.readFileSync(process.env.GITHUB_APP_PRIVATE_KEY_PATH, 'utf8')
      : process.env.GITHUB_APP_PRIVATE_KEY,
    webhookSecret: process.env.GITHUB_WEBHOOK_SECRET,
    storePath: process.env.SAMETREE_STORE || require('path').join(__dirname, '..', 'data', 'store.json'),
  };
  if (!config.appId || !config.privateKey || !config.webhookSecret) {
    console.error('Missing GITHUB_APP_ID / GITHUB_APP_PRIVATE_KEY(_PATH) / GITHUB_WEBHOOK_SECRET');
    process.exit(2);
  }
  const store = new Store(config.storePath);
  const github = makeGithubClient({ appId: config.appId, privateKeyPem: config.privateKey });
  const server = createServer({ store, github, webhookSecret: config.webhookSecret, log: (m) => console.log(new Date().toISOString(), m) });
  server.listen(config.port, () => console.log(`SameTree listening on :${config.port}`));
}

if (require.main === module) main();

module.exports = { createServer };
