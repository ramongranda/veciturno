const dbService = require('../services/db.service');
const config = require('../config/env');

const turnController = {
  // Obtener estado público del dashboard (sin requerir auth)
  getStatus: (req, res) => {
    try {
      const neighbors = dbService.getNeighbors().map(n => ({
        id: n.id,
        floor: n.floor,
        registered: !!n.username,
        twoFactorRegistered: n.twoFactorRegistered,
        phone: n.phone,
        isAdmin: n.isAdmin
      }));

      const state = dbService.getState();
      const history = dbService.getHistory();

      res.json({
        communityName: config.COMMUNITY_NAME,
        neighbors,
        state,
        history
      });
    } catch (err) {
      res.status(500).json({ error: 'Error al obtener el feed público de la comunidad.' });
    }
  }
};

module.exports = turnController;
