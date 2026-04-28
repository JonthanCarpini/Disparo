const mysql = require('/app/node_modules/mysql2/promise');

async function run() {
  const pool = await mysql.createPool({
    host: 'mysql', user: 'disparo', password: 'Disparo@2026', database: 'disparo_whats'
  });
  const [rows] = await pool.execute('SELECT id, name, phone, status FROM whatsapp_sessions WHERE status = "connected"');
  console.log('Connected sessions:', JSON.stringify(rows));

  const [contacts] = await pool.execute('SELECT COUNT(*) as total, list_id FROM contacts GROUP BY list_id');
  console.log('Contacts per list:', JSON.stringify(contacts));

  const [lists] = await pool.execute('SELECT id, name, source, total FROM contact_lists');
  console.log('Lists:', JSON.stringify(lists));

  await pool.end();
  process.exit(0);
}
run().catch(e => { console.error(e.message); process.exit(1); });
