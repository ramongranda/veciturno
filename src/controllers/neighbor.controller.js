const dbService = require('../services/db.service');
const cryptoService = require('../services/crypto.service');

const neighborController = {
  // Actualizar perfil (teléfono o contraseña)
  updateProfile: async (req, res) => {
    try {
      const { phone, password } = req.body;
      const updates = {};

      if (phone !== undefined) {
        updates.phone = phone;
      }

      if (password) {
        updates.passwordHash = await cryptoService.hashPassword(password);
      }

      const updatedNeighbor = dbService.updateNeighbor(req.user.id, updates);
      
      res.json({
        message: 'Datos de perfil actualizados correctamente.',
        phone: updatedNeighbor.phone
      });
    } catch (err) {
      res.status(500).json({ error: 'Error al actualizar el perfil del vecino.' });
    }
  },

  // Iniciar configuración de 2FA bajo demanda (generar QR)
  setup2FA: async (req, res) => {
    try {
      const neighbor = dbService.getNeighborById(req.user.id);
      
      const { base32, otpauthUrl } = cryptoService.generate2FASecret(neighbor.floor);
      const qrCodeUrl = await cryptoService.generateQRCode(otpauthUrl);

      dbService.updateNeighbor(neighbor.id, {
        twoFactorSecret: base32
      });

      res.json({
        message: 'Secreto generado. Confirma con el código OTP de tu app móvil.',
        qrCodeUrl,
        secret: base32
      });
    } catch (err) {
      res.status(500).json({ error: 'Error al generar secreto 2FA en caliente.' });
    }
  },

  // Confirmar y activar 2FA
  activate2FA: (req, res) => {
    try {
      const { code } = req.body;

      if (!code) {
        return res.status(400).json({ error: 'Por favor, proporciona el código de verificación.' });
      }

      const neighbor = dbService.getNeighborById(req.user.id);
      if (!neighbor.twoFactorSecret) {
        return res.status(400).json({ error: 'Primero debes solicitar el secreto 2FA.' });
      }

      const isVerified = cryptoService.verify2FACode(neighbor.twoFactorSecret, code);
      if (!isVerified) {
        return res.status(400).json({ error: 'Código 2FA incorrecto o expirado.' });
      }

      dbService.updateNeighbor(neighbor.id, {
        twoFactorRegistered: true
      });

      res.json({
        message: 'Doble Factor de Autenticación (2FA) activado con éxito en tu cuenta.'
      });
    } catch (err) {
      res.status(500).json({ error: 'Error al confirmar la activación del 2FA.' });
    }
  },

  // Desactivar 2FA
  deactivate2FA: (req, res) => {
    try {
      dbService.updateNeighbor(req.user.id, {
        twoFactorSecret: null,
        twoFactorRegistered: false
      });

      res.json({
        message: 'Doble Factor de Autenticación (2FA) desactivado de tu cuenta.'
      });
    } catch (err) {
      res.status(500).json({ error: 'Error al desactivar el 2FA.' });
    }
  }
};

module.exports = neighborController;
