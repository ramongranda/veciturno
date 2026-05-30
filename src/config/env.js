require('dotenv').config();

// Lista de variables requeridas y sus valores por defecto
const config = {
  PORT: parseInt(process.env.PORT || '3000', 10),
  JWT_SECRET: process.env.JWT_SECRET,
  COMMUNITY_NAME: process.env.COMMUNITY_NAME || 'Comunidad VeciTurno',
  START_MONTH: process.env.START_MONTH || '2026-06-01',
  START_FLOOR_ID: process.env.START_FLOOR_ID || '1',
  BOOTSTRAP_TOKEN: process.env.BOOTSTRAP_TOKEN || 'registro-inicial-planta3',
  NODE_ENV: process.env.NODE_ENV || 'development',
  SYSTEM_WHATSAPP_API_KEY: process.env.SYSTEM_WHATSAPP_API_KEY || '',
  NOTIFICATIONS_GROUP_URL: process.env.NOTIFICATIONS_GROUP_URL || '',
  DATABASE_URL: process.env.DATABASE_URL || ''
};

// Validación de seguridad: detener servidor de forma temprana si faltan variables críticas
if (!config.JWT_SECRET) {
  console.error('\x1b[31m%s\x1b[0m', 'CRITICAL ERROR: La variable de entorno JWT_SECRET no está configurada.');
  console.error('\x1b[33m%s\x1b[0m', 'Por favor, añádela a tu archivo .env para asegurar el cifrado de la sesión.');
  process.exit(1);
}

module.exports = config;
