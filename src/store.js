'use strict';
/*
 * Tiny JSON-file store. v1 scale (a handful of installations, metadata
 * only — no code, no logs) does not justify a database.
 *
 * Two processes share this file: the long-lived webhook server and the
 * cron-run audit CLI. Both hold the data in memory, so a naive
 * write-back loses updates — whichever process saves last overwrites
 * the other's work (caught in review before the first live audit).
 * The discipline here: every mutation runs inside a lockfile-held
 * transaction that RELOADS from disk first, applies the change, then
 * writes back atomically (tmp file + rename). Reads also reload first;
 * the atomic rename means a reader never sees a partial file.
 */
const fs = require('fs');
const path = require('path');

const LOCK_STALE_MS = 10_000;
const LOCK_TIMEOUT_MS = 5_000;

class Store {
  constructor(filePath) {
    this.filePath = filePath;
    this.lockPath = filePath + '.lock';
    this.data = Store.emptyData();
    this.load();
  }

  static emptyData() {
    return {
      installations: {}, // id -> { id, accountLogin, suspended, seenAt }
      repos: {},         // repoId -> { id, owner, name, installationId, digest }
      passedTrees: {},   // `${repoId}:${workflowId}:${treeSha}` -> { runId, runUrl, headSha, completedAt }
      cancellations: [], // { repoId, runId, treeSha, savedRunUrl, at }
      dailyAudits: {},   // `${repoId}:${yyyy-mm-dd}` -> aggregate object
    };
  }

  load() {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      this.data = { ...Store.emptyData(), ...parsed };
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      this.data = Store.emptyData();
    }
  }

  save() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 1));
    fs.renameSync(tmp, this.filePath);
  }

  acquireLock() {
    const deadline = Date.now() + LOCK_TIMEOUT_MS;
    for (;;) {
      try {
        return fs.openSync(this.lockPath, 'wx');
      } catch (err) {
        if (err.code !== 'EEXIST') throw err;
        // Break a stale lock (holder killed mid-transaction).
        try {
          const st = fs.statSync(this.lockPath);
          if (Date.now() - st.mtimeMs > LOCK_STALE_MS) { fs.unlinkSync(this.lockPath); continue; }
        } catch (_) { continue; }
        if (Date.now() > deadline) throw new Error(`store lock timeout: ${this.lockPath}`);
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 15);
      }
    }
  }

  transact(mutate) {
    const fd = this.acquireLock();
    try {
      this.load();
      const result = mutate(this.data);
      this.save();
      return result;
    } finally {
      try { fs.closeSync(fd); } catch (_) {}
      try { fs.unlinkSync(this.lockPath); } catch (_) {}
    }
  }

  recordInstallation(inst) {
    this.transact((data) => {
      data.installations[inst.id] = {
        id: inst.id,
        accountLogin: inst.account && inst.account.login,
        suspended: false,
        seenAt: new Date().toISOString(),
      };
    });
  }

  suspendInstallation(id) {
    this.transact((data) => {
      if (data.installations[id]) data.installations[id].suspended = true;
    });
  }

  recordRepo(repo, installationId) {
    this.transact((data) => {
      data.repos[repo.id] = {
        id: repo.id,
        owner: repo.owner.login,
        name: repo.name,
        installationId,
        digest: (data.repos[repo.id] && data.repos[repo.id].digest) || false,
      };
    });
  }

  passedKey(repoId, workflowId, treeSha) {
    return `${repoId}:${workflowId}:${treeSha}`;
  }

  getPassed(repoId, workflowId, treeSha) {
    this.load();
    return this.data.passedTrees[this.passedKey(repoId, workflowId, treeSha)] || null;
  }

  recordPassed(repoId, workflowId, treeSha, info) {
    this.transact((data) => {
      data.passedTrees[this.passedKey(repoId, workflowId, treeSha)] = info;
    });
  }

  recordCancellation(entry) {
    this.transact((data) => {
      data.cancellations.push(entry);
    });
  }

  setDailyAudit(repoId, date, aggregate) {
    this.transact((data) => {
      data.dailyAudits[`${repoId}:${date}`] = aggregate;
    });
  }

  getDailyAudit(repoId, date) {
    this.load();
    return this.data.dailyAudits[`${repoId}:${date}`] || null;
  }
}

module.exports = { Store };
