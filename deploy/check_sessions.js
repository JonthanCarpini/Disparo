const mysql = require('/app/node_modules/mysql2/promise');

async function run() {
  const pool = await mysql.createPool({
    host: 'mysql', user: 'disparo', password: 'Disparo@2026', database: 'disparo_whats'
  });
  const [rows] = await pool.execute('SELECT id, name, phone, status FROM whatsapp_sessions');
  console.log('Sessions:', JSON.stringify(rows, null, 2));
  await pool.end();
  process.exit(0);
}
run().catch(e => { console.error(e.message); process.exit(1); });
