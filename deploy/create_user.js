const bcrypt = require('/app/node_modules/bcryptjs');
const mysql = require('/app/node_modules/mysql2/promise');

async function run() {
  const hash = await bcrypt.hash('Admin@2026', 12);
  const pool = await mysql.createPool({
    host: 'mysql',
    user: 'disparo',
    password: 'Disparo@2026',
    database: 'disparo_whats'
  });
  const [result] = await pool.execute(
    'INSERT IGNORE INTO users (username, password) VALUES (?, ?)',
    ['admin', hash]
  );
  console.log('USER_CREATED', JSON.stringify(result));
  await pool.end();
  process.exit(0);
}

run().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
