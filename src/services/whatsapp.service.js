const config = require('../config/env');

const whatsappService = {
  /**
   * Envía una notificación de WhatsApp a través del sistema usando CallMeBot API
   * @param {string} message Mensaje a enviar
   * @returns {Promise<boolean>} Retorna si la petición fue exitosa
   */
  sendMessage: async (message) => {
    const phone = config.SYSTEM_WHATSAPP_PHONE;
    const apiKey = config.SYSTEM_WHATSAPP_API_KEY;

    if (!phone || !apiKey) {
      console.warn('⚠️ WhatsApp System: SYSTEM_WHATSAPP_PHONE o SYSTEM_WHATSAPP_API_KEY no están configuradas en el archivo .env. Notificación omitida.');
      return false;
    }

    try {
      // Formatear el teléfono eliminando espacios y símbolos +
      const cleanPhone = phone.replace(/[\s+]/g, '');
      const encodedMessage = encodeURIComponent(message);
      const url = `https://api.callmebot.com/whatsapp.php?phone=${cleanPhone}&text=${encodedMessage}&apikey=${apiKey}`;

      console.log(`[WhatsApp System] Enviando mensaje de WhatsApp a ${cleanPhone}...`);
      
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      console.log('✅ [WhatsApp System] Notificación enviada con éxito.');
      return true;
    } catch (err) {
      console.error('❌ [WhatsApp System] Error al enviar notificación:', err.message);
      return false;
    }
  },

  /**
   * Envía una notificación del sistema cuando cambia el turno
   * @param {string} nextFloorName Planta a la que le toca
   * @param {string} formattedMonth Mes del turno
   */
  sendRotationNotification: async (nextFloorName, formattedMonth) => {
    const message = `🏡 *VeciTurno (Notificación General)*:\n\n¡Atención comunidad! Ha comenzado el turno de limpieza de *${formattedMonth}*.\n\nLe corresponde limpiar de forma automática a: *${nextFloorName}*.\n\n¡Gracias por colaborar con la limpieza y mantenimiento del portal! ✨`;
    return whatsappService.sendMessage(message);
  }
};

module.exports = whatsappService;
