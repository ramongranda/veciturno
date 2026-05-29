// ==========================================================================
// VECITURNO - INTERACTIVE FRONTEND APPLICATION
// ==========================================================================

// Estado de la aplicación
const state = {
  token: localStorage.getItem('vt_token') || null,
  user: JSON.parse(localStorage.getItem('vt_user')) || null,
  tempLoginToken: null,
  activeRegisterToken: null,
  statusData: null
};

// Configuración de la API
const API_URL = '/api';

// Inicialización de la aplicación al cargar
document.addEventListener('DOMContentLoaded', () => {
  initApp();
});

// Inicialización general
async function initApp() {
  // Inicializar iconos de Lucide
  lucide.createIcons();
  
  // Renderizar estado de autenticación inicial
  renderAuthHeader();
  
  // Cargar datos de la comunidad (públicos)
  await loadCommunityStatus();

  // Escuchar cambios de Hash en la URL para enrutamiento SPA
  window.addEventListener('hashchange', checkUrlRoute);
  
  // Comprobar la ruta actual al cargar la página
  checkUrlRoute();
}

// Enrutador de URL (SPA hashes)
function checkUrlRoute() {
  const hash = window.location.hash;
  
  if (hash.startsWith('#register')) {
    // Detectar si hay un token de registro
    const params = new URLSearchParams(hash.substring(hash.indexOf('?')));
    const token = params.get('token');
    
    if (token) {
      handleRegistrationRoute(token);
    }
  }
}

// ==========================================
// CARGA Y RENDERIZADO DEL DASHBOARD
// ==========================================

// Cargar estado público de la comunidad
async function loadCommunityStatus() {
  try {
    const res = await fetch(`${API_URL}/public/status`);
    if (!res.ok) throw new Error('Error al cargar datos públicos');
    
    const data = await res.json();
    state.statusData = data;
    
    renderDashboard(data);
  } catch (err) {
    console.error('Error cargando estado:', err);
  }
}

// Renderizar el Dashboard principal
function renderDashboard(data) {
  const activeFloorId = data.state.currentTurnFloorId;
  const activeNeighbor = data.neighbors.find(n => n.id === activeFloorId);
  
  // 1. Renderizar tarjeta central del Turno Activo
  const activeBadgeEl = document.getElementById('active-floor-badge');
  const activeTitleEl = document.getElementById('active-floor-title');
  const activeMonthEl = document.getElementById('active-turn-month');
  const whatsappBtnEl = document.getElementById('whatsapp-btn');
  
  // Formatear el mes actual en español
  let formattedMonth = "Junio de 2026"; // Fallback
  if (data.state.currentMonth) {
    const monthDate = new Date(data.state.currentMonth);
    const monthOptions = { month: 'long', year: 'numeric' };
    formattedMonth = monthDate.toLocaleDateString('es-ES', monthOptions);
    // Capitalizar la primera letra
    formattedMonth = formattedMonth.charAt(0).toUpperCase() + formattedMonth.slice(1);
  }
  
  if (activeMonthEl) {
    activeMonthEl.textContent = formattedMonth;
  }
  
  if (activeNeighbor) {
    activeBadgeEl.textContent = activeNeighbor.id;
    activeTitleEl.textContent = activeNeighbor.floor;
    
    // Configurar enlace de WhatsApp
    if (activeNeighbor.phone) {
      const message = `¡Hola! 🏡 Te escribo desde VeciTurno para recordarte de forma amistosa que te toca el turno mensual de la limpieza de la escalera correspondiente a *${formattedMonth}*. ¡Muchas gracias por colaborar con la comunidad!`;
      const encodedMsg = encodeURIComponent(message);
      // Eliminar el símbolo + o espacios si existieran para la API de WhatsApp
      const cleanPhone = activeNeighbor.phone.replace(/[\s+]/g, '');
      whatsappBtnEl.href = `https://wa.me/${cleanPhone}?text=${encodedMsg}`;
      whatsappBtnEl.classList.remove('disabled');
      whatsappBtnEl.querySelector('span').textContent = `Avisar por WhatsApp a ${activeNeighbor.floor}`;
    } else {
      whatsappBtnEl.href = '#';
      whatsappBtnEl.classList.add('disabled');
      whatsappBtnEl.querySelector('span').textContent = 'WhatsApp (Sin número registrado)';
    }
  }

  // Mostrar acción de rotación solo si el usuario está autenticado
  const rotateSection = document.getElementById('action-rotate-section');
  if (state.token) {
    rotateSection.classList.remove('hidden');
  } else {
    rotateSection.classList.add('hidden');
  }

  // 2. Renderizar lista de vecinos / plantas
  const neighborsContainer = document.getElementById('neighbors-container');
  neighborsContainer.innerHTML = '';

  data.neighbors.forEach(neighbor => {
    const isActive = neighbor.id === activeFloorId;
    const isRegistered = neighbor.registered;
    
    const row = document.createElement('div');
    row.className = `neighbor-row ${isActive ? 'active' : ''}`;
    
    row.innerHTML = `
      <div class="neighbor-info">
        <div class="neighbor-mini-avatar">
          ${neighbor.id}
        </div>
        <div class="neighbor-details">
          <span class="neighbor-name">${neighbor.floor} ${neighbor.isAdmin ? '👑' : ''}</span>
          <span class="neighbor-status-badge">
            <i data-lucide="${isActive ? 'sparkles' : (isRegistered ? 'check-circle' : 'circle-dashed')}"></i>
            ${isActive ? 'Turno Activo' : (isRegistered ? 'Registrado' : 'Pendiente de Registro')}
          </span>
        </div>
      </div>
      <div class="neighbor-action">
        ${neighbor.phone ? `
          <span class="badge badge-success" title="${neighbor.phone}">
            <i data-lucide="phone-call" style="width: 12px; height: 12px; margin-right: 4px;"></i>
            Con número
          </span>
        ` : `
          <span class="badge badge-danger">
            Sin número
          </span>
        `}
      </div>
    `;
    
    neighborsContainer.appendChild(row);
  });

  // 3. Renderizar el historial
  const historyContainer = document.getElementById('history-container');
  historyContainer.innerHTML = '';

  if (data.history.length === 0) {
    historyContainer.innerHTML = '<div class="history-item text-center">Aún no hay turnos completados en el historial.</div>';
  } else {
    data.history.forEach(item => {
      const neighbor = data.neighbors.find(n => n.id === item.floorId);
      const date = new Date(item.completedAt);
      
      const historyItem = document.createElement('div');
      historyItem.className = 'history-item';
      historyItem.innerHTML = `
        <div class="history-meta">
          <span class="history-floor">${neighbor ? neighbor.floor : 'Planta Desconocida'}</span>
          <span class="history-by">Completado por: @${item.completedBy}</span>
        </div>
        <span class="history-date">${date.toLocaleDateString()} a las ${date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
      `;
      
      historyContainer.appendChild(historyItem);
    });
  }

  // Recargar iconos insertados dinámicamente
  lucide.createIcons();
}

// ==========================================
// SISTEMA DE SESIÓN Y VISTAS (SPA)
// ==========================================

// Mostrar u ocultar vistas / modales
function showView(viewName) {
  // Ocultar todas las vistas modal-like
  document.querySelectorAll('.app-view.modal-like').forEach(el => {
    el.classList.remove('active');
  });

  if (viewName === 'dashboard') {
    // Volver al dashboard, no hacemos nada más ya que siempre está de fondo
    return;
  }

  // Mostrar la vista seleccionada si es modal
  const targetView = document.getElementById(`view-${viewName}`);
  if (targetView) {
    targetView.classList.add('active');
  }
}

// Renderizar la cabecera y el botón de sesión según el estado de auth
function renderAuthHeader() {
  const authHeaderBtn = document.getElementById('auth-header-btn');
  
  if (state.token && state.user) {
    authHeaderBtn.innerHTML = `
      <div class="session-dropdown-container" style="display: flex; gap: 8px;">
        ${state.user.isAdmin ? `
          <button class="btn btn-secondary glass" onclick="openAdminPanel()" title="Consola Administrador">
            <i data-lucide="shield-alert" class="text-warning"></i>
            <span>Administrar</span>
          </button>
        ` : ''}
        <button class="btn btn-secondary glass" onclick="openProfileModal()">
          <i data-lucide="user"></i>
          <span>${state.user.floor}</span>
        </button>
        <button class="btn btn-secondary glass" onclick="handleLogout()" title="Cerrar Sesión">
          <i data-lucide="log-out"></i>
        </button>
      </div>
    `;
  } else {
    authHeaderBtn.innerHTML = `
      <button class="btn btn-secondary glass" onclick="showView('login')">
        <i data-lucide="user-check"></i>
        <span>Acceso Vecino</span>
      </button>
    `;
  }
  lucide.createIcons();
}

// Cerrar sesión
function handleLogout() {
  localStorage.removeItem('vt_token');
  localStorage.removeItem('vt_user');
  state.token = null;
  state.user = null;
  
  renderAuthHeader();
  loadCommunityStatus(); // Recargar para actualizar interfaz
  showView('dashboard');
}

// ==========================================
// FLUJO DE INICIO DE SESIÓN
// ==========================================

// Login Paso 1: Introducir credenciales
async function handleLoginStep1(event) {
  event.preventDefault();
  
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  const errorEl = document.getElementById('login-error-1');
  
  errorEl.classList.add('hidden');

  try {
    const res = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    const data = await res.json();
    
    if (!res.ok) {
      throw new Error(data.error || 'Credenciales incorrectas');
    }

    if (data.requires2fa) {
      // Guardar token temporal y pasar al Paso 2
      state.tempLoginToken = data.tempToken;
      document.getElementById('login-step1-form').classList.add('hidden');
      document.getElementById('login-step2-form').classList.remove('hidden');
      document.getElementById('login-2fa-code').focus();
    }
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.remove('hidden');
  }
}

// Volver al paso 1 en la vista de login
function backToLoginStep1() {
  document.getElementById('login-step2-form').classList.add('hidden');
  document.getElementById('login-step1-form').classList.remove('hidden');
  document.getElementById('login-2fa-code').value = '';
}

// Login Paso 2: Verificar TOTP
async function handleLoginStep2(event) {
  event.preventDefault();
  
  const code = document.getElementById('login-2fa-code').value.trim();
  const errorEl = document.getElementById('login-error-2');
  
  errorEl.classList.add('hidden');

  try {
    const res = await fetch(`${API_URL}/auth/login/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tempToken: state.tempLoginToken, code })
    });

    const data = await res.json();
    
    if (!res.ok) {
      throw new Error(data.error || 'Código incorrecto');
    }

    // Iniciar sesión con éxito
    localStorage.setItem('vt_token', data.token);
    localStorage.setItem('vt_user', JSON.stringify(data.user));
    
    state.token = data.token;
    state.user = data.user;
    state.tempLoginToken = null;

    // Resetear formulario
    document.getElementById('login-step1-form').reset();
    document.getElementById('login-step2-form').reset();
    backToLoginStep1();

    // Actualizar UI
    renderAuthHeader();
    await loadCommunityStatus();
    showView('dashboard');
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.remove('hidden');
  }
}

// ==========================================
// FLUJO DE REGISTRO CON LINK DE UN SOLO USO
// ==========================================

// Enrutado especial de registro
async function handleRegistrationRoute(token) {
  state.activeRegisterToken = token;
  showView('register');
  
  const welcomeMsgEl = document.getElementById('register-welcome-msg');
  const errorGlobalEl = document.getElementById('register-error-global');
  const formStep1 = document.getElementById('register-step1-form');
  const containerStep2 = document.getElementById('register-step2-container');
  
  welcomeMsgEl.textContent = 'Validando enlace de invitación...';
  errorGlobalEl.classList.add('hidden');
  formStep1.classList.add('hidden');
  containerStep2.classList.add('hidden');

  try {
    const res = await fetch(`${API_URL}/register/validate?token=${token}`);
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Enlace de registro no válido o usado.');
    }

    // Mostrar el formulario del paso 1 de registro
    welcomeMsgEl.innerHTML = `👋 ¡Bienvenido vecino de la <strong>${data.floor}</strong>! Completa tu registro inicial.`;
    formStep1.classList.remove('hidden');
  } catch (err) {
    welcomeMsgEl.textContent = 'Enlace de invitación inválido';
    errorGlobalEl.textContent = err.message;
    errorGlobalEl.classList.remove('hidden');
  }
}

// Registro Paso 1: Configurar credenciales y solicitar QR 2FA
async function handleRegisterStep1(event) {
  event.preventDefault();
  
  const username = document.getElementById('reg-username').value.trim();
  const password = document.getElementById('reg-password').value;
  const phone = document.getElementById('reg-phone').value.trim();
  const errorEl = document.getElementById('register-error-1');
  
  errorEl.classList.add('hidden');

  try {
    const res = await fetch(`${API_URL}/register/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: state.activeRegisterToken,
        username,
        password,
        phone
      })
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Error al guardar credenciales');
    }

    // Configurar imagen del QR y código manual para el Paso 2
    document.getElementById('register-qr-image').src = data.qrCodeUrl;
    document.getElementById('register-manual-secret').textContent = data.secret;

    // Cambiar de paso
    document.getElementById('register-step1-form').classList.add('hidden');
    document.getElementById('register-step2-container').classList.remove('hidden');
    document.getElementById('reg-2fa-code').focus();
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.remove('hidden');
  }
}

// Registro Paso 2: Verificar TOTP inicial y activar la cuenta
async function handleRegisterStep2(event) {
  event.preventDefault();
  
  const code = document.getElementById('reg-2fa-code').value.trim();
  const errorEl = document.getElementById('register-error-2');
  
  errorEl.classList.add('hidden');

  try {
    const res = await fetch(`${API_URL}/register/verify-2fa`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: state.activeRegisterToken,
        code
      })
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Código incorrecto');
    }

    // Registro completo: iniciar sesión automáticamente
    localStorage.setItem('vt_token', data.token);
    localStorage.setItem('vt_user', JSON.stringify(data.user));
    
    state.token = data.token;
    state.user = data.user;
    state.activeRegisterToken = null;

    // Limpiar hash URL
    window.location.hash = '';

    // Resetear formularios
    document.getElementById('register-step1-form').reset();
    document.getElementById('register-step2-form').reset();
    
    // Actualizar e ir a dashboard
    renderAuthHeader();
    await loadCommunityStatus();
    showView('dashboard');
    
    alert('🎉 ¡Registro completado correctamente! Ya tienes acceso a VeciTurno con Doble Factor.');
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.remove('hidden');
  }
}

// ==========================================
// CONFIGURACIÓN DE PERFIL VECINO
// ==========================================

// Abrir el modal de edición de datos de vecino
function openProfileModal() {
  if (!state.token || !state.user) return;
  
  document.getElementById('profile-title').textContent = `Mi Perfil: ${state.user.floor}`;
  
  // Cargar teléfono actual si existe
  const neighbor = state.statusData.neighbors.find(n => n.id === state.user.id);
  document.getElementById('profile-phone').value = neighbor ? neighbor.phone : '';
  
  // Limpiar mensajes
  document.getElementById('profile-success').classList.add('hidden');
  document.getElementById('profile-error').classList.add('hidden');
  document.getElementById('profile-password').value = '';
  
  showView('profile');
}

// Guardar cambios de perfil
async function handleProfileUpdate(event) {
  event.preventDefault();
  
  const phone = document.getElementById('profile-phone').value.trim();
  const password = document.getElementById('profile-password').value;
  const successEl = document.getElementById('profile-success');
  const errorEl = document.getElementById('profile-error');
  
  successEl.classList.add('hidden');
  errorEl.classList.add('hidden');

  try {
    const res = await fetch(`${API_URL}/neighbors/update`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify({ phone, password })
    });

    const data = await res.json();
    
    if (!res.ok) {
      throw new Error(data.error || 'Error al guardar cambios');
    }

    successEl.textContent = data.message;
    successEl.classList.remove('hidden');
    
    document.getElementById('profile-password').value = '';
    
    // Recargar estado
    await loadCommunityStatus();
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.remove('hidden');
  }
}

// ==========================================
// ROTACIÓN DE TURNOS
// ==========================================

// Avanzar el turno al siguiente vecino
async function rotateTurn() {
  if (!state.token) return;

  const confirmRotate = confirm('¿Confirmas que el turno mensual de limpieza de la escalera ha sido completado y deseas rotar al siguiente vecino?');
  if (!confirmRotate) return;

  try {
    const res = await fetch(`${API_URL}/turns/rotate`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${state.token}`
      }
    });

    const data = await res.json();
    
    if (!res.ok) {
      throw new Error(data.error || 'Error al rotar el turno');
    }

    // Recargar el dashboard con los nuevos datos
    await loadCommunityStatus();
    
    alert('✅ ¡Turno mensual completado y rotado al siguiente vecino con éxito!');
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

// ==========================================
// OPERACIONES DEL ADMINISTRADOR
// ==========================================

// Abrir consola de administrador
async function openAdminPanel() {
  if (!state.token || !state.user || !state.user.isAdmin) return;
  
  // Limpiar formulario y enlaces generados
  document.getElementById('admin-invite-form').reset();
  document.getElementById('admin-invite-success').classList.add('hidden');
  
  showView('admin');
  
  // Cargar lista de invitaciones existentes
  await loadAdminInvites();
}

// Cargar la tabla de invitaciones de administrador
async function loadAdminInvites() {
  const container = document.getElementById('admin-invites-list');
  container.innerHTML = '<tr><td colspan="3" class="text-center">Cargando invitaciones...</td></tr>';
  
  try {
    const res = await fetch(`${API_URL}/admin/invites`, {
      headers: {
        'Authorization': `Bearer ${state.token}`
      }
    });
    
    const data = await res.json();
    
    if (!res.ok) {
      throw new Error(data.error || 'Error al obtener invitaciones');
    }
    
    container.innerHTML = '';
    
    if (data.invites.length === 0) {
      container.innerHTML = '<tr><td colspan="3" class="text-center">No hay invitaciones generadas actualmente.</td></tr>';
      return;
    }
    
    data.invites.forEach(invite => {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td><strong>${invite.floor}</strong></td>
        <td>
          <span class="badge ${invite.used ? 'badge-danger' : 'badge-success'}">
            ${invite.used ? 'Usado' : 'Activo'}
          </span>
        </td>
        <td>
          ${invite.used ? '-' : `
            <button class="btn btn-secondary btn-icon" onclick="copyInviteLinkUrl('${invite.inviteUrl}')" title="Copiar Enlace">
              <i data-lucide="copy" style="width: 14px; height: 14px;"></i>
            </button>
          `}
        </td>
      `;
      container.appendChild(row);
    });
    
    lucide.createIcons();
  } catch (err) {
    container.innerHTML = `<tr><td colspan="3" class="text-center error-msg">${err.message}</td></tr>`;
  }
}

// Generar una nueva invitación
async function handleGenerateInvite(event) {
  event.preventDefault();
  
  const floorId = document.getElementById('admin-select-floor').value;
  const successBox = document.getElementById('admin-invite-success');
  const inviteUrlInput = document.getElementById('admin-invite-url');
  
  successBox.classList.add('hidden');
  
  try {
    const res = await fetch(`${API_URL}/admin/generate-invite`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify({ floorId })
    });
    
    const data = await res.json();
    
    if (!res.ok) {
      throw new Error(data.error || 'Error al generar invitación');
    }
    
    inviteUrlInput.value = data.inviteUrl;
    successBox.classList.remove('hidden');
    
    // Recargar tabla de invitaciones
    await loadAdminInvites();
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

// Copiar enlace generado desde el formulario
function copyInviteLink() {
  const inviteUrlInput = document.getElementById('admin-invite-url');
  inviteUrlInput.select();
  document.execCommand('copy');
  alert('📋 Enlace de registro copiado al portapapeles.');
}

// Copiar enlace de la tabla
function copyInviteLinkUrl(url) {
  const tempInput = document.createElement('input');
  tempInput.value = url;
  document.body.appendChild(tempInput);
  tempInput.select();
  document.execCommand('copy');
  document.body.removeChild(tempInput);
  alert('📋 Enlace de registro copiado al portapapeles.');
}
