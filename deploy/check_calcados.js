const mysql = require('/app/node_modules/mysql2/promise');

async function run() {
  const pool = await mysql.createPool({
    host: 'mysql', user: 'disparo', password: 'Disparo@2026', database: 'disparo_whats'
  });
  const [lists] = await pool.execute("SELECT id, name, total FROM contact_lists WHERE name LIKE '%calcados%' OR name LIKE '%calçados%' ORDER BY created_at DESC");
  console.log('Lists calcados:', JSON.stringify(lists, null, 2));
  
  for (const l of lists) {
    const [contacts] = await pool.execute('SELECT phone, name FROM contacts WHERE list_id = ? LIMIT 10', [l.id]);
    console.log(`\nPrimeiros 10 contatos de "${l.name}":`, JSON.stringify(contacts, null, 2));
  }
  
  await pool.end();
  process.exit(0);
}
run().catch(e => { console.error(e.message); process.exit(1); });
