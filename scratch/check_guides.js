const db = require('../database/db.js');
const today = db.prepare("SELECT DATE('now') as d").get().d;
const guides = db.prepare("SELECT g.guide_number, g.type, g.status, g.value, g.payment_method FROM daily_routes dr JOIN guides g ON dr.guide_id = g.id WHERE dr.domiciliario_id = 2 AND dr.date = ?").all(today);
console.log(JSON.stringify(guides, null, 2));
