const express = require('express');
const router = express.Router();
const multer = require('multer');
const neighborController = require('../controllers/neighbor.controller');
const { authenticateToken } = require('../middlewares/auth.middleware');
const uploadPhoto = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

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
router.get('/documents', authenticateToken, neighborController.listDocuments);
router.get('/documents/:id/download', authenticateToken, neighborController.downloadDocument);
router.get('/areas', authenticateToken, neighborController.listCommonAreas);
router.get('/reservations', authenticateToken, neighborController.listReservations);
router.post('/reservations', authenticateToken, neighborController.createReservation);
router.delete('/reservations/:id', authenticateToken, neighborController.cancelReservation);
router.get('/incidents', authenticateToken, neighborController.listIncidents);
router.post('/incidents', authenticateToken, uploadPhoto.single('photo'), neighborController.createIncident);
router.get('/incidents/:id/photo', authenticateToken, neighborController.getIncidentPhoto);

module.exports = router;
