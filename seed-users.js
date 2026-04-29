const db = require('./database/db');
const bcrypt = require('bcryptjs');

function seedUsers() {
  console.log('--- Iniciando Seed de Usuarios ---');

  // 1. Admin
  const adminUsername = 'admin';
  const adminPass = 'Soloc@li1';
  const adminExists = db.prepare("SELECT id FROM users WHERE username = ?").get(adminUsername);
  
  if (!adminExists) {
    const hash = bcrypt.hashSync(adminPass, 10);
    db.prepare("INSERT INTO users (username, password, role, name) VALUES (?, ?, 'admin', 'Administrador')")
      .run(adminUsername, hash);
    console.log(`[OK] Admin creado: ${adminUsername} / ${adminPass}`);
  } else {
    // Actualizar clave si ya existe
    const hash = bcrypt.hashSync(adminPass, 10);
    db.prepare("UPDATE users SET password = ? WHERE username = ?").run(hash, adminUsername);
    console.log(`[OK] Admin actualizado: ${adminUsername} / ${adminPass}`);
  }

  // 2. Domiciliario
  const domUsername = 'mensajero';
  const domPass = 'Soloc@li1';
  const domExists = db.prepare("SELECT id FROM users WHERE username = ?").get(domUsername);

  if (!domExists) {
    const hash = bcrypt.hashSync(domPass, 10);
    db.prepare("INSERT INTO users (username, password, role, name) VALUES (?, ?, 'domiciliario', 'Domiciliario 1')")
      .run(domUsername, hash);
    console.log(`[OK] Domiciliario creado: ${domUsername} / ${domPass}`);
  } else {
    // Actualizar clave si ya existe
    const hash = bcrypt.hashSync(domPass, 10);
    db.prepare("UPDATE users SET password = ? WHERE username = ?").run(hash, domUsername);
    console.log(`[OK] Domiciliario actualizado: ${domUsername} / ${domPass}`);
  }

  console.log('--- Seed Finalizado ---');
}

seedUsers();
process.exit(0);
