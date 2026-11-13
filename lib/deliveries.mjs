import { DatabaseSync } from 'node:sqlite';

export class DeliveryStore {
  constructor(path) {
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS deliveries (
        id TEXT PRIMARY KEY, message TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0, next_at INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL, completed_at INTEGER
      );`);
  }

  enqueue(id, message) {
    return this.db.prepare(`INSERT OR IGNORE INTO deliveries (id, message, created_at)
      VALUES (?, ?, ?)`).run(id, JSON.stringify(message), Date.now()).changes > 0;
  }

  async deliverOne(send, now = Date.now()) {
    const row = this.db.prepare(`SELECT * FROM deliveries WHERE status = 'pending' AND next_at <= ?
      ORDER BY created_at, id LIMIT 1`).get(now);
    if (!row) return false;
    try {
      await send(JSON.parse(row.message));
      this.db.prepare(`UPDATE deliveries SET status = 'sent', completed_at = ?, message = '{}' WHERE id = ?`).run(now, row.id);
    } catch {
      const attempts = row.attempts + 1;
      const status = attempts >= 8 ? 'failed' : 'pending';
      this.db.prepare(`UPDATE deliveries SET status = ?, attempts = ?, next_at = ? WHERE id = ?`)
        .run(status, attempts, now + Math.min(3600, 30 * 2 ** (attempts - 1)) * 1000, row.id);
      console.error(`Discord delivery ${row.id} failed; ${status === 'failed' ? 'manual retry required' : 'retry scheduled'}.`);
    }
    return true;
  }

  retryFailed() {
    return this.db.prepare(`UPDATE deliveries SET status = 'pending', attempts = 0, next_at = 0
      WHERE status = 'failed'`).run().changes;
  }

  prune(now = Date.now()) {
    this.db.prepare(`DELETE FROM deliveries WHERE status = 'sent' AND completed_at < ?`)
      .run(now - 30 * 86400_000);
  }

  close() { this.db.close(); }
}
