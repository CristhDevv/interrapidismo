const express = require('express');
const router = express.Router();
const db = require('../database/db');
const authMiddleware = require('../middleware/auth');

router.get('/', authMiddleware('admin'), (req, res) => {
  const { date, domiciliario_id } = req.query;
  let query = `
    SELECT d.*, g.guide_number, g.value, g.payment_method, g.type,
           u.name as domiciliario_name
    FROM deliveries d
    JOIN guides g ON d.guide_id = g.id
    JOIN users u ON d.domiciliario_id = u.id
    WHERE 1=1
  `;
  const params = [];
  if (date) { query += ' AND DATE(d.delivered_at) = ?'; params.push(date); }
  if (domiciliario_id) { query += ' AND d.domiciliario_id = ?'; params.push(domiciliario_id); }
  query += ' ORDER BY d.delivered_at DESC';
  res.json(db.prepare(query).all(...params));
});

router.get('/summary', authMiddleware('admin'), (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const summary = {
    total_guides_today: db.prepare("SELECT COUNT(*) as c FROM guides WHERE DATE(created_at) = ?").get(today).c,
    delivered_today: db.prepare("SELECT COUNT(*) as c FROM guides WHERE DATE(updated_at) = ? AND (status = 'entregado' OR downloaded_from_system = 1)").get(today).c,
    total_value_today: db.prepare("SELECT COALESCE(SUM(value),0) as s FROM guides WHERE DATE(created_at) = ?").get(today).s,
  };
  res.json(summary);
});

// Reporte detallado por mensajero para el día de hoy
router.get('/report/domiciliarios', authMiddleware('admin'), (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  
  const query = `
    SELECT 
      u.name as domiciliario_name,
      COUNT(d.id) as entregas_count,
      SUM(CASE WHEN g.payment_method = 'efectivo' THEN g.value ELSE 0 END) as total_efectivo,
      SUM(CASE WHEN g.payment_method = 'nequi' THEN g.value ELSE 0 END) as total_nequi,
      SUM(CASE WHEN g.payment_method = 'pago_directo' THEN g.value ELSE 0 END) as total_pago_directo,
      SUM(g.value) as total_general
    FROM deliveries d
    JOIN guides g ON d.guide_id = g.id
    JOIN users u ON d.domiciliario_id = u.id
    WHERE DATE(d.delivered_at) = ?
    GROUP BY u.id
  `;
  
  try {
    const report = db.prepare(query).all(today);
    res.json(report);
  } catch (e) {
    res.status(500).json({ error: 'Error al generar reporte' });
  }
});

module.exports = router;
