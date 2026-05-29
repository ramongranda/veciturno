const cryptoService = require('../services/crypto.service');
const dbService = require('../services/db.service');
const config = require('../config/env');
const jwt = require('jsonwebtoken');

const authController = {
  // Login Paso 1: Validar usuario y contraseña
  login: async (req, res) => {
    try {
      const { username, password } = req.body;

      if (!username || !password) {
        return res.status(400).json({ error: 'Por favor, introduce usuario y contraseña.' });
      }

      const neighbor = dbService.getNeighborByUsername(username);
      if (!neighbor) {
        return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
      }

      const isPassValid = await cryptoService.comparePassword(password, neighbor.passwordHash);
      if (!isPassValid) {
        return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
      }

      // Si el doble factor no está registrado en la cuenta, inicia sesión directamente
      if (!neighbor.twoFactorRegistered) {
        const sessionToken = cryptoService.generateToken({
          id: neighbor.id,
          floor: neighbor.floor,
          username: neighbor.username,
          isAdmin: neighbor.isAdmin
        });

        return res.json({
          message: 'Inicio de sesión correcto.',
          token: sessionToken,
          requires2fa: false,
          user: {
            id: neighbor.id,
            floor: neighbor.floor,
            username: neighbor.username,
            isAdmin: neighbor.isAdmin
          }
        });
      }

      // Generar un token temporal con vigencia corta (5 minutos) para verificar el 2FA
      const tempToken = jwt.sign(
        { id: neighbor.id, step: '2fa_pending' },
        config.JWT_SECRET,
        { expiresIn: '5m' }
      );

      res.json({
        message: 'Credenciales correctas. Se requiere código de doble factor.',
        tempToken,
        requires2fa: true
      });
    } catch (err) {
      res.status(500).json({ error: 'Error interno del servidor en el proceso de inicio de sesión.' });
    }
  },

  // Login Paso 2: Verificar OTP
  verifyLogin2FA: async (req, res) => {
    try {
      const { tempToken, code } = req.body;

      if (!tempToken || !code) {
        return res.status(400).json({ error: 'Faltan datos para el inicio de sesión.' });
      }

      const payload = jwt.verify(tempToken, config.JWT_SECRET);
      if (payload.step !== '2fa_pending') {
        return res.status(400).json({ error: 'Petición de inicio de sesión inválida.' });
      }

      const neighbor = dbService.getNeighborById(payload.id);
      const isVerified = cryptoService.verify2FACode(neighbor.twoFactorSecret, code);

      if (!isVerified) {
        return res.status(401).json({ error: 'Código de verificación 2FA incorrecto o expirado.' });
      }

      // Login definitivo
      const sessionToken = cryptoService.generateToken({
        id: neighbor.id,
        floor: neighbor.floor,
        username: neighbor.username,
        isAdmin: neighbor.isAdmin
      });

      res.json({
        message: 'Inicio de sesión correcto.',
        token: sessionToken,
        user: {
          id: neighbor.id,
          floor: neighbor.floor,
          username: neighbor.username,
          isAdmin: neighbor.isAdmin
        }
      });
    } catch (err) {
      return res.status(401).json({ error: 'Sesión temporal de login expirada. Por favor, vuelve a intentar.' });
    }
  },

  // Validar link de invitación
  validateInvite: (req, res) => {
    const { token } = req.query;
    if (!token) {
      return res.status(400).json({ error: 'Token de registro faltante.' });
    }

    const invite = dbService.getInviteToken(token);
    if (!invite) {
      return res.status(404).json({ error: 'El enlace de registro no es válido.' });
    }

    if (invite.used) {
      return res.status(400).json({ error: 'Este enlace de registro ya ha sido utilizado.' });
    }

    // Verificar que el enlace no tenga más de 48 horas
    const diffTime = Math.abs(new Date() - new Date(invite.createdAt));
    const diffHours = Math.ceil(diffTime / (1000 * 60 * 60));
    if (diffHours > 48) {
      return res.status(400).json({ error: 'El enlace de registro ha expirado (límite 48 horas).' });
    }

    const neighbor = dbService.getNeighborById(invite.floorId);
    res.json({
      floorId: invite.floorId,
      floor: neighbor.floor
    });
  },

  // Completar registro (Paso 1: crear usuario/contraseña y generar QR de 2FA)
  registerSetup: async (req, res) => {
    try {
      const { token, username, password, phone } = req.body;

      if (!token || !username || !password) {
        return res.status(400).json({ error: 'Faltan campos obligatorios para el registro.' });
      }

      const invite = dbService.getInviteToken(token);
      if (!invite || invite.used) {
        return res.status(400).json({ error: 'Enlace de invitación inválido o ya usado.' });
      }

      const existingNeighbor = dbService.getNeighborByUsername(username);
      if (existingNeighbor) {
        return res.status(400).json({ error: 'Este nombre de usuario ya está registrado en la comunidad.' });
      }

      const neighbor = dbService.getNeighborById(invite.floorId);
      if (neighbor.username) {
        return res.status(400).json({ error: 'Esta planta ya tiene un vecino registrado.' });
      }

      // Generar secreto 2FA
      const { base32, otpauthUrl } = cryptoService.generate2FASecret(neighbor.floor);
      const qrCodeUrl = await cryptoService.generateQRCode(otpauthUrl);

      const passHash = await cryptoService.hashPassword(password);
      
      dbService.updateNeighbor(neighbor.id, {
        username,
        passwordHash: passHash,
        twoFactorSecret: base32,
        twoFactorRegistered: false,
        phone: phone || ""
      });

      res.json({
        message: 'Credenciales guardadas. Escanea el código QR para activar el Doble Factor (2FA).',
        qrCodeUrl,
        secret: base32
      });
    } catch (err) {
      res.status(500).json({ error: 'Error interno en el paso 1 de registro.' });
    }
  },

  // Activar 2FA y completar registro (Paso 2: verificar código y activar)
  registerVerify: async (req, res) => {
    try {
      const { token, code } = req.body;

      if (!token || !code) {
        return res.status(400).json({ error: 'Faltan datos para la verificación.' });
      }

      const invite = dbService.getInviteToken(token);
      if (!invite || invite.used) {
        return res.status(400).json({ error: 'Enlace de invitación inválido o ya usado.' });
      }

      const neighbor = dbService.getNeighborById(invite.floorId);
      if (!neighbor.twoFactorSecret) {
        return res.status(400).json({ error: 'Debes completar el paso 1 de registro primero.' });
      }

      const isVerified = cryptoService.verify2FACode(neighbor.twoFactorSecret, code);
      if (!isVerified) {
        return res.status(400).json({ error: 'Código 2FA incorrecto. Inténtalo de nuevo.' });
      }

      // Activar formalmente el vecino y marcar el token de invitación como usado
      dbService.updateNeighbor(neighbor.id, { twoFactorRegistered: true });
      dbService.useInviteToken(token);

      // Generar sesión definitiva
      const sessionToken = cryptoService.generateToken({
        id: neighbor.id,
        floor: neighbor.floor,
        username: neighbor.username,
        isAdmin: neighbor.isAdmin
      });

      res.json({
        message: 'Registro completado con éxito.',
        token: sessionToken,
        user: {
          id: neighbor.id,
          floor: neighbor.floor,
          username: neighbor.username,
          isAdmin: neighbor.isAdmin
        }
      });
    } catch (err) {
      res.status(500).json({ error: 'Error en la activación del doble factor durante el registro.' });
    }
  },

  // Activar y completar registro OMITIENDO el 2FA
  registerVerifySkip: async (req, res) => {
    try {
      const { token } = req.body;

      if (!token) {
        return res.status(400).json({ error: 'Falta el token de verificación.' });
      }

      const invite = dbService.getInviteToken(token);
      if (!invite || invite.used) {
        return res.status(400).json({ error: 'Enlace de invitación inválido o ya usado.' });
      }

      const neighbor = dbService.getNeighborById(invite.floorId);
      
      // Marcar la cuenta como registrada sin 2FA (limpiamos el secreto temporal generado)
      dbService.updateNeighbor(neighbor.id, {
        twoFactorSecret: null,
        twoFactorRegistered: false
      });
      dbService.useInviteToken(token);

      // Generar sesión definitiva
      const sessionToken = cryptoService.generateToken({
        id: neighbor.id,
        floor: neighbor.floor,
        username: neighbor.username,
        isAdmin: neighbor.isAdmin
      });

      res.json({
        message: 'Registro completado con éxito sin Doble Factor.',
        token: sessionToken,
        user: {
          id: neighbor.id,
          floor: neighbor.floor,
          username: neighbor.username,
          isAdmin: neighbor.isAdmin
        }
      });
    } catch (err) {
      res.status(500).json({ error: 'Error al completar el registro sin Doble Factor.' });
    }
  }
};

module.exports = authController;
