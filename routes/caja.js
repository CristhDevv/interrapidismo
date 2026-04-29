const express = require('express');
const router = express.Router();
const db = require('../database/db');
const authMiddleware = require('../middleware/auth');

// Obtener la caja activa (abierta)
router.get('/active', authMiddleware('admin'), (req, res) => {
  const activeCaja = db.prepare("SELECT * FROM caja WHERE estado = 'abierta' ORDER BY id DESC LIMIT 1").get();
  res.json(activeCaja || { message: 'No hay caja abierta' });
});

// Abrir caja
router.post('/open', authMiddleware('admin'), (req, res) => {
  const { base_inicial, base_domiciliarios } = req.body;
  
  // Verificar si ya hay una abierta
  const alreadyOpen = db.prepare("SELECT id FROM caja WHERE estado = 'abierta'").get();
  if (alreadyOpen) return res.status(400).json({ error: 'Ya existe una caja abierta' });

  try {
    const result = db.prepare(`
      INSERT INTO caja (base_inicial, base_domiciliarios, estado) 
      VALUES (?, ?, 'abierta')
    `).run(base_inicial || 0, base_domiciliarios || 0);
    
    const newCaja = db.prepare('SELECT * FROM caja WHERE id = ?').get(result.lastInsertRowid);
    req.app.get('io').emit('caja:opened', newCaja);
    res.json(newCaja);
  } catch (e) {
    res.status(500).json({ error: 'Error al abrir caja' });
  }
});

// Cerrar caja
router.post('/close', authMiddleware('admin'), (req, res) => {
  const { observaciones } = req.body;
  
  const activeCaja = db.prepare("SELECT * FROM caja WHERE estado = 'abierta'").get();
  if (!activeCaja) return res.status(400).json({ error: 'No hay ninguna caja abierta para cerrar' });

  const today = new Date().toISOString().split('T')[0];

  // Cálculo de totales del día
  const totals = db.prepare(`
    SELECT 
      SUM(CASE WHEN domiciliario_id IS NOT NULL THEN value ELSE 0 END) as dom_total,
      SUM(CASE WHEN domiciliario_id IS NULL THEN value ELSE 0 END) as ofi_total
    FROM guides 
    WHERE status = 'entregado' AND DATE(updated_at) = ?
  `).get(today);

  const total_recaudado_domiciliarios = totals.dom_total || 0;
  const total_recaudado_oficina = totals.ofi_total || 0;
  const total_esperado = activeCaja.base_inicial + total_recaudado_oficina + total_recaudado_domiciliarios;

  try {
    db.prepare(`
      UPDATE caja SET 
        total_recaudado_oficina = ?,
        total_recaudado_domiciliarios = ?,
        total_esperado = ?,
        observaciones = ?,
        estado = 'cerrada',
        closed_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      total_recaudado_oficina,
      total_recaudado_domiciliarios,
      total_esperado,
      observaciones || '',
      activeCaja.id
    );

    const closedCaja = db.prepare('SELECT * FROM caja WHERE id = ?').get(activeCaja.id);
    req.app.get('io').emit('caja:closed', closedCaja);
    res.json(closedCaja);
  } catch (e) {
    res.status(500).json({ error: 'Error al cerrar caja' });
  }
});

// Historial de cierres
router.get('/history', authMiddleware('admin'), (req, res) => {
  const history = db.prepare("SELECT * FROM caja WHERE estado = 'cerrada' ORDER BY id DESC").all();
  res.json(history);
});

module.exports = router;
