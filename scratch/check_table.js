const db = require('../database/db');
try {
  const result = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='daily_routes'").get();
  console.log('Table daily_routes exists:', !!result);
  if (result) {
    const columns = db.prepare("PRAGMA table_info(daily_routes)").all();
    console.log('Columns:', JSON.stringify(columns, null, 2));
  }
} catch (e) {
  console.error('Error checking table:', e);
}
