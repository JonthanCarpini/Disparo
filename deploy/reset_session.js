const mysql = require('/app/node_modules/mysql2/promise');

async function run() {
  const pool = await mysql.createPool({
    host: 'mysql', user: 'disparo', password: 'Disparo@2026', database: 'disparo_whats'
  });
  await pool.execute(
    'UPDATE whatsapp_sessions SET status = ?, phone = NULL WHERE id = ?',
    ['disconnected', 'e17dcfe0-7a1f-4b0e-a89f-c935b0d6bdce']
  );
  console.log('Sessao Aline resetada para disconnected');
  await pool.end();
  process.exit(0);
}
run().catch(e => { console.error(e.message); process.exit(1); });
