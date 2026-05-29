const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('./db');
const {
  authenticateToken,
  requireAdmin,
  hashPassword,
  comparePassword,
  generate2FASecret,
  generateQRCode,
  verify2FACode,
  generateJWT
} = require('./auth');
const jwt = require('jsonwebtoken');

// ==========================================
// RUTA PÚBLICA: Estado de la comunidad y turnos
// ==========================================
router.get('/public/status', (req, res) => {
  const neighbors = db.getNeighbors().map(n => ({
    id: n.id,
    floor: n.floor,
    registered: !!n.username,
    twoFactorRegistered: n.twoFactorRegistered,
    phone: n.phone,
    isAdmin: n.isAdmin
  }));

  const state = db.getState();
  const history = db.getHistory();

  res.json({
    communityName: process.env.COMMUNITY_NAME || "VeciTurno",
    neighbors,
    state,
    history
  });
});

// ==========================================
// FLUJO DE REGISTRO CON LINK DE UN SOLO USO
// ==========================================

// Validar link de invitación
router.get('/register/validate', (req, res) => {
  const { token } = req.query;
  if (!token) {
    return res.status(400).json({ error: 'Token de registro faltante.' });
  }

  const invite = db.getInviteToken(token);
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

  const neighbor = db.getNeighborById(invite.floorId);
  res.json({
    floorId: invite.floorId,
    floor: neighbor.floor
  });
});

// Completar registro (Paso 1: crear usuario/contraseña y generar QR de 2FA)
router.post('/register/setup', async (req, res) => {
  const { token, username, password, phone } = req.body;

  if (!token || !username || !password) {
    return res.status(400).json({ error: 'Faltan campos obligatorios para el registro.' });
  }

  const invite = db.getInviteToken(token);
  if (!invite || invite.used) {
    return res.status(400).json({ error: 'Enlace de invitación inválido o ya usado.' });
  }

  const existingNeighbor = db.getNeighborByUsername(username);
  if (existingNeighbor) {
    return res.status(400).json({ error: 'Este nombre de usuario ya está registrado en la comunidad.' });
  }

  const neighbor = db.getNeighborById(invite.floorId);
  if (neighbor.username) {
    return res.status(400).json({ error: 'Esta planta ya tiene un vecino registrado.' });
  }

  // Generar secreto 2FA
  const { base32, otpauthUrl } = generate2FASecret(neighbor.floor);
  const qrCodeUrl = await generateQRCode(otpauthUrl);

  // Almacenar temporalmente los datos en memoria encriptada o pre-guardarlos en el registro del vecino
  // Guardamos los datos provisionales pero SIN marcar twoFactorRegistered como true
  const passHash = await hashPassword(password);
  
  db.updateNeighbor(neighbor.id, {
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
});

// Activar 2FA y completar registro (Paso 2: verificar código y activar)
router.post('/register/verify-2fa', (req, res) => {
  const { token, code } = req.body;

  if (!token || !code) {
    return res.status(400).json({ error: 'Faltan datos para la verificación.' });
  }

  const invite = db.getInviteToken(token);
  if (!invite || invite.used) {
    return res.status(400).json({ error: 'Enlace de invitación inválido o ya usado.' });
  }

  const neighbor = db.getNeighborById(invite.floorId);
  if (!neighbor.twoFactorSecret) {
    return res.status(400).json({ error: 'Debes completar el paso 1 de registro primero.' });
  }

  const isVerified = verify2FACode(neighbor.twoFactorSecret, code);
  if (!isVerified) {
    return res.status(400).json({ error: 'Código 2FA incorrecto. Inténtalo de nuevo.' });
  }

  // Activar formalmente el vecino y marcar el token de invitación como usado
  db.updateNeighbor(neighbor.id, { twoFactorRegistered: true });
  db.useInviteToken(token);

  // Generar sesión
  const sessionToken = generateJWT({
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
});


// ==========================================
// INICIO DE SESIÓN CON DOS PASOS (PASSWORD + 2FA)
// ==========================================

// Login Paso 1: Validar usuario y contraseña
router.post('/auth/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Por favor, introduce usuario y contraseña.' });
  }

  const neighbor = db.getNeighborByUsername(username);
  if (!neighbor) {
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
  }

  const isPassValid = await comparePassword(password, neighbor.passwordHash);
  if (!isPassValid) {
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
  }

  // Si el doble factor no está registrado en la cuenta, inicia sesión directamente
  if (!neighbor.twoFactorRegistered) {
    const sessionToken = generateJWT({
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
    process.env.JWT_SECRET || 'super_secret_veciturno_token_2026_safe_key_9988',
    { expiresIn: '5m' }
  );

  res.json({
    message: 'Credenciales correctas. Se requiere código de doble factor.',
    tempToken,
    requires2fa: true
  });
});

// Login Paso 2: Verificar OTP
router.post('/auth/login/verify', (req, res) => {
  const { tempToken, code } = req.body;

  if (!tempToken || !code) {
    return res.status(400).json({ error: 'Faltan datos para el inicio de sesión.' });
  }

  try {
    const payload = jwt.verify(
      tempToken,
      process.env.JWT_SECRET || 'super_secret_veciturno_token_2026_safe_key_9988'
    );

    if (payload.step !== '2fa_pending') {
      return res.status(400).json({ error: 'Petición inválida.' });
    }

    const neighbor = db.getNeighborById(payload.id);
    const isVerified = verify2FACode(neighbor.twoFactorSecret, code);

    if (!isVerified) {
      return res.status(401).json({ error: 'Código 2FA incorrecto o expirado.' });
    }

    // Login definitivo
    const sessionToken = generateJWT({
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
    return res.status(401).json({ error: 'Sesión temporal de login expirada. Vuelve a intentar.' });
  }
});


// ==========================================
// OPERACIONES DE TURNOS (PROTEGIDAS)
// ==========================================

// Rotar turno de limpieza/aviso
router.post('/turns/rotate', authenticateToken, (req, res) => {
  const result = db.rotateTurn(req.user.username);
  
  res.json({
    message: 'Turno rotado con éxito.',
    state: result.state,
    history: result.history
  });
});


// ==========================================
// CONFIGURACIÓN DE VECINO (PROTEGIDA)
// ==========================================

// Actualizar teléfono u otra info del vecino
router.post('/neighbors/update', authenticateToken, async (req, res) => {
  const { phone, password } = req.body;
  const updates = {};

  if (phone !== undefined) {
    updates.phone = phone;
  }

  if (password) {
    updates.passwordHash = await hashPassword(password);
  }

  const updatedNeighbor = db.updateNeighbor(req.user.id, updates);
  
  res.json({
    message: 'Datos actualizados correctamente.',
    phone: updatedNeighbor.phone
  });
});


// ==========================================
// OPERACIONES DE ADMINISTRADOR (PROTEGIDAS)
// ==========================================

// Generar enlace de registro de un solo uso para una planta específica
router.post('/admin/generate-invite', authenticateToken, requireAdmin, (req, res) => {
  const { floorId } = req.body;

  if (!floorId) {
    return res.status(400).json({ error: 'Debes especificar la planta.' });
  }

  const neighbor = db.getNeighborById(floorId);
  if (!neighbor) {
    return res.status(404).json({ error: 'La planta especificada no existe.' });
  }

  // Generar token único (UUID)
  const token = uuidv4();
  const invite = db.createInviteToken(floorId, token);

  res.json({
    message: `Enlace de registro generado para la ${neighbor.floor}.`,
    inviteUrl: `${req.protocol}://${req.get('host')}/#register?token=${token}`,
    token,
    floor: neighbor.floor
  });
});

// Ver todos los enlaces generados e históricos
router.get('/admin/invites', authenticateToken, requireAdmin, (req, res) => {
  const invites = db.getInviteTokens().map(t => {
    const neighbor = db.getNeighborById(t.floorId);
    return {
      token: t.token,
      floor: neighbor.floor,
      used: t.used,
      createdAt: t.createdAt,
      inviteUrl: `${req.protocol}://${req.get('host')}/#register?token=${t.token}`
    };
  });
  
  res.json({ invites });
});

// Registrar vecino directamente por el Administrador
router.post('/admin/create-neighbor', authenticateToken, requireAdmin, async (req, res) => {
  const { floorId, username, password, phone } = req.body;

  if (!floorId || !username || !password) {
    return res.status(400).json({ error: 'Faltan campos obligatorios (planta, usuario, contraseña).' });
  }

  const neighbor = db.getNeighborById(floorId);
  if (!neighbor) {
    return res.status(404).json({ error: 'La planta especificada no existe.' });
  }

  // Si ya existe un vecino, permitimos que el administrador lo pise o lo actualice (muy útil)
  const existingNeighbor = db.getNeighborByUsername(username);
  if (existingNeighbor && existingNeighbor.id !== floorId) {
    return res.status(400).json({ error: 'Este nombre de usuario ya está registrado por otro vecino.' });
  }

  const passHash = await hashPassword(password);
  
  db.updateNeighbor(floorId, {
    username,
    passwordHash: passHash,
    phone: phone || "",
    twoFactorSecret: null,
    twoFactorRegistered: false
  });

  res.json({
    message: `Vecino de la ${neighbor.floor} registrado correctamente con usuario @${username}.`
  });
});

// Generar secreto y código QR para activar 2FA bajo demanda por el propio vecino
router.post('/neighbors/setup-2fa', authenticateToken, async (req, res) => {
  const neighbor = db.getNeighborById(req.user.id);
  
  const { base32, otpauthUrl } = generate2FASecret(neighbor.floor);
  const qrCodeUrl = await generateQRCode(otpauthUrl);

  // Guardar el secreto temporalmente pero SIN activar twoFactorRegistered
  db.updateNeighbor(neighbor.id, {
    twoFactorSecret: base32
  });

  res.json({
    message: 'Secreto generado. Confirma con el código OTP de tu app móvil.',
    qrCodeUrl,
    secret: base32
  });
});

// Confirmar y activar 2FA bajo demanda por el propio vecino
router.post('/neighbors/activate-2fa', authenticateToken, (req, res) => {
  const { code } = req.body;

  if (!code) {
    return res.status(400).json({ error: 'Por favor, proporciona el código de verificación.' });
  }

  const neighbor = db.getNeighborById(req.user.id);
  if (!neighbor.twoFactorSecret) {
    return res.status(400).json({ error: 'Primero debes solicitar el secreto 2FA.' });
  }

  const isVerified = verify2FACode(neighbor.twoFactorSecret, code);
  if (!isVerified) {
    return res.status(400).json({ error: 'Código 2FA incorrecto o expirado.' });
  }

  // Guardar activación definitiva
  db.updateNeighbor(neighbor.id, {
    twoFactorRegistered: true
  });

  res.json({
    message: 'Doble Factor de Autenticación (2FA) activado con éxito en tu cuenta.'
  });
});

// Desactivar 2FA bajo demanda por el propio vecino
router.post('/neighbors/deactivate-2fa', authenticateToken, (req, res) => {
  db.updateNeighbor(req.user.id, {
    twoFactorSecret: null,
    twoFactorRegistered: false
  });

  res.json({
    message: 'Doble Factor de Autenticación (2FA) desactivado de tu cuenta.'
  });
});

module.exports = router;
