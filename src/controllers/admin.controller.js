const { v4: uuidv4 } = require('uuid');
const dbService = require('../services/db.service');
const cryptoService = require('../services/crypto.service');

const adminController = {
  // Registrar un vecino directamente por el administrador (opción sin link)
  createNeighbor: async (req, res) => {
    try {
      const { floorId, username, password, phone } = req.body;

      if (!floorId || !username || !password) {
        return res.status(400).json({ error: 'Faltan campos obligatorios (planta, usuario, contraseña).' });
      }

      const neighbor = dbService.getNeighborById(floorId);
      if (!neighbor) {
        return res.status(404).json({ error: 'La planta especificada no existe.' });
      }

      const existingNeighbor = dbService.getNeighborByUsername(username);
      if (existingNeighbor && existingNeighbor.id !== floorId) {
        return res.status(400).json({ error: 'Este nombre de usuario ya está registrado por otro vecino.' });
      }

      const passHash = await cryptoService.hashPassword(password);
      
      dbService.updateNeighbor(floorId, {
        username,
        passwordHash: passHash,
        phone: phone || "",
        twoFactorSecret: null,
        twoFactorRegistered: false
      });

      res.json({
        message: `Vecino de la ${neighbor.floor} registrado correctamente con usuario @${username}.`
      });
    } catch (err) {
      res.status(500).json({ error: 'Error interno en la creación directa del vecino.' });
    }
  },

  // Generar un link de invitación
  generateInvite: (req, res) => {
    try {
      const { floorId } = req.body;

      if (!floorId) {
        return res.status(400).json({ error: 'Debes especificar la planta.' });
      }

      const neighbor = dbService.getNeighborById(floorId);
      if (!neighbor) {
        return res.status(404).json({ error: 'La planta especificada no existe.' });
      }

      const token = uuidv4();
      dbService.createInviteToken(floorId, token);

      res.json({
        message: `Enlace de registro generado para la ${neighbor.floor}.`,
        inviteUrl: `${req.protocol}://${req.get('host')}/#register?token=${token}`,
        token,
        floor: neighbor.floor
      });
    } catch (err) {
      res.status(500).json({ error: 'Error al generar enlace de invitación.' });
    }
  },

  // Obtener lista de invitaciones
  getInvites: (req, res) => {
    try {
      const invites = dbService.getInviteTokens().map(t => {
        const neighbor = dbService.getNeighborById(t.floorId);
        return {
          token: t.token,
          floor: neighbor.floor,
          used: t.used,
          createdAt: t.createdAt,
          inviteUrl: `${req.protocol}://${req.get('host')}/#register?token=${t.token}`
        };
      });
      
      res.json({ invites });
    } catch (err) {
      res.status(500).json({ error: 'Error al listar las invitaciones de la comunidad.' });
    }
  }
};

module.exports = adminController;
