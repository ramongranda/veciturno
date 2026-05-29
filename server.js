const express = require('express');
const cors = require('cors');
const path = require('path');
const config = require('./src/config/env');
const apiRouter = require('./src/routes');

const app = express();

// Middlewares estándar de Express
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Servir archivos estáticos del frontend
app.use(express.static(path.join(__dirname, 'public')));

// Cargar enrutador unificado para la API REST
app.use('/api', apiRouter);

// Fallback para Single Page Application (SPA)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Levantar el servidor en el puerto configurado en .env
app.listen(config.PORT, () => {
  console.log(`====================================================`);
  console.log(` 🏡 VeciTurno está corriendo en: http://localhost:${config.PORT}`);
  console.log(` Comunidad: ${config.COMMUNITY_NAME}`);
  console.log(` Entorno actual: ${config.NODE_ENV}`);
  console.log(` Listo para desplegar en Oracle Cloud Free Tier`);
  console.log(`====================================================`);
});
