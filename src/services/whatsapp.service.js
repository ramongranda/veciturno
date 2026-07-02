const { Client, LocalAuth } = require('whatsapp-web.js');
const path = require('path');
const fs = require('fs');
const qrcode = require('qrcode');

// Ruta donde se guardarán las credenciales de la sesión local
const authPath = path.join(__dirname, '../../db/.wwebjs_auth');

let client = null;
let connectionStatus = 'disconnected'; // 'disconnected', 'connecting', 'qr', 'connected'
let lastQR = '';
let connectedPhone = '';
let connectTimeout = null;
let lastSendError = '';
let lastCommandError = '';

function normalizeAnyPhone(phone) {
  let clean = String(phone || '').replace(/\D/g, '');
  if (clean.startsWith('00')) clean = clean.slice(2);
  if (clean.startsWith('34') && clean.length > 9) clean = clean.slice(2);
  if (clean.length === 9) clean = `34${clean}`;
  return clean;
}

const whatsappService = {
  /**
   * Inicializa el cliente de WhatsApp Web en segundo plano
   */
  initialize: () => {
    if (client) return;

    connectionStatus = 'connecting';
    console.log('[WhatsApp Autohospedado] Inicializando cliente...');

    // Autocura: elimina locks de Chromium (SingletonLock/Cookie/Socket) que un
    // pod/proceso anterior pudo dejar tras un cierre no limpio. Con almacenamiento
    // persistente, un lock zombi impide lanzar el navegador ("profile appears to be
    // in use by another Chromium process") y deja el bot muerto hasta borrarlo.
    whatsappService.clearBrowserLocks();

    if (connectTimeout) clearTimeout(connectTimeout);
    connectTimeout = setTimeout(() => {
      if (connectionStatus === 'connecting') {
        console.warn('[WhatsApp Autohospedado] Tiempo de espera agotado en estado connecting. Reiniciando cliente...');
        whatsappService.restart().catch((err) => {
          console.error('[WhatsApp Autohospedado] Error al reiniciar tras timeout:', err.message);
        });
      }
    }, 45000);

    client = new Client({
      authStrategy: new LocalAuth({
        dataPath: authPath
      }),
      puppeteer: {
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu',
          '--disable-features=site-per-process'
        ]
      }
    });

    client.on('qr', async (qr) => {
      connectionStatus = 'qr';
      try {
        // Convertir el string del QR a un DataURL Base64
        lastQR = await qrcode.toDataURL(qr);
        console.log('[WhatsApp Autohospedado] Código QR generado. Listo para escanear en la consola.');
      } catch (err) {
        console.error('[WhatsApp Autohospedado] Error al convertir QR a imagen:', err.message);
      }
    });

    client.on('ready', () => {
      connectionStatus = 'connected';
      lastQR = '';
      lastSendError = '';
      if (connectTimeout) {
        clearTimeout(connectTimeout);
        connectTimeout = null;
      }
      
      // Obtener el número de teléfono del cliente conectado
      const info = client.info;
      connectedPhone = info && info.wid ? info.wid.user : '';
      
      console.log(`====================================================`);
      console.log(` 📱 [WhatsApp Autohospedado] ¡CLIENTE LISTO Y VINCULADO!`);
      console.log(` Número vinculado: +${connectedPhone}`);
      console.log(`====================================================`);
      whatsappService.runDailyReminders().catch(() => {});
    });

    client.on('authenticated', () => {
      console.log('[WhatsApp Autohospedado] Cliente autenticado con éxito.');
    });

    client.on('auth_failure', (msg) => {
      console.error('[WhatsApp Autohospedado] Fallo de autenticación:', msg);
      connectionStatus = 'disconnected';
      lastQR = '';
      connectedPhone = '';
      lastSendError = `Fallo de autenticación: ${msg}`;
      if (connectTimeout) {
        clearTimeout(connectTimeout);
        connectTimeout = null;
      }
    });

    client.on('disconnected', (reason) => {
      console.log('[WhatsApp Autohospedado] Cliente desconectado. Razón:', reason);
      connectionStatus = 'disconnected';
      lastQR = '';
      connectedPhone = '';
      lastSendError = `Cliente desconectado: ${reason}`;
      if (connectTimeout) {
        clearTimeout(connectTimeout);
        connectTimeout = null;
      }

      // Solo borrar credenciales si el MÓVIL desvinculó el dispositivo (LOGOUT).
      // En cortes de red/navegación conservamos la sesión y reconectamos sin QR,
      // de forma que la vinculación de WhatsApp quede fija entre reinicios.
      if (String(reason).toUpperCase() === 'LOGOUT') {
        try {
          whatsappService.cleanSession();
        } catch (err) {
          console.error('Error al limpiar sesión:', err.message);
        }
        client = null;
        setTimeout(() => whatsappService.initialize(), 3000);
      } else {
        try {
          if (client) client.destroy().catch(() => {});
        } catch (_) {}
        client = null;
        setTimeout(() => whatsappService.initialize(), 5000);
      }
    });

    client.on('message', async (msg) => {
      try {
        await whatsappService.handleIncomingMessage(msg);
      } catch (err) {
        lastCommandError = err.message || 'Error procesando mensaje entrante';
      }
    });

    client.initialize().catch(err => {
      console.error('[WhatsApp Autohospedado] Error crítico al inicializar client:', err.message);
      connectionStatus = 'disconnected';
      lastSendError = `Error de inicialización: ${err.message}`;
      if (connectTimeout) {
        clearTimeout(connectTimeout);
        connectTimeout = null;
      }
    });
  },

  /**
   * Obtiene el estado actual de la pasarela
   */
  getStatus: () => {
    return {
      status: connectionStatus,
      qrCodeUrl: lastQR,
      phoneConnected: connectedPhone ? `+${connectedPhone}` : '',
      lastError: lastSendError
    };
  },

  /**
   * Resuelve una plantilla de WhatsApp dinámica utilizando placeholders
   */
  resolveTemplate: (templateKey, placeholders = {}) => {
    const dbService = require('./db.service');
    const settings = dbService.getSettings();
    const templates = settings.whatsappTemplates || {};
    
    let templateStr = templates[templateKey];
    if (typeof templateStr !== 'string') {
      const defaults = {
        turn_start_general: '🏡 *VeciTurno (Notificación General)*:\n\n¡Atención comunidad! Ha comenzado el turno de limpieza de *{mes}*.\n\nLe corresponde limpiar de forma automática a: *{vecino}*.\n\n¡Gracias por colaborar con la limpieza y mantenimiento del portal! ✨',
        turn_start_individual: '🏡 *VeciTurno (Aviso Forzado por Admin)*:\n\nSe envía recordatorio de inicio de turno de limpieza de *{mes}*.\n\nTurno actual: *{vecino}*.\n\nGracias por colaborar.',
        turn_reminder_general: '🧹 *Recordatorio de turno de limpieza*\n\nEl turno de *{vecino}* comienza *{tiempo}*.',
        turn_reminder_individual: '🧹 *Recordatorio de turno de limpieza*\n\nTu turno ({vecino}) comienza *{tiempo}*.\nPor favor confirma respondiendo: *OK TURNO*',
        monthly_summary: '📊 *Resumen mensual VeciTurno*\n\nTurno actual: *{vecino}*\nMes: *{mes}*\n\nÚltimos turnos:\n{historial}\n\nGracias por colaborar.',
        finance_summary: '💶 *Estado de cuotas y gastos ({mes})*\n\nIngresos por cuotas: {ingresos} €\nGasto seguro: {gasto_seguro} €\nGasto luz: {gasto_luz} €\nBalance: {balance} €\n{notas}',
        invite_neighbor: '🏡 *VeciTurno (Invitación de Registro)*:\n\n¡Hola! Te invitamos a registrarte en el sistema de turnos de limpieza de *{comunidad}*.\n\nPara configurar tu usuario y contraseña, accede al siguiente enlace:\n👉 {enlace}\n\n¡Gracias por colaborar! ✨'
      };
      templateStr = defaults[templateKey] || '';
    }

    const allPlaceholders = {
      comunidad: settings.communityName || 'Mi Comunidad',
      ...placeholders
    };

    let resolved = templateStr;
    for (const [key, val] of Object.entries(allPlaceholders)) {
      const regex = new RegExp(`{${key}}`, 'g');
      resolved = resolved.replace(regex, val !== undefined && val !== null ? String(val) : '');
    }

    return resolved;
  },

  /**
   * Envía un mensaje de WhatsApp a un número
   * @param {string} phone Teléfono del destinatario
   * @param {string} text Texto del mensaje
   */
  sendMessage: async (phone, text) => {
    if (connectionStatus !== 'connected' || !client) {
      console.warn('[WhatsApp Autohospedado] El cliente no está vinculado. No se pudo enviar la notificación.');
      lastSendError = 'Cliente no vinculado o no listo.';
      return false;
    }

    try {
      // Limpiar el teléfono dejando solo dígitos
      let cleanPhone = String(phone || '').replace(/\D/g, '');
      if (cleanPhone.startsWith('00')) {
        cleanPhone = cleanPhone.slice(2);
      }
      if (cleanPhone.length < 8) {
        lastSendError = `Número inválido tras limpiar formato: "${phone}"`;
        return false;
      }
      
      // Asegurarse de que termine con @c.us (formato de ID de chat individual de WhatsApp)
      let chatId = cleanPhone;
      if (!chatId.endsWith('@c.us')) {
        chatId = `${chatId}@c.us`;
      }

      const numberId = await client.getNumberId(cleanPhone);
      if (!numberId || !numberId._serialized) {
        lastSendError = `El número ${cleanPhone} no está registrado en WhatsApp.`;
        return false;
      }

      console.log(`[WhatsApp Autohospedado] Enviando mensaje a ${numberId._serialized}...`);
      await client.sendMessage(numberId._serialized || chatId, text);
      console.log(`✅ [WhatsApp Autohospedado] Mensaje enviado correctamente.`);
      lastSendError = '';
      return true;
    } catch (err) {
      console.error(`❌ [WhatsApp Autohospedado] Error al enviar mensaje:`, err.message);
      lastSendError = err.message || 'Error desconocido al enviar mensaje.';
      return false;
    }
  },

  listGroups: async () => {
    if (connectionStatus !== 'connected' || !client) {
      return [];
    }
    try {
      const chats = await client.getChats();
      return chats
        .filter(c => c.isGroup)
        .map(c => ({
          id: c.id?._serialized || '',
          name: c.name || 'Grupo sin nombre'
        }))
        .filter(g => g.id.endsWith('@g.us'));
    } catch (err) {
      lastSendError = err.message || 'No se pudieron listar los grupos.';
      return [];
    }
  },

  sendMessageToGroup: async (groupId, text) => {
    if (connectionStatus !== 'connected' || !client) {
      lastSendError = 'Cliente no vinculado o no listo.';
      return false;
    }
    if (!groupId || !groupId.endsWith('@g.us')) {
      lastSendError = 'ID de grupo no válido.';
      return false;
    }
    try {
      await client.sendMessage(groupId, text);
      lastSendError = '';
      return true;
    } catch (err) {
      lastSendError = err.message || 'Error al enviar al grupo.';
      return false;
    }
  },

  sendSegmentedMessage: async ({ text, filter = {} }) => {
    const dbService = require('./db.service');
    const neighbors = dbService.getNeighbors();
    const logs = [];
    const targets = neighbors.filter((n) => {
      if (!n.phone) return false;
      if (filter.portal && String(n.portal || '').toUpperCase() !== String(filter.portal).toUpperCase()) return false;
      if (filter.kind && (n.kind || 'vivienda') !== filter.kind) return false;
      if (filter.adminOnly === true && !n.isAdmin) return false;
      return true;
    });

    for (const n of targets) {
      const ok = await whatsappService.sendMessage(n.phone, text);
      logs.push({
        notificationType: 'segmented_broadcast',
        mode: 'manual',
        channel: 'individual',
        target: n.phone,
        status: ok ? 'sent' : 'failed',
        error: ok ? '' : lastSendError,
        message: text,
        metadata: { floorId: n.id, floor: n.floor, filter }
      });
    }
    return { ok: logs.some(l => l.status === 'sent'), total: targets.length, logs };
  },

  sendMonthlySummaryToGroup: async () => {
    const dbService = require('./db.service');
    const state = dbService.getState();
    const neighbors = dbService.getNeighbors();
    const history = dbService.getHistory().slice(0, 12);
    const settings = dbService.getSettings();
    const current = neighbors.find(n => n.id === state.currentTurnFloorId);
    const lines = history.slice(0, 5).map((h, idx) => {
      const neigh = neighbors.find(n => n.id === h.floorId);
      return `${idx + 1}. ${neigh ? neigh.floor : 'Desconocido'} - ${new Date(h.completedAt).toLocaleDateString('es-ES')}`;
    });

    const msg = whatsappService.resolveTemplate('monthly_summary', {
      vecino: current ? current.floor : 'N/D',
      mes: new Date(state.currentMonth).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' }),
      historial: lines.join('\n') || '- Sin historial'
    });

    const groupId = settings.whatsappGroupId || '';
    const ok = groupId ? await whatsappService.sendMessageToGroup(groupId, msg) : false;
    return {
      ok,
      log: {
        notificationType: 'monthly_summary',
        mode: 'manual',
        channel: 'group',
        target: groupId || '(sin grupo)',
        status: ok ? 'sent' : 'failed',
        error: ok ? '' : (groupId ? lastSendError : 'Sin grupo configurado'),
        message: msg
      }
    };
  },

  sendFinanceSummary: async ({ month, targetType = 'group', floorId = '' }) => {
    const dbService = require('./db.service');
    const records = dbService.getFinanceRecords();
    const settings = dbService.getSettings();
    const rec = records.find(r => r.month === month) || records[0];
    if (!rec) {
      return { ok: false, error: 'No hay datos financieros cargados.' };
    }
    const balance = Number(rec.incomeFees || 0) - Number(rec.expenseInsurance || 0) - Number(rec.expenseElectricity || 0);

    const message = whatsappService.resolveTemplate('finance_summary', {
      mes: rec.month,
      ingresos: Number(rec.incomeFees || 0).toFixed(2),
      gasto_seguro: Number(rec.expenseInsurance || 0).toFixed(2),
      gasto_luz: Number(rec.expenseElectricity || 0).toFixed(2),
      balance: balance.toFixed(2),
      notas: rec.notes ? `\nNotas: ${rec.notes}` : ''
    });

    if (targetType === 'group') {
      const ok = await whatsappService.sendMessageToGroup(settings.whatsappGroupId || '', message);
      return { ok, log: { notificationType: 'finance_summary', mode: 'manual', channel: 'group', target: settings.whatsappGroupId || '', status: ok ? 'sent' : 'failed', error: ok ? '' : lastSendError, message } };
    }
    if (targetType === 'individual' && floorId) {
      const n = dbService.getNeighborById(floorId);
      if (!n || !n.phone) return { ok: false, error: 'Vecino sin teléfono' };
      const ok = await whatsappService.sendMessage(n.phone, message);
      return { ok, log: { notificationType: 'finance_summary', mode: 'manual', channel: 'individual', target: n.phone, status: ok ? 'sent' : 'failed', error: ok ? '' : lastSendError, message } };
    }
    return { ok: false, error: 'Destino no válido.' };
  },

  runDailyReminders: async () => {
    const dbService = require('./db.service');
    const settings = dbService.getSettings();
    if (!settings.remindersEnabled) return;
    const today = new Date().toISOString().slice(0, 10);
    if (settings.lastReminderRunDate === today) return;

    const state = dbService.getState();
    const neighbors = dbService.getNeighbors();
    const current = neighbors.find(n => n.id === state.currentTurnFloorId);
    if (!current) return;

    const monthDate = new Date(state.currentMonth);
    const startDate = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
    const now = new Date();
    const diffDays = Math.floor((startDate - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
    const offsets = Array.isArray(settings.reminderOffsetsDays) ? settings.reminderOffsetsDays : [3, 1, 0];
    if (!offsets.includes(diffDays)) {
      dbService.updateSettings({ lastReminderRunDate: today });
      return;
    }

    const label = diffDays === 0 ? 'hoy' : `en ${diffDays} día(s)`;
    const message = whatsappService.resolveTemplate('turn_reminder_general', {
      vecino: current.floor,
      tiempo: label
    });
    const individualMessage = whatsappService.resolveTemplate('turn_reminder_individual', {
      vecino: current.floor,
      tiempo: label
    });

    const result = await whatsappService.sendTurnStartNotifications({
      nextFloorName: current.floor,
      formattedMonth: monthDate.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' }),
      message,
      individualMessage,
      groupId: settings.whatsappGroupId || '',
      individualPhone: current.phone || '',
      mode: 'automatic'
    });
    if (Array.isArray(result.logs)) {
      result.logs.forEach((log) => dbService.addNotificationLog({ ...log, notificationType: 'turn_cleanup_reminder' }));
    }
    dbService.updateSettings({ lastReminderRunDate: today });
  },

  handleIncomingMessage: async (msg) => {
    if (!msg || msg.fromMe) return;
    const dbService = require('./db.service');
    const bodyRaw = String(msg.body || '').trim();
    if (!bodyRaw) return;
    const body = bodyRaw.toUpperCase();
    const from = msg.from || '';
    const phone = from.endsWith('@c.us') ? from.replace('@c.us', '') : '';
    const normalized = normalizeAnyPhone(phone);
    const neighbors = dbService.getNeighbors();
    const sender = neighbors.find(n => normalizeAnyPhone(n.phone) === normalized);
    const state = dbService.getState();
    const current = neighbors.find(n => n.id === state.currentTurnFloorId);
    const ids = neighbors.slice().sort((a, b) => Number(a.id) - Number(b.id)).map(n => n.id);
    const idx = ids.indexOf(state.currentTurnFloorId);
    const next = idx >= 0 ? neighbors.find(n => n.id === ids[(idx + 1) % ids.length]) : null;

    if (body === 'OK TURNO' || body === 'CONFIRMAR TURNO') {
      if (!sender || !current || sender.id !== current.id) {
        await msg.reply('Recibido. Solo el vecino en turno puede confirmar este mes.');
        return;
      }
      const month = state.currentMonth.slice(0, 7);
      dbService.addTurnConfirmation({ floorId: sender.id, month, phone: sender.phone, via: 'whatsapp' });
      dbService.addNotificationLog({
        notificationType: 'turn_confirmation',
        mode: 'manual',
        channel: 'individual',
        target: sender.phone || from,
        status: 'sent',
        error: '',
        message: `Confirmación de turno de ${sender.floor}`
      });
      await msg.reply(`Gracias, ${sender.username || sender.floor}. Confirmación registrada para ${month}.`);
      return;
    }

    if (body.startsWith('INCIDENCIA')) {
      const text = bodyRaw.slice('INCIDENCIA'.length).trim();
      if (!text) {
        await msg.reply('Formato: INCIDENCIA <descripción>');
        return;
      }
      dbService.addIncident({ source: 'whatsapp', from: sender?.phone || from, text, status: 'open' });
      await msg.reply('Incidencia recibida y registrada. Gracias.');
      return;
    }

    if (body === 'MI TURNO') {
      if (!sender) {
        await msg.reply('No tengo tu teléfono asociado en el sistema. Pide al administrador que lo registre.');
        return;
      }
      const isCurrent = current && sender.id === current.id;
      await msg.reply(isCurrent ? `Sí, tu turno está activo este mes (${state.currentMonth.slice(0, 7)}).` : `Tu turno no es el actual. Turno activo: ${current ? current.floor : 'N/D'}.`);
      return;
    }

    if (body === 'PROXIMO TURNO' || body === 'PRÓXIMO TURNO') {
      await msg.reply(`Turno actual: ${current ? current.floor : 'N/D'}\nPróximo turno: ${next ? next.floor : 'N/D'}`);
      return;
    }

    if (body === 'ESTADO CUOTAS') {
      const rec = dbService.getFinanceRecords()[0];
      if (!rec) {
        await msg.reply('No hay datos de cuotas todavía.');
        return;
      }
      const balance = Number(rec.incomeFees || 0) - Number(rec.expenseInsurance || 0) - Number(rec.expenseElectricity || 0);
      await msg.reply(`Estado cuotas ${rec.month}:\nIngresos: ${Number(rec.incomeFees || 0).toFixed(2)} €\nSeguro: ${Number(rec.expenseInsurance || 0).toFixed(2)} €\nLuz: ${Number(rec.expenseElectricity || 0).toFixed(2)} €\nBalance: ${balance.toFixed(2)} €`);
      return;
    }

    if (body.startsWith('VOTO ')) {
      const parts = body.split(/\s+/);
      const option = Number(parts[1]);
      if (!Number.isInteger(option) || option < 1) {
        await msg.reply('Formato de voto: VOTO <número_opción>. Ejemplo: VOTO 2');
        return;
      }
      const poll = dbService.getLatestOpenPoll(msg.from.endsWith('@g.us') ? msg.from : '');
      if (!poll) {
        await msg.reply('No hay encuestas abiertas ahora mismo.');
        return;
      }
      if (option > poll.options.length) {
        await msg.reply(`Opción inválida. Elige entre 1 y ${poll.options.length}.`);
        return;
      }
      dbService.addPollVote({ pollId: poll.id, voter: sender?.phone || from, optionIndex: option - 1 });
      await msg.reply(`Voto registrado para encuesta ${poll.id}.`);
    }
  },

  /**
   * Cierra la sesión activa del cliente y borra la caché
   */
  logout: async () => {
    if (!client) return;

    try {
      console.log('[WhatsApp Autohospedado] Desvinculando dispositivo...');
      await client.logout();
      await client.destroy();
      client = null;
      connectionStatus = 'disconnected';
      lastQR = '';
      connectedPhone = '';
      lastSendError = '';
      whatsappService.cleanSession();
      
      // Re-inicializar para volver a generar un QR de inmediato si se solicita
      setTimeout(() => {
        whatsappService.initialize();
      }, 2000);
    } catch (err) {
      console.error('Error al cerrar sesión de WhatsApp:', err.message);
    }
  },

  restart: async () => {
    try {
      if (connectTimeout) {
        clearTimeout(connectTimeout);
        connectTimeout = null;
      }

      if (client) {
        try {
          await client.destroy();
        } catch (_) {}
      }

      client = null;
      connectionStatus = 'disconnected';
      lastQR = '';
      connectedPhone = '';
      lastSendError = '';

      whatsappService.cleanSession();
      whatsappService.initialize();
      return true;
    } catch (err) {
      console.error('[WhatsApp Autohospedado] Error en restart:', err.message);
      return false;
    }
  },

  /**
   * Elimina los ficheros de bloqueo de Chromium sin tocar la sesión de WhatsApp.
   * Necesario en almacenamiento persistente: un lock huérfano de un proceso muerto
   * bloquea el arranque del navegador pero NO invalida las credenciales, así que
   * borrar solo el lock permite reconectar sin re-escanear el QR.
   */
  clearBrowserLocks: () => {
    try {
      if (!fs.existsSync(authPath)) return;
      const lockNames = ['SingletonLock', 'SingletonCookie', 'SingletonSocket'];
      // Recorre authPath y cualquier subcarpeta de perfil (session, session-*).
      const dirs = [authPath];
      for (const entry of fs.readdirSync(authPath)) {
        const full = path.join(authPath, entry);
        try {
          if (fs.statSync(full).isDirectory()) dirs.push(full);
        } catch (_) {}
      }
      for (const dir of dirs) {
        for (const name of lockNames) {
          const lockPath = path.join(dir, name);
          // lstatSync NO sigue el symlink: detecta también SingletonLock/SingletonSocket,
          // que Chromium crea como enlaces (p. ej. SingletonLock -> <hostname>-<pid>).
          // Tras cambiar de pod el objetivo no existe → fs.existsSync (que SÍ sigue el
          // symlink) los daría por inexistentes y no se borrarían, dejando el navegador
          // bloqueado. rmSync con force elimina el propio enlace.
          let present = false;
          try {
            fs.lstatSync(lockPath);
            present = true;
          } catch (_) {
            present = false;
          }
          if (!present) continue;
          try {
            fs.rmSync(lockPath, { force: true });
            console.log(`[WhatsApp Autohospedado] Lock de Chromium eliminado: ${lockPath}`);
          } catch (err) {
            console.error(`[WhatsApp Autohospedado] No se pudo borrar lock ${lockPath}:`, err.message);
          }
        }
      }
    } catch (err) {
      console.error('[WhatsApp Autohospedado] Error al limpiar locks de Chromium:', err.message);
    }
  },

  /**
   * Limpia físicamente la carpeta de autenticación para asegurar un login limpio
   */
  cleanSession: () => {
    try {
      if (fs.existsSync(authPath)) {
        fs.rmSync(authPath, { recursive: true, force: true });
        console.log('[WhatsApp Autohospedado] Carpeta de sesión eliminada correctamente.');
      }
    } catch (err) {
      console.error('[WhatsApp Autohospedado] No se pudo borrar la carpeta de autenticación:', err.message);
    }
  },

  /**
   * Envía la notificación de rotación
   */
  sendRotationNotification: async (nextFloorName, formattedMonth, options = {}) => {
    const groupId = typeof options?.groupId === 'string' ? options.groupId : '';
    const individualPhone = typeof options?.individualPhone === 'string' ? options.individualPhone : '';

    const message = whatsappService.resolveTemplate('turn_start_general', {
      mes: formattedMonth,
      vecino: nextFloorName
    });
    const individualMessage = whatsappService.resolveTemplate('turn_start_individual', {
      mes: formattedMonth,
      vecino: nextFloorName
    });

    return whatsappService.sendTurnStartNotifications({
      nextFloorName,
      formattedMonth,
      message,
      individualMessage,
      groupId,
      individualPhone,
      mode: 'automatic'
    });
  },

  sendTurnStartNotifications: async ({ nextFloorName, formattedMonth, message, groupId = '', individualPhone = '', mode = 'automatic', individualMessage = '' }) => {
    const logs = [];
    const type = 'turn_cleanup_start';

    if (connectionStatus !== 'connected') {
      const errMsg = 'Cliente no vinculado para envío automático.';
      logs.push({
        notificationType: type,
        mode,
        channel: 'group',
        target: groupId || '(sin grupo configurado)',
        status: 'failed',
        error: errMsg,
        message
      });
      if (individualPhone) {
        logs.push({
          notificationType: type,
          mode,
          channel: 'individual',
          target: individualPhone,
          status: 'failed',
          error: errMsg,
          message
        });
      }
      return { ok: false, logs };
    }

    // Grupo
    if (groupId) {
      const groupOk = await whatsappService.sendMessageToGroup(groupId, message);
      logs.push({
        notificationType: type,
        mode,
        channel: 'group',
        target: groupId,
        status: groupOk ? 'sent' : 'failed',
        error: groupOk ? '' : lastSendError,
        message,
        metadata: {
          nextFloorName,
          month: formattedMonth
        }
      });
    } else {
      logs.push({
        notificationType: type,
        mode,
        channel: 'group',
        target: '(sin grupo configurado)',
        status: 'failed',
        error: 'No hay grupo de notificación configurado.',
        message,
        metadata: {
          nextFloorName,
          month: formattedMonth
        }
      });
    }

    // Individual al piso en turno
    if (individualPhone) {
      const directMessage = individualMessage || message;
      const individualOk = await whatsappService.sendMessage(individualPhone, directMessage);
      logs.push({
        notificationType: type,
        mode,
        channel: 'individual',
        target: individualPhone,
        status: individualOk ? 'sent' : 'failed',
        error: individualOk ? '' : lastSendError,
        message: directMessage,
        metadata: {
          nextFloorName,
          month: formattedMonth
        }
      });
    } else {
      logs.push({
        notificationType: type,
        mode,
        channel: 'individual',
        target: '(sin teléfono)',
        status: 'failed',
        error: 'El piso en turno no tiene teléfono configurado.',
        message,
        metadata: {
          nextFloorName,
          month: formattedMonth
        }
      });
    }

    return {
      ok: logs.some(l => l.status === 'sent'),
      logs
    };
  }
};

module.exports = whatsappService;
