const express = require('express');
const router = express.Router();
const neighborController = require('../controllers/neighbor.controller');
const { authenticateToken } = require('../middlewares/auth.middleware');

// Rutas de vecino protegidas por sesión
router.post('/update', authenticateToken, neighborController.updateProfile);
router.post('/setup-2fa', authenticateToken, neighborController.setup2FA);
router.post('/activate-2fa', authenticateToken, neighborController.activate2FA);
router.post('/deactivate-2fa', authenticateToken, neighborController.deactivate2FA);
router.post('/passkey/register/start', authenticateToken, neighborController.startPasskeyRegistration);
router.post('/passkey/register/finish', authenticateToken, neighborController.finishPasskeyRegistration);
router.get('/passkey/list', authenticateToken, neighborController.listPasskeys);
router.post('/passkey/revoke', authenticateToken, neighborController.revokePasskey);
router.post('/passkey/rename', authenticateToken, neighborController.renamePasskey);
router.get('/finance/overview', authenticateToken, neighborController.getFinanceOverview);
router.get('/finance/certificate', authenticateToken, neighborController.downloadFinanceCertificate);

module.exports = router;
