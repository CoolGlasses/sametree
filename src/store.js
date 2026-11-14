'use strict';
/*
 * Tiny JSON-file store. v1 scale (a handful of installations, metadata
 * only — no code, no logs) does not justify a database. Writes are
 * atomic (tmp file + rename) and every mutation persists immediately:
 * the process may be restarted by the host at any time and must not
 * lose the tree registry, which is the product's memory.
 */
const fs = require('fs');
const path = require('path');

class Store {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = {
      installations: {}, // id -> { id, accountLogin, suspended, seenAt }
      repos: {},         // repoId -> { id, owner, name, installationId, digest }
      passedTrees: {},   // `${repoId}:${workflowId}:${treeSha}` -> { runId, runUrl, headSha, completedAt }
      cancellations: [], // { repoId, runId, treeSha, savedRunUrl, at }
      dailyAudits: {},   // `${repoId}:${yyyy-mm-dd}` -> aggregate object
    };
    this.load();
  }

  load() {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      this.data = { ...this.data, ...parsed };
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }

  save() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmp = this.filePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 1));
    fs.renameSync(tmp, this.filePath);
  }

  recordInstallation(inst) {
    this.data.installations[inst.id] = {
      id: inst.id,
      accountLogin: inst.account && inst.account.login,
      suspended: false,
      seenAt: new Date().toISOString(),
    };
    this.save();
  }

  suspendInstallation(id) {
    if (this.data.installations[id]) this.data.installations[id].suspended = true;
    this.save();
  }

  recordRepo(repo, installationId) {
    this.data.repos[repo.id] = {
      id: repo.id,
      owner: repo.owner.login,
      name: repo.name,
      installationId,
      digest: (this.data.repos[repo.id] && this.data.repos[repo.id].digest) || false,
    };
    this.save();
  }

  passedKey(repoId, workflowId, treeSha) {
    return `${repoId}:${workflowId}:${treeSha}`;
  }

  getPassed(repoId, workflowId, treeSha) {
    return this.data.passedTrees[this.passedKey(repoId, workflowId, treeSha)] || null;
  }

  recordPassed(repoId, workflowId, treeSha, info) {
    this.data.passedTrees[this.passedKey(repoId, workflowId, treeSha)] = info;
    this.save();
  }

  recordCancellation(entry) {
    this.data.cancellations.push(entry);
    this.save();
  }

  setDailyAudit(repoId, date, aggregate) {
    this.data.dailyAudits[`${repoId}:${date}`] = aggregate;
    this.save();
  }

  getDailyAudit(repoId, date) {
    return this.data.dailyAudits[`${repoId}:${date}`] || null;
  }
}

module.exports = { Store };
