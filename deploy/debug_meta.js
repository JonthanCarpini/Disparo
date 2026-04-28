// Inspeciona o formato dos participantes de um grupo via Baileys interno
// Acessa o socket diretamente via API de debug
const http = require('http');

async function loginAndGet(path) {
  const loginData = JSON.stringify({ username: 'admin', password: 'Admin@2026' });
  const token = await new Promise((resolve, reject) => {
    const req = http.request({
      host: 'localhost', port: 3333, path: '/api/auth/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': loginData.length }
    }, (res) => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(JSON.parse(d).token));
    });
    req.on('error', reject); req.write(loginData); req.end();
  });

  return new Promise((resolve, reject) => {
    http.get({ host: 'localhost', port: 3333, path, headers: { 'Authorization': `Bearer ${token}` } }, (res) => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => {
        try { resolve(JSON.parse(d)); } catch(e) { resolve(d); }
      });
    }).on('error', reject);
  });
}

async function run() {
  const sessions = await loginAndGet('/api/whatsapp/sessions');
  const sessionId = sessions[0]?.id;
  const groups = await loginAndGet(`/api/whatsapp/sessions/${sessionId}/groups`);
  
  // Pega o maior grupo para testar
  const bigGroup = groups.sort((a, b) => b.size - a.size)[0];
  console.log('Testing with group:', bigGroup.name, '- ID:', bigGroup.id, '- Size:', bigGroup.size);

  const participants = await loginAndGet(`/api/whatsapp/sessions/${sessionId}/groups/${encodeURIComponent(bigGroup.id)}/participants`);
  console.log('Participants count returned:', Array.isArray(participants) ? participants.length : 'NOT ARRAY');
  console.log('First 3:', JSON.stringify(Array.isArray(participants) ? participants.slice(0, 3) : participants));

  process.exit(0);
}
run().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
