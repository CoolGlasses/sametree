'use strict';
/*
 * GitHub App plumbing: webhook signature verification, App JWT ->
 * installation access token exchange, and the small REST surface
 * SameTree needs (commit tree lookup, run cancel, run/job listing,
 * issue creation). No dependencies: Node's crypto + fetch.
 */
const crypto = require('crypto');

function verifyWebhookSignature(rawBody, signatureHeader, secret) {
  if (!signatureHeader || !secret) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signatureHeader));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function base64url(input) {
  return Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function makeAppJwt(appId, privateKeyPem, nowSeconds) {
  const now = nowSeconds || Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = { iat: now - 60, exp: now + 540, iss: String(appId) };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(signingInput), privateKeyPem);
  return `${signingInput}.${base64url(signature)}`;
}

function makeGithubClient({ appId, privateKeyPem, fetchImpl, apiBase }) {
  const doFetch = fetchImpl || fetch;
  const base = apiBase || 'https://api.github.com';
  const tokenCache = new Map(); // installationId -> { token, expiresAtMs }

  async function api(token, method, path, body) {
    const res = await doFetch(base + path, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'user-agent': 'SameTree',
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = typeof res.text === 'function' ? await res.text() : '';
      throw new Error(`GitHub API ${method} ${path} -> ${res.status} ${text.slice(0, 200)}`);
    }
    if (res.status === 204) return null;
    return res.json();
  }

  async function getInstallationToken(installationId) {
    const cached = tokenCache.get(installationId);
    if (cached && cached.expiresAtMs - Date.now() > 60_000) return cached.token;
    const jwt = makeAppJwt(appId, privateKeyPem);
    const data = await api(jwt, 'POST', `/app/installations/${installationId}/access_tokens`);
    tokenCache.set(installationId, { token: data.token, expiresAtMs: Date.parse(data.expires_at) });
    return data.token;
  }

  return {
    // Resolve a commit SHA to its tree SHA: the identity SameTree keys on.
    // Two different commits (different messages/parents) with identical
    // content share a tree SHA — that is the whole point of the product.
    async getTreeSha(installationId, owner, repo, commitSha) {
      const token = await getInstallationToken(installationId);
      const commit = await api(token, 'GET', `/repos/${owner}/${repo}/git/commits/${commitSha}`);
      return commit.tree.sha;
    },
    async cancelWorkflowRun(installationId, owner, repo, runId) {
      const token = await getInstallationToken(installationId);
      return api(token, 'POST', `/repos/${owner}/${repo}/actions/runs/${runId}/cancel`);
    },
    async listWorkflowRunsCreated(installationId, owner, repo, createdQuery) {
      const token = await getInstallationToken(installationId);
      const out = [];
      let page = 1;
      for (;;) {
        const data = await api(token, 'GET', `/repos/${owner}/${repo}/actions/runs?created=${encodeURIComponent(createdQuery)}&per_page=100&page=${page}`);
        out.push(...(data.workflow_runs || []));
        if (!data.workflow_runs || data.workflow_runs.length < 100) break;
        page++;
      }
      return out;
    },
    async listJobsForRun(installationId, owner, repo, runId) {
      const token = await getInstallationToken(installationId);
      const out = [];
      let page = 1;
      for (;;) {
        const data = await api(token, 'GET', `/repos/${owner}/${repo}/actions/runs/${runId}/jobs?per_page=100&page=${page}`);
        out.push(...(data.jobs || []));
        if (!data.jobs || data.jobs.length < 100) break;
        page++;
      }
      return out;
    },
    async createIssue(installationId, owner, repo, title, body) {
      const token = await getInstallationToken(installationId);
      return api(token, 'POST', `/repos/${owner}/${repo}/issues`, { title, body });
    },
  };
}

module.exports = { verifyWebhookSignature, makeAppJwt, makeGithubClient };
