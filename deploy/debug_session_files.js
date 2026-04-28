const fs = require('fs');
const path = require('path');

const sessionDir = '/app/data/sessions/e17dcfe0-7a1f-4b0e-a89f-c935b0d6bdce';
const files = fs.readdirSync(sessionDir);
console.log('Session files:', files);

// Lê o arquivo de contatos se existir
for (const f of files) {
  if (f.includes('contact') || f.includes('app-state')) {
    const content = fs.readFileSync(path.join(sessionDir, f), 'utf-8').substring(0, 500);
    console.log(`\n=== ${f} ===\n${content}`);
  }
}
process.exit(0);
