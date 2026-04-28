// Inspeciona todos os campos de um participante LID
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

  return { token, get: (p) => new Promise((resolve, reject) => {
    http.get({ host: 'localhost', port: 3333, path: p, headers: { 'Authorization': `Bearer ${token}` } }, (res) => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => {
        try { resolve(JSON.parse(d)); } catch(e) { resolve(d); }
      });
    }).on('error', reject);
  })};
}

async function run() {
  // Usar Baileys direto para ver os campos
  const { default: makeWASocket, useMultiFileAuthState } = await import('/app/node_modules/@whiskeysockets/baileys/lib/index.js');
  const { state } = await useMultiFileAuthState('/app/data/sessions/e17dcfe0-7a1f-4b0e-a89f-c935b0d6bdce');
  
  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    browser: ['Ubuntu', 'Chrome', '121.0.0'],
  });

  await new Promise(r => setTimeout(r, 8000));
  
  const groupId = '120363425188652308@g.us';
  const meta = await sock.groupMetadata(groupId);
  console.log('Total participants:', meta.participants.length);
  
  const first5 = meta.participants.slice(0, 5);
  for (const p of first5) {
    console.log('Participant keys:', Object.keys(p));
    console.log('Participant full:', JSON.stringify(p));
    console.log('---');
  }
  
  await sock.end();
  process.exit(0);
}
run().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
