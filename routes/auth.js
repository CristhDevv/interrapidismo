const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../database/db');
const SECRET = process.env.JWT_SECRET || 'interrapidisimo_secret_2024';

router.post('/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Credenciales incorrectas' });
  }
  const token = jwt.sign(
    { id: user.id, username: user.username, role: user.role, name: user.name },
    SECRET,
    { expiresIn: '12h' }
  );
  res.json({ token, role: user.role, name: user.name });
});

// Solo admin puede crear usuarios
const authMiddleware = require('../middleware/auth');
router.post('/create-user', authMiddleware('admin'), (req, res) => {
  const { username, password, role, name } = req.body;
  if (!['admin', 'domiciliario'].includes(role)) return res.status(400).json({ error: 'Rol inválido' });
  const hash = bcrypt.hashSync(password, 10);
  try {
    db.prepare('INSERT INTO users (username, password, role, name) VALUES (?, ?, ?, ?)').run(username, hash, role, name);
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: 'Usuario ya existe' });
  }
});

router.get('/users', authMiddleware('admin'), (req, res) => {
  const users = db.prepare("SELECT id, username, role, name, created_at FROM users").all();
  res.json(users);
});

// Editar usuario (nombre y rol)
router.put('/users/:id', authMiddleware('admin'), (req, res) => {
  const { name, role } = req.body;
  const { id } = req.params;

  if (role && !['admin', 'domiciliario'].includes(role)) {
    return res.status(400).json({ error: 'Rol inválido' });
  }

  // Protección: no se puede cambiar el rol del admin principal si es el usuario 1
  if (id == 1 && role === 'domiciliario') {
    return res.status(403).json({ error: 'No se puede cambiar el rol al administrador principal' });
  }

  try {
    db.prepare('UPDATE users SET name = COALESCE(?, name), role = COALESCE(?, role) WHERE id = ?')
      .run(name, role, id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Error al actualizar usuario' });
  }
});

// Cambiar contraseña
router.put('/users/:id/password', authMiddleware('admin'), (req, res) => {
  const { password } = req.body;
  const { id } = req.params;

  if (!password || password.length < 6) {
    return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
  }

  const hash = bcrypt.hashSync(password, 10);
  try {
    db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hash, id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Error al cambiar contraseña' });
  }
});

// Eliminar usuario
router.delete('/users/:id', authMiddleware('admin'), (req, res) => {
  const { id } = req.params;

  // Protección: no se puede eliminar el usuario con ID 1 (admin principal)
  if (id == 1) {
    return res.status(403).json({ error: 'No se puede eliminar el administrador principal' });
  }

  try {
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Error al eliminar usuario' });
  }
});

module.exports = router;
