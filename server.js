const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const https = require('https');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const config = require('./src/config/env');
const apiRouter = require('./src/routes');
const dbService = require('./src/services/db.service');
const whatsappService = require('./src/services/whatsapp.service');

const certsDir = path.join(__dirname, 'certs');
const keyPath = path.join(certsDir, 'key.pem');
const certPath = path.join(certsDir, 'cert.pem');

// Generar certificados automáticamente en desarrollo si no existen
if (config.NODE_ENV === 'development' && (!fs.existsSync(keyPath) || !fs.existsSync(certPath))) {
  console.log('🛡️ Certificados SSL locales no encontrados. Autogenerando...');
  try {
    const { execSync } = require('child_process');
    execSync('node scripts/generate-certs.js', { stdio: 'inherit' });
  } catch (err) {
    console.error('⚠️ No se pudieron generar automáticamente los certificados SSL locales:', err.message);
  }
}

// Cargar certificados SSL si están disponibles
let sslOptions = null;
if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
  try {
    sslOptions = {
      key: fs.readFileSync(keyPath),
      cert: fs.readFileSync(certPath)
    };
  } catch (err) {
    console.error('⚠️ Error al cargar los certificados SSL:', err.message);
  }
}


const app = express();

// 🛡️ Cabeceras HTTP seguras con Helmet (configuración compatible con SPA)
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "https://unpkg.com", "'unsafe-inline'", "'unsafe-eval'"],
        scriptSrcAttr: ["'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'", "https://unpkg.com"]
      }
    }
  })
);

// 🛡️ Control de tasa (Rate Limiting) para prevenir DoS y fuerza bruta
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 150, // Límite razonable para la SPA por IP
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Demasiadas solicitudes desde esta dirección IP. Por favor, inténtalo de nuevo en 15 minutos.'
  }
});
app.use('/api', apiLimiter);

// Middlewares estándar de Express
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Servir archivos estáticos del frontend
app.use(express.static(path.join(__dirname, 'public')));

// Desactivar caché del navegador para toda la API REST (garantiza datos en tiempo real)
app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

// Cargar enrutador unificado para la API REST
app.use('/api', apiRouter);

// Fallback para Single Page Application (SPA)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

async function startServer() {
  // 🔌 Inicializar la base de datos híbrida (in-memory con Postgres/Supabase de respaldo)
  await dbService.initialize();

  // 💬 Inicializar la pasarela de WhatsApp en segundo plano
  whatsappService.initialize();
  setInterval(() => {
    whatsappService.runDailyReminders().catch(() => {});
  }, 6 * 60 * 60 * 1000);

  // Levantar el servidor en el puerto configurado (según disponibilidad de SSL)
  if (sslOptions) {
    const secureServer = https.createServer(sslOptions, app);
    secureServer.listen(config.PORT, () => {
      console.log(`====================================================`);
      console.log(` 🏡 VeciTurno está corriendo en modo SEGURO (HTTPS)`);
      console.log(` URL local: https://localhost:${config.PORT}`);
      console.log(` Comunidad: ${config.COMMUNITY_NAME}`);
      console.log(` Entorno actual: ${config.NODE_ENV}`);
      console.log(` Listo para desplegar en Hugging Face Spaces`);
      console.log(`====================================================`);
    });
  } else {
    app.listen(config.PORT, () => {
      console.log(`====================================================`);
      console.log(` 🏡 VeciTurno está corriendo en modo ESTÁNDAR (HTTP)`);
      console.log(` URL local: http://localhost:${config.PORT}`);
      console.log(` Comunidad: ${config.COMMUNITY_NAME}`);
      console.log(` Entorno actual: ${config.NODE_ENV}`);
      console.log(` Listo para desplegar en Hugging Face Spaces`);
      console.log(`====================================================`);
    });
  }
}

startServer().catch((err) => {
  console.error('❌ Error crítico al arrancar el servidor VeciTurno:', err);
  process.exit(1);
});
