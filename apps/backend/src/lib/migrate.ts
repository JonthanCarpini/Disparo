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
  phone VARCHAR(50) NOT NULL,
  jid VARCHAR(100),
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

export async function runMigrations() {
  const db = getDb()
  const statements = schema
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)

  for (const stmt of statements) {
    await db.execute(stmt)
  }

  await ensureColumn(db, 'contacts', 'jid', 'VARCHAR(100) NULL AFTER phone')
  await ensureColumnType(db, 'contacts', 'phone', 'VARCHAR(50) NOT NULL')
  await ensureColumn(db, 'contacts', 'wa_exists', 'TINYINT(1) NULL DEFAULT NULL')
  await ensureColumn(db, 'contacts', 'verified_at', 'TIMESTAMP NULL DEFAULT NULL')

  await ensureColumn(db, 'campaigns', 'max_per_day', 'INT NOT NULL DEFAULT 0')
  await ensureColumn(db, 'campaigns', 'daily_sent', 'INT NOT NULL DEFAULT 0')
  await ensureColumn(db, 'campaigns', 'last_send_date', 'DATE NULL DEFAULT NULL')
  await ensureColumn(db, 'campaigns', 'max_per_session_day', 'INT NOT NULL DEFAULT 0')
  await ensureColumn(db, 'campaigns', 'start_time', "VARCHAR(5) NULL DEFAULT NULL")
  await ensureColumn(db, 'campaigns', 'end_time', "VARCHAR(5) NULL DEFAULT NULL")
  await ensureColumn(db, 'whatsapp_sessions', 'warming_daily_limit', 'INT NOT NULL DEFAULT 0')

  await ensureColumnType(db, 'ai_configs', 'provider', "ENUM('openai','gemini','groq','mistral') NOT NULL")
  await ensureColumnType(db, 'campaigns', 'ai_provider', "ENUM('openai','gemini','groq','mistral') NOT NULL")

  await ensureColumnType(db, 'contact_lists', 'source', "ENUM('csv_import','group_extract','contact_extract','n8n_group_import') DEFAULT 'csv_import'")
  await ensureColumn(db, 'contact_lists', 'source_jid', 'VARCHAR(120) NULL DEFAULT NULL')
  await ensureIndex(db, 'contact_lists', 'idx_source_jid', 'source_jid')

  await db.execute(`
    CREATE TABLE IF NOT EXISTS api_keys (
      id INT AUTO_INCREMENT PRIMARY KEY,
      label VARCHAR(120) NOT NULL,
      key_hash VARCHAR(255) NOT NULL,
      key_preview VARCHAR(20) NOT NULL,
      enabled TINYINT(1) NOT NULL DEFAULT 1,
      last_used_at TIMESTAMP NULL DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_key_hash (key_hash),
      INDEX idx_enabled (enabled)
    )
  `)

  await db.execute(`
    CREATE TABLE IF NOT EXISTS ai_provider_keys (
      id INT AUTO_INCREMENT PRIMARY KEY,
      provider VARCHAR(50) NOT NULL,
      label VARCHAR(100) NOT NULL DEFAULT 'Conta',
      api_key VARCHAR(500) NOT NULL,
      enabled TINYINT(1) DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_provider (provider)
    )
  `)

  logger.info('Migração concluída com sucesso')
}

async function ensureColumn(db: ReturnType<typeof getDb>, table: string, column: string, definition: string) {
  const [rows] = await db.execute(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column],
  )
  if (Array.isArray(rows) && rows.length === 0) {
    await db.execute(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`)
    logger.info(`Coluna ${table}.${column} adicionada`)
  }
}

async function ensureColumnType(db: ReturnType<typeof getDb>, table: string, column: string, definition: string) {
  try {
    await db.execute(`ALTER TABLE \`${table}\` MODIFY COLUMN \`${column}\` ${definition}`)
  } catch (err) {
    logger.warn({ err: String(err) }, `ensureColumnType falhou para ${table}.${column}`)
  }
}

async function ensureIndex(
  db: ReturnType<typeof getDb>,
  table: string,
  indexName: string,
  columns: string,
) {
  const [rows] = await db.execute(
    `SELECT INDEX_NAME FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [table, indexName],
  )
  if (Array.isArray(rows) && rows.length === 0) {
    await db.execute(`ALTER TABLE \`${table}\` ADD INDEX \`${indexName}\` (${columns})`)
    logger.info(`Índice ${table}.${indexName} adicionado`)
  }
}

if (require.main === module) {
  runMigrations()
    .then(() => process.exit(0))
    .catch((err) => {
      logger.error({ err }, 'Falha na migração')
      process.exit(1)
    })
}
