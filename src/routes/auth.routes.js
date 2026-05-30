const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');

// Login en 2 pasos
router.post('/login', authController.login);
router.post('/login/verify', authController.verifyLogin2FA);
router.post('/passkey/login/start', authController.startPasskeyLogin);
router.post('/passkey/login/finish', authController.finishPasskeyLogin);

// Flujo de Registro autónomo con link
router.get('/register/validate', authController.validateInvite);
router.post('/register/setup', authController.registerSetup);
router.post('/register/verify-2fa', authController.registerVerify);
router.post('/register/verify-skip-2fa', authController.registerVerifySkip);

module.exports = router;
