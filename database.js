// database.js
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Datenbank Datei
const dbPath = path.join(__dirname, 'history.db');
const db = new sqlite3.Database(dbPath);

// Tabelle erstellen, falls nicht vorhanden
db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS readings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp INTEGER,
            vlt REAL,
            outdoor REAL,
            indoor REAL,
            tank REAL,
            target REAL
        )
    `);
    // Index für schnelleres Suchen
    db.run(`CREATE INDEX IF NOT EXISTS idx_timestamp ON readings(timestamp)`);
});

// --- SPEICHERN ---
function saveReading(data) {
    const stmt = db.prepare(`
        INSERT INTO readings (timestamp, vlt, outdoor, indoor, tank, target) 
        VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(Date.now(), data.vlt, data.outdoor, data.indoor, data.tank, data.target);
    stmt.finalize();
}

// --- ABFRAGEN ---
function getHistory(mode, callback) {
    let sql = "";
    let params = [];
    const now = Date.now();
    const oneDay = 24 * 60 * 60 * 1000;

    // Helper für Zeitgrenzen
    const startOfDay = new Date(); startOfDay.setHours(0,0,0,0);
    const startOfYesterday = new Date(startOfDay.getTime() - oneDay);
    const endOfYesterday = new Date(startOfDay.getTime());
    
    const startOfMonth = new Date(); startOfMonth.setDate(1); startOfMonth.setHours(0,0,0,0);
    const startOfLastMonth = new Date(startOfMonth); startOfLastMonth.setMonth(startOfLastMonth.getMonth() - 1);
    
    const startOfYear = new Date(); startOfYear.setMonth(0, 1); startOfYear.setHours(0,0,0,0);
    const startOfLastYear = new Date(startOfYear); startOfLastYear.setFullYear(startOfLastYear.getFullYear() - 1);

    // Standard Abfrage (Raw Data)
    const baseQuery = `SELECT timestamp, vlt, outdoor, indoor, tank, target FROM readings`;

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
        
        // --- AGGREGIERTE DATEN (Für Monate/Jahre - stündliche/tägliche Mittelwerte) ---
        case 'month':
            // Gruppiert nach Tag-Stunde (DD-HH)
            sql = `SELECT min(timestamp) as timestamp, avg(vlt) as vlt, avg(outdoor) as outdoor, avg(tank) as tank FROM readings WHERE timestamp > ? GROUP BY strftime('%d-%H', timestamp / 1000, 'unixepoch', 'localtime') ORDER BY timestamp ASC`;
            params = [startOfMonth.getTime()];
            break;
        case 'last_month':
            sql = `SELECT min(timestamp) as timestamp, avg(vlt) as vlt, avg(outdoor) as outdoor, avg(tank) as tank FROM readings WHERE timestamp >= ? AND timestamp < ? GROUP BY strftime('%d-%H', timestamp / 1000, 'unixepoch', 'localtime') ORDER BY timestamp ASC`;
            params = [startOfLastMonth.getTime(), startOfMonth.getTime()];
            break;
        case 'year':
            // Gruppiert nach Monat-Tag (MM-DD)
            sql = `SELECT min(timestamp) as timestamp, avg(vlt) as vlt, avg(outdoor) as outdoor, avg(tank) as tank FROM readings WHERE timestamp > ? GROUP BY strftime('%m-%d', timestamp / 1000, 'unixepoch', 'localtime') ORDER BY timestamp ASC`;
            params = [startOfYear.getTime()];
            break;
        case 'last_year':
            sql = `SELECT min(timestamp) as timestamp, avg(vlt) as vlt, avg(outdoor) as outdoor, avg(tank) as tank FROM readings WHERE timestamp >= ? AND timestamp < ? GROUP BY strftime('%m-%d', timestamp / 1000, 'unixepoch', 'localtime') ORDER BY timestamp ASC`;
            params = [startOfLastYear.getTime(), startOfYear.getTime()];
            break;

        default: // Fallback 24h
            sql = `${baseQuery} WHERE timestamp > ? ORDER BY timestamp ASC`;
            params = [now - oneDay];
    }

    db.all(sql, params, (err, rows) => {
        if (err) { console.error(err); callback([]); return; }
        callback(rows);
    });
}

// --- SPEZIAL: VERGLEICHE ---
function getComparison(mode, callback) {
    let q1_mode, q2_mode;
    
    if (mode === 'compare_days') { // Heute vs Gestern
        q1_mode = 'today';
        q2_mode = 'yesterday';
    } else if (mode === 'compare_months') { // Dieser vs Letzter Monat
        q1_mode = 'month';
        q2_mode = 'last_month';
    } else {
        return callback(null);
    }

    getHistory(q1_mode, (dataCurrent) => {
        getHistory(q2_mode, (dataPrevious) => {
            // Wir müssen die "Previous" Daten normalisieren, damit sie im Diagramm übereinander liegen
            // Trick: Wir verschieben die Zeitstempel der "Previous" Daten in die aktuelle Periode
            
            const normalizedPrev = dataPrevious.map(d => {
                const date = new Date(d.timestamp);
                
                if (mode === 'compare_days') {
                    // Gestern -> Heute schieben (einfach +24h)
                    // Achtung: Sommer/Winterzeit könnte hier 1h Versatz machen, aber für simple Charts ok
                    date.setDate(date.getDate() + 1); 
                }
                if (mode === 'compare_months') {
                    // Letztes Monat -> Dieses Monat schieben
                    // Wir versuchen den Tag des Monats beizubehalten
                    date.setMonth(date.getMonth() + 1); 
                }
                return { ...d, timestamp: date.getTime(), original_ts: d.timestamp };
            });

            callback({ current: dataCurrent, previous: normalizedPrev });
        });
    });
}

module.exports = { saveReading, getHistory, getComparison };