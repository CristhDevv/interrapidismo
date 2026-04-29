const jwt = require('jsonwebtoken');
const SECRET = process.env.JWT_SECRET || 'interrapidisimo_secret_2024';

module.exports = (requiredRole = null) => (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No autorizado' });
  try {
    const decoded = jwt.verify(token, SECRET);
    if (requiredRole && decoded.role !== requiredRole && decoded.role !== 'admin') {
      return res.status(403).json({ error: 'Acceso denegado' });
    }
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido' });
  }
};
