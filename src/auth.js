const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const speakeasy = require('speakeasy');
const qrcode = require('qrcode');

const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_veciturno_token_2026_safe_key_9988';

// Middleware para verificar JWT
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Acceso no autorizado. Token faltante.' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Sesión expirada o token no válido.' });
    }
    req.user = user;
    next();
  });
}

// Middleware para verificar si el usuario es administrador
function requireAdmin(req, res, next) {
  if (!req.user || !req.user.isAdmin) {
    return res.status(403).json({ error: 'Acceso restringido. Se requieren permisos de administrador.' });
  }
  next();
}

// Hashing de contraseñas
async function hashPassword(password) {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(password, salt);
}

async function comparePassword(password, hash) {
  return bcrypt.compare(password, hash);
}

// Generación de secreto 2FA TOTP
function generate2FASecret(floorName) {
  const secret = speakeasy.generateSecret({
    name: `VeciTurno: ${floorName}`,
    issuer: 'VeciTurno'
  });
  return {
    otpauthUrl: secret.otpauth_url,
    base32: secret.base32
  };
}

// Generar código QR en Base64 a partir de una URL otpauth
function generateQRCode(otpauthUrl) {
  return new Promise((resolve, reject) => {
    qrcode.toDataURL(otpauthUrl, (err, dataUrl) => {
      if (err) reject(err);
      else resolve(dataUrl);
    });
  });
}

// Verificar código 2FA
function verify2FACode(secretBase32, token) {
  return speakeasy.totp.verify({
    secret: secretBase32,
    encoding: 'base32',
    token: token,
    window: 2 // Ventana de tolerancia para desfase de reloj (2 * 30 segundos)
  });
}

// Crear token JWT
function generateJWT(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
}

module.exports = {
  authenticateToken,
  requireAdmin,
  hashPassword,
  comparePassword,
  generate2FASecret,
  generateQRCode,
  verify2FACode,
  generateJWT
};
