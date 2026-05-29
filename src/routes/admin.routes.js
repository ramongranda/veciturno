const express = require('express');
const router = express.Router();
const adminController = require('../controllers/admin.controller');
const { authenticateToken, requireAdmin } = require('../middlewares/auth.middleware');

// Rutas de administración protegidas por sesión y privilegios de administrador
router.post('/create-neighbor', authenticateToken, requireAdmin, adminController.createNeighbor);
router.post('/generate-invite', authenticateToken, requireAdmin, adminController.generateInvite);
router.get('/invites', authenticateToken, requireAdmin, adminController.getInvites);
router.post('/send-test-whatsapp', authenticateToken, requireAdmin, adminController.sendTestWhatsApp);

module.exports = router;
