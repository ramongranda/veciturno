require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const routes = require('./src/routes');

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Servir archivos estáticos del frontend
app.use(express.static(path.join(__dirname, 'public')));

// Rutas de la API
app.use('/api', routes);

// Redirigir el resto de peticiones al frontend (SPA)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(` VeciTurno está corriendo en: http://localhost:${PORT}`);
  console.log(` Listo para desplegar en Oracle Cloud Free Tier`);
  console.log(`====================================================`);
});
