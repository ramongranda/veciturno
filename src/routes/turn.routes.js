const express = require('express');
const router = express.Router();
const turnController = require('../controllers/turn.controller');

// Obtener estado y feeds del dashboard
router.get('/status', turnController.getStatus);

module.exports = router;
