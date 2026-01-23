// database.js
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'history.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
    // Readings Tabelle (wie gehabt)
    db.run(`
        CREATE TABLE IF NOT EXISTS readings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp INTEGER,
            vlt REAL, outdoor REAL, indoor REAL, tank REAL, target REAL
        )
    `);
    db.run(`CREATE INDEX IF NOT EXISTS idx_timestamp ON readings(timestamp)`);

    // NEU: Logs Tabelle
    db.run(`
        CREATE TABLE IF NOT EXISTS system_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp INTEGER,
            level TEXT,
            message TEXT
        )
    `);
    // Index für schnelles Suchen nach Datum
    db.run(`CREATE INDEX IF NOT EXISTS idx_log_ts ON system_logs(timestamp)`);
});

// --- READINGS ---
function saveReading(data) {
    const stmt = db.prepare(`INSERT INTO readings (timestamp, vlt, outdoor, indoor, tank, target) VALUES (?, ?, ?, ?, ?, ?)`);
    stmt.run(Date.now(), data.vlt, data.outdoor, data.indoor, data.tank, data.target);
    stmt.finalize();
}

function getHistory(mode, callback) {
    let sql = "";
    let params = [];
    const now = Date.now();
    const oneDay = 24 * 60 * 60 * 1000;

    const startOfDay = new Date(); startOfDay.setHours(0,0,0,0);
    const startOfYesterday = new Date(startOfDay.getTime() - oneDay);
    const endOfYesterday = new Date(startOfDay.getTime());
    
    const startOfMonth = new Date(); startOfMonth.setDate(1); startOfMonth.setHours(0,0,0,0);
    const startOfLastMonth = new Date(startOfMonth); startOfLastMonth.setMonth(startOfLastMonth.getMonth() - 1);
    
    const startOfYear = new Date(); startOfYear.setMonth(0, 1); startOfYear.setHours(0,0,0,0);
    const startOfLastYear = new Date(startOfYear); startOfLastYear.setFullYear(startOfLastYear.getFullYear() - 1);

    const baseQuery = `SELECT timestamp, vlt, outdoor, indoor, tank, target FROM readings`;

    switch (mode) {
        case '24h':
            sql = `${baseQuery} WHERE timestamp > ? ORDER BY timestamp ASC`; params = [now - oneDay]; break;
        case 'today':
            sql = `${baseQuery} WHERE timestamp > ? ORDER BY timestamp ASC`; params = [startOfDay.getTime()]; break;
        case 'yesterday':
            sql = `${baseQuery} WHERE timestamp >= ? AND timestamp < ? ORDER BY timestamp ASC`; params = [startOfYesterday.getTime(), endOfYesterday.getTime()]; break;
        case 'month':
            sql = `SELECT min(timestamp) as timestamp, avg(vlt) as vlt, avg(outdoor) as outdoor, avg(tank) as tank FROM readings WHERE timestamp > ? GROUP BY strftime('%d-%H', timestamp / 1000, 'unixepoch', 'localtime') ORDER BY timestamp ASC`; params = [startOfMonth.getTime()]; break;
        case 'last_month':
            sql = `SELECT min(timestamp) as timestamp, avg(vlt) as vlt, avg(outdoor) as outdoor, avg(tank) as tank FROM readings WHERE timestamp >= ? AND timestamp < ? GROUP BY strftime('%d-%H', timestamp / 1000, 'unixepoch', 'localtime') ORDER BY timestamp ASC`; params = [startOfLastMonth.getTime(), startOfMonth.getTime()]; break;
        case 'year':
            sql = `SELECT min(timestamp) as timestamp, avg(vlt) as vlt, avg(outdoor) as outdoor, avg(tank) as tank FROM readings WHERE timestamp > ? GROUP BY strftime('%m-%d', timestamp / 1000, 'unixepoch', 'localtime') ORDER BY timestamp ASC`; params = [startOfYear.getTime()]; break;
        case 'last_year':
            sql = `SELECT min(timestamp) as timestamp, avg(vlt) as vlt, avg(outdoor) as outdoor, avg(tank) as tank FROM readings WHERE timestamp >= ? AND timestamp < ? GROUP BY strftime('%m-%d', timestamp / 1000, 'unixepoch', 'localtime') ORDER BY timestamp ASC`; params = [startOfLastYear.getTime(), startOfYear.getTime()]; break;
        default:
            sql = `${baseQuery} WHERE timestamp > ? ORDER BY timestamp ASC`; params = [now - oneDay];
    }

    db.all(sql, params, (err, rows) => {
        if (err) { console.error(err); callback([]); return; }
        callback(rows);
    });
}

function getComparison(mode, callback) {
    let q1_mode, q2_mode;
    if (mode === 'compare_days') { q1_mode = 'today'; q2_mode = 'yesterday'; } 
    else if (mode === 'compare_months') { q1_mode = 'month'; q2_mode = 'last_month'; } 
    else { return callback(null); }

    getHistory(q1_mode, (dataCurrent) => {
        getHistory(q2_mode, (dataPrevious) => {
            const normalizedPrev = dataPrevious.map(d => {
                const date = new Date(d.timestamp);
                if (mode === 'compare_days') date.setDate(date.getDate() + 1); 
                if (mode === 'compare_months') date.setMonth(date.getMonth() + 1); 
                return { ...d, timestamp: date.getTime(), original_ts: d.timestamp };
            });
            callback({ current: dataCurrent, previous: normalizedPrev });
        });
    });
}

// --- NEU: LOGGING FUNKTIONEN ---
function saveLog(level, message) {
    // Lösche Logs älter als 30 Tage (Housekeeping)
    const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
    db.run("DELETE FROM system_logs WHERE timestamp < ?", [thirtyDaysAgo]);

    const stmt = db.prepare("INSERT INTO system_logs (timestamp, level, message) VALUES (?, ?, ?)");
    stmt.run(Date.now(), level, message);
    stmt.finalize();
}

function getLogs(dateStr, callback) {
    // dateStr erwartet Format "YYYY-MM-DD"
    // Wenn leer, hole die letzten 100 Einträge
    if (!dateStr) {
        db.all("SELECT timestamp, level, message FROM system_logs ORDER BY timestamp DESC LIMIT 100", [], (err, rows) => {
            if(err) callback([]); else callback(rows.reverse()); // Reverse damit Chronologie im Chat stimmt
        });
        return;
    }

    // Bestimmter Tag
    const start = new Date(dateStr); start.setHours(0,0,0,0);
    const end = new Date(dateStr); end.setHours(23,59,59,999);

    db.all("SELECT timestamp, level, message FROM system_logs WHERE timestamp >= ? AND timestamp <= ? ORDER BY timestamp ASC", 
        [start.getTime(), end.getTime()], 
        (err, rows) => {
            if(err) callback([]); else callback(rows);
        }
    );
}

module.exports = { saveReading, getHistory, getComparison, saveLog, getLogs };