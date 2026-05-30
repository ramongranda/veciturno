const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const config = require('../src/config/env');

const DB_PATH = path.join(__dirname, '../db/database.json');

if (!fs.existsSync(DB_PATH)) {
  console.error('❌ Archivo db/database.json local no encontrado.');
  process.exit(1);
}

try {
  console.log('📖 Leyendo base de datos local...');
  const localData = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
  console.log(`✅ Base de datos local leída con éxito.`);

  if (!config.DATABASE_URL) {
    console.error('❌ DATABASE_URL no configurada en el archivo .env.');
    process.exit(1);
  }

  console.log('🔌 Conectando a Supabase...');
  const pool = new Pool({
    connectionString: config.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  console.log('⚡ Asegurando existencia de la tabla veciturno_store...');
  pool.query(`
    CREATE TABLE IF NOT EXISTS veciturno_store (
      id INT PRIMARY KEY,
      data JSONB
    );
  `).then(() => {
    console.log('📤 Subiendo tus datos locales a la tabla en Supabase...');
    return pool.query(
      'INSERT INTO veciturno_store (id, data) VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET data = $1',
      [JSON.stringify(localData)]
    );
  }).then(() => {
    console.log('🎉 ¡MIGRACIÓN COMPLETADA CON ÉXITO! 🎉');
    console.log('Todos tus vecinos, turnos, e historial de pagos están ahora en tu base de datos de Supabase en la nube.');
    pool.end();
    process.exit(0);
  }).catch(err => {
    console.error('❌ Error durante la consulta en PostgreSQL:', err.message);
    pool.end();
    process.exit(1);
  });
} catch (err) {
  console.error('❌ Error al procesar el archivo local:', err.message);
  process.exit(1);
}
