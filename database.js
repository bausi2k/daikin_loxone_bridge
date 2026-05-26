const sqlite3 = require('sqlite3').verbose();
const path = require('path');

/**
 * @typedef {Object} Reading
 * @property {number} [id]
 * @property {number} timestamp
 * @property {number} vlt
 * @property {number} outdoor
 * @property {number} indoor
 * @property {number} tank
 * @property {number} target
 * @property {number} ww_active
 * @property {number} heating_active
 */

/**
 * @typedef {Object} SystemLog
 * @property {number} [id]
 * @property {number} timestamp
 * @property {string} level
 * @property {string} message
 */

/**
 * @typedef {Object} HistoryEntry
 * @property {number} timestamp
 * @property {number} vlt
 * @property {number} outdoor
 * @property {number} indoor
 * @property {number} tank
 * @property {number} target
 * @property {number} ww_active
 * @property {number} heating_active
 */

/**
 * @typedef {Object} StatsEntry
 * @property {string} label
 * @property {number} ww_minutes
 * @property {number} heat_minutes
 * @property {number|null} avg_heat_vlt
 */

class Database {
  constructor() {
    const dbPath = path.join(__dirname, 'history.db');
    this.db = new sqlite3.Database(dbPath);
    this.init();
  }

  init() {
    this.db.serialize(() => {
      // Readings Tabelle
      this.db.run(`
        CREATE TABLE IF NOT EXISTS readings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          timestamp INTEGER,
          vlt REAL, outdoor REAL, indoor REAL, tank REAL, target REAL,
          ww_active INTEGER DEFAULT 0,
          heating_active INTEGER DEFAULT 0
        )
      `);

      // Spalten Updates (falls nötig)
      this.db.run('ALTER TABLE readings ADD COLUMN ww_active INTEGER DEFAULT 0', () => {});
      this.db.run('ALTER TABLE readings ADD COLUMN heating_active INTEGER DEFAULT 0', () => {});
      this.db.run('CREATE INDEX IF NOT EXISTS idx_timestamp ON readings(timestamp)');

      // Logs Tabelle
      this.db.run(`
        CREATE TABLE IF NOT EXISTS system_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          timestamp INTEGER,
          level TEXT,
          message TEXT
        )
      `);
      this.db.run('CREATE INDEX IF NOT EXISTS idx_log_ts ON system_logs(timestamp)');
    });
  }

  /**
   * @param {Omit<Reading, 'id' | 'timestamp'>} data
   */
  saveReading(data) {
    const stmt = this.db.prepare(
      'INSERT INTO readings (timestamp, vlt, outdoor, indoor, tank, target, ww_active, heating_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    );
    stmt.run(
      Date.now(),
      data.vlt,
      data.outdoor,
      data.indoor,
      data.tank,
      data.target,
      data.ww_active || 0,
      data.heating_active || 0,
    );
    stmt.finalize();
  }

  /**
   * @param {string} mode
   * @returns {Promise<HistoryEntry[]>}
   */
  getHistory(mode) {
    return new Promise((resolve) => {
      let sql = '';
      let params = [];
      const now = Date.now();
      const oneDay = 24 * 60 * 60 * 1000;

      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const startOfYesterday = new Date(startOfDay.getTime() - oneDay);
      const endOfYesterday = new Date(startOfDay.getTime());

      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);
      const startOfLastMonth = new Date(startOfMonth);
      startOfLastMonth.setMonth(startOfLastMonth.getMonth() - 1);

      const startOfYear = new Date();
      startOfYear.setMonth(0, 1);
      startOfYear.setHours(0, 0, 0, 0);
      const startOfLastYear = new Date(startOfYear);
      startOfLastYear.setFullYear(startOfLastYear.getFullYear() - 1);

      const baseQuery =
        'SELECT timestamp, vlt, outdoor, indoor, tank, target, ww_active, heating_active FROM readings';

      switch (mode) {
        case '24h':
          sql = `${baseQuery} WHERE timestamp > ? ORDER BY timestamp ASC`;
          params = [now - oneDay];
          break;
        case 'today':
          sql = `${baseQuery} WHERE timestamp > ? ORDER BY timestamp ASC`;
          params = [startOfDay.getTime()];
          break;
        case 'yesterday':
          sql = `${baseQuery} WHERE timestamp >= ? AND timestamp < ? ORDER BY timestamp ASC`;
          params = [startOfYesterday.getTime(), endOfYesterday.getTime()];
          break;
        case 'month':
          sql = `SELECT min(timestamp) as timestamp, avg(vlt) as vlt, avg(outdoor) as outdoor, avg(tank) as tank FROM readings WHERE timestamp > ? GROUP BY strftime('%d-%H', timestamp / 1000, 'unixepoch', 'localtime') ORDER BY timestamp ASC`;
          params = [startOfMonth.getTime()];
          break;
        case 'last_month':
          sql = `SELECT min(timestamp) as timestamp, avg(vlt) as vlt, avg(outdoor) as outdoor, avg(tank) as tank FROM readings WHERE timestamp >= ? AND timestamp < ? GROUP BY strftime('%d-%H', timestamp / 1000, 'unixepoch', 'localtime') ORDER BY timestamp ASC`;
          params = [startOfLastMonth.getTime(), startOfMonth.getTime()];
          break;
        case 'year':
          sql = `SELECT min(timestamp) as timestamp, avg(vlt) as vlt, avg(outdoor) as outdoor, avg(tank) as tank FROM readings WHERE timestamp > ? GROUP BY strftime('%m-%d', timestamp / 1000, 'unixepoch', 'localtime') ORDER BY timestamp ASC`;
          params = [startOfYear.getTime()];
          break;
        case 'last_year':
          sql = `SELECT min(timestamp) as timestamp, avg(vlt) as vlt, avg(outdoor) as outdoor, avg(tank) as tank FROM readings WHERE timestamp >= ? AND timestamp < ? GROUP BY strftime('%m-%d', timestamp / 1000, 'unixepoch', 'localtime') ORDER BY timestamp ASC`;
          params = [startOfLastYear.getTime(), startOfYear.getTime()];
          break;
        default:
          sql = `${baseQuery} WHERE timestamp > ? ORDER BY timestamp ASC`;
          params = [now - oneDay];
      }

      this.db.all(sql, params, (err, rows) => {
        if (err) {
          console.error(err);
          resolve([]);
          return;
        }
        resolve(rows);
      });
    });
  }

  /**
   * @param {string} mode
   * @returns {Promise<{ current: HistoryEntry[], previous: HistoryEntry[] } | null>}
   */
  async getComparison(mode) {
    let q1_mode, q2_mode;
    if (mode === 'compare_days') {
      q1_mode = 'today';
      q2_mode = 'yesterday';
    } else if (mode === 'compare_months') {
      q1_mode = 'month';
      q2_mode = 'last_month';
    } else {
      return null;
    }

    const dataCurrent = await this.getHistory(q1_mode);
    const dataPrevious = await this.getHistory(q2_mode);

    const normalizedPrev = dataPrevious.map((d) => {
      const date = new Date(d.timestamp);
      if (mode === 'compare_days') date.setDate(date.getDate() + 1);
      if (mode === 'compare_months') date.setMonth(date.getMonth() + 1);
      return { ...d, timestamp: date.getTime(), original_ts: d.timestamp };
    });

    return { current: dataCurrent, previous: normalizedPrev };
  }

  /**
   * @param {string} mode
   * @returns {Promise<StatsEntry[]>}
   */
  getStats(mode) {
    return new Promise((resolve) => {
      let limit = 14;
      let format = '%Y-%m-%d'; // Standard: Täglich

      switch (mode) {
        case '30d':
          limit = 30;
          break;
        case '3m':
          limit = 13;
          format = '%Y-W%W';
          break;
        case '6m':
          limit = 26;
          format = '%Y-W%W';
          break;
        case '12m':
          limit = 12;
          format = '%Y-%m';
          break;
        default:
          limit = 14;
      }

      const sql = `
        SELECT 
          strftime('${format}', timestamp / 1000, 'unixepoch', 'localtime') as label,
          SUM(ww_active) as ww_minutes,
          SUM(heating_active) as heat_minutes,
          AVG(CASE WHEN heating_active = 1 THEN vlt ELSE NULL END) as avg_heat_vlt
        FROM readings 
        GROUP BY label 
        ORDER BY label DESC 
        LIMIT ?
      `;

      this.db.all(sql, [limit], (err, rows) => {
        if (err) {
          console.error('Stats Error:', err);
          resolve([]);
          return;
        }
        resolve(rows.reverse());
      });
    });
  }

  /**
   * @param {string} level
   * @param {string} message
   */
  saveLog(level, message) {
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    this.db.run('DELETE FROM system_logs WHERE timestamp < ?', [thirtyDaysAgo]);

    const stmt = this.db.prepare('INSERT INTO system_logs (timestamp, level, message) VALUES (?, ?, ?)');
    stmt.run(Date.now(), level, message);
    stmt.finalize();
  }

  /**
   * @param {string} [dateStr]
   * @returns {Promise<SystemLog[]>}
   */
  getLogs(dateStr) {
    return new Promise((resolve) => {
      if (!dateStr) {
        this.db.all(
          'SELECT timestamp, level, message FROM system_logs ORDER BY timestamp DESC LIMIT 100',
          [],
          (err, rows) => {
            if (err) resolve([]);
            else resolve(rows.reverse());
          },
        );
        return;
      }

      const start = new Date(dateStr);
      start.setHours(0, 0, 0, 0);
      const end = new Date(dateStr);
      end.setHours(23, 59, 59, 999);

      this.db.all(
        'SELECT timestamp, level, message FROM system_logs WHERE timestamp >= ? AND timestamp <= ? ORDER BY timestamp ASC',
        [start.getTime(), end.getTime()],
        (err, rows) => {
          if (err) resolve([]);
          else resolve(rows);
        },
      );
    });
  }

  /**
   * @returns {Promise<void>}
   */
  close() {
    return new Promise((resolve, reject) => {
      this.db.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
}

const dbInstance = new Database();

module.exports = {
  saveReading: dbInstance.saveReading.bind(dbInstance),
  getHistory: dbInstance.getHistory.bind(dbInstance),
  getComparison: dbInstance.getComparison.bind(dbInstance),
  saveLog: dbInstance.saveLog.bind(dbInstance),
  getLogs: dbInstance.getLogs.bind(dbInstance),
  getStats: dbInstance.getStats.bind(dbInstance),
  db: dbInstance, // Export instance for close()
};