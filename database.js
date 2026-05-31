const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'database.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS parameters (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        negative_pressure REAL NOT NULL,
        drill_angle REAL NOT NULL,
        pipe_diameter REAL DEFAULT 0.1,
        pipe_length REAL DEFAULT 100,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        parameter_id INTEGER,
        liquid_position REAL,
        liquid_level_height REAL,
        drainage_efficiency REAL,
        gas_lock INTEGER DEFAULT 0,
        gas_lock_severity REAL DEFAULT 0,
        flow_regime TEXT DEFAULT 'stratified',
        hold_up REAL DEFAULT 0,
        reynolds_gas REAL DEFAULT 0,
        reynolds_liquid REAL DEFAULT 0,
        friction_gas REAL DEFAULT 0,
        friction_liquid REAL DEFAULT 0,
        pressure_drop REAL DEFAULT 0,
        gas_velocity REAL DEFAULT 0,
        liquid_velocity REAL DEFAULT 0,
        critical_gas_velocity REAL DEFAULT 0,
        liquid_level_profile TEXT,
        pressure_distribution TEXT,
        gas_distribution TEXT,
        liquid_distribution TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (parameter_id) REFERENCES parameters(id)
    )`);
});

module.exports = db;
