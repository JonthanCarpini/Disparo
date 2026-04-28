// Este script conecta ao BaileysService via HTTP e faz debug dos participantes
const http = require('http');

async function fetchAPI(path, token) {
  return new Promise((resolve, reject) => {
    const options = {
      host: 'localhost',
      port: 3333,
      path: path,
      headers: { 'Authorization': `Bearer ${token}` }
    };
    http.get(options, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch(e) { resolve(data); }
      });
    }).on('error', reject);
  });
}

async function run() {
  // Login
  const loginData = JSON.stringify({ username: 'admin', password: 'Admin@2026' });
  const token = await new Promise((resolve, reject) => {
    const req = http.request({
      host: 'localhost', port: 3333, path: '/api/auth/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': loginData.length }
    }, (res) => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(JSON.parse(d).token));
    });
    req.on('error', reject);
    req.write(loginData); req.end();
  });

  const sessions = await fetchAPI('/api/whatsapp/sessions', token);
  const sessionId = sessions[0]?.id;
  console.log('Session ID:', sessionId);

  const groups = await fetchAPI(`/api/whatsapp/sessions/${sessionId}/groups`, token);
  console.log('Groups count:', groups.length);
  if (groups.length > 0) {
    console.log('First group:', JSON.stringify(groups[0]));
  }

  process.exit(0);
}
run().catch(e => { console.error(e.message); process.exit(1); });
