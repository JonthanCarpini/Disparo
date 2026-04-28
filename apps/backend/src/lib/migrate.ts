import 'dotenv/config'
import { getDb } from './db'
import { logger } from './logger'

const schema = `
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(100) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS whatsapp_sessions (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  phone VARCHAR(30),
  status ENUM('disconnected', 'connecting', 'connected', 'banned') DEFAULT 'disconnected',
  session_data LONGTEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS contact_lists (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  source ENUM('csv_import', 'group_extract', 'contact_extract') DEFAULT 'csv_import',
  total INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS contacts (
  id VARCHAR(36) PRIMARY KEY,
  list_id VARCHAR(36) NOT NULL,
  phone VARCHAR(30) NOT NULL,
  name VARCHAR(200),
  extra_data JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (list_id) REFERENCES contact_lists(id) ON DELETE CASCADE,
  INDEX idx_list_id (list_id)
);

CREATE TABLE IF NOT EXISTS ai_configs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  provider ENUM('openai', 'gemini', 'groq') NOT NULL UNIQUE,
  api_key VARCHAR(500) NOT NULL,
  model VARCHAR(100),
  enabled TINYINT(1) DEFAULT 1,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS campaigns (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  list_id VARCHAR(36) NOT NULL,
  ai_provider ENUM('openai', 'gemini', 'groq') NOT NULL,
  ai_model VARCHAR(100),
  prompt TEXT NOT NULL,
  media_type ENUM('none', 'image', 'audio') DEFAULT 'none',
  media_path VARCHAR(500),
  min_delay INT DEFAULT 5,
  max_delay INT DEFAULT 15,
  rotate_sessions TINYINT(1) DEFAULT 1,
  session_ids JSON,
  scheduled_at TIMESTAMP NULL,
  status ENUM('draft', 'scheduled', 'running', 'paused', 'completed', 'failed') DEFAULT 'draft',
  total INT DEFAULT 0,
  sent INT DEFAULT 0,
  failed INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (list_id) REFERENCES contact_lists(id)
);

CREATE TABLE IF NOT EXISTS campaign_logs (
  id VARCHAR(36) PRIMARY KEY,
  campaign_id VARCHAR(36) NOT NULL,
  contact_id VARCHAR(36) NOT NULL,
  phone VARCHAR(30) NOT NULL,
  message TEXT,
  status ENUM('pending', 'sent', 'failed') DEFAULT 'pending',
  error TEXT,
  sent_at TIMESTAMP NULL,
  session_id VARCHAR(36),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
  INDEX idx_campaign_id (campaign_id),
  INDEX idx_status (status)
);

CREATE TABLE IF NOT EXISTS settings (
  \`key\` VARCHAR(100) PRIMARY KEY,
  \`value\` TEXT,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

INSERT IGNORE INTO settings (\`key\`, \`value\`) VALUES 
  ('app_name', 'Disparo WhatsApp'),
  ('default_ai_provider', 'openai');
`

async function migrate() {
  const db = getDb()
  const statements = schema
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)

  for (const stmt of statements) {
    await db.execute(stmt)
  }
  logger.info('Migração concluída com sucesso')
  process.exit(0)
}

migrate().catch((err) => {
  logger.error({ err }, 'Falha na migração')
  process.exit(1)
})
