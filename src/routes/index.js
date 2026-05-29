const express = require('express');
const router = express.Router();

const authRoutes = require('./auth.routes');
const adminRoutes = require('./admin.routes');
const neighborRoutes = require('./neighbor.routes');
const turnRoutes = require('./turn.routes');

// Unificación de rutas en base a namespaces profesionales
router.use('/auth', authRoutes);
router.use('/admin', adminRoutes);
router.use('/neighbors', neighborRoutes);
router.use('/public', turnRoutes); // Para mantener la API /public/status compatible

module.exports = router;
