'use strict';
/* SameTree test suite: no framework, no dependencies. */
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { verifyWebhookSignature, makeAppJwt } = require('../src/github');
const { jobMinutes, aggregateDay, buildDigestMarkdown } = require('../src/logic');
const { Store } = require('../src/store');
const { createServer } = require('../src/server');

let passed = 0, failed = 0;
const pending = [];
function test(name, fn) {
  const r = fn();
  if (r && typeof r.then === 'function') {
    pending.push(r.then(() => { passed++; console.log(`  ok    ${name}`); })
      .catch((err) => { failed++; console.log(`  FAIL  ${name}\n        ${err.message}`); }));
  } else {
    try { passed++; console.log(`  ok    ${name}`); }
    catch (err) { failed++; console.log(`  FAIL  ${name}\n        ${err.message}`); }
  }
}
function check(name, fn) {
  try { fn(); passed++; console.log(`  ok    ${name}`); }
  catch (err) { failed++; console.log(`  FAIL  ${name}\n        ${err.message}`); }
}

const SECRET = 'test-secret';
function sign(body) {
  return 'sha256=' + crypto.createHmac('sha256', SECRET).update(body).digest('hex');
}

check('webhook signature: valid passes, tampered fails', () => {
  const body = Buffer.from('{"a":1}');
  assert.strictEqual(verifyWebhookSignature(body, sign(body), SECRET), true);
  assert.strictEqual(verifyWebhookSignature(Buffer.from('{"a":2}'), sign(body), SECRET), false);
  assert.strictEqual(verifyWebhookSignature(body, null, SECRET), false);
});

check('app JWT: RS256 structure and claims', () => {
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const jwt = makeAppJwt(12345, pem, 1_700_000_000);
  const parts = jwt.split('.');
  assert.strictEqual(parts.length, 3);
  const payload = JSON.parse(Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
  assert.strictEqual(payload.iss, '12345');
  assert.strictEqual(payload.exp - payload.iat, 600);
});

check('jobMinutes: billed is ceil of actual (the round-up tax)', () => {
  const job = { started_at: '2026-11-13T10:00:00Z', completed_at: '2026-11-13T10:00:20Z' }; // 20s
  const m = jobMinutes(job);
  assert.strictEqual(m.billed, 1);
  assert.ok(Math.abs(m.actual - 1 / 3) < 0.01);
  const long = { started_at: '2026-11-13T10:00:00Z', completed_at: '2026-11-13T10:12:00Z' }; // 12m
  assert.strictEqual(jobMinutes(long).billed, 12);
  assert.deepStrictEqual(jobMinutes({ started_at: null, completed_at: null }), { actual: 0, billed: 0 });
});

function job(id, sec) {
  return { id, started_at: '2026-11-13T10:00:00Z', completed_at: new Date(Date.parse('2026-11-13T10:00:00Z') + sec * 1000).toISOString() };
}
function run(id, workflow_id, tree, attempt, conclusion, updatedMin) {
  return {
    id, workflow_id, name: 'CI', head_sha: `sha-${id}`, tree_sha: tree,
    status: 'completed', conclusion, run_attempt: attempt,
    created_at: '2026-11-13T09:00:00Z', updated_at: `2026-11-13T09:${String(updatedMin).padStart(2, '0')}:00Z`,
    html_url: `https://example.test/runs/${id}`,
  };
}

check('aggregateDay: rounding, rerun, and duplicate-tree waste separated', () => {
  // Same tree T proven by run 1: 8 jobs of 90s = 12 min actual, but the
  // per-job ceil makes it 8 x 2 = 16 billed. Run 2 duplicates it (16).
  // Run 3 is a rerun of another tree: one 300s job, billed 5.
  const runs = [run(1, 7, 'T', 1, 'success', 10), run(2, 7, 'T', 1, 'success', 30), run(3, 7, 'U', 2, 'failure', 40)];
  const jobs = {
    1: Array.from({ length: 8 }, (_, i) => job(100 + i, 90)),
    2: Array.from({ length: 8 }, (_, i) => job(200 + i, 90)),
    3: [job(300, 300)],
  };
  const agg = aggregateDay(runs, jobs);
  assert.strictEqual(agg.billedMinutes, 16 + 16 + 5);
  assert.strictEqual(agg.duplicateTreeMinutes, 16, `dup minutes: ${JSON.stringify(agg)}`);
  assert.strictEqual(agg.duplicateTreeRuns, 1);
  assert.strictEqual(agg.rerunMinutes, 5);
  assert.ok(agg.roundingWaste > 0);
});

check('digest markdown includes the three waste lanes and a dollar estimate', () => {
  const md = buildDigestMarkdown('acme/widgets', [{ date: '2026-11-12', aggregate: {
    billedMinutes: 100, roundingWaste: 20, rerunMinutes: 5, duplicateTreeMinutes: 30, duplicateTreeRuns: 2, runs: 40,
    perWorkflow: { 7: { name: 'CI', billed: 100 } },
  } }]);
  assert.ok(md.includes('Duplicate-tree'));
  assert.ok(md.includes('$'));
  assert.ok(md.includes('acme/widgets'));
});

/* ---- server integration: the canceller decision end to end ---- */
function mockGithub() {
  const calls = [];
  return {
    calls,
    async getTreeSha(installationId, owner, repo, sha) { return { 'sha-a': 'TREE-T', 'sha-b': 'TREE-T', 'sha-c': 'TREE-U' }[sha]; },
    async cancelWorkflowRun(installationId, owner, repo, runId) { calls.push(['cancel', runId]); return {}; },
  };
}
function wrPayload(action, runId, headSha, conclusion) {
  return {
    action,
    workflow_run: {
      id: runId, workflow_id: 7, head_sha: headSha, status: action === 'completed' ? 'completed' : 'in_progress',
      conclusion: conclusion || null, html_url: `https://example.test/runs/${runId}`,
    },
    repository: { id: 42, name: 'widgets', full_name: 'acme/widgets', owner: { login: 'acme' } },
    installation: { id: 9 },
  };
}
async function post(server, port, event, payload) {
  const body = JSON.stringify(payload);
  const res = await fetch(`http://127.0.0.1:${port}/webhooks`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-github-event': event, 'x-hub-signature-256': sign(body) },
    body,
  });
  // Handlers process async after the 202; give them a tick.
  await new Promise((r) => setTimeout(r, 25));
  return res.status;
}

test('canceller: a requested run on an already-green tree is cancelled; a fresh tree is not', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sametree-'));
  const store = new Store(path.join(dir, 'store.json'));
  const github = mockGithub();
  const server = createServer({ store, github, webhookSecret: SECRET, log: () => {} });
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  try {
    // Run 501 completes green on TREE-T (head sha-a).
    assert.strictEqual(await post(server, port, 'workflow_run', wrPayload('completed', 501, 'sha-a', 'success')), 202);
    // Run 502 requests the SAME tree via a different commit (sha-b): cancel it.
    await post(server, port, 'workflow_run', wrPayload('requested', 502, 'sha-b'));
    assert.deepStrictEqual(github.calls, [['cancel', 502]], `calls: ${JSON.stringify(github.calls)}`);
    // Run 503 is a fresh tree: never cancelled.
    await post(server, port, 'workflow_run', wrPayload('requested', 503, 'sha-c'));
    assert.deepStrictEqual(github.calls, [['cancel', 502]]);
    // And the cancellation was recorded with its evidence.
    assert.strictEqual(store.data.cancellations.length, 1);
    assert.strictEqual(store.data.cancellations[0].savedByRunUrl, 'https://example.test/runs/501');
  } finally {
    server.close();
  }
});

test('server: bad signature is rejected 401', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sametree-'));
  const store = new Store(path.join(dir, 'store.json'));
  const server = createServer({ store, github: mockGithub(), webhookSecret: SECRET, log: () => {} });
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/webhooks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-github-event': 'workflow_run', 'x-hub-signature-256': 'sha256=deadbeef' },
      body: '{}',
    });
    assert.strictEqual(res.status, 401);
  } finally {
    server.close();
  }
});

Promise.all(pending).then(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
});
