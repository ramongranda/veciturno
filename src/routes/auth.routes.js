const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');

// Login en 2 pasos
router.post('/login', authController.login);
router.post('/login/verify', authController.verifyLogin2FA);

// Flujo de Registro autónomo con link
router.get('/register/validate', authController.validateInvite);
router.post('/register/setup', authController.registerSetup);
router.post('/register/verify-2fa', authController.registerVerify);

module.exports = router;
