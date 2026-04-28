// Lista metodos disponíveis no sock e verifica getLIDMembers
const mysql = require('/app/node_modules/mysql2/promise');

async function run() {
  // Verifica o Baileys Utils para getLIDMembers ou equivalente
  const fs = require('fs');
  const utilsPath = '/app/node_modules/@whiskeysockets/baileys/lib/Utils';
  const files = fs.readdirSync(utilsPath);
  console.log('Utils files:', files);

  // Verifica exports do Socket
  const socketPath = '/app/node_modules/@whiskeysockets/baileys/lib/Socket';
  const socketFiles = fs.readdirSync(socketPath);
  console.log('Socket files:', socketFiles);

  // Lê index do Socket
  const indexContent = fs.readFileSync('/app/node_modules/@whiskeysockets/baileys/lib/Socket/index.js', 'utf8').substring(0, 1000);
  console.log('Socket index:', indexContent);

  process.exit(0);
}
run().catch(e => { console.error(e.message); process.exit(1); });
