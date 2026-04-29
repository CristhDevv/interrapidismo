const express = require('express');
const router = express.Router();
const db = require('../database/db');
const authMiddleware = require('../middleware/auth');

// Obtener guías del día para el domiciliario
router.get('/my-guides', authMiddleware(), (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const guides = db.prepare(`
    SELECT g.* FROM guides g
    INNER JOIN daily_routes dr ON g.id = dr.guide_id
    WHERE dr.domiciliario_id = ? AND dr.date = ?
    ORDER BY g.created_at DESC
  `).all(req.user.id, today);
  res.json(guides);
});

const { getLiveSummaries } = require('./guides');

// Marcar guía como entregada (con ubicación y método de pago)
router.post('/deliver/:guide_id', authMiddleware(), (req, res) => {
  const { latitude, longitude, address_hint, payment_method } = req.body;
  const guide_id = req.params.guide_id;
  
  if (!['efectivo', 'nequi', 'pago_directo'].includes(payment_method)) {
    return res.status(400).json({ error: 'Método de pago inválido' });
  }

  db.prepare("UPDATE guides SET status = 'entregado', payment_method = ?, downloaded_from_system = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(payment_method, guide_id);
  db.prepare('INSERT INTO deliveries (guide_id, domiciliario_id, latitude, longitude, address_hint) VALUES (?, ?, ?, ?, ?)').run(
    guide_id, req.user.id, latitude, longitude, address_hint || ''
  );
  
  const delivery = db.prepare(`
    SELECT d.*, g.guide_number, g.payment_method, u.name as domiciliario_name 
    FROM deliveries d 
    JOIN guides g ON d.guide_id = g.id 
    JOIN users u ON d.domiciliario_id = u.id 
    WHERE d.guide_id = ? AND d.domiciliario_id = ?
    ORDER BY d.id DESC LIMIT 1
  `).get(guide_id, req.user.id);
  
  req.app.get('io').emit('delivery:completed', delivery);
  
  // Actualizar el resumen en vivo
  req.app.get('io').emit('ruta:actualizada', getLiveSummaries());
  
  res.json(delivery);
});

// Actualizar ubicación del domiciliario
router.post('/location', authMiddleware(), (req, res) => {
  const { latitude, longitude } = req.body;
  db.prepare(`
    INSERT INTO domiciliario_location (domiciliario_id, latitude, longitude, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(domiciliario_id) DO UPDATE SET latitude=excluded.latitude, longitude=excluded.longitude, updated_at=CURRENT_TIMESTAMP
  `).run(req.user.id, latitude, longitude);
  req.app.get('io').emit('location:updated', { domiciliario_id: req.user.id, latitude, longitude, name: req.user.name });
  res.json({ success: true });
});

module.exports = router;
