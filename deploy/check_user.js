const bcrypt = require('/app/node_modules/bcryptjs');
const mysql = require('/app/node_modules/mysql2/promise');

async function run() {
  const pool = await mysql.createPool({
    host: 'mysql',
    user: 'disparo',
    password: 'Disparo@2026',
    database: 'disparo_whats'
  });

  const [rows] = await pool.execute('SELECT id, username, password FROM users');
  console.log('Users in DB:', JSON.stringify(rows));

  if (rows.length === 0) {
    console.log('No users found, creating admin...');
    const hash = await bcrypt.hash('Admin@2026', 12);
    await pool.execute(
      'INSERT INTO users (username, password) VALUES (?, ?)',
      ['admin', hash]
    );
    console.log('Admin created!');
  } else {
    console.log('Resetting admin password...');
    const hash = await bcrypt.hash('Admin@2026', 12);
    await pool.execute('UPDATE users SET password = ? WHERE username = ?', [hash, 'admin']);
    console.log('Password reset done!');
  }

  await pool.end();
  process.exit(0);
}

run().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
