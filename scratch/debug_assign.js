const db = require('../database/db');
const { getLiveSummaries } = require('../routes/guides');

try {
  console.log('Testing INSERT result properties...');
  const result = db.prepare("INSERT INTO guides (guide_number, value) VALUES ('TEST' || RANDOM(), 100)").run();
  console.log('Insert result:', JSON.stringify(result));
} catch (e) {
  console.error('Error in insert:', e);
}

try {
  console.log('Testing INSERT OR REPLACE into courier_bases...');
  const domiciliario_id = 1; // Assuming user 1 exists
  const base_amount = 5000;
  
  db.prepare(`
    INSERT OR REPLACE INTO courier_bases (id, domiciliario_id, date, base_amount) 
    VALUES (
      (SELECT id FROM courier_bases WHERE domiciliario_id = ? AND date = DATE('now')),
      ?, DATE('now'), ?
    )
  `).run(domiciliario_id, domiciliario_id, base_amount);
  
  console.log('Query executed successfully');
} catch (e) {
  console.error('Error in query:', e);
}

try {
  console.log('Testing getLiveSummaries...');
  const summary = getLiveSummaries();
  console.log('Summary result:', JSON.stringify(summary, null, 2));
} catch (e) {
  console.error('Error in getLiveSummaries:', e);
}
