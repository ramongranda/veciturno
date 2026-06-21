const dbService = require('../services/db.service');
const config = require('../config/env');

const turnController = {
  // Obtener estado público del dashboard (sin requerir auth)
  getStatus: (req, res) => {
    try {
      const neighbors = dbService.getNeighbors().map(n => ({
        id: n.id,
        floor: n.floor,
        portal: n.portal || null,
        floorNumber: n.floorNumber || null,
        door: n.door || null,
        kind: n.kind || 'vivienda',
        exemptFromCleaning: !!n.exemptFromCleaning,
        monthlyFee: dbService.getMonthlyFeeForNeighbor(n.id),
        monthlyFeeOverride: Number.isFinite(Number(n.monthlyFeeOverride)) ? Number(n.monthlyFeeOverride) : null,
        passkeyRegistered: Array.isArray(n.passkeys) && n.passkeys.length > 0,
        passkeyCount: Array.isArray(n.passkeys) ? n.passkeys.length : 0,
        registered: !!n.username,
        twoFactorRegistered: n.twoFactorRegistered,
        phone: n.phone,
        isAdmin: n.isAdmin
      }));
      const settings = dbService.getSettings();
      const ownerFloorId = settings.adminOwnerFloorId || '';
      if (ownerFloorId) {
        neighbors.forEach((n) => {
          n.isAdmin = n.id === ownerFloorId;
        });
      }

      const state = dbService.getState();
      const history = dbService.getHistory();

      res.json({
        communityName: settings.communityName || config.COMMUNITY_NAME,
        notificationsGroupUrl: config.NOTIFICATIONS_GROUP_URL,
        neighbors,
        state,
        history,
        announcements: dbService.getAnnouncements(50)
      });
    } catch (err) {
      res.status(500).json({ error: 'Error al obtener el feed público de la comunidad.' });
    }
  },
  verifyCSV: (req, res) => {
    try {
      const { csv } = req.query;
      if (!csv) {
        return res.status(400).json({ error: 'Falta el código CSV a verificar.' });
      }

      const cert = dbService.getGeneratedCertificate(csv.trim().toUpperCase());
      if (!cert) {
        return res.status(404).json({ error: 'El código de verificación CSV no es válido o no corresponde a ningún certificado oficial emitido.' });
      }

      return res.json({
        valid: true,
        communityName: dbService.getSettings().communityName || config.COMMUNITY_NAME,
        csv: cert.csv,
        floorName: cert.floorName,
        username: cert.username,
        year: cert.year,
        quarter: cert.quarter,
        totalAmount: cert.totalAmount,
        emittedAt: cert.emittedAt
      });
    } catch (err) {
      return res.status(500).json({ error: 'Error interno al validar el certificado.' });
    }
  }
};

module.exports = turnController;
