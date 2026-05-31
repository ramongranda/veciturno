const cryptoService = require('../services/crypto.service');
const dbService = require('../services/db.service');
const config = require('../config/env');
const jwt = require('jsonwebtoken');
const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse
} = require('@simplewebauthn/server');

const passkeyLoginChallenges = new Map();
const passkeyRegisterChallenges = new Map();

function toBase64Url(bufferLike) {
  return Buffer.from(bufferLike).toString('base64url');
}

function fromBase64Url(value) {
  return Buffer.from(value, 'base64url');
}

function normalizeB64Url(value) {
  if (!value) return '';
  return String(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeB64UrlToUtf8(value) {
  try {
    return fromBase64Url(value).toString('utf8');
  } catch (_) {
    return '';
  }
}

function credentialIdVariants(value) {
  const n = normalizeB64Url(value);
  if (!n) return [];
  const decoded = decodeB64UrlToUtf8(n);
  const decodedNorm = normalizeB64Url(decoded);
  return Array.from(new Set([n, decodedNorm].filter(Boolean)));
}

function normalizeSpanishPhone(phone) {
  if (!phone) return '';
  let digits = String(phone).replace(/\D/g, '');
  if (digits.startsWith('0034')) digits = digits.slice(4);
  else if (digits.startsWith('34')) digits = digits.slice(2);
  if (digits.length === 0) return '';
  if (!/^\d{9}$/.test(digits)) return null;
  return `+34${digits}`;
}

const authController = {
  // Login Paso 1: Validar usuario y priorizar acceso por 2FA si está activo
  login: async (req, res) => {
    try {
      const { username, password } = req.body;

      if (!username) {
        return res.status(400).json({ error: 'Por favor, introduce tu nombre de usuario.' });
      }

      const neighbor = dbService.getNeighborByUsername(username);
      if (!neighbor) {
        return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
      }

      if (neighbor.deactivated) {
        return res.status(403).json({ error: 'Tu cuenta ha sido desactivada temporalmente por la administración.' });
      }

      const isSystemAdmin = dbService.isSystemAdminUsername(neighbor.username);

      const hasPassword = typeof password === 'string' && password.trim().length > 0;

      // Si NO tiene 2FA activo, pedimos contraseña en un paso posterior.
      if (!neighbor.twoFactorRegistered) {
        if (!hasPassword) {
          return res.json({
            requiresPassword: true,
            requires2fa: false,
            message: 'Esta cuenta requiere contraseña para iniciar sesión.'
          });
        }

        const isPassValid = await cryptoService.comparePassword(password, neighbor.passwordHash);
        if (!isPassValid) {
          return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
        }
      }

      // Si el doble factor no está registrado en la cuenta, inicia sesión directamente tras contraseña.
      if (!neighbor.twoFactorRegistered) {
        const sessionToken = cryptoService.generateToken({
          id: neighbor.id,
          floor: neighbor.floor,
          username: neighbor.username,
          isAdmin: isSystemAdmin
        });

        return res.json({
          message: 'Inicio de sesión correcto.',
          token: sessionToken,
          requires2fa: false,
          user: {
            id: neighbor.id,
            floor: neighbor.floor,
            username: neighbor.username,
            isAdmin: isSystemAdmin
          }
        });
      }

      // Cuenta con 2FA: por defecto pedimos código móvil.
      // Fallback: si llega contraseña y es correcta, permitimos acceso de respaldo.
      if (hasPassword) {
        const isPassValid = await cryptoService.comparePassword(password, neighbor.passwordHash);
        if (!isPassValid) {
          return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
        }

        const sessionToken = cryptoService.generateToken({
          id: neighbor.id,
          floor: neighbor.floor,
          username: neighbor.username,
          isAdmin: isSystemAdmin
        });

        return res.json({
          message: 'Inicio de sesión por contraseña de respaldo correcto.',
          token: sessionToken,
          requires2fa: false,
          user: {
            id: neighbor.id,
            floor: neighbor.floor,
            username: neighbor.username,
            isAdmin: isSystemAdmin
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
      const isSystemAdmin = dbService.isSystemAdminUsername(neighbor.username);
      const isVerified = cryptoService.verify2FACode(neighbor.twoFactorSecret, code);

      if (!isVerified) {
        return res.status(401).json({ error: 'Código de verificación 2FA incorrecto o expirado.' });
      }

      // Login definitivo
      const sessionToken = cryptoService.generateToken({
        id: neighbor.id,
        floor: neighbor.floor,
        username: neighbor.username,
        isAdmin: isSystemAdmin
      });

      res.json({
        message: 'Inicio de sesión correcto.',
        token: sessionToken,
        user: {
          id: neighbor.id,
          floor: neighbor.floor,
          username: neighbor.username,
          isAdmin: isSystemAdmin
        }
      });
    } catch (err) {
      return res.status(401).json({ error: 'Sesión temporal de login expirada. Por favor, vuelve a intentar.' });
    }
  },

  startPasskeyLogin: async (req, res) => {
    try {
      const { username } = req.body || {};
      if (!username) return res.status(400).json({ error: 'Indica tu usuario.' });

      const neighbor = dbService.getNeighborByUsername(username);
      if (!neighbor) return res.status(404).json({ error: 'Usuario no encontrado.' });

      if (neighbor.deactivated) {
        return res.status(403).json({ error: 'Tu cuenta ha sido desactivada temporalmente por la administración.' });
      }

      const passkeys = Array.isArray(neighbor.passkeys) ? neighbor.passkeys : [];
      if (!passkeys.length) return res.status(400).json({ error: 'Este usuario no tiene acceso por huella/passkey activado.' });

      const rpID = req.hostname || 'localhost';
      const options = await generateAuthenticationOptions({
        rpID,
        userVerification: 'preferred'
      });

      passkeyLoginChallenges.set(neighbor.id, options.challenge);
      return res.json({ options, userId: neighbor.id });
    } catch (err) {
      return res.status(500).json({ error: `No se pudo iniciar el acceso por huella: ${err.message}` });
    }
  },

  finishPasskeyLogin: async (req, res) => {
    try {
      const { userId, credential } = req.body || {};
      if (!userId || !credential) return res.status(400).json({ error: 'Faltan datos para validar passkey.' });

      const neighbor = dbService.getNeighborById(userId);
      const isSystemAdmin = dbService.isSystemAdminUsername(neighbor.username);
      if (!neighbor) return res.status(404).json({ error: 'Usuario no encontrado.' });

      if (neighbor.deactivated) {
        return res.status(403).json({ error: 'Tu cuenta ha sido desactivada temporalmente por la administración.' });
      }

      const expectedChallenge = passkeyLoginChallenges.get(neighbor.id);
      if (!expectedChallenge) return res.status(400).json({ error: 'Challenge de passkey no encontrado o expirado.' });

      const passkeys = Array.isArray(neighbor.passkeys) ? neighbor.passkeys : [];
      const incomingIds = [
        ...credentialIdVariants(credential.id),
        ...credentialIdVariants(credential.rawId)
      ];
      const found = passkeys.find((p) => {
        const storedVariants = credentialIdVariants(p.credentialID);
        return storedVariants.some((sv) => incomingIds.includes(sv));
      });
      if (!found) {
        return res.status(400).json({ error: 'La huella/passkey usada no pertenece a este usuario (id de credencial distinto).' });
      }

      const verification = await verifyAuthenticationResponse({
        response: credential,
        expectedChallenge,
        expectedOrigin: `${req.protocol}://${req.get('host')}`,
        expectedRPID: req.hostname || 'localhost',
        credential: {
          id: found.credentialID,
          publicKey: fromBase64Url(found.publicKey),
          counter: found.counter || 0,
          transports: Array.isArray(found.transports) ? found.transports : []
        }
      });

      if (!verification.verified) {
        return res.status(401).json({ error: 'No se pudo verificar la passkey.' });
      }

      const nextCounter = verification.authenticationInfo?.newCounter || found.counter || 0;
      const updatedPasskeys = passkeys.map((p) => (p.credentialID === found.credentialID ? { ...p, counter: nextCounter } : p));
      dbService.updateNeighbor(neighbor.id, { passkeys: updatedPasskeys });
      passkeyLoginChallenges.delete(neighbor.id);

      const sessionToken = cryptoService.generateToken({
        id: neighbor.id,
        floor: neighbor.floor,
        username: neighbor.username,
        isAdmin: isSystemAdmin
      });

      return res.json({
        message: 'Inicio de sesión con huella/passkey correcto.',
        token: sessionToken,
        user: {
          id: neighbor.id,
          floor: neighbor.floor,
          username: neighbor.username,
          isAdmin: isSystemAdmin
        }
      });
    } catch (err) {
      return res.status(500).json({ error: `Error al validar acceso por huella/passkey: ${err.message}` });
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
      const { token, username, password, passwordConfirm, phone } = req.body;

      if (!token || !username || !password) {
        return res.status(400).json({ error: 'Faltan campos obligatorios para el registro.' });
      }
      
      if (password !== passwordConfirm) {
        return res.status(400).json({ error: 'La contraseña y su confirmación no coinciden.' });
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
      const isSystemAdmin = dbService.isSystemAdminUsername(neighbor.username);
      if (neighbor.username) {
        return res.status(400).json({ error: 'Este piso ya tiene un vecino registrado.' });
      }

      // Generar secreto 2FA
      const { base32, otpauthUrl } = cryptoService.generate2FASecret(neighbor.floor);
      const qrCodeUrl = await cryptoService.generateQRCode(otpauthUrl);

      const passHash = await cryptoService.hashPassword(password);
      
      const normalizedPhone = normalizeSpanishPhone(phone);
      if (phone && !normalizedPhone) {
        return res.status(400).json({ error: 'El teléfono debe ser válido de España (+34XXXXXXXXX).' });
      }

      dbService.updateNeighbor(neighbor.id, {
        username,
        passwordHash: passHash,
        twoFactorSecret: base32,
        twoFactorRegistered: false,
        phone: normalizedPhone || ""
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

      const settings = dbService.getSettings();
      const isSystemAdmin = neighbor.isAdmin === true || 
                            dbService.isSystemAdminUsername(neighbor.username) || 
                            (settings.adminOwnerFloorId && String(neighbor.id) === String(settings.adminOwnerFloorId));

      // Activar formalmente el vecino y marcar el token de invitación como usado
      dbService.updateNeighbor(neighbor.id, { 
        twoFactorRegistered: true,
        isAdmin: isSystemAdmin
      });

      if (isSystemAdmin) {
        dbService.updateSettings({ adminUsername: neighbor.username });
      }

      dbService.useInviteToken(token);

      // Generar sesión definitiva
      const sessionToken = cryptoService.generateToken({
        id: neighbor.id,
        floor: neighbor.floor,
        username: neighbor.username,
        isAdmin: isSystemAdmin
      });

      res.json({
        message: 'Registro completado con éxito.',
        token: sessionToken,
        user: {
          id: neighbor.id,
          floor: neighbor.floor,
          username: neighbor.username,
          isAdmin: isSystemAdmin
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
      const settings = dbService.getSettings();
      const isSystemAdmin = neighbor.isAdmin === true || 
                            dbService.isSystemAdminUsername(neighbor.username) || 
                            (settings.adminOwnerFloorId && String(neighbor.id) === String(settings.adminOwnerFloorId));
      
      // Marcar la cuenta como registrada sin 2FA
      dbService.updateNeighbor(neighbor.id, {
        twoFactorSecret: null,
        twoFactorRegistered: false,
        isAdmin: isSystemAdmin
      });

      if (isSystemAdmin) {
        dbService.updateSettings({ adminUsername: neighbor.username });
      }

      dbService.useInviteToken(token);

      // Generar sesión definitiva
      const sessionToken = cryptoService.generateToken({
        id: neighbor.id,
        floor: neighbor.floor,
        username: neighbor.username,
        isAdmin: isSystemAdmin
      });

      res.json({
        message: 'Registro completado con éxito sin Doble Factor.',
        token: sessionToken,
        user: {
          id: neighbor.id,
          floor: neighbor.floor,
          username: neighbor.username,
          isAdmin: isSystemAdmin
        }
      });
    } catch (err) {
      res.status(500).json({ error: 'Error al completar el registro sin Doble Factor.' });
    }
  }
};

module.exports = authController;
