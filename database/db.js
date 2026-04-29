const { Database } = require('node-sqlite3-wasm');
const path = require('path');

const dbPath = path.join(__dirname, 'app.db');
const db = new Database(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('admin', 'domiciliario')),
    name TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS guides (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guide_number TEXT UNIQUE NOT NULL,
    value REAL NOT NULL,
    payment_method TEXT NOT NULL CHECK(payment_method IN ('nequi', 'efectivo', 'pago_directo')),
    type TEXT NOT NULL CHECK(type IN ('entrega', 'envio')),
    downloaded_from_system INTEGER DEFAULT 0,
    status TEXT DEFAULT 'en_oficina' CHECK(status IN ('en_oficina', 'en_ruta', 'entregado', 'direccion_erronea', 'cliente_no_esta', 'devolucion')),
    domiciliario_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (domiciliario_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS deliveries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guide_id INTEGER NOT NULL,
    domiciliario_id INTEGER NOT NULL,
    delivered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    latitude REAL,
    longitude REAL,
    address_hint TEXT,
    FOREIGN KEY (guide_id) REFERENCES guides(id),
    FOREIGN KEY (domiciliario_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS domiciliario_location (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    domiciliario_id INTEGER NOT NULL UNIQUE,
    latitude REAL,
    longitude REAL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (domiciliario_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS daily_routes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    domiciliario_id INTEGER NOT NULL,
    guide_id INTEGER NOT NULL,
    assigned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    date TEXT DEFAULT (DATE('now')),
    FOREIGN KEY (domiciliario_id) REFERENCES users(id),
    FOREIGN KEY (guide_id) REFERENCES guides(id)
  );

  CREATE TABLE IF NOT EXISTS courier_bases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    domiciliario_id INTEGER NOT NULL,
    date TEXT DEFAULT (DATE('now')),
    base_amount REAL DEFAULT 0,
    UNIQUE(domiciliario_id, date),
    FOREIGN KEY (domiciliario_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS caja (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fecha TEXT DEFAULT (DATE('now')),
    base_inicial REAL DEFAULT 0,
    base_domiciliarios REAL DEFAULT 0,
    total_recaudado_oficina REAL DEFAULT 0,
    total_recaudado_domiciliarios REAL DEFAULT 0,
    total_esperado REAL DEFAULT 0,
    estado TEXT DEFAULT 'abierta' CHECK(estado IN ('abierta', 'cerrada')),
    observaciones TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    closed_at DATETIME
  );
`);

// ── Compatibility shim: node-sqlite3-wasm → better-sqlite3-like API ──────────
// node-sqlite3-wasm requires params as array; spread args are ignored after first.
// We normalise all calls to pass a single array.
function normaliseParams(params) {
  if (params.length === 0) return [];
  // If called as .run([a, b, c]) — already an array
  if (params.length === 1 && Array.isArray(params[0])) return params[0];
  // If called as .run(a, b, c) — spread args
  return params;
}

function wrapStmt(rawStmt) {
  return {
    get: function (...args) {
      const rows = rawStmt.all(normaliseParams(args));
      return rows.length > 0 ? rows[0] : undefined;
    },
    all: function (...args) {
      return rawStmt.all(normaliseParams(args));
    },
    run: function (...args) {
      return rawStmt.run(normaliseParams(args));
      // returns { changes, lastInsertRowid }
    },
  };
}

const _origPrepare = db.prepare.bind(db);
db.prepare = function (sql) {
  return wrapStmt(_origPrepare(sql));
};

// ── transaction helper ────────────────────────────────────────────────────────
db.transaction = function (fn) {
  return function (...args) {
    db.exec('BEGIN');
    try {
      const result = fn(...args);
      db.exec('COMMIT');
      return result;
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  };
};

// ── Seed: crear admin por defecto si no existe ────────────────────────────────
const bcrypt = require('bcryptjs');
const adminExists = db.prepare("SELECT id FROM users WHERE username = 'admin'").get();
if (!adminExists) {
  const hash = bcrypt.hashSync('admin123', 10);
  db.prepare("INSERT INTO users (username, password, role, name) VALUES (?, ?, 'admin', 'Administrador')")
    .run('admin', hash);
  console.log('[DB] Admin creado → usuario: admin | contraseña: admin123');
}

module.exports = db;
