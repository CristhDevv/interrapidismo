const db = require('../database/db.js');
const today = db.prepare("SELECT DATE('now') as d").get().d;
console.log('HOY:', today);
const routes = db.prepare(`
  SELECT dr.domiciliario_id, dr.date, u.name, u.role, g.guide_number, g.status 
  FROM daily_routes dr 
  JOIN guides g ON dr.guide_id = g.id 
  JOIN users u ON dr.domiciliario_id = u.id
`).all();
console.log('RUTAS:', JSON.stringify(routes, null, 2));
