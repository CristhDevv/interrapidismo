const express = require('express');
const router = express.Router();
const db = require('../database/db');
const authMiddleware = require('../middleware/auth');

// Obtener todas las guías (con filtros opcionales)
router.get('/', authMiddleware(), (req, res) => {
  const { status, type, date } = req.query;
  let query = 'SELECT g.*, u.name as domiciliario_name FROM guides g LEFT JOIN users u ON g.domiciliario_id = u.id WHERE 1=1';
  const params = [];
  if (status) { query += ' AND g.status = ?'; params.push(status); }
  if (type) { query += ' AND g.type = ?'; params.push(type); }
  if (date) { query += ' AND DATE(g.created_at) = ?'; params.push(date); }
  query += ' ORDER BY g.created_at DESC';
  res.json(db.prepare(query).all(...params));
});

// Rastreo público (Sin autenticación)
router.get('/track/:guide_number', (req, res) => {
  const { guide_number } = req.params;
  const guide = db.prepare(`
    SELECT guide_number, type, status, created_at 
    FROM guides 
    WHERE guide_number = ?
  `).get(guide_number);

  if (!guide) {
    return res.status(404).json({ error: 'Guía no encontrada' });
  }
  res.json(guide);
});

// Crear guía
router.post('/', authMiddleware('admin'), (req, res) => {
  const { guide_number, value, payment_method, type } = req.body;
  try {
    const result = db.prepare(
      'INSERT INTO guides (guide_number, value, payment_method, type) VALUES (?, ?, ?, ?)'
    ).run(guide_number, value, payment_method, type);
    const guide = db.prepare('SELECT * FROM guides WHERE id = ?').get(result.lastInsertRowid);
    req.app.get('io').emit('guide:new', guide);
    res.json(guide);
  } catch (e) {
    res.status(400).json({ error: 'Número de guía ya existe' });
  }
});

// Actualizar guía (downloaded_from_system, etc.)
router.patch('/:id', authMiddleware('admin'), (req, res) => {
  const { downloaded_from_system, status } = req.body;
  const updates = [];
  const params = [];
  if (downloaded_from_system !== undefined) {
    updates.push('downloaded_from_system = ?');
    params.push(downloaded_from_system ? 1 : 0);
  }
  if (status) {
    updates.push('status = ?');
    params.push(status);
  }
  updates.push("updated_at = CURRENT_TIMESTAMP");
  params.push(req.params.id);
  db.prepare(`UPDATE guides SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  const guide = db.prepare('SELECT * FROM guides WHERE id = ?').get(req.params.id);
  req.app.get('io').emit('guide:updated', guide);
  res.json(guide);
});

// Eliminar guía
router.delete('/:id', authMiddleware('admin'), (req, res) => {
  db.prepare('DELETE FROM guides WHERE id = ?').run(req.params.id);
  req.app.get('io').emit('guide:deleted', { id: parseInt(req.params.id) });
  res.json({ success: true });
});

// Helper para calcular el resumen en vivo de todos los domiciliarios activos hoy
function getLiveSummaries() {
  const todayRow = db.prepare("SELECT DATE('now') as d").get();
  const today = todayRow.d;
  
  // Solo domiciliarios
  const domiciliarios = db.prepare(
    "SELECT id, name, role FROM users WHERE role = 'domiciliario'"
  ).all();
  
  const bases = db.prepare(
    'SELECT domiciliario_id, base_amount FROM courier_bases WHERE date = ?'
  ).all(today);
  const baseMap = {};
  bases.forEach(b => baseMap[b.domiciliario_id] = b.base_amount);

  return domiciliarios.map(d => {
    const guides = db.prepare(`
      SELECT g.guide_number, g.type, g.status, g.value, g.payment_method, g.downloaded_from_system
      FROM daily_routes dr
      JOIN guides g ON dr.guide_id = g.id
      WHERE dr.domiciliario_id = ? AND dr.date = ?
    `).all(d.id, today);

    const entregadas = guides.filter(g => g.status === 'entregado' || g.downloaded_from_system === 1);
    const pendientes = guides.filter(g => g.status !== 'entregado' && g.downloaded_from_system !== 1);
    const efectivo = entregadas.filter(g => g.payment_method === 'efectivo').reduce((s, g) => s + (g.value || 0), 0);
    const nequi = entregadas.filter(g => g.payment_method === 'nequi').reduce((s, g) => s + (g.value || 0), 0);
    const directo = entregadas.filter(g => g.payment_method === 'pago_directo').reduce((s, g) => s + (g.value || 0), 0);
    const base = baseMap[d.id] || 0;

    return {
      domiciliario_id: d.id,
      courier_name: d.name,
      role: d.role,
      entregadas: entregadas.length,
      pendientes: pendientes.length,
      efectivo, nequi, pago_directo: directo,
      base,
      a_entregar: efectivo + base,
      guides
    };
  });
}

// Obtener resumen en vivo (Admin)
router.get('/live-summary', authMiddleware('admin'), (req, res) => {
  res.json(getLiveSummaries());
});

// Asignar guías al domiciliario para el día (por número de guía)
router.post('/assign', authMiddleware('admin'), (req, res) => {
  const { domiciliario_id, base_amount, guides } = req.body;
  
  if (!domiciliario_id || !guides || !guides.length) {
    return res.status(400).json({ error: 'Faltan datos requeridos' });
  }

  const transaction = db.transaction(() => {
    const assignedIds = [];

    // Guardar la base del mensajero
    if (base_amount !== undefined) {
      db.prepare(`
        INSERT INTO courier_bases (domiciliario_id, date, base_amount) 
        VALUES (?, DATE('now'), ?)
        ON CONFLICT(domiciliario_id, date) DO UPDATE SET base_amount = excluded.base_amount
      `).run(domiciliario_id, base_amount);
    }

    for (const g of guides) {
      // 1. Verificar si existe
      let guideRow = db.prepare("SELECT id FROM guides WHERE guide_number = ?").get(g.guide_number);
      let gid;

      if (guideRow) {
        // Existe -> Actualizar (incluyendo valor y tipo)
        gid = guideRow.id;
        db.prepare("UPDATE guides SET value = ?, type = ?, domiciliario_id = ?, status = 'en_ruta', updated_at = CURRENT_TIMESTAMP WHERE id = ?")
          .run(g.value, g.type, domiciliario_id, gid);
      } else {
        // No existe -> Crear
        const result = db.prepare(
          "INSERT INTO guides (guide_number, value, payment_method, type, status, domiciliario_id) VALUES (?, ?, 'efectivo', ?, 'en_ruta', ?)"
        ).run(g.guide_number, g.value, g.type, domiciliario_id);
        gid = result.lastInsertRowid;
      }
      
      assignedIds.push(gid);

      // 2. Registrar en daily_routes
      db.prepare('INSERT OR IGNORE INTO daily_routes (domiciliario_id, guide_id) VALUES (?, ?)')
        .run(domiciliario_id, gid);
    }

    return assignedIds;
  });

  try {
    const finalIds = transaction();
    
    // Obtener las guías finales para enviarlas al domiciliario
    const placeholders = finalIds.map(() => '?').join(',');
    const assignedGuides = db.prepare(`SELECT * FROM guides WHERE id IN (${placeholders})`).all(...finalIds);
    
    // Emitir a todos los admins que las rutas se actualizaron
    req.app.get('io').emit('routes:updated', { domiciliario_id });
    
    // Emitir resumen en vivo a todos los admins
    req.app.get('io').emit('ruta:actualizada', getLiveSummaries());
    
    // Emitir directamente al domiciliario el evento ruta:asignada con la lista
    req.app.get('io').to(`dom_${domiciliario_id}`).emit('ruta:asignada', assignedGuides);
    
    res.json({ success: true, count: finalIds.length });
  } catch (e) {
    console.error('CRITICAL ERROR in /api/guides/assign:', e);
    res.status(500).json({ 
      error: 'Error en el proceso de asignación', 
      details: e.message,
      stack: e.stack
    });
  }
});

// Cambiar estado de una guía (específicos)
router.put('/:id/status', authMiddleware(), (req, res) => {
  const { status } = req.body;
  const validStatuses = ['en_oficina', 'en_ruta', 'entregado', 'direccion_erronea', 'cliente_no_esta', 'devolucion'];
  
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: 'Estado inválido' });
  }

  try {
    db.prepare("UPDATE guides SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(status, req.params.id);
    const guide = db.prepare('SELECT * FROM guides WHERE id = ?').get(req.params.id);
    req.app.get('io').emit('guide:updated', guide);
    
    // Actualizar el resumen en vivo
    req.app.get('io').emit('ruta:actualizada', getLiveSummaries());
    
    res.json(guide);
  } catch (e) {
    res.status(500).json({ error: 'Error al actualizar estado' });
  }
});

module.exports = { router, getLiveSummaries };
