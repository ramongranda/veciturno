const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const speakeasy = require('speakeasy');
const qrcode = require('qrcode');
const config = require('../config/env');

const cryptoService = {
  // Hashing de contraseñas
  hashPassword: async (password) => {
    const salt = await bcrypt.genSalt(10);
    return bcrypt.hash(password, salt);
  },

  comparePassword: async (password, hash) => {
    return bcrypt.compare(password, hash);
  },

  // JWT Tokens
  generateToken: (payload, expiresIn = '7d') => {
    return jwt.sign(payload, config.JWT_SECRET, { expiresIn });
  },

  verifyToken: (token) => {
    return jwt.verify(token, config.JWT_SECRET);
  },

  // Doble Factor TOTP
  generate2FASecret: (floorName) => {
    const secret = speakeasy.generateSecret({
      name: `VeciTurno: ${floorName}`,
      issuer: 'VeciTurno'
    });
    return {
      otpauthUrl: secret.otpauth_url,
      base32: secret.base32
    };
  },

  generateQRCode: (otpauthUrl) => {
    return new Promise((resolve, reject) => {
      qrcode.toDataURL(otpauthUrl, (err, dataUrl) => {
        if (err) reject(err);
        else resolve(dataUrl);
      });
    });
  },

  verify2FACode: (secretBase32, token) => {
    return speakeasy.totp.verify({
      secret: secretBase32,
      encoding: 'base32',
      token: token,
      window: 2 // Ventana de desfase
    });
  }
};

module.exports = cryptoService;
