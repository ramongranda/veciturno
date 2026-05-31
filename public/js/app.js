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

let pendingLoginUsername = '';
let adminBuildingUnits = [];
const LAST_LOGIN_USERNAME_KEY = 'vt_last_username';
const passkeyActionState = {
  mode: null,
  credentialID: '',
  currentLabel: ''
};
let financeOverviewData = null;
let expenseTypeFilter = 'all';

function fmtEur(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return '0,00 €';
  const fixed = n.toFixed(2);
  const parts = fixed.split('.');
  const intPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const decPart = parts[1] || '00';
  return `${intPart},${decPart} €`;
}

// Configuración de la API
const API_URL = '/api';

function showToast(message, type = 'info') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 220);
  }, 3200);
}

function b64urlToBuffer(b64url) {
  const pad = '='.repeat((4 - (b64url.length % 4)) % 4);
  const base64 = (b64url + pad).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes.buffer;
}

function bufferToB64url(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function toArrayBufferFlexible(value) {
  if (!value) return null;
  if (value instanceof ArrayBuffer) return value;
  if (ArrayBuffer.isView(value)) return value.buffer;
  if (Array.isArray(value)) return Uint8Array.from(value).buffer;
  if (typeof value === 'string') return b64urlToBuffer(value);
  return null;
}

function normalizeSpanishPhoneInput(rawPhone) {
  const value = String(rawPhone || '').trim();
  if (!value) return '';
  let digits = value.replace(/\D/g, '');
  if (digits.startsWith('0034')) digits = digits.slice(4);
  else if (digits.startsWith('34')) digits = digits.slice(2);
  if (!/^\d{9}$/.test(digits)) return null;
  return `+34${digits}`;
}

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
  preloadRememberedUsername();

  // Escuchar cambios de Hash en la URL para enrutamiento SPA
  window.addEventListener('hashchange', checkUrlRoute);
  
  // Comprobar la ruta actual al cargar la página
  checkUrlRoute();

  const financeSearch = document.getElementById('finance-search');
  const financeSort = document.getElementById('finance-sort');
  if (financeSearch) financeSearch.addEventListener('input', renderFinanceContributionsTable);
  if (financeSort) financeSort.addEventListener('change', renderFinanceContributionsTable);
}

function preloadRememberedUsername() {
  const input = document.getElementById('login-username');
  if (!input) return;
  const remembered = localStorage.getItem(LAST_LOGIN_USERNAME_KEY) || '';
  if (remembered && !input.value) {
    input.value = remembered;
  }
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
    const res = await fetch(`${API_URL}/public/status?_t=${Date.now()}`);
    if (!res.ok) throw new Error('Error al cargar datos públicos');
    
    const data = await res.json();
    state.statusData = data;
    
    renderDashboard(data);
    if (state.token && state.user?.isAdmin) {
      renderSecurityPanel();
      loadActiveTurnOptions();
    }
  } catch (err) {
    console.error('Error cargando estado:', err);
  }
}

// Renderizar el Dashboard principal
function renderDashboard(data) {
  const activeFloorId = data.state.currentTurnFloorId;
  const activeNeighbor = data.neighbors.find(n => n.id === activeFloorId);

  // Actualizar el nombre de la comunidad dinámicamente desde el backend (.env)
  const communityNameEl = document.querySelector('.logo-text span');
  if (communityNameEl && data.communityName) {
    communityNameEl.textContent = data.communityName;
    document.title = `${data.communityName} - VeciTurno`;
  }
  
  // 1. Renderizar tarjeta central del Turno Activo
  const activeBadgeEl = document.getElementById('active-floor-badge');
  const activeTitleEl = document.getElementById('active-floor-title');
  const activeMonthEl = document.getElementById('active-turn-month');
  
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

    // Calcular siguiente turno ignorando unidades exentas
    const orderedNeighbors = [...data.neighbors]
      .filter((n) => !n.exemptFromCleaning)
      .sort((a, b) => Number(a.id) - Number(b.id));
    const currentIndex = orderedNeighbors.findIndex(n => n.id === activeFloorId);
    const nextNeighbor = currentIndex >= 0
      ? orderedNeighbors[(currentIndex + 1) % orderedNeighbors.length]
      : orderedNeighbors[0];

    const nextFloorNameEl = document.getElementById('next-floor-name');
    const nextAvatarBadgeEl = document.getElementById('next-floor-avatar-badge');
    if (nextFloorNameEl && nextNeighbor) {
      nextFloorNameEl.textContent = nextNeighbor.floor;
    }
    if (nextAvatarBadgeEl && nextNeighbor) {
      nextAvatarBadgeEl.textContent = nextNeighbor.id;
    }
  }

  // Mostrar banner de recomendación 2FA si corresponde
  const banner2fa = document.getElementById('banner-2fa-recommendation');
  if (banner2fa) {
    if (state.token && state.user) {
      const currentNeighbor = data.neighbors.find(n => n.id === state.user.id);
      if (currentNeighbor && !currentNeighbor.twoFactorRegistered) {
        banner2fa.classList.remove('hidden');
      } else {
        banner2fa.classList.add('hidden');
      }
    } else {
      banner2fa.classList.add('hidden');
    }
  }

  // Tarjeta de grupo de notificaciones para vecinos no admin
  const notificationsCard = document.getElementById('neighbor-notifications-card');
  const notificationsLink = document.getElementById('neighbor-notifications-link');
  const notificationsText = document.getElementById('neighbor-notifications-text');
  if (notificationsCard && notificationsLink && notificationsText) {
    const isNeighborLogged = !!(state.token && state.user && !state.user.isAdmin);
    if (isNeighborLogged) {
      notificationsCard.classList.remove('hidden');
      if (data.notificationsGroupUrl) {
        notificationsLink.href = data.notificationsGroupUrl;
        notificationsLink.classList.remove('hidden');
        notificationsText.textContent = 'Únete al grupo oficial para recibir avisos de turnos y comunicaciones de la comunidad.';
      } else {
        notificationsLink.classList.add('hidden');
        notificationsText.textContent = 'El grupo de notificaciones aún no está configurado por la administración.';
      }
    } else {
      notificationsCard.classList.add('hidden');
    }
  }


  // 2. Renderizar lista de vecinos / pisos
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
          <span class="history-date">Cuota: ${(Number(neighbor.monthlyFee || 0)).toFixed(2)} €/mes</span>
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
          <span class="history-floor">${neighbor ? neighbor.floor : 'Piso Desconocido'}</span>
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

function renderAdminUnitSelectors() {
  const units = state.statusData?.neighbors || [];
  const inviteSelect = document.getElementById('admin-select-floor');
  const registerSelect = document.getElementById('admin-reg-floor');

  if (!inviteSelect || !registerSelect) return;

  const options = units
    .slice()
    .sort((a, b) => Number(a.id) - Number(b.id))
    .map((unit) => `<option value=\"${unit.id}\">${unit.floor}</option>`)
    .join('');

  inviteSelect.innerHTML = options || '<option value=\"\">Sin viviendas</option>';
  registerSelect.innerHTML = options || '<option value=\"\">Sin viviendas</option>';
}

// ==========================================
// SISTEMA DE SESIÓN Y VISTAS (SPA)
// ==========================================

// Mostrar u ocultar vistas / modales
function showView(viewName) {
  // Mostrar dashboard por defecto
  const dashboardView = document.getElementById('view-dashboard');
  if (dashboardView) {
    dashboardView.classList.add('active');
  }

  // Ocultar todas las vistas especiales
  document.querySelectorAll('.app-view.modal-like').forEach(el => {
    el.classList.remove('active');
  });
  document.querySelectorAll('.app-view.page-view').forEach(el => {
    el.classList.remove('active');
  });
  document.body.classList.remove('modal-open');

  if (viewName === 'dashboard') {
    // Vista principal
    return;
  }

  if (viewName === 'login') {
    preloadRememberedUsername();
  }

  // Mostrar la vista seleccionada
  const targetView = document.getElementById(`view-${viewName}`);
  if (targetView) {
    if (targetView.classList.contains('modal-like')) {
      targetView.classList.add('active');
      document.body.classList.add('modal-open');
      targetView.scrollTop = 0;
      window.scrollTo({ top: 0, behavior: 'auto' });
    } else if (targetView.classList.contains('page-view')) {
      if (dashboardView) {
        dashboardView.classList.remove('active');
      }
      targetView.classList.add('active');
      window.scrollTo({ top: 0, behavior: 'auto' });
    }
  }
}

// Renderizar la cabecera y el botón de sesión según el estado de auth
function renderAuthHeader() {
  const authHeaderBtn = document.getElementById('auth-header-btn');
  const displayName = (state.user && state.user.username) ? state.user.username : (state.user ? state.user.floor : '');
  
  if (state.token && state.user) {
    authHeaderBtn.innerHTML = `
      <div class="session-dropdown-container" style="display: flex; gap: 12px; flex-wrap: wrap; justify-content: flex-end;">
        ${state.user.isAdmin ? `
          <button class="btn btn-secondary glass" onclick="openAdminPanel()" title="Consola Administrador">
            <i data-lucide="shield-alert" class="text-warning"></i>
            <span>Administrar</span>
          </button>
        ` : ''}
        <button class="btn btn-secondary glass" onclick="openFinancePage()" title="Estado de Cuentas">
          <i data-lucide="line-chart"></i>
          <span>Finanzas</span>
        </button>
        <button class="btn btn-secondary glass" onclick="openCertificatesPage()" title="Certificados">
          <i data-lucide="file-text"></i>
          <span>Certificados</span>
        </button>
        <button class="btn btn-secondary glass" onclick="openProfileModal()">
          <i data-lucide="user"></i>
          <span>${displayName}</span>
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

async function openFinancePage() {
  if (!state.token || !state.user) return;
  const financeView = document.getElementById('view-finance');
  const dashboardView = document.getElementById('view-dashboard');
  if (!financeView) {
    showToast('No se encontró la vista de finanzas.', 'error');
    return;
  }
  document.querySelectorAll('.app-view.modal-like').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.app-view.page-view').forEach(el => el.classList.remove('active'));
  if (dashboardView) dashboardView.classList.remove('active');
  financeView.classList.add('active');
  window.scrollTo({ top: 0, behavior: 'auto' });
  await loadFinanceOverview();
}

function openCertificatesPage() {
  if (!state.token || !state.user) return;
  showView('certificates');
  const yearInput = document.getElementById('finance-cert-year');
  if (yearInput && !yearInput.value) yearInput.value = String(new Date().getFullYear());
}

async function downloadFinanceCertificate() {
  if (!state.token || !state.user) return;
  const year = document.getElementById('finance-cert-year')?.value || String(new Date().getFullYear());
  const quarter = document.getElementById('finance-cert-quarter')?.value || 'all';
  const url = `${API_URL}/neighbors/finance/certificate?year=${encodeURIComponent(year)}&quarter=${encodeURIComponent(quarter)}`;
  try {
    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'No se pudo generar el certificado.');
    }
    const blob = await res.blob();
    const objUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objUrl;
    a.download = `certificado-abonos-${year}-${quarter}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(objUrl);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function loadFinanceOverview() {
  if (!state.token || !state.user) return;
  const summaryEl = document.getElementById('finance-summary-cards');
  const monthlyEl = document.getElementById('finance-monthly-chart');
  const tableEl = document.getElementById('finance-contributions-table');
  if (!summaryEl || !monthlyEl || !tableEl) return;
  try {
    const res = await fetch(`${API_URL}/neighbors/finance/overview`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudo cargar finanzas.');
    financeOverviewData = data;
    renderFinanceOverview();
  } catch (err) {
    summaryEl.innerHTML = `<div class="history-item">${err.message}</div>`;
  }
}

function renderFinanceOverview() {
  const data = financeOverviewData;
  if (!data) return;
  const summaryEl = document.getElementById('finance-summary-cards');
  const donutsEl = document.getElementById('finance-donut-panels');
  const monthlyEl = document.getElementById('finance-monthly-chart');
  const paymentEl = document.getElementById('finance-payment-check');
  if (!summaryEl || !monthlyEl || !donutsEl || !paymentEl) return;

  const saldoCuenta = data.currentBankBalance === null || data.currentBankBalance === undefined
    ? 'Sin dato'
    : fmtEur(data.currentBankBalance);
  const pc = data.paymentCheck || {};
  const saldoPrincipal = (data.currentBankBalance === null || data.currentBankBalance === undefined)
    ? Number(data.totals?.balance || 0)
    : Number(data.currentBankBalance);
  const monthly = Array.isArray(data.monthly) ? data.monthly : [];
  const currentMonth = monthly[0] || null;
  const currentYear = (currentMonth?.month || '').slice(0, 4);
  const yearRows = monthly.filter((m) => String(m.month || '').startsWith(currentYear));
  const yearExpenses = yearRows.reduce((a, m) => a + Number(m.expenseInsurance || 0) + Number(m.expenseElectricity || 0), 0);
  summaryEl.innerHTML = `
    <div class="finance-kpi-card"><div class="finance-kpi-title">Saldo Total Actual</div><div class="finance-kpi-value">${fmtEur(saldoPrincipal)}</div></div>
    <div class="finance-kpi-card"><div class="finance-kpi-title">Gastos Acumulados</div><div class="finance-kpi-value">${fmtEur(data.totals?.expenses || 0)}</div></div>
    <div class="finance-kpi-card"><div class="finance-kpi-title">Gastos Año en Curso ${currentYear ? `(${currentYear})` : ''}</div><div class="finance-kpi-value">${fmtEur(yearExpenses)}</div></div>
  `;

  const prevYear = currentYear ? String(Number(currentYear) - 1) : '';
  const prevYearRows = monthly.filter((m) => prevYear && String(m.month || '').startsWith(prevYear));
  const yearIncome = yearRows.reduce((a, m) => a + Number(m.incomeFees || 0), 0);
  const prevYearIncome = prevYearRows.reduce((a, m) => a + Number(m.incomeFees || 0), 0);
  const prevYearExpenses = prevYearRows.reduce((a, m) => a + Number(m.expenseInsurance || 0) + Number(m.expenseElectricity || 0), 0);
  const monthIncome = Number(currentMonth?.incomeFees || 0);
  const monthExpenses = Number(currentMonth ? (Number(currentMonth.expenseInsurance || 0) + Number(currentMonth.expenseElectricity || 0)) : 0);
  const totalIncome = Number(data.totals?.income || 0);
  const totalExpenses = Number(data.totals?.expenses || 0);

  donutsEl.innerHTML = [
    renderDonutCard('Mes Actual', monthIncome, monthExpenses),
    renderDonutCard(`Año ${currentYear || 'Actual'}`, yearIncome, yearExpenses),
    renderDonutCard(`Año ${prevYear || 'Anterior'}`, prevYearIncome, prevYearExpenses),
    renderDonutCard('Acumulado', totalIncome, totalExpenses)
  ].join('');

  const maxVal = Math.max(1, ...monthly.map((m) => Math.max(Number(m.incomeFees || 0), Number(m.expenseInsurance || 0) + Number(m.expenseElectricity || 0))));
  const recent = monthly.slice(0, 6).reverse();
  if (!recent.length) {
    monthlyEl.innerHTML = '<div class="history-item">Sin meses disponibles.</div>';
  } else {
    const bars = recent.map((m) => {
      const ing = Number(m.incomeFees || 0);
      const gas = Number(m.expenseInsurance || 0) + Number(m.expenseElectricity || 0);
      const ingH = Math.max(8, Math.round((ing / maxVal) * 100));
      const gasH = Math.max(8, Math.round((gas / maxVal) * 100));
      return `<div class="finance-mini-bar-col" title="${m.month} · Ingresos ${fmtEur(ing)} · Gastos ${fmtEur(gas)}"><div class="finance-mini-bar-stack"><div class="finance-mini-income" style="height:${ingH}%"></div><div class="finance-mini-expense" style="height:${gasH}%"></div></div><div class="finance-mini-month">${m.month.slice(5)}</div></div>`;
    }).join('');
    monthlyEl.innerHTML = `
      <div class="finance-trend-grid">
        <div class="finance-trend-card">
          <div class="finance-kpi-title" style="margin-bottom:8px;">Tendencia 6 últimos meses (Ingresos vs Gastos)</div>
          <div class="finance-mini-bars">${bars}</div>
        </div>
        <div class="finance-trend-card">
          <div class="finance-kpi-title" style="margin-bottom:8px;">Salud Financiera</div>
          <div class="finance-health-pill"><span>Ingresos:</span><strong>${fmtEur(data.totals?.income || 0)}</strong></div>
          <div style="height:8px"></div>
          <div class="finance-health-pill"><span>Gastos:</span><strong>${fmtEur(data.totals?.expenses || 0)}</strong></div>
          <div style="height:8px"></div>
          <div class="finance-health-pill"><span>Al corriente:</span><strong>${Number(pc.currentCount || 0)}/${Number(pc.totalOwners || 0)}</strong></div>
        </div>
      </div>
    `;
  }

  const totalOwners = Number(pc.totalOwners || 0);
  const currentCount = Number(pc.currentCount || 0);
  const pendingCount = Number(pc.pendingCount || 0);
  const currentPct = totalOwners > 0 ? (currentCount / totalOwners) * 100 : 0;
  const circle = 2 * Math.PI * 30;
  const currentLen = (currentPct / 100) * circle;
  paymentEl.innerHTML = `
    <div class="history-item">
      <div class="history-meta" style="width:100%;">
        <span class="history-floor">Propietarios al corriente (${currentCount}/${totalOwners}) · Periodos: ${Number(pc.monthsCount || 0)} meses</span>
        <div style="display:flex;align-items:center;gap:14px;margin-top:8px;flex-wrap:wrap;">
          <svg width="86" height="86" viewBox="0 0 86 86" aria-label="Control de pagos">
            <g transform="translate(43,43) rotate(-90)">
              <circle r="30" cx="0" cy="0" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="10"></circle>
              <circle r="30" cx="0" cy="0" fill="none" stroke="rgba(16,185,129,0.9)" stroke-width="10" stroke-linecap="round" stroke-dasharray="${currentLen} ${circle - currentLen}" stroke-dashoffset="0"></circle>
              <circle r="30" cx="0" cy="0" fill="none" stroke="rgba(239,68,68,0.9)" stroke-width="10" stroke-linecap="round" stroke-dasharray="${circle - currentLen} ${currentLen}" stroke-dashoffset="-${currentLen}"></circle>
            </g>
            <text x="43" y="40" text-anchor="middle" fill="#e5e7eb" font-size="10">${currentPct.toFixed(0)}%</text>
            <text x="43" y="53" text-anchor="middle" fill="#9ca3af" font-size="8">al corriente</text>
          </svg>
          <div>
            <div class="history-by">Al corriente: ${currentCount}</div>
            <div class="history-by">Pendientes: ${pendingCount}</div>
          </div>
        </div>
      </div>
    </div>
    ${(pc.owners || []).map((o) => `<div class="history-item"><div class="history-meta"><span class="history-floor">${o.unitName}</span><span class="history-by">Pagado: ${fmtEur(o.paid || 0)} · Esperado: ${fmtEur(o.expected || 0)} · Deuda: ${fmtEur(o.debt || 0)}</span></div></div>`).join('')}
  `;
  renderExpenseEvolutionByType();
  renderFinanceContributionsTable();
}

function renderDonutCard(title, income, expenses) {
  const safeIncome = Math.max(0, Number(income || 0));
  const safeExpenses = Math.max(0, Number(expenses || 0));
  const total = Math.max(1, safeIncome + safeExpenses);
  const incomePct = (safeIncome / total) * 100;
  const expensePct = (safeExpenses / total) * 100;
  const circle = 2 * Math.PI * 30;
  const incomeLen = (incomePct / 100) * circle;
  const expenseLen = (expensePct / 100) * circle;
  return `<div class="history-item" style="padding: 10px 12px;"><div class="history-meta" style="width:100%;"><span class="history-floor" style="font-size: 0.82rem; font-weight: 700; color: var(--text-main); opacity: 0.95;">${title}</span><div style="display:flex;align-items:center;gap:12px;margin-top:6px;flex-wrap:wrap;"><svg width="74" height="74" viewBox="0 0 86 86" aria-label="${title}" style="flex-shrink:0;"><g transform="translate(43,43) rotate(-90)"><circle r="30" cx="0" cy="0" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="8"></circle><circle r="30" cx="0" cy="0" fill="none" stroke="rgba(16,185,129,0.9)" stroke-width="8" stroke-linecap="round" stroke-dasharray="${incomeLen} ${circle - incomeLen}" stroke-dashoffset="0"></circle><circle r="30" cx="0" cy="0" fill="none" stroke="rgba(239,68,68,0.9)" stroke-width="8" stroke-linecap="round" stroke-dasharray="${expenseLen} ${circle - expenseLen}" stroke-dashoffset="-${incomeLen}"></circle></g><text x="43" y="42" text-anchor="middle" fill="#e5e7eb" font-size="11" font-weight="700">${incomePct.toFixed(0)}%</text><text x="43" y="55" text-anchor="middle" fill="#9ca3af" font-size="7.5" font-weight="500" letter-spacing="0.2px">ingresos</text></svg><div style="font-size: 0.72rem; display:flex; flex-direction:column; gap:2px;"><div class="history-by" style="font-size: 0.7rem; color: #34d399; font-weight:600;">Ingresos: ${fmtEur(safeIncome)}</div><div class="history-by" style="font-size: 0.7rem; color: #f87171; font-weight:600;">Gastos: ${fmtEur(safeExpenses)}</div><div class="history-by" style="font-size: 0.7rem; color: var(--text-muted);">Balance: ${fmtEur(safeIncome - safeExpenses)}</div></div></div></div></div>`;
}

function renderFinanceContributionsTable() {
  const container = document.getElementById('finance-contributions-table');
  const searchEl = document.getElementById('finance-search');
  const sortEl = document.getElementById('finance-sort');
  if (!container || !financeOverviewData) return;
  const query = (searchEl?.value || '').trim().toLowerCase();
  const sort = sortEl?.value || 'date_asc';
  let rows = Array.isArray(financeOverviewData.expenseMovements) ? financeOverviewData.expenseMovements.slice() : [];
  if (expenseTypeFilter !== 'all') {
    rows = rows.filter((r) => String(r.movementType || '') === expenseTypeFilter);
  } else {
    rows = rows.filter((r) => {
      const mt = String(r.movementType || '');
      return mt === 'expense_electricity' || mt === 'expense_insurance' || mt === 'other';
    });
  }
  rows = rows.filter((r) => {
    const kind = String(r.movementType || '').toLowerCase();
    const desc = String(r.description || '').toLowerCase();
    return !query || kind.includes(query) || desc.includes(query);
  });
  rows.sort((a, b) => {
    if (sort === 'amount_desc') return Number(b.amount || 0) - Number(a.amount || 0);
    if (sort === 'amount_asc') return Number(a.amount || 0) - Number(b.amount || 0);
    if (sort === 'date_asc') return String(a.month).localeCompare(String(b.month)) || String(a.dateValue).localeCompare(String(b.dateValue));
    return String(b.month).localeCompare(String(a.month)) || String(b.dateValue).localeCompare(String(a.dateValue));
  });
  container.innerHTML = rows.map((r) => {
    const typeLabel = r.movementType === 'expense_electricity'
      ? 'Luz'
      : (r.movementType === 'expense_insurance' ? 'Seguro' : 'Otro gasto');
    return `<div class="history-item"><div class="history-meta"><span class="history-floor">${r.month} · ${r.dateValue} · ${fmtEur(r.amount || 0)}</span><span class="history-by">${typeLabel}</span><span class="history-by">${r.description || ''}</span></div></div>`;
  }).join('') || '<div class="history-item">Sin gastos.</div>';
}

function setExpenseTypeFilter(type) {
  expenseTypeFilter = type || 'all';
  document.querySelectorAll('[data-expense-tab-btn]').forEach((btn) => {
    btn.classList.toggle('admin-menu-btn-active', btn.getAttribute('data-expense-tab-btn') === expenseTypeFilter);
  });
  renderExpenseEvolutionByType();
  renderFinanceContributionsTable();
}

function renderExpenseEvolutionByType() {
  const el = document.getElementById('finance-expense-evolution');
  if (!el || !financeOverviewData) return;
  const rows = Array.isArray(financeOverviewData.expenseMovements) ? financeOverviewData.expenseMovements : [];
  
  // 1. Obtener la lista de todos los meses de forma ordenada y quedarnos con los últimos 12 meses
  const monthsSet = new Set();
  rows.forEach((r) => {
    const m = String(r.month || '').trim();
    if (/^\d{4}-\d{2}$/.test(m)) {
      monthsSet.add(m);
    }
  });
  const sortedMonths = Array.from(monthsSet).sort().slice(-12);
  const label = expenseTypeFilter === 'expense_electricity'
    ? 'Luz'
    : expenseTypeFilter === 'expense_insurance'
      ? 'Seguro'
      : expenseTypeFilter === 'other'
        ? 'Otros'
        : 'Todos';

  if (!sortedMonths.length) {
    el.innerHTML = `<div class="history-item">Sin datos de evolución para: <strong>${label}</strong>.</div>`;
    return;
  }

  // 2. Mapear los gastos de cada tipo por mes
  const electricityByMonth = {};
  const insuranceByMonth = {};
  const otherByMonth = {};

  sortedMonths.forEach((m) => {
    electricityByMonth[m] = 0;
    insuranceByMonth[m] = 0;
    otherByMonth[m] = 0;
  });

  rows.forEach((r) => {
    const m = String(r.month || '').trim();
    if (!sortedMonths.includes(m)) return;
    const amt = Math.abs(Number(r.amount || 0));
    const mt = String(r.movementType || '');
    if (mt === 'expense_electricity') {
      electricityByMonth[m] += amt;
    } else if (mt === 'expense_insurance') {
      insuranceByMonth[m] += amt;
    } else if (mt === 'other') {
      otherByMonth[m] += amt;
    }
  });

  // calcular totales individuales y globales en este periodo de 12 meses
  let totalElec = 0;
  let totalIns = 0;
  let totalOth = 0;
  sortedMonths.forEach((m) => {
    totalElec += electricityByMonth[m];
    totalIns += insuranceByMonth[m];
    totalOth += otherByMonth[m];
  });
  const totalGlobal = totalElec + totalIns + totalOth;

  // 3. Calcular el valor máximo absoluto para escalar el eje Y
  let maxVal = 1;
  sortedMonths.forEach((m) => {
    if (expenseTypeFilter === 'all') {
      maxVal = Math.max(maxVal, electricityByMonth[m], insuranceByMonth[m], otherByMonth[m]);
    } else if (expenseTypeFilter === 'expense_electricity') {
      maxVal = Math.max(maxVal, electricityByMonth[m]);
    } else if (expenseTypeFilter === 'expense_insurance') {
      maxVal = Math.max(maxVal, insuranceByMonth[m]);
    } else if (expenseTypeFilter === 'other') {
      maxVal = Math.max(maxVal, otherByMonth[m]);
    }
  });
  maxVal = maxVal * 1.15; // 15% de margen superior para evitar colisiones estéticas

  // 4. Parámetros de dibujo SVG
  const width = 1000;
  const height = 220;
  const padX = 42;
  const padY = 24;
  const drawW = width - (padX * 2);
  const drawH = height - (padY * 2);
  const stepX = sortedMonths.length > 1 ? (drawW / (sortedMonths.length - 1)) : 0;

  // Función para obtener coordenadas
  const getCoords = (seriesData) => {
    return sortedMonths.map((month, idx) => {
      const val = Number(seriesData[month] || 0);
      const x = padX + (idx * stepX);
      const y = padY + (drawH - ((val / maxVal) * drawH));
      return { month, val, x, y };
    });
  };

  // Función para renderizar una línea en el SVG
  const getPaths = (coords, strokeColor, gradId) => {
    const linePath = coords.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ');
    const areaPath = `${linePath} L ${(padX + drawW).toFixed(2)} ${(padY + drawH).toFixed(2)} L ${padX.toFixed(2)} ${(padY + drawH).toFixed(2)} Z`;
    
    const stroke = `<path d="${linePath}" class="finance-line-stroke" style="stroke: ${strokeColor}; filter: drop-shadow(0px 4px 8px ${strokeColor}66); stroke-width: 3.5; fill: none;"></path>`;
    const area = `<path d="${areaPath}" class="finance-line-area" style="fill: url(#${gradId}); opacity: 0.15;"></path>`;
    const dots = coords.map((p) => (
      `<circle cx="${p.x.toFixed(2)}" cy="${p.y.toFixed(2)}" r="4.5" class="finance-line-dot" style="stroke: ${strokeColor}; fill: #ffffff; stroke-width: 2.5; filter: drop-shadow(0 0 4px ${strokeColor});">
        <title>${monthLabel(p.month)} · ${fmtEur(p.val)}</title>
      </circle>`
    )).join('');
    
    return { stroke, area, dots };
  };

  // Generar las series de dibujo
  let chartContentHtml = '';
  if (expenseTypeFilter === 'all' || expenseTypeFilter === 'expense_electricity') {
    const coords = getCoords(electricityByMonth);
    const { stroke, area, dots } = getPaths(coords, '#3b82f6', 'financeLineGradElec');
    chartContentHtml += area + stroke + dots;
  }
  if (expenseTypeFilter === 'all' || expenseTypeFilter === 'expense_insurance') {
    const coords = getCoords(insuranceByMonth);
    const { stroke, area, dots } = getPaths(coords, '#10b981', 'financeLineGradIns');
    chartContentHtml += area + stroke + dots;
  }
  if (expenseTypeFilter === 'all' || expenseTypeFilter === 'other') {
    const coords = getCoords(otherByMonth);
    const { stroke, area, dots } = getPaths(coords, '#a78bfa', 'financeLineGradOth');
    chartContentHtml += area + stroke + dots;
  }

  // Eje X ticks
  const ticks = sortedMonths.map((month, idx) => {
    const x = padX + (idx * stepX);
    return `<text x="${x.toFixed(2)}" y="${height - 4}" text-anchor="middle" class="finance-line-x-label">${monthLabel(month)}</text>`;
  }).join('');

  // Título y Leyenda
  let legendHtml = '';
  let subText = `12 últimos meses · Total ${fmtEur(totalGlobal)}`;
  if (expenseTypeFilter === 'all') {
    legendHtml = `
      <div style="display:flex; gap:16px; font-size:0.75rem; color:var(--text-muted); justify-content:flex-end; margin-top:6px; flex-wrap:wrap;">
        <span style="display:inline-flex; align-items:center; gap:6px;"><span style="width:8px; height:8px; border-radius:50%; background:#3b82f6; box-shadow: 0 0 6px #3b82f6; display:inline-block;"></span>Luz (${fmtEur(totalElec)})</span>
        <span style="display:inline-flex; align-items:center; gap:6px;"><span style="width:8px; height:8px; border-radius:50%; background:#10b981; box-shadow: 0 0 6px #10b981; display:inline-block;"></span>Seguros (${fmtEur(totalIns)})</span>
        <span style="display:inline-flex; align-items:center; gap:6px;"><span style="width:8px; height:8px; border-radius:50%; background:#a78bfa; box-shadow: 0 0 6px #a78bfa; display:inline-block;"></span>Otros (${fmtEur(totalOth)})</span>
      </div>
    `;
  } else {
    const activeTotal = expenseTypeFilter === 'expense_electricity' ? totalElec : (expenseTypeFilter === 'expense_insurance' ? totalIns : totalOth);
    subText = `12 últimos meses · Total ${label}: ${fmtEur(activeTotal)}`;
  }

  el.innerHTML = `
    <div class="finance-evo-head">
      <span class="history-floor">Evolución de gastos: ${label}</span>
      <span class="history-by">${subText}</span>
    </div>
    ${legendHtml}
    <div class="finance-line-wrap">
      <svg viewBox="0 0 ${width} ${height}" class="finance-line-svg" role="img" aria-label="Evolución de gastos ${label}">
        <defs>
          <linearGradient id="financeLineGradElec" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#3b82f6"></stop>
            <stop offset="100%" stop-color="rgba(59,130,246,0)"></stop>
          </linearGradient>
          <linearGradient id="financeLineGradIns" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#10b981"></stop>
            <stop offset="100%" stop-color="rgba(16,185,129,0)"></stop>
          </linearGradient>
          <linearGradient id="financeLineGradOth" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#a78bfa"></stop>
            <stop offset="100%" stop-color="rgba(167,139,250,0)"></stop>
          </linearGradient>
        </defs>
        <line x1="${padX}" y1="${padY + drawH}" x2="${padX + drawW}" y2="${padY + drawH}" class="finance-line-axis"></line>
        ${chartContentHtml}
        ${ticks}
      </svg>
    </div>
  `;
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
  const errorEl = document.getElementById('login-error-1');
  
  errorEl.classList.add('hidden');
  pendingLoginUsername = username;
  if (username) localStorage.setItem(LAST_LOGIN_USERNAME_KEY, username);

  try {
    const res = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username })
    });

    const data = await res.json();
    
    if (!res.ok) {
      throw new Error(data.error || 'Credenciales incorrectas');
    }

    if (data.requiresPassword) {
      document.getElementById('login-step1-form').classList.add('hidden');
      document.getElementById('login-password-form').classList.remove('hidden');
      document.getElementById('login-password-fallback').focus();
      return;
    }

    if (data.requires2fa) {
      // Guardar token temporal y pasar al Paso 2
      state.tempLoginToken = data.tempToken;
      document.getElementById('login-step1-form').classList.add('hidden');
      document.getElementById('login-step2-form').classList.remove('hidden');
      document.getElementById('login-2fa-code').focus();
    } else {
      // Inicio de sesión directo (sin 2FA habilitado)
      localStorage.setItem('vt_token', data.token);
      localStorage.setItem('vt_user', JSON.stringify(data.user));
      
      state.token = data.token;
      state.user = data.user;
      
      document.getElementById('login-step1-form').reset();
      renderAuthHeader();
      await loadCommunityStatus();
      showView('dashboard');
    }
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.remove('hidden');
  }
}

async function handlePasskeyLogin() {
  const username = document.getElementById('login-username').value.trim();
  const errorEl = document.getElementById('login-error-1');
  errorEl.classList.add('hidden');

  if (!window.PublicKeyCredential) {
    errorEl.textContent = 'Tu navegador no soporta acceso con huella/passkey.';
    errorEl.classList.remove('hidden');
    return;
  }
  if (!username) {
    errorEl.textContent = 'Introduce primero tu nombre de usuario.';
    errorEl.classList.remove('hidden');
    return;
  }

  try {
    localStorage.setItem(LAST_LOGIN_USERNAME_KEY, username);
    const startRes = await fetch(`${API_URL}/auth/passkey/login/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username })
    });
    const startData = await startRes.json();
    if (!startRes.ok) throw new Error(startData.error || 'No se pudo iniciar acceso por huella.');

    const options = startData.options;
    options.challenge = toArrayBufferFlexible(options.challenge);
    options.allowCredentials = (options.allowCredentials || []).map((c) => ({
      ...c,
      id: toArrayBufferFlexible(c.id)
    }));

    const assertion = await navigator.credentials.get({ publicKey: options });
    if (!assertion) throw new Error('No se pudo obtener credencial de huella/passkey.');

    const credential = {
      id: assertion.id,
      rawId: bufferToB64url(assertion.rawId),
      type: assertion.type,
      response: {
        authenticatorData: bufferToB64url(assertion.response.authenticatorData),
        clientDataJSON: bufferToB64url(assertion.response.clientDataJSON),
        signature: bufferToB64url(assertion.response.signature),
        userHandle: assertion.response.userHandle ? bufferToB64url(assertion.response.userHandle) : null
      }
    };

    const finishRes = await fetch(`${API_URL}/auth/passkey/login/finish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: startData.userId, credential })
    });
    const finishData = await finishRes.json();
    if (!finishRes.ok) throw new Error(finishData.error || 'No se pudo completar login por huella.');

    localStorage.setItem('vt_token', finishData.token);
    localStorage.setItem('vt_user', JSON.stringify(finishData.user));
    state.token = finishData.token;
    state.user = finishData.user;
    renderAuthHeader();
    await loadCommunityStatus();
    showView('dashboard');
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.remove('hidden');
  }
}

// Volver al paso 1 en la vista de login
function backToLoginStep1() {
  document.getElementById('login-step2-form').classList.add('hidden');
  document.getElementById('login-password-form').classList.add('hidden');
  document.getElementById('login-step1-form').classList.remove('hidden');
  document.getElementById('login-2fa-code').value = '';
  document.getElementById('login-password-fallback').value = '';
}

function showPasswordFallback() {
  document.getElementById('login-step2-form').classList.add('hidden');
  document.getElementById('login-password-form').classList.remove('hidden');
  document.getElementById('login-password-fallback').focus();
}

async function handleLoginWithPassword(event) {
  event.preventDefault();
  const password = document.getElementById('login-password-fallback').value;
  const errorEl = document.getElementById('login-error-password');
  errorEl.classList.add('hidden');

  try {
    const res = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: pendingLoginUsername, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudo iniciar sesión con contraseña.');
    if (!data.token) throw new Error('El acceso por contraseña no está disponible para esta cuenta.');

    localStorage.setItem('vt_token', data.token);
    localStorage.setItem('vt_user', JSON.stringify(data.user));
    if (pendingLoginUsername) localStorage.setItem(LAST_LOGIN_USERNAME_KEY, pendingLoginUsername);
    state.token = data.token;
    state.user = data.user;
    state.tempLoginToken = null;

    document.getElementById('login-step1-form').reset();
    document.getElementById('login-step2-form').reset();
    document.getElementById('login-password-form').reset();
    backToLoginStep1();

    renderAuthHeader();
    await loadCommunityStatus();
    showView('dashboard');
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.remove('hidden');
  }
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
    if (pendingLoginUsername) localStorage.setItem(LAST_LOGIN_USERNAME_KEY, pendingLoginUsername);
    
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
    const res = await fetch(`${API_URL}/auth/register/validate?token=${token}`);
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
  const passwordConfirm = document.getElementById('reg-password-confirm').value;
  const phone = document.getElementById('reg-phone').value.trim();
  const errorEl = document.getElementById('register-error-1');
  
  errorEl.classList.add('hidden');
  
  if (password !== passwordConfirm) {
    errorEl.textContent = 'Las contraseñas no coinciden. Revísalas e inténtalo de nuevo.';
    errorEl.classList.remove('hidden');
    return;
  }
  const normalizedPhone = normalizeSpanishPhoneInput(phone);
  if (phone && !normalizedPhone) {
    errorEl.textContent = 'Teléfono inválido. Introduce 9 dígitos de España, con o sin +34.';
    errorEl.classList.remove('hidden');
    return;
  }

  try {
    const res = await fetch(`${API_URL}/auth/register/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: state.activeRegisterToken,
        username,
        password,
        passwordConfirm,
        phone: normalizedPhone || ''
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
    const res = await fetch(`${API_URL}/auth/register/verify-2fa`, {
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
    
    showToast('🎉 ¡Registro completado correctamente! Ya tienes acceso a VeciTurno con Doble Factor.', 'success');
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
  
  const displayName = state.user.username || state.user.floor;
  document.getElementById('profile-title').textContent = `Mi Perfil: ${displayName}`;
  
  // Cargar teléfono actual si existe
  const neighbor = state.statusData.neighbors.find(n => n.id === state.user.id);
  document.getElementById('profile-phone').value = neighbor ? neighbor.phone : '';
  const passkeyBadge = document.getElementById('profile-passkey-badge');
  if (passkeyBadge) {
    const active = !!(neighbor && neighbor.passkeyRegistered);
    passkeyBadge.classList.toggle('hidden', !active);
    if (active) {
      const count = Number(neighbor.passkeyCount || 1);
      passkeyBadge.innerHTML = `<i data-lucide="fingerprint" style="width:12px;height:12px;margin-right:4px;"></i> Huellas/Passkeys activas: ${count}`;
      lucide.createIcons();
    }
  }
  loadProfilePasskeys();
  
  // Limpiar mensajes
  document.getElementById('profile-success').classList.add('hidden');
  document.getElementById('profile-error').classList.add('hidden');
  document.getElementById('profile-password').value = '';
  document.getElementById('profile-password-confirm').value = '';
  
  showView('profile');
}

async function loadProfilePasskeys() {
  if (!state.token || !state.user) return;
  const list = document.getElementById('profile-passkey-list');
  if (!list) return;
  try {
    const res = await fetch(`${API_URL}/neighbors/passkey/list`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudo cargar listado de huellas.');
    const items = data.passkeys || [];
    if (!items.length) {
      list.innerHTML = '<div class="history-item">No hay huellas/passkeys activas.</div>';
      return;
    }
    list.innerHTML = items.map((p) => {
      const when = p.createdAt ? new Date(p.createdAt).toLocaleString('es-ES') : 'Fecha desconocida';
      const safeLabel = String(p.label || 'Dispositivo').replace(/'/g, "\\'");
      return `<div class="history-item"><div class="history-meta"><span class="history-floor">${p.label}</span><span class="history-by">${when}</span></div><div style="display:flex; gap:6px;"><button class="btn btn-secondary btn-icon" type="button" onclick="openRenamePasskeyModal('${p.id}', '${safeLabel}')"><i data-lucide="pencil" style="width:14px;height:14px;"></i></button><button class="btn btn-secondary btn-icon" type="button" onclick="openRevokePasskeyModal('${p.id}', '${safeLabel}')"><i data-lucide="trash-2" style="width:14px;height:14px;"></i></button></div></div>`;
    }).join('');
    lucide.createIcons();
  } catch (err) {
    list.innerHTML = `<div class="history-item">Error: ${err.message}</div>`;
  }
}

function openRenamePasskeyModal(credentialID, currentLabel) {
  passkeyActionState.mode = 'rename';
  passkeyActionState.credentialID = credentialID;
  passkeyActionState.currentLabel = currentLabel || 'Dispositivo';
  const title = document.getElementById('passkey-action-title');
  const subtitle = document.getElementById('passkey-action-subtitle');
  const submit = document.getElementById('passkey-action-submit');
  const labelGroup = document.getElementById('passkey-label-group');
  const input = document.getElementById('passkey-action-label');
  const errorEl = document.getElementById('passkey-action-error');
  if (title) title.textContent = 'Renombrar Dispositivo';
  if (subtitle) subtitle.textContent = 'Asigna un nombre claro para reconocer esta huella/passkey';
  if (submit) submit.innerHTML = '<i data-lucide="save"></i><span>Guardar nombre</span>';
  if (labelGroup) labelGroup.classList.remove('hidden');
  if (input) input.value = passkeyActionState.currentLabel;
  if (errorEl) errorEl.classList.add('hidden');
  showView('passkey-manage');
  lucide.createIcons();
}

function openRevokePasskeyModal(credentialID, currentLabel) {
  passkeyActionState.mode = 'revoke';
  passkeyActionState.credentialID = credentialID;
  passkeyActionState.currentLabel = currentLabel || 'Dispositivo';
  const title = document.getElementById('passkey-action-title');
  const subtitle = document.getElementById('passkey-action-subtitle');
  const submit = document.getElementById('passkey-action-submit');
  const labelGroup = document.getElementById('passkey-label-group');
  const errorEl = document.getElementById('passkey-action-error');
  if (title) title.textContent = 'Revocar Dispositivo';
  if (subtitle) subtitle.textContent = `¿Seguro que quieres revocar "${passkeyActionState.currentLabel}"?`;
  if (submit) submit.innerHTML = '<i data-lucide="trash-2"></i><span>Revocar</span>';
  if (labelGroup) labelGroup.classList.add('hidden');
  if (errorEl) errorEl.classList.add('hidden');
  showView('passkey-manage');
  lucide.createIcons();
}

function closePasskeyActionModal() {
  showView('profile');
}

async function submitPasskeyAction(event) {
  event.preventDefault();
  if (!state.token || !state.user) return;
  const errorEl = document.getElementById('passkey-action-error');
  if (errorEl) errorEl.classList.add('hidden');

  try {
    let res;
    if (passkeyActionState.mode === 'rename') {
      const label = (document.getElementById('passkey-action-label')?.value || '').trim();
      res = await fetch(`${API_URL}/neighbors/passkey/rename`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${state.token}`
        },
        body: JSON.stringify({ credentialID: passkeyActionState.credentialID, label })
      });
    } else if (passkeyActionState.mode === 'revoke') {
      res = await fetch(`${API_URL}/neighbors/passkey/revoke`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${state.token}`
        },
        body: JSON.stringify({ credentialID: passkeyActionState.credentialID })
      });
    } else {
      throw new Error('Acción de passkey no válida.');
    }

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudo completar la acción sobre passkey.');
    showToast(data.message || 'Operación completada.', 'success');
    await loadCommunityStatus();
    await loadProfilePasskeys();
    openProfileModal();
  } catch (err) {
    if (errorEl) {
      errorEl.textContent = err.message;
      errorEl.classList.remove('hidden');
    } else {
      showToast(`Error: ${err.message}`, 'error');
    }
  }
}

// Guardar cambios de perfil
async function handleProfileUpdate(event) {
  event.preventDefault();
  
  const phone = document.getElementById('profile-phone').value.trim();
  const password = document.getElementById('profile-password').value;
  const passwordConfirm = document.getElementById('profile-password-confirm').value;
  const successEl = document.getElementById('profile-success');
  const errorEl = document.getElementById('profile-error');
  
  successEl.classList.add('hidden');
  errorEl.classList.add('hidden');

  if (password && password !== passwordConfirm) {
    errorEl.textContent = 'La nueva contraseña y su confirmación no coinciden.';
    errorEl.classList.remove('hidden');
    return;
  }
  const normalizedPhone = normalizeSpanishPhoneInput(phone);
  if (phone && !normalizedPhone) {
    errorEl.textContent = 'Teléfono inválido. Introduce 9 dígitos de España, con o sin +34.';
    errorEl.classList.remove('hidden');
    return;
  }

  try {
    const res = await fetch(`${API_URL}/neighbors/update`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify({ phone: normalizedPhone || '', password, passwordConfirm })
    });

    const data = await res.json();
    
    if (!res.ok) {
      throw new Error(data.error || 'Error al guardar cambios');
    }

    successEl.textContent = data.message;
    successEl.classList.remove('hidden');
    
    document.getElementById('profile-password').value = '';
    document.getElementById('profile-password-confirm').value = '';
    
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

let adminWaPollInterval = null;

// Abrir consola de administrador
async function openAdminPanel() {
  if (!state.token || !state.user || !state.user.isAdmin) return;
  
  // Limpiar formulario y enlaces generados
  document.getElementById('admin-invite-form').reset();
  document.getElementById('admin-invite-success').classList.add('hidden');
  
  showView('admin');
  renderAdminUnitSelectors();
  await loadCommunityStructureConfig();
  await loadFeeConfig();
  await loadAdminOwnerConfig();
  renderSecurityPanel();
  adminShowPanel('config');
  
  // Cargar lista de invitaciones existentes
  await loadAdminInvites();
  await loadWhatsAppGroupsAndConfig();
  await loadWhatsAppTemplates();
  await loadNotificationLogs();
  await loadIncidents();

  // Iniciar sondeo en vivo del estado de WhatsApp Web
  startWhatsAppPolling();
}

async function loadFeeConfig() {
  if (!state.token || !state.user || !state.user.isAdmin) return;
  try {
    const res = await fetch(`${API_URL}/admin/fees/config`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudo cargar configuración de cuotas.');
    const feeHousingEl = document.getElementById('fee-housing');
    const feeCommercialEl = document.getElementById('fee-commercial');
    if (feeHousingEl) feeHousingEl.value = Number(data.defaultFeeHousing || 25);
    if (feeCommercialEl) feeCommercialEl.value = Number(data.defaultFeeCommercial || 20);
    const list = document.getElementById('admin-fee-units-list');
    if (!list) return;
    list.innerHTML = (data.units || []).map((u) => {
      const currentOverride = u.monthlyFeeOverride === null || u.monthlyFeeOverride === undefined ? '' : Number(u.monthlyFeeOverride);
      const kind = u.kind === 'comercial' ? 'Local' : 'Vivienda';
      return `<div class="history-item fee-unit-row"><div class="history-meta"><span class="history-floor">${u.floor}</span><span class="history-by">${kind} · Efectiva ${Number(u.effectiveMonthlyFee || 0).toFixed(2)} €/mes</span></div><div class="fee-unit-actions"><div class="input-wrapper fee-override-wrapper"><i data-lucide="euro"></i><input class="fee-override-input" type="number" min="0" step="0.01" id="fee-override-${u.id}" placeholder="Usar base" value="${currentOverride}"></div><button class="btn btn-secondary btn-icon" type="button" onclick="saveUnitFeeOverride('${u.id}')" title="Guardar override"><i data-lucide="save" style="width:14px;height:14px;"></i></button></div></div>`;
    }).join('') || '<div class="history-item">Sin unidades.</div>';
    lucide.createIcons();
  } catch (err) {
    const errorEl = document.getElementById('admin-fee-error');
    if (errorEl) {
      errorEl.textContent = err.message;
      errorEl.classList.remove('hidden');
    }
  }
}

async function handleSaveFeeConfig(event) {
  event.preventDefault();
  if (!state.token || !state.user || !state.user.isAdmin) return;
  const successEl = document.getElementById('admin-fee-success');
  const errorEl = document.getElementById('admin-fee-error');
  successEl.classList.add('hidden');
  errorEl.classList.add('hidden');
  try {
    const defaultFeeHousing = Number(document.getElementById('fee-housing').value);
    const defaultFeeCommercial = Number(document.getElementById('fee-commercial').value);
    const res = await fetch(`${API_URL}/admin/fees/config`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify({ defaultFeeHousing, defaultFeeCommercial })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudieron guardar las cuotas.');
    successEl.textContent = data.message || 'Cuotas base actualizadas.';
    successEl.classList.remove('hidden');
    await loadFeeConfig();
    await loadCommunityStatus();
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.remove('hidden');
  }
}

async function saveUnitFeeOverride(unitId) {
  if (!state.token || !state.user || !state.user.isAdmin) return;
  const input = document.getElementById(`fee-override-${unitId}`);
  const raw = input ? input.value.trim() : '';
  const monthlyFeeOverride = raw === '' ? null : Number(raw);
  const successEl = document.getElementById('admin-fee-success');
  const errorEl = document.getElementById('admin-fee-error');
  successEl.classList.add('hidden');
  errorEl.classList.add('hidden');
  try {
    const res = await fetch(`${API_URL}/admin/fees/unit-override`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify({ unitId, monthlyFeeOverride })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudo guardar el override.');
    successEl.textContent = data.message || 'Override actualizado.';
    successEl.classList.remove('hidden');
    await loadFeeConfig();
    await loadCommunityStatus();
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.remove('hidden');
  }
}

async function handleFinanceExcelImport(event) {
  event.preventDefault();
  if (!state.token || !state.user || !state.user.isAdmin) return;
  const fileInput = document.getElementById('finance-excel-file');
  const successEl = document.getElementById('admin-finance-excel-success');
  const errorEl = document.getElementById('admin-finance-excel-error');
  if (!fileInput || !fileInput.files || fileInput.files.length === 0) return;

  successEl.classList.add('hidden');
  errorEl.classList.add('hidden');

  try {
    const fd = new FormData();
    fd.append('file', fileInput.files[0]);
    const res = await fetch(`${API_URL}/admin/finance/import-excel`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${state.token}` },
      body: fd
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudo importar el Excel.');
    const extra = Array.isArray(data.errors) && data.errors.length
      ? ` (con avisos: ${data.errors.length})`
      : '';
    successEl.textContent = `${data.message || 'Excel importado correctamente.'}${extra}`;
    successEl.classList.remove('hidden');
    fileInput.value = '';
    await loadMovementAssignments();
    await loadFinanceRecords();
    await loadFinanceContributions();
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.remove('hidden');
  }
}

async function resetFinanceData() {
  if (!state.token || !state.user || !state.user.isAdmin) return;
  const successEl = document.getElementById('admin-finance-excel-success');
  const errorEl = document.getElementById('admin-finance-excel-error');
  if (successEl) successEl.classList.add('hidden');
  if (errorEl) errorEl.classList.add('hidden');

  const confirmReset = window.confirm('Esto borrará movimientos, aportaciones, histórico mensual y saldo actual. ¿Continuar?');
  if (!confirmReset) return;

  try {
    const res = await fetch(`${API_URL}/admin/finance/reset`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify({ clearAssignments: false })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudo reiniciar finanzas.');
    if (successEl) {
      successEl.textContent = data.message || 'Finanzas reiniciadas.';
      successEl.classList.remove('hidden');
    }
    await loadFinanceRecords();
    await loadFinanceContributions();
  } catch (err) {
    if (errorEl) {
      errorEl.textContent = err.message;
      errorEl.classList.remove('hidden');
    }
  }
}

async function loadFinanceRecords() {
  if (!state.token || !state.user || !state.user.isAdmin) return;
  const list = document.getElementById('admin-finance-records-list');
  const balanceBox = document.getElementById('admin-finance-current-balance');
  if (!list) return;
  try {
    const res = await fetch(`${API_URL}/admin/finance/records`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudieron cargar los registros.');
    if (balanceBox) {
      if (data.currentBankBalance === null || data.currentBankBalance === undefined) {
        balanceBox.innerHTML = '<span>Saldo actual: sin dato todavía (importa extracto bancario para calcularlo).</span>';
      } else {
        balanceBox.innerHTML = `<span><strong>Saldo total actual en cuenta:</strong> ${fmtEur(data.currentBankBalance)}</span>`;
      }
    }
    let records = Array.isArray(data.records) ? data.records.slice() : [];
    const sortMode = document.getElementById('admin-finance-records-sort')?.value || 'asc';
    records.sort((a, b) => String(a.month || '').localeCompare(String(b.month || '')));
    if (sortMode === 'desc') records.reverse();
    if (!records.length) {
      list.innerHTML = '<div class="history-item">Todavía no hay meses importados.</div>';
      return;
    }
    list.innerHTML = records.map((r) => {
      const income = Number(r.incomeFees || 0);
      const luz = Number(r.expenseElectricity || 0);
      const seguro = Number(r.expenseInsurance || 0);
      const balance = income - luz - seguro;
      return `<div class="history-item"><div class="history-meta"><span class="history-floor">${r.month}</span><span class="history-by">Ingresos: ${fmtEur(income)} · Luz: ${fmtEur(luz)} · Seguro: ${fmtEur(seguro)} · Balance: ${fmtEur(balance)}</span></div></div>`;
    }).join('');
  } catch (err) {
    list.innerHTML = `<div class="history-item">Error: ${err.message}</div>`;
  }
}

async function loadFinanceContributions() {
  if (!state.token || !state.user || !state.user.isAdmin) return;
  const list = document.getElementById('admin-finance-contributions-list');
  if (!list) return;
  try {
    const res = await fetch(`${API_URL}/admin/finance/contributions?limit=800`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudo cargar el desglose de aportaciones.');
    const sortMode = document.getElementById('admin-finance-contrib-sort')?.value || 'asc';
    const rows = (Array.isArray(data.contributions) ? data.contributions.slice() : [])
      .sort((a, b) => String(a.month || '').localeCompare(String(b.month || '')) || String(a.dateValue || '').localeCompare(String(b.dateValue || '')));
    if (sortMode === 'desc') rows.reverse();
    if (!rows.length) {
      list.innerHTML = '<div class="history-item">Sin aportaciones registradas todavía.</div>';
      return;
    }
    list.innerHTML = rows.map((r) => {
      const unit = r.matched ? (r.unitName || r.unitId) : 'Sin asignar';
      const status = r.matched ? 'Asignada' : 'Pendiente asignación';
      return `<div class="history-item"><div class="history-meta"><span class="history-floor">${r.month} · ${r.dateValue} · ${Number(r.amount || 0).toFixed(2)} €</span><span class="history-by">${status} a: ${unit}</span><span class="history-by">${r.description || ''}</span></div></div>`;
    }).join('');
  } catch (err) {
    list.innerHTML = `<div class="history-item">Error: ${err.message}</div>`;
  }
}

async function loadMovementAssignments() {
  if (!state.token || !state.user || !state.user.isAdmin) return;
  const list = document.getElementById('admin-movement-assignments-list');
  const unitSelect = document.getElementById('movement-unit-id');
  if (!list || !unitSelect) return;
  try {
    const [resAssignments, resStatus] = await Promise.all([
      fetch(`${API_URL}/admin/finance/movement-assignments`, {
        headers: { 'Authorization': `Bearer ${state.token}` }
      }),
      fetch(`${API_URL}/public/status?_t=${Date.now()}`)
    ]);
    const aData = await resAssignments.json();
    const sData = await resStatus.json();
    if (!resAssignments.ok) throw new Error(aData.error || 'No se pudieron cargar asignaciones.');
    if (!resStatus.ok) throw new Error(sData.error || 'No se pudieron cargar unidades.');
    const units = (sData.neighbors || []).slice().sort((a, b) => Number(a.id) - Number(b.id));
    unitSelect.innerHTML = '<option value="">Selecciona una unidad</option>' + units.map((u) => `<option value="${u.id}">${u.floor}</option>`).join('');

    const rows = aData.assignments || [];
    if (!rows.length) {
      list.innerHTML = '<div class="history-item">Sin asignaciones guardadas todavía.</div>';
      return;
    }
    const unitOptions = units.map((u) => `<option value="${u.id}">${u.floor}</option>`).join('');
    list.innerHTML = rows.map((r, idx) => (
      `<div class="history-item"><div class="history-meta"><div class="input-wrapper"><i data-lucide="tag"></i><input id="movement-inline-key-${idx}" type="text" value="${String(r.payerKey || '').replace(/"/g, '&quot;')}"></div><span class="history-by">Asignado a: ${r.unitName}</span><div class="input-wrapper" style="margin-top:6px;"><i data-lucide="home"></i><select id="movement-inline-unit-${idx}">${unitOptions}</select></div></div><div style="display:flex;gap:8px;"><button type="button" class="btn btn-secondary btn-icon" onclick="saveInlineMovementAssignment('${encodeURIComponent(r.payerKey)}','movement-inline-unit-${idx}','movement-inline-key-${idx}')" title="Guardar"><i data-lucide="save" style="width:14px;height:14px;"></i></button><button type="button" class="btn btn-secondary btn-icon" onclick="deleteMovementAssignment('${encodeURIComponent(r.payerKey)}')" title="Eliminar"><i data-lucide="trash-2" style="width:14px;height:14px;"></i></button></div></div>`
    )).join('');
    rows.forEach((r, idx) => {
      const sel = document.getElementById(`movement-inline-unit-${idx}`);
      if (sel) sel.value = r.unitId || '';
    });
    lucide.createIcons();
  } catch (err) {
    list.innerHTML = `<div class="history-item">Error: ${err.message}</div>`;
  }
}

async function saveInlineMovementAssignment(encodedPayerKey, selectId, keyInputId) {
  const payerKey = decodeURIComponent(encodedPayerKey || '');
  const select = document.getElementById(selectId);
  const keyInput = document.getElementById(keyInputId);
  if (!select || !keyInput) return;
  const newPayerKey = keyInput.value.trim();
  const successEl = document.getElementById('admin-movement-success');
  const errorEl = document.getElementById('admin-movement-error');
  if (successEl) successEl.classList.add('hidden');
  if (errorEl) errorEl.classList.add('hidden');
  try {
    if (newPayerKey && newPayerKey !== payerKey) {
      const renameRes = await fetch(`${API_URL}/admin/finance/movement-assignments/rename`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${state.token}`
        },
        body: JSON.stringify({ oldPayerKey: payerKey, newPayerKey })
      });
      const renameData = await renameRes.json();
      if (!renameRes.ok) throw new Error(renameData.error || 'No se pudo renombrar la asignación.');
    }
    const effectiveKey = newPayerKey || payerKey;
    const res = await fetch(`${API_URL}/admin/finance/movement-assignments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify({ payerKey: effectiveKey, unitId: select.value })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudo guardar la asignación inline.');
    if (successEl) {
      successEl.textContent = data.message || 'Asignación actualizada.';
      successEl.classList.remove('hidden');
    }
    await loadMovementAssignments();
    await loadFinanceContributions();
  } catch (err) {
    if (errorEl) {
      errorEl.textContent = err.message;
      errorEl.classList.remove('hidden');
    }
  }
}

function editMovementAssignment(encodedPayerKey, unitId) {
  const payerInput = document.getElementById('movement-payer-key');
  const unitSelect = document.getElementById('movement-unit-id');
  if (!payerInput || !unitSelect) return;
  payerInput.value = decodeURIComponent(encodedPayerKey || '');
  unitSelect.value = unitId || '';
  payerInput.focus();
}

async function handleAddMovementAssignment(event) {
  event.preventDefault();
  if (!state.token || !state.user || !state.user.isAdmin) return;
  const payerInput = document.getElementById('movement-payer-key');
  const unitSelect = document.getElementById('movement-unit-id');
  const successEl = document.getElementById('admin-movement-success');
  const errorEl = document.getElementById('admin-movement-error');
  if (!payerInput || !unitSelect || !successEl || !errorEl) return;
  successEl.classList.add('hidden');
  errorEl.classList.add('hidden');
  try {
    const payerKey = payerInput.value.trim();
    const unitId = unitSelect.value;
    const res = await fetch(`${API_URL}/admin/finance/movement-assignments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify({ payerKey, unitId })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudo guardar la asignación.');
    const relinkedInfo = Number.isFinite(Number(data.relinked))
      ? ` Aportaciones enlazadas: ${Number(data.relinked)}.`
      : '';
    successEl.textContent = `${data.message || 'Asignación guardada.'}${relinkedInfo}`;
    successEl.classList.remove('hidden');
    payerInput.value = '';
    unitSelect.value = '';
    await loadMovementAssignments();
    await loadFinanceContributions();
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.remove('hidden');
  }
}

async function deleteMovementAssignment(encodedPayerKey) {
  if (!state.token || !state.user || !state.user.isAdmin) return;
  const successEl = document.getElementById('admin-movement-success');
  const errorEl = document.getElementById('admin-movement-error');
  if (successEl) successEl.classList.add('hidden');
  if (errorEl) errorEl.classList.add('hidden');
  try {
    const res = await fetch(`${API_URL}/admin/finance/movement-assignments/${encodedPayerKey}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudo eliminar la asignación.');
    if (successEl) {
      successEl.textContent = data.message || 'Asignación eliminada.';
      successEl.classList.remove('hidden');
    }
    await loadMovementAssignments();
  } catch (err) {
    if (errorEl) {
      errorEl.textContent = err.message;
      errorEl.classList.remove('hidden');
    }
  }
}

// Cerrar consola de administrador
function closeAdminPanel() {
  // Limpiar el intervalo de sondeo para no consumir recursos en segundo plano
  if (adminWaPollInterval) {
    clearInterval(adminWaPollInterval);
    adminWaPollInterval = null;
    console.log('[WhatsApp Autohospedado] Polling de WhatsApp detenido.');
  }
  showView('dashboard');
}

function adminGoTo(sectionId) {
  const section = document.getElementById(sectionId);
  if (!section) return;
  section.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function adminShowPanel(panelKey) {
  const config = document.getElementById('admin-section-config');
  const fees = document.getElementById('admin-section-fees');
  const finance = document.getElementById('admin-section-finance');
  const security = document.getElementById('admin-section-security');
  const grid = document.querySelector('.admin-grid');
  const users = document.getElementById('admin-section-users');
  const invites = document.getElementById('admin-section-invites');
  const visualization = document.getElementById('admin-section-visualization');
  const whatsapp = document.getElementById('admin-section-whatsapp');
  const invitesTable = invites ? invites.querySelector('.invite-table-container') : null;
  const invitesTitle = invites ? invites.querySelector('h3') : null;

  if (config) config.style.display = 'none';
  if (fees) fees.style.display = 'none';
  if (finance) finance.style.display = 'none';
  if (security) security.style.display = 'none';
  if (grid) grid.style.display = 'none';
  if (grid) grid.classList.remove('admin-grid-single-panel');
  if (users) users.style.display = 'none';
  if (invites) invites.style.display = 'none';
  if (visualization) visualization.style.display = 'none';
  if (whatsapp) whatsapp.style.display = 'none';
  if (invitesTable) invitesTable.style.display = '';
  if (invitesTitle) invitesTitle.style.display = '';

  if (panelKey === 'config' && config) {
    config.style.display = '';
    loadActiveTurnOptions();
  }
  if (panelKey === 'fees' && fees) fees.style.display = '';
  if (panelKey === 'finance' && finance) {
    finance.style.display = '';
    loadMovementAssignments();
    loadFinanceRecords();
    loadFinanceContributions();
  }
  if (panelKey === 'security' && security) security.style.display = '';
  if (panelKey === 'visualization' && visualization) {
    visualization.style.display = '';
    loadForceTurnPanelOptions();
  }

  if (panelKey === 'users' && grid && users) {
    grid.style.display = '';
    grid.classList.add('admin-grid-single-panel');
    users.style.display = 'flex';
    users.style.flexDirection = 'column';
    loadAdminNeighborsManagement();
    renderSecurityPanel();
  }

  if (panelKey === 'invites' && grid && invites) {
    grid.style.display = '';
    grid.classList.add('admin-grid-single-panel');
    invites.style.display = 'flex';
    invites.style.flexDirection = 'column';
    if (whatsapp) whatsapp.style.display = 'none';
    if (invitesTitle) invitesTitle.style.display = '';
    if (invitesTable) invitesTable.style.display = '';
  }

  if (panelKey === 'whatsapp' && grid && invites) {
    grid.style.display = '';
    grid.classList.add('admin-grid-single-panel');
    invites.style.display = 'flex';
    invites.style.flexDirection = 'column';
    if (invitesTable) invitesTable.style.display = 'none';
    if (invitesTitle) invitesTitle.style.display = 'none';
    if (whatsapp) whatsapp.style.display = '';
  }

  document.querySelectorAll('[data-admin-panel-btn]').forEach((btn) => {
    const isActive = btn.getAttribute('data-admin-panel-btn') === panelKey;
    btn.classList.toggle('admin-menu-btn-active', isActive);
  });
}

async function loadCommunityStructureConfig() {
  if (!state.token || !state.user || !state.user.isAdmin) return;

  try {
    const res = await fetch(`${API_URL}/admin/community/structure`, {
      headers: {
        'Authorization': `Bearer ${state.token}`
      }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudo cargar la estructura.');
    adminBuildingUnits = (data.structure || []).map(u => ({
      portal: u.portal,
      floor: u.floor,
      door: u.door,
      name: u.name || '',
      legalName: u.legalName || '',
      kind: u.kind || 'vivienda',
      exemptFromCleaning: !!u.exemptFromCleaning
    }));
    renderBuildingUnitsList();
    renderAdminUnitSelectors();
  } catch (err) {
    console.error('Error cargando estructura de comunidad:', err);
  }
}

function renderBuildingUnitsList() {
  const container = document.getElementById('admin-structure-units-list');
  if (!container) return;
  if (!adminBuildingUnits.length) {
    container.innerHTML = '<div class="history-item">Sin unidades configuradas.</div>';
    return;
  }
  container.innerHTML = adminBuildingUnits.map((u, idx) => {
    const labelKind = u.kind === 'comercial' ? 'Local Comercial' : 'Vivienda';
    const parts = [];
    if (u.portal) parts.push(`Portal ${u.portal}`);
    parts.push(`${u.kind === 'comercial' ? 'Bajo' : 'Planta'} ${u.floor}`);
    if (u.door) parts.push(`${u.kind === 'comercial' ? 'Local' : 'Puerta'} ${u.door}`);
    const generatedLabel = parts.join(' · ');
    const safeName = String(u.name || '').replace(/"/g, '&quot;');
    const safeLegalName = String(u.legalName || '').replace(/"/g, '&quot;');
    return `<div class="history-item"><div class="history-meta" style="width:100%;"><div class="input-wrapper" style="margin-top:2px;"><i data-lucide="tag"></i><input type="text" value="${safeName}" placeholder="${generatedLabel}" oninput="updateBuildingUnitName(${idx}, this.value)"></div><div class="input-wrapper" style="margin-top:8px;"><i data-lucide="file-text"></i><input type="text" value="${safeLegalName}" placeholder="Nombre legal para documentación (opcional)" oninput="updateBuildingUnitLegalName(${idx}, this.value)"></div><span class="history-by" style="margin-top:8px;">${labelKind}${u.exemptFromCleaning ? ' · Exenta de limpieza' : ''}</span><label style="display:inline-flex;align-items:center;gap:8px;margin-top:8px;font-size:0.75rem;color:var(--text-muted);"><input type="checkbox" ${u.exemptFromCleaning ? 'checked' : ''} onchange="toggleBuildingUnitExempt(${idx}, this.checked)"> Exenta del turno de limpieza</label></div><button type="button" class="btn btn-secondary btn-icon" onclick="removeBuildingUnit(${idx})" title="Eliminar"><i data-lucide="trash-2" style="width:14px;height:14px;"></i></button></div>`;
  }).join('');
  lucide.createIcons();
}

function handleAddBuildingUnit(event) {
  event.preventDefault();
  const portal = document.getElementById('builder-portal').value.trim();
  const kind = document.getElementById('builder-kind').value;
  const name = document.getElementById('builder-name').value.trim();
  const legalName = document.getElementById('builder-legal-name').value.trim();
  const floor = document.getElementById('builder-floor').value.trim();
  const door = document.getElementById('builder-door').value.trim();
  const exemptFromCleaning = !!document.getElementById('builder-exempt')?.checked;
  if (!name || !floor) return;
  adminBuildingUnits.push({ portal, kind, name, legalName, floor, door, exemptFromCleaning });
  document.getElementById('admin-structure-builder-form').reset();
  document.getElementById('builder-kind').value = 'vivienda';
  renderBuildingUnitsList();
}

function updateBuildingUnitName(index, value) {
  if (!adminBuildingUnits[index]) return;
  adminBuildingUnits[index].name = String(value || '').trim();
}

function updateBuildingUnitLegalName(index, value) {
  if (!adminBuildingUnits[index]) return;
  adminBuildingUnits[index].legalName = String(value || '').trim();
}

function toggleBuildingUnitExempt(index, checked) {
  if (!adminBuildingUnits[index]) return;
  adminBuildingUnits[index].exemptFromCleaning = !!checked;
}

function removeBuildingUnit(index) {
  adminBuildingUnits.splice(index, 1);
  renderBuildingUnitsList();
}

function clearBuildingUnits() {
  adminBuildingUnits = [];
  renderBuildingUnitsList();
}

async function resetBuildingUnitsToCurrent() {
  await loadCommunityStructureConfig();
}

async function handleUpdateCommunityStructure(event) {
  event.preventDefault();

  const successEl = document.getElementById('admin-structure-success');
  const errorEl = document.getElementById('admin-structure-error');

  successEl.classList.add('hidden');
  errorEl.classList.add('hidden');

  try {
    const units = adminBuildingUnits;
    if (!Array.isArray(units) || units.length === 0) {
      throw new Error('Debes incluir al menos una vivienda en la estructura.');
    }

    const res = await fetch(`${API_URL}/admin/community/structure`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify({ units })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudo guardar la estructura.');

    successEl.textContent = data.message || 'Estructura actualizada correctamente.';
    successEl.classList.remove('hidden');

    await loadCommunityStatus();
    renderAdminUnitSelectors();
    await loadFeeConfig();
    await loadAdminOwnerConfig();
    await loadAdminInvites();
    renderSecurityPanel();
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.remove('hidden');
  }
}

async function loadAdminOwnerConfig() {
  if (!state.token || !state.user || !state.user.isAdmin) return;
  const select = document.getElementById('admin-owner-floor');
  if (!select) return;
  const neighbors = (state.statusData?.neighbors || []).slice().sort((a, b) => Number(a.id) - Number(b.id));
  const options = ['<option value="">Sin vincular a unidad</option>']
    .concat(neighbors.map((n) => `<option value="${n.id}">${n.floor}</option>`));
  select.innerHTML = options.join('');
  try {
    const res = await fetch(`${API_URL}/admin/admin-identity/config`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudo cargar la vinculación del admin.');
    select.value = data.adminOwnerFloorId || '';
  } catch (err) {
    const errorEl = document.getElementById('admin-owner-error');
    if (errorEl) {
      errorEl.textContent = err.message;
      errorEl.classList.remove('hidden');
    }
  }
}

async function handleSaveAdminOwner(event) {
  event.preventDefault();
  if (!state.token || !state.user || !state.user.isAdmin) return;
  const select = document.getElementById('admin-owner-floor');
  const successEl = document.getElementById('admin-owner-success');
  const errorEl = document.getElementById('admin-owner-error');
  if (!select || !successEl || !errorEl) return;
  successEl.classList.add('hidden');
  errorEl.classList.add('hidden');
  try {
    const res = await fetch(`${API_URL}/admin/admin-identity/config`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify({ adminOwnerFloorId: select.value || '' })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudo guardar la vinculación.');
    successEl.textContent = data.message || 'Vinculación guardada.';
    successEl.classList.remove('hidden');
    await loadCommunityStatus();
    await loadAdminOwnerConfig();
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.remove('hidden');
  }
}

function renderSecurityPanel() {
  const summaryEl = document.getElementById('admin-security-summary');
  if (!summaryEl) return;
  const neighbors = (state.statusData?.neighbors || []).filter(n => !n.isAdmin);
  const total = neighbors.length;
  const enabled = neighbors.filter(n => n.twoFactorRegistered).length;
  const pending = total - enabled;
  summaryEl.innerHTML = `<span>2FA Activo: <strong>${enabled}</strong> / ${total} vecinos · Pendientes: <strong>${pending}</strong></span>`;
  
  const listEl = document.getElementById('admin-security-list');
  if (!listEl) return;
  if (!neighbors.length) {
    listEl.innerHTML = '<div class="history-item">No hay vecinos para evaluar seguridad.</div>';
    return;
  }
  listEl.innerHTML = neighbors.map(n => {
    const badge = n.twoFactorRegistered ? 'badge-success' : 'badge-danger';
    const txt = n.twoFactorRegistered ? '2FA activo' : '2FA pendiente';
    return `<div class="history-item"><div class="history-meta"><span class="history-floor">${n.floor}</span><span class="history-by">${n.phone || 'Sin teléfono'}</span></div><span class="badge ${badge}">${txt}</span></div>`;
  }).join('');
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
      
      // Buscar si el piso tiene un teléfono ya registrado
      const neighbor = state.statusData.neighbors.find(n => n.floor === invite.floor);
      const phone = neighbor ? neighbor.phone : '';
      
      const message = `¡Hola! 🏡 Aquí tienes tu enlace de registro exclusivo para VeciTurno correspondiente a la *${invite.floor}*:\n\n🔗 ${invite.inviteUrl}\n\nRecuerda que tiene una validez de 48 horas para registrar tu usuario y contraseña.`;
      const encodedMsg = encodeURIComponent(message);
      const waUrl = phone ? `https://wa.me/${phone.replace(/[\s+]/g, '')}?text=${encodedMsg}` : `https://wa.me/?text=${encodedMsg}`;
      
      row.innerHTML = `
        <td><strong>${invite.floor}</strong></td>
        <td>
          <span class="badge ${invite.used ? 'badge-danger' : 'badge-success'}">
            ${invite.used ? 'Usado' : 'Activo'}
          </span>
        </td>
        <td>
          ${invite.used ? '-' : `
            <div style="display: flex; gap: 6px;">
              <button class="btn btn-secondary btn-icon" style="width: 32px; height: 32px;" onclick="copyInviteLinkUrl('${invite.inviteUrl}')" title="Copiar Enlace">
                <i data-lucide="copy" style="width: 14px; height: 14px;"></i>
              </button>
              <a href="${waUrl}" target="_blank" class="btn btn-whatsapp btn-icon" style="width: 32px; height: 32px; display: inline-flex;" title="Enviar por WhatsApp">
                <i data-lucide="message-square" style="width: 14px; height: 14px;"></i>
              </a>
            </div>
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
    
    // Configurar botón de compartir por WhatsApp
    const floorName = data.floor;
    const inviteUrl = data.inviteUrl;
    const neighbor = state.statusData.neighbors.find(n => n.floor === floorName);
    const phone = neighbor ? neighbor.phone : '';
    
    const message = `¡Hola! 🏡 Aquí tienes tu enlace de registro exclusivo para VeciTurno correspondiente a la *${floorName}*:\n\n🔗 ${inviteUrl}\n\nRecuerda que tiene una validez de 48 horas para registrar tu usuario y contraseña.`;
    const encodedMsg = encodeURIComponent(message);
    const waBtn = document.getElementById('admin-invite-wa-btn');
    
    if (phone) {
      const cleanPhone = phone.replace(/[\s+]/g, '');
      waBtn.href = `https://wa.me/${cleanPhone}?text=${encodedMsg}`;
    } else {
      waBtn.href = `https://wa.me/?text=${encodedMsg}`;
    }
    
    successBox.classList.remove('hidden');
    
    // Recargar tabla de invitaciones
    await loadAdminInvites();
    await loadAdminNeighborsManagement();
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

// Copiar enlace generado desde el formulario
function copyInviteLink() {
  const inviteUrlInput = document.getElementById('admin-invite-url');
  inviteUrlInput.select();
  document.execCommand('copy');
  showToast('📋 Enlace de registro copiado al portapapeles.', 'success');
}

// Copiar enlace de la tabla
function copyInviteLinkUrl(url) {
  const tempInput = document.createElement('input');
  tempInput.value = url;
  document.body.appendChild(tempInput);
  tempInput.select();
  document.execCommand('copy');
  document.body.removeChild(tempInput);
  showToast('📋 Enlace de registro copiado al portapapeles.', 'success');
}

// ==========================================
// REGISTRO DIRECTO Y 2FA BAJO DEMANDA
// ==========================================

// Registrar un vecino directamente desde el panel de administración
async function handleDirectRegister(event) {
  event.preventDefault();
  
  if (!state.token || !state.user || !state.user.isAdmin) return;

  const floorId = document.getElementById('admin-reg-floor').value;
  const username = document.getElementById('admin-reg-username').value.trim();
  const password = document.getElementById('admin-reg-password').value;
  const passwordConfirm = document.getElementById('admin-reg-password-confirm').value;
  const phone = document.getElementById('admin-reg-phone').value.trim();
  
  const successEl = document.getElementById('admin-reg-success');
  const errorEl = document.getElementById('admin-reg-error');
  
  successEl.classList.add('hidden');
  errorEl.classList.add('hidden');

  if (password !== passwordConfirm) {
    errorEl.textContent = 'La contraseña inicial y su confirmación no coinciden.';
    errorEl.classList.remove('hidden');
    return;
  }
  const normalizedPhone = normalizeSpanishPhoneInput(phone);
  if (phone && !normalizedPhone) {
    errorEl.textContent = 'Teléfono inválido. Introduce 9 dígitos de España, con o sin +34.';
    errorEl.classList.remove('hidden');
    return;
  }

  try {
    const res = await fetch(`${API_URL}/admin/create-neighbor`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify({ floorId, username, password, passwordConfirm, phone: normalizedPhone || '' })
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Error al registrar vecino');
    }

    successEl.textContent = data.message;
    successEl.classList.remove('hidden');
    
    // Limpiar formulario
    document.getElementById('admin-direct-reg-form').reset();
    
    // Recargar estado del dashboard para mostrar que ya está registrado
    await loadCommunityStatus();
    await loadAdminNeighborsManagement();
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.remove('hidden');
  }
}

// Cargar y renderizar la tabla de gestión de vecinos (usuarios, teléfonos, bajas, exención de limpieza)
async function loadAdminNeighborsManagement() {
  const container = document.getElementById('admin-neighbors-list');
  if (!container) return;
  
  container.innerHTML = '<tr><td colspan="5" class="text-center">Cargando viviendas y usuarios...</td></tr>';
  
  try {
    const res = await fetch(`${API_URL}/public/status?_t=${Date.now()}`);
    if (!res.ok) throw new Error('Error al recargar estado de la comunidad');
    const data = await res.json();
    state.statusData = data;
    
    container.innerHTML = '';
    
    if (!data.neighbors || data.neighbors.length === 0) {
      container.innerHTML = '<tr><td colspan="5" class="text-center">No hay viviendas registradas.</td></tr>';
      return;
    }
    
    data.neighbors.forEach(n => {
      const isRegistered = !!n.username;
      
      let statusBadge = '';
      if (n.isAdmin) {
        statusBadge = `<span class="badge" style="background: rgba(59, 130, 246, 0.1); color: var(--color-primary); display: inline-flex; align-items: center; gap: 4px;"><i data-lucide="shield" style="width: 12px; height: 12px;"></i>Admin</span>`;
      } else if (isRegistered) {
        let authType = 'Activo';
        if (n.deactivated) {
          authType = 'Desactivado';
        } else if (n.twoFactorRegistered && n.passkeys?.length > 0) {
          authType = '2FA + Huella';
        } else if (n.twoFactorRegistered) {
          authType = '2FA Activo';
        } else if (n.passkeys?.length > 0) {
          authType = 'Huella Activa';
        }

        if (n.deactivated) {
          statusBadge = `<span class="badge" style="background: rgba(239, 68, 68, 0.1); color: #f87171; display: inline-flex; align-items: center; gap: 4px;"><i data-lucide="user-x" style="width: 12px; height: 12px;"></i>Desactivado</span>`;
        } else {
          statusBadge = `<span class="badge badge-success" title="Registrado como @${n.username}" style="display: inline-flex; align-items: center; gap: 4px;"><i data-lucide="user-check" style="width: 12px; height: 12px;"></i>${authType}</span>`;
        }
      } else {
        statusBadge = `<span class="badge" style="background: rgba(245, 158, 11, 0.1); color: var(--color-warning); display: inline-flex; align-items: center; gap: 4px;"><i data-lucide="user-x" style="width: 12px; height: 12px;"></i>Pendiente</span>`;
      }
      
      const exemptBadge = n.exemptFromCleaning 
        ? `<button class="btn btn-secondary" style="padding: 4px 8px; font-size: 0.7rem; border-color: rgba(239, 68, 68, 0.2); background: rgba(239, 68, 68, 0.05); color: #f87171; display: inline-flex; align-items: center; gap: 4px; height: 26px;" onclick="toggleNeighborExempt('${n.id}', false)" title="Haga clic para INCLUIR en limpieza">
            <i data-lucide="moon" style="width: 12px; height: 12px;"></i>Exento
           </button>`
        : `<button class="btn btn-secondary" style="padding: 4px 8px; font-size: 0.7rem; border-color: rgba(16, 185, 129, 0.2); background: rgba(16, 185, 129, 0.05); color: #34d399; display: inline-flex; align-items: center; gap: 4px; height: 26px;" onclick="toggleNeighborExempt('${n.id}', true)" title="Haga clic para EXIMIR de limpieza">
            <i data-lucide="sun" style="width: 12px; height: 12px;"></i>Activo
           </button>`;

      const phoneDisplay = n.phone 
        ? `<span style="font-size: 0.8rem; font-family: monospace;">${n.phone}</span>`
        : `<span style="color: var(--text-muted); font-style: italic; font-size: 0.75rem;">Sin número</span>`;
      
      const isSelf = state.user?.id === n.id;
      const editButton = `
        <button class="btn btn-secondary" style="padding: 4px 8px; border-color: rgba(255, 255, 255, 0.15); background: rgba(255, 255, 255, 0.02); color: var(--text-main); display: inline-flex; align-items: center; gap: 4px; height: 28px; margin-right: 4px;" onclick="openEditNeighborModal('${n.id}')" title="Modificar Vivienda / Vecino">
          <i data-lucide="edit-3" style="width: 12px; height: 12px;"></i>
          <span style="font-size: 0.72rem;">Modificar</span>
        </button>
      `;

      let actions = '';
      if (!isRegistered) {
        actions = editButton + `
          <button class="btn btn-primary" style="padding: 5px 10px; font-size: 0.72rem; display: inline-flex; align-items: center; gap: 4px; height: 28px;" onclick="inviteNeighborViaWhatsApp('${n.id}', '${n.phone || ''}')" title="Enviar enlace de invitación por WhatsApp">
            <i data-lucide="message-square" style="width: 12px; height: 12px;"></i>
            <span>Invitar</span>
          </button>
        `;
      } else {
        let toggleActiveButton = '';
        if (!isSelf) {
          if (n.deactivated) {
            toggleActiveButton = `
              <button class="btn btn-secondary" style="padding: 4px 8px; border-color: rgba(16, 185, 129, 0.25); background: rgba(16, 185, 129, 0.03); color: #34d399; display: inline-flex; align-items: center; gap: 4px; height: 28px; margin-right: 4px;" onclick="toggleNeighborActive('${n.id}', true)" title="Activar acceso de la cuenta">
                <i data-lucide="user-check" style="width: 12px; height: 12px;"></i>
                <span style="font-size: 0.72rem;">Activar</span>
              </button>
            `;
          } else {
            toggleActiveButton = `
              <button class="btn btn-secondary" style="padding: 4px 8px; border-color: rgba(245, 158, 11, 0.25); background: rgba(245, 158, 11, 0.03); color: #fbbf24; display: inline-flex; align-items: center; gap: 4px; height: 28px; margin-right: 4px;" onclick="toggleNeighborActive('${n.id}', false)" title="Desactivar temporalmente el acceso">
                <i data-lucide="user-x" style="width: 12px; height: 12px;"></i>
                <span style="font-size: 0.72rem;">Desactivar</span>
              </button>
            `;
          }
        }

        actions = editButton + toggleActiveButton + `
          <button class="btn btn-secondary" style="padding: 4px 8px; border-color: rgba(239, 68, 68, 0.25); background: rgba(239, 68, 68, 0.03); color: #f87171; display: inline-flex; align-items: center; gap: 4px; height: 28px;" onclick="resetNeighbor('${n.id}', '${n.floor}', ${isSelf})" title="Dar de baja y restablecer cuenta (eliminar contraseña para que vuelva a meterla)">
            <i data-lucide="rotate-ccw" style="width: 12px; height: 12px;"></i>
            <span style="font-size: 0.72rem;">Reiniciar</span>
          </button>
        `;
      }
      
      const row = document.createElement('tr');
      row.innerHTML = `
        <td><strong>${n.floor}</strong></td>
        <td>${statusBadge}</td>
        <td>${phoneDisplay}</td>
        <td>${exemptBadge}</td>
        <td style="white-space: nowrap;">${actions}</td>
      `;
      container.appendChild(row);
    });
    
    lucide.createIcons();
    renderSecurityPanel();
  } catch (err) {
    container.innerHTML = `<tr><td colspan="5" class="text-center error-msg">${err.message}</td></tr>`;
  }
}

// Generar una invitación y enviarla directamente por WhatsApp al móvil
async function inviteNeighborViaWhatsApp(floorId, currentPhone) {
  let phone = currentPhone;
  if (!phone) {
    const input = prompt("Introduce el número de teléfono móvil de España (9 dígitos, ej. 600112233) para enviar la invitación por WhatsApp:");
    if (input === null) return; // Cancelado por usuario
    phone = input.trim();
    if (!phone) {
      showToast("Es necesario un número de teléfono móvil para enviar la invitación.", "error");
      return;
    }
  }

  try {
    const res = await fetch(`${API_URL}/admin/generate-invite`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify({ floorId, phone, sendWhatsApp: true })
    });
    
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al procesar la invitación.');
    
    showToast(data.message, "success");
    
    // Recargar tabla de gestión, listado de invitaciones y estado general
    await loadAdminNeighborsManagement();
    await loadAdminInvites();
    await loadCommunityStatus();
  } catch (err) {
    showToast(`Error: ${err.message}`, "error");
  }
}

// Dar de baja/reinicializar a un vecino
async function resetNeighbor(floorId, floorName, isSelf) {
  if (isSelf) {
    if (!confirm("⚠️ ¿Estás seguro de que deseas DAR DE BAJA tu propio usuario administrador?\n\nPerderás la sesión de forma inmediata y la cuenta quedará pendiente de registro nuevamente.")) {
      return;
    }
  } else {
    if (!confirm(`🚨 ¿Estás seguro de que deseas DAR DE BAJA al vecino de la ${floorName}?\n\nEsto borrará permanentemente su usuario, contraseña, doble factor (2FA) y huellas. Deberá volver a registrarse.`)) {
      return;
    }
  }

  try {
    const res = await fetch(`${API_URL}/admin/neighbors/${floorId}/reset`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${state.token}`
      }
    });
    
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al reiniciar vecino.');
    
    alert(data.message);
    
    if (isSelf) {
      handleLogout();
    } else {
      await loadAdminNeighborsManagement();
      await loadCommunityStatus();
    }
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

// Cambiar participación en limpieza
async function toggleNeighborExempt(floorId, exempt) {
  try {
    const res = await fetch(`${API_URL}/admin/neighbors/${floorId}/toggle-exempt`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${state.token}`
      }
    });
    
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al cambiar participación de limpieza.');
    
    await loadAdminNeighborsManagement();
    await loadCommunityStatus();
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

// Activar/desactivar el acceso de un vecino
async function toggleNeighborActive(floorId, active) {
  try {
    const res = await fetch(`${API_URL}/admin/neighbors/${floorId}/toggle-active`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${state.token}`
      }
    });
    
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al cambiar estado de acceso del vecino.');
    
    await loadAdminNeighborsManagement();
    await loadCommunityStatus();
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

// Abrir modal para modificar los datos de un vecino/vivienda
function openEditNeighborModal(floorId) {
  if (!state.statusData || !state.statusData.neighbors) return;
  const n = state.statusData.neighbors.find(x => x.id === floorId);
  if (!n) return;

  document.getElementById('edit-neighbor-id').value = n.id;
  const structure = state.statusData.structure || [];
  const structUnit = structure.find(u => u.id === floorId) || {};
  document.getElementById('edit-neighbor-name').value = structUnit.name || n.name || '';
  document.getElementById('edit-neighbor-kind').value = n.kind || 'vivienda';
  document.getElementById('edit-neighbor-phone').value = n.phone || '';
  document.getElementById('edit-neighbor-fee').value = n.monthlyFeeOverride !== null ? n.monthlyFeeOverride : '';

  document.getElementById('edit-neighbor-error').classList.add('hidden');
  showView('edit-neighbor');
}

// Cerrar el modal de edición
function closeEditNeighborModal() {
  document.getElementById('edit-neighbor-form').reset();
  showView('admin'); // Volver a la consola de administración
}

// Enviar los cambios de edición al servidor
async function submitEditNeighbor(event) {
  event.preventDefault();
  
  const id = document.getElementById('edit-neighbor-id').value;
  const name = document.getElementById('edit-neighbor-name').value.trim();
  const kind = document.getElementById('edit-neighbor-kind').value;
  const phone = document.getElementById('edit-neighbor-phone').value.trim();
  const feeInput = document.getElementById('edit-neighbor-fee').value.trim();
  const monthlyFeeOverride = feeInput === '' ? null : Number(feeInput);

  const errorEl = document.getElementById('edit-neighbor-error');
  errorEl.classList.add('hidden');

  const normalizedPhone = normalizeSpanishPhoneInput(phone);
  if (phone && !normalizedPhone) {
    errorEl.textContent = 'Teléfono móvil inválido. Introduce 9 dígitos, con o sin +34.';
    errorEl.classList.remove('hidden');
    return;
  }

  try {
    const res = await fetch(`${API_URL}/admin/neighbors/${id}/update`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify({ name, kind, phone: normalizedPhone || '', monthlyFeeOverride })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al actualizar vecino.');

    closeEditNeighborModal();
    await loadAdminNeighborsManagement();
    await loadCommunityStatus();
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.remove('hidden');
  }
}

// Rellenar las opciones de selección para cambiar el turno activo de limpieza
function loadActiveTurnOptions() {
  const select = document.getElementById('admin-active-turn-floor');
  if (!select) return;

  select.innerHTML = '<option value="">Selecciona la vivienda activa...</option>';

  if (!state.statusData || !state.statusData.neighbors) return;

  // Filtrar vecinos no exentos de limpieza
  const eligible = state.statusData.neighbors.filter(n => !n.exemptFromCleaning);

  eligible.forEach(n => {
    const opt = document.createElement('option');
    opt.value = n.id;
    opt.textContent = `${n.floor} ${n.username ? `(@${n.username})` : '(Sin registrar)'}`;
    select.appendChild(opt);
  });
  
  // Seleccionar la actual si existe
  const activeId = state.statusData.state?.currentTurnFloorId;
  if (activeId) {
    select.value = activeId;
  }
}

// Cambiar manualmente el turno activo
async function handleSetActiveTurn(event) {
  event.preventDefault();

  const floorId = document.getElementById('admin-active-turn-floor').value;
  const successEl = document.getElementById('admin-active-turn-success');
  const errorEl = document.getElementById('admin-active-turn-error');

  successEl.classList.add('hidden');
  errorEl.classList.add('hidden');

  if (!floorId) {
    errorEl.textContent = 'Debes seleccionar una vivienda.';
    errorEl.classList.remove('hidden');
    return;
  }

  try {
    const res = await fetch(`${API_URL}/admin/turn/set-active`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify({ floorId })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al cambiar el turno activo.');

    successEl.textContent = data.message;
    successEl.classList.remove('hidden');

    await loadCommunityStatus();
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.remove('hidden');
  }
}

// Solicitar secreto y abrir modal para configurar 2FA bajo demanda (usuario logueado)
async function open2FASetupModal() {
  if (!state.token) return;

  const qrImage = document.getElementById('setup-2fa-qr-image');
  const manualSecret = document.getElementById('setup-2fa-manual-secret');
  const errorEl = document.getElementById('setup-2fa-error');
  
  errorEl.classList.add('hidden');
  document.getElementById('setup-2fa-form').reset();
  
  try {
    const res = await fetch(`${API_URL}/neighbors/setup-2fa`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${state.token}`
      }
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Error al generar código 2FA');
    }

    qrImage.src = data.qrCodeUrl;
    manualSecret.textContent = data.secret;

    showView('setup-2fa');
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

async function registerPasskeyFromProfile() {
  if (!state.token) return;
  if (!window.PublicKeyCredential) {
    showToast('Tu navegador/dispositivo no soporta huella/passkey.', 'error');
    return;
  }
  try {
    const startRes = await fetch(`${API_URL}/neighbors/passkey/register/start`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    const startData = await startRes.json();
    if (!startRes.ok) throw new Error(startData.error || 'No se pudo iniciar registro de huella.');

    const options = startData.options;
    options.challenge = toArrayBufferFlexible(options.challenge);
    options.user.id = toArrayBufferFlexible(options.user.id);
    options.excludeCredentials = (options.excludeCredentials || []).map((c) => ({
      ...c,
      id: toArrayBufferFlexible(c.id)
    }));

    const attestation = await navigator.credentials.create({ publicKey: options });
    if (!attestation) throw new Error('No se pudo crear la passkey en este dispositivo.');

    const credential = {
      id: attestation.id,
      rawId: bufferToB64url(attestation.rawId),
      type: attestation.type,
      response: {
        attestationObject: bufferToB64url(attestation.response.attestationObject),
        clientDataJSON: bufferToB64url(attestation.response.clientDataJSON),
        transports: typeof attestation.response.getTransports === 'function' ? attestation.response.getTransports() : []
      }
    };

    const finishRes = await fetch(`${API_URL}/neighbors/passkey/register/finish`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify({ credential })
    });
    const finishData = await finishRes.json();
    if (!finishRes.ok) throw new Error(finishData.error || 'No se pudo finalizar registro de huella.');

    showToast(finishData.message || 'Huella/passkey activada correctamente.', 'success');
    await loadCommunityStatus();
    const passkeyBadge = document.getElementById('profile-passkey-badge');
    if (passkeyBadge) passkeyBadge.classList.remove('hidden');
    await loadProfilePasskeys();
    openProfileModal();
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
}

// Activar el Doble Factor (2FA) tras ingresar el código de verificación
async function handleActivate2FA(event) {
  event.preventDefault();

  if (!state.token) return;

  const code = document.getElementById('setup-2fa-code').value.trim();
  const errorEl = document.getElementById('setup-2fa-error');
  
  errorEl.classList.add('hidden');

  try {
    const res = await fetch(`${API_URL}/neighbors/activate-2fa`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify({ code })
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Código de verificación incorrecto');
    }

    alert('🛡️ ¡Doble Factor de Autenticación (2FA) activado correctamente en tu cuenta!');
    
    // Ocultar modal y volver al dashboard
    showView('dashboard');
    
    // Recargar estado
    await loadCommunityStatus();
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.remove('hidden');
  }
}

// Probar la conexión del sistema de WhatsApp
async function testSystemWhatsApp() {
  if (!state.token || !state.user || !state.user.isAdmin) return;

  const successEl = document.getElementById('admin-wa-success');
  const errorEl = document.getElementById('admin-wa-error');
  const buttonEl = document.querySelector('button[onclick="testSystemWhatsApp()"]');

  successEl.classList.add('hidden');
  errorEl.classList.add('hidden');
  buttonEl.disabled = true;
  buttonEl.querySelector('span').textContent = 'Enviando...';

  try {
    const res = await fetch(`${API_URL}/admin/send-test-whatsapp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      }
    });

    const data = await res.json();

    if (!res.ok) {
      console.error('[WhatsApp Test Error]', data);
      throw new Error(data.error || 'Error al enviar WhatsApp de prueba.');
    }

    successEl.textContent = data.message;
    successEl.classList.remove('hidden');
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.remove('hidden');
  } finally {
    buttonEl.disabled = false;
    buttonEl.querySelector('span').textContent = 'Enviar Notificación de Prueba';
    loadNotificationLogs();
  }
}

// Omitir el Doble Factor (2FA) durante el registro y activar la cuenta directamente
async function handleRegisterWithout2FA() {
  if (!state.activeRegisterToken) return;

  const confirmSkip = confirm('¿Estás seguro de que deseas registrarte sin activar el Doble Factor de Autenticación (2FA)? Podrás activarlo más adelante desde tu perfil para asegurar tu cuenta.');
  if (!confirmSkip) return;

  const errorEl = document.getElementById('register-error-2');
  errorEl.classList.add('hidden');

  try {
    const res = await fetch(`${API_URL}/auth/register/verify-skip-2fa`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: state.activeRegisterToken })
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Error al omitir la verificación 2FA.');
    }

    // Registro completo sin 2FA: iniciar sesión automáticamente
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
    
    alert('🎉 ¡Registro completado correctamente sin 2FA! Te recomendamos activarlo más adelante desde tu perfil.');
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.remove('hidden');
  }
}

// Iniciar el sondeo de estado de la pasarela de WhatsApp
function startWhatsAppPolling() {
  if (adminWaPollInterval) clearInterval(adminWaPollInterval);
  
  // Realizar primera comprobación inmediata
  pollWhatsAppStatus();
  
  // Repetir cada 4 segundos
  adminWaPollInterval = setInterval(pollWhatsAppStatus, 4000);
}

// Comprobar el estado en vivo de WhatsApp en el backend
async function pollWhatsAppStatus() {
  if (!state.token || !state.user || !state.user.isAdmin) return;

  const descEl = document.getElementById('admin-wa-desc');
  const spinnerEl = document.getElementById('admin-wa-spinner');
  const qrBox = document.getElementById('admin-wa-qr-box');
  const qrImg = document.getElementById('admin-wa-qr-img');
  const connectedBox = document.getElementById('admin-wa-connected-box');
  const phoneSpan = document.getElementById('admin-wa-phone-span');

  try {
    const res = await fetch(`${API_URL}/admin/whatsapp/status`, {
      headers: {
        'Authorization': `Bearer ${state.token}`
      }
    });

    const data = await res.json();

    if (!res.ok) throw new Error(data.error || 'No se pudo obtener el estado');

    // Manejar la actualización visual según el estado de la pasarela
    if (data.status === 'connecting') {
      descEl.textContent = 'Estado: Conectando con WhatsApp Web...';
      spinnerEl.classList.remove('hidden');
      qrBox.classList.add('hidden');
      connectedBox.classList.add('hidden');
    } 
    else if (data.status === 'qr') {
      descEl.textContent = 'Estado: Pendiente de Vinculación';
      spinnerEl.classList.add('hidden');
      connectedBox.classList.add('hidden');
      
      // Mostrar QR
      if (data.qrCodeUrl) {
        qrImg.src = data.qrCodeUrl;
        qrBox.classList.remove('hidden');
      } else {
        spinnerEl.classList.remove('hidden');
        spinnerEl.textContent = 'Generando QR...';
        qrBox.classList.add('hidden');
      }
    } 
    else if (data.status === 'connected') {
      descEl.textContent = 'Estado: Vinculado Correctamente';
      spinnerEl.classList.add('hidden');
      qrBox.classList.add('hidden');
      
      // Mostrar área de conexión exitosa y teléfono
      phoneSpan.innerHTML = `Conectado como: <strong>${data.phoneConnected}</strong>`;
      connectedBox.classList.remove('hidden');
      
      // Recargar iconos insertados dinámicamente
      lucide.createIcons();
    } 
    else {
      // Disconnected
      descEl.textContent = 'Estado: Pasarela apagada o desvinculada.';
      spinnerEl.classList.remove('hidden');
      spinnerEl.textContent = 'Inicializando cliente...';
      qrBox.classList.add('hidden');
      connectedBox.classList.add('hidden');
    }
  } catch (err) {
    console.error('Error al sondear WhatsApp status:', err);
    descEl.textContent = 'Estado: Error al comunicar con el servidor.';
  }
}

async function loadWhatsAppGroupsAndConfig() {
  if (!state.token || !state.user || !state.user.isAdmin) return;
  const selectEl = document.getElementById('admin-wa-group-select');
  if (!selectEl) return;

  try {
    const [groupsRes, configRes] = await Promise.all([
      fetch(`${API_URL}/admin/whatsapp/groups`, {
        headers: { 'Authorization': `Bearer ${state.token}` }
      }),
      fetch(`${API_URL}/admin/whatsapp/config`, {
        headers: { 'Authorization': `Bearer ${state.token}` }
      })
    ]);

    const groupsData = await groupsRes.json();
    const configData = await configRes.json();

    if (!groupsRes.ok) throw new Error(groupsData.error || 'No se pudieron cargar los grupos.');
    if (!configRes.ok) throw new Error(configData.error || 'No se pudo cargar la configuración.');

    const options = ['<option value="">Sin grupo (usar chat vinculado)</option>']
      .concat((groupsData.groups || []).map(g => `<option value="${g.id}">${g.name}</option>`));
    selectEl.innerHTML = options.join('');
    selectEl.value = configData.whatsappGroupId || '';
  } catch (err) {
    console.error('Error cargando grupos/config de WhatsApp:', err);
  }
}

async function saveWhatsAppGroupConfig() {
  if (!state.token || !state.user || !state.user.isAdmin) return;
  const selectEl = document.getElementById('admin-wa-group-select');
  const successEl = document.getElementById('admin-wa-success');
  const errorEl = document.getElementById('admin-wa-error');
  if (!selectEl || !successEl || !errorEl) return;

  successEl.classList.add('hidden');
  errorEl.classList.add('hidden');

  try {
    const res = await fetch(`${API_URL}/admin/whatsapp/config`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify({ whatsappGroupId: selectEl.value || '' })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudo guardar el grupo.');
    successEl.textContent = data.message || 'Grupo guardado correctamente.';
    successEl.classList.remove('hidden');
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.remove('hidden');
  }
}

async function forceTurnStartNotification() {
  if (!state.token || !state.user || !state.user.isAdmin) return;
  const confirmed = confirm('¿Seguro que quieres forzar el aviso del turno actual?');
  if (!confirmed) return;
  const successEl = document.getElementById('admin-wa-success');
  const errorEl = document.getElementById('admin-wa-error');
  if (!successEl || !errorEl) return;
  successEl.classList.add('hidden');
  errorEl.classList.add('hidden');

  try {
    const res = await fetch(`${API_URL}/admin/notifications/force-turn-start`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${state.token}`
      }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudo forzar el aviso.');
    successEl.textContent = data.message || 'Aviso forzado enviado.';
    successEl.classList.remove('hidden');
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.remove('hidden');
  } finally {
    loadNotificationLogs();
  }
}

async function runWhatsAppRemindersNow() {
  if (!state.token || !state.user || !state.user.isAdmin) return;
  const res = await fetch(`${API_URL}/admin/notifications/run-reminders`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${state.token}` }
  });
  const data = await res.json();
  if (!res.ok) return alert(data.error || 'No se pudo ejecutar recordatorios.');
  alert(data.message || 'Recordatorios ejecutados.');
  loadNotificationLogs();
}

async function sendMonthlySummaryNow() {
  if (!state.token || !state.user || !state.user.isAdmin) return;
  const res = await fetch(`${API_URL}/admin/notifications/monthly-summary`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${state.token}` }
  });
  const data = await res.json();
  if (!res.ok) return alert(data.error || 'No se pudo enviar el resumen mensual.');
  alert(data.message || 'Resumen enviado.');
  loadNotificationLogs();
}

async function sendFinanceSummaryNow() {
  if (!state.token || !state.user || !state.user.isAdmin) return;
  const month = prompt('Mes a enviar (YYYY-MM). Déjalo vacío para último registro:') || '';
  const res = await fetch(`${API_URL}/admin/notifications/finance-summary`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${state.token}`
    },
    body: JSON.stringify({ month, targetType: 'group' })
  });
  const data = await res.json();
  if (!res.ok) return alert(data.error || 'No se pudo enviar estado de cuotas.');
  alert(data.message || 'Estado de cuotas enviado.');
  loadNotificationLogs();
}

async function createQuickPoll() {
  if (!state.token || !state.user || !state.user.isAdmin) return;
  const question = prompt('Pregunta de la encuesta:');
  if (!question) return;
  const rawOptions = prompt('Opciones separadas por coma (mínimo 2):', 'Sí,No');
  if (!rawOptions) return;
  const options = rawOptions.split(',').map(s => s.trim()).filter(Boolean);
  if (options.length < 2) return alert('Debes indicar al menos 2 opciones.');
  const res = await fetch(`${API_URL}/admin/polls`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${state.token}`
    },
    body: JSON.stringify({ question, options })
  });
  const data = await res.json();
  if (!res.ok) return alert(data.error || 'No se pudo crear la encuesta.');
  alert(data.message || 'Encuesta creada.');
  loadNotificationLogs();
}

async function sendSegmentedMessageNow() {
  if (!state.token || !state.user || !state.user.isAdmin) return;
  const text = prompt('Mensaje a enviar:');
  if (!text) return;
  const portal = prompt('Portal (vacío=todos):', '') || '';
  const kind = prompt('Tipo (vivienda/comercial o vacío=todos):', '') || '';
  const res = await fetch(`${API_URL}/admin/notifications/segmented`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${state.token}`
    },
    body: JSON.stringify({ text, filter: { portal, kind } })
  });
  const data = await res.json();
  if (!res.ok) return alert(data.error || 'No se pudo enviar la difusión.');
  alert(data.message || 'Difusión enviada.');
  loadNotificationLogs();
}

/* ==========================================================================
   GESTOR DE PLANTILLAS DE WHATSAPP
   ========================================================================== */

function insertPlaceholder(textareaId, placeholderText) {
  const el = document.getElementById(textareaId);
  if (!el) return;
  const start = el.selectionStart;
  const end = el.selectionEnd;
  const text = el.value;
  el.value = text.slice(0, start) + placeholderText + text.slice(end);
  el.focus();
  el.selectionStart = el.selectionEnd = start + placeholderText.length;
}

async function loadWhatsAppTemplates() {
  if (!state.token || !state.user || !state.user.isAdmin) return;
  try {
    const res = await fetch(`${API_URL}/admin/whatsapp/templates`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudieron cargar las plantillas.');

    const templates = data.templates || {};
    
    const keys = [
      'turn_start_general',
      'turn_start_individual',
      'turn_reminder_general',
      'turn_reminder_individual',
      'monthly_summary',
      'finance_summary',
      'invite_neighbor'
    ];

    keys.forEach((key) => {
      const textarea = document.getElementById(`template-${key.replace(/_/g, '-')}`);
      if (textarea) {
        textarea.value = templates[key] || '';
      }
    });
  } catch (err) {
    showToast(`Error al cargar plantillas: ${err.message}`, 'error');
  }
}

async function handleSaveWhatsAppTemplates(event) {
  if (event) event.preventDefault();
  if (!state.token || !state.user || !state.user.isAdmin) return;

  const keys = [
    'turn_start_general',
    'turn_start_individual',
    'turn_reminder_general',
    'turn_reminder_individual',
    'monthly_summary',
    'finance_summary',
    'invite_neighbor'
  ];

  const templates = {};
  keys.forEach((key) => {
    const textarea = document.getElementById(`template-${key.replace(/_/g, '-')}`);
    if (textarea) {
      templates[key] = textarea.value;
    }
  });

  try {
    const res = await fetch(`${API_URL}/admin/whatsapp/templates`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify({ templates })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudieron guardar las plantillas.');

    showToast(data.message || 'Plantillas guardadas correctamente.', 'success');
    await loadWhatsAppTemplates();
  } catch (err) {
    showToast(`Error al guardar plantillas: ${err.message}`, 'error');
  }
}

function resetWhatsAppTemplatesToDefault() {
  const confirmed = confirm('¿Estás seguro de que deseas reestablecer los textos a los valores por defecto?\n\n(Deberás hacer clic en "Guardar Plantillas" para confirmar los cambios permanentemente en el servidor)');
  if (!confirmed) return;

  const defaults = {
    'turn-start-general': '🏡 *VeciTurno (Notificación General)*:\n\n¡Atención comunidad! Ha comenzado el turno de limpieza de *{mes}*.\n\nLe corresponde limpiar de forma automática a: *{vecino}*.\n\n¡Gracias por colaborar con la limpieza y mantenimiento del portal! ✨',
    'turn-start-individual': '🏡 *VeciTurno (Aviso Forzado por Admin)*:\n\nSe envía recordatorio de inicio de turno de limpieza de *{mes}*.\n\nTurno actual: *{vecino}*.\n\nGracias por colaborar.',
    'turn-reminder-general': '🧹 *Recordatorio de turno de limpieza*\n\nEl turno de *{vecino}* comienza *{tiempo}*.',
    'turn-reminder-individual': '🧹 *Recordatorio de turno de limpieza*\n\nTu turno ({vecino}) comienza *{tiempo}*.\nPor favor confirma respondiendo: *OK TURNO*',
    'monthly-summary': '📊 *Resumen mensual VeciTurno*\n\nTurno actual: *{vecino}*\nMes: *{mes}*\n\nÚltimos turnos:\n{historial}\n\nGracias por colaborar.',
    'finance-summary': '💶 *Estado de cuotas y gastos ({mes})*\n\nIngresos por cuotas: {ingresos} €\nGasto seguro: {gasto_seguro} €\nGasto luz: {gasto_luz} €\nBalance: {balance} €\n{notas}',
    'invite-neighbor': '🏡 *VeciTurno (Invitación de Registro)*:\n\n¡Hola! Te invitamos a registrarte en el sistema de turnos de limpieza de *{comunidad}*.\n\nPara configurar tu usuario y contraseña, accede al siguiente enlace:\n👉 {enlace}\n\n¡Gracias por colaborar! ✨'
  };

  Object.entries(defaults).forEach(([id, text]) => {
    const textarea = document.getElementById(`template-${id}`);
    if (textarea) {
      textarea.value = text;
    }
  });

  showToast('Valores por defecto cargados en el formulario. Haz clic en "Guardar Plantillas" para confirmar.', 'info');
}

async function loadNotificationLogs() {
  if (!state.token || !state.user || !state.user.isAdmin) return;
  const container = document.getElementById('admin-notification-logs');
  if (!container) return;
  try {
    const res = await fetch(`${API_URL}/admin/notifications/logs?limit=50`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudo cargar el registro.');
    const logs = data.logs || [];
    if (!logs.length) {
      container.innerHTML = '<div class="history-item">Sin notificaciones registradas todavía.</div>';
      return;
    }
    container.innerHTML = logs.map((log) => {
      const when = new Date(log.createdAt).toLocaleString('es-ES');
      const status = log.status === 'sent' ? 'Enviado' : 'Fallido';
      const detail = log.error ? ` · ${log.error}` : '';
      return `<div class="history-item"><div class="history-meta"><span class="history-floor">${log.notificationType} · ${log.mode} · ${log.channel}</span><span class="history-by">${status}${detail}</span></div><span class="history-date">${when}</span></div>`;
    }).join('');
  } catch (err) {
    container.innerHTML = `<div class="history-item">Error cargando registro: ${err.message}</div>`;
  }
}

async function loadIncidents() {
  if (!state.token || !state.user || !state.user.isAdmin) return;
  const container = document.getElementById('admin-incidents-list');
  if (!container) return;
  try {
    const res = await fetch(`${API_URL}/admin/incidents?limit=30`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudieron cargar incidencias.');
    const items = data.incidents || [];
    if (!items.length) {
      container.innerHTML = '<div class="history-item">Sin incidencias.</div>';
      return;
    }
    container.innerHTML = items.map((i) => {
      const when = new Date(i.createdAt).toLocaleString('es-ES');
      return `<div class="history-item"><div class="history-meta"><span class="history-floor">${i.from}</span><span class="history-by">${i.text}</span></div><span class="history-date">${when}</span></div>`;
    }).join('');
  } catch (err) {
    container.innerHTML = `<div class="history-item">Error: ${err.message}</div>`;
  }
}

// Desvincular el dispositivo de WhatsApp desde la consola
async function disconnectSystemWhatsApp() {
  if (!state.token || !state.user || !state.user.isAdmin) return;

  const confirmDisconnect = confirm('¿Estás seguro de que deseas desvincular tu número de WhatsApp del servidor de la comunidad? Las notificaciones automáticas de turnos dejarán de enviarse de forma directa.');
  if (!confirmDisconnect) return;

  const descEl = document.getElementById('admin-wa-desc');
  const spinnerEl = document.getElementById('admin-wa-spinner');
  const qrBox = document.getElementById('admin-wa-qr-box');
  const connectedBox = document.getElementById('admin-wa-connected-box');

  // Mostrar cargando
  descEl.textContent = 'Desvinculando dispositivo...';
  spinnerEl.classList.remove('hidden');
  spinnerEl.textContent = 'Cerrando sesión de WhatsApp...';
  qrBox.classList.add('hidden');
  connectedBox.classList.add('hidden');

  try {
    const res = await fetch(`${API_URL}/admin/whatsapp/logout`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${state.token}`
      }
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Error al desvincular');
    }

    alert('✅ Dispositivo desvinculado con éxito del servidor. Se generará un nuevo QR listo para escanear en unos segundos.');
    
    // Forzar comprobación inmediata
    pollWhatsAppStatus();
  } catch (err) {
    alert(`Error al desvincular: ${err.message}`);
    pollWhatsAppStatus(); // Volver al estado actual
  }
}

async function restartSystemWhatsApp() {
  if (!state.token || !state.user || !state.user.isAdmin) return;

  const descEl = document.getElementById('admin-wa-desc');
  const spinnerEl = document.getElementById('admin-wa-spinner');
  const qrBox = document.getElementById('admin-wa-qr-box');
  const connectedBox = document.getElementById('admin-wa-connected-box');

  descEl.textContent = 'Reiniciando cliente de WhatsApp...';
  spinnerEl.classList.remove('hidden');
  spinnerEl.textContent = 'Reiniciando...';
  qrBox.classList.add('hidden');
  connectedBox.classList.add('hidden');

  try {
    const res = await fetch(`${API_URL}/admin/whatsapp/restart`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${state.token}`
      }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudo reiniciar WhatsApp.');

    descEl.textContent = data.message || 'Cliente reiniciado.';
    setTimeout(() => {
      pollWhatsAppStatus();
    }, 2000);
  } catch (err) {
    descEl.textContent = `Error: ${err.message}`;
  }
}
  const monthLabel = (monthValue) => {
    const m = String(monthValue || '');
    if (!/^\d{4}-\d{2}$/.test(m)) return m;
    return `${m.slice(5, 7)}/${m.slice(0, 4)}`;
  };

async function verifyPdfCertificateCsv() {
  const input = document.getElementById('verify-csv-input');
  const resultEl = document.getElementById('verify-csv-result');
  if (!input || !resultEl) return;

  const csv = input.value.trim();
  if (!csv) {
    resultEl.classList.remove('hidden');
    resultEl.innerHTML = `<div class="error-msg" style="padding: 8px; font-size: 0.72rem;">Introduce un código CSV válido.</div>`;
    return;
  }

  resultEl.classList.remove('hidden');
  resultEl.innerHTML = `<div class="loading-spinner" style="font-size: 0.72rem;">Verificando...</div>`;

  try {
    const res = await fetch(`/api/public/verify-csv?csv=${encodeURIComponent(csv)}`);
    const data = await res.json();

    if (!res.ok) {
      resultEl.innerHTML = `<div class="error-msg" style="padding: 8px; font-size: 0.72rem;">${data.error || 'Código CSV no encontrado.'}</div>`;
      return;
    }

    resultEl.innerHTML = `
      <div class="success-msg" style="padding: 10px; font-size: 0.72rem; text-align: left; display:flex; flex-direction:column; gap:4px; border-color: rgba(16, 185, 129, 0.4); background: rgba(16, 185, 129, 0.04); margin-bottom: 0px;">
        <div style="font-weight: 700; color: #34d399; display:flex; align-items:center; gap:6px;">
          <i data-lucide="check-circle" style="width:14px; height:14px;"></i>
          <span>Certificado Válido</span>
        </div>
        <div style="margin-top: 4px; border-top: 1px dashed rgba(16, 185, 129, 0.25); padding-top: 6px; display:flex; flex-direction:column; gap:2px; color: var(--text-main); font-weight:500;">
          <div>Comunidad: <span style="color:var(--text-muted); font-weight:400;">${escapeHtmlForJs(data.communityName)}</span></div>
          <div>Propietario: <span style="color:var(--text-muted); font-weight:400;">${escapeHtmlForJs(data.username)}</span></div>
          <div>Unidad: <span style="color:var(--text-muted); font-weight:400;">${escapeHtmlForJs(data.floorName)}</span></div>
          <div>Periodo: <span style="color:var(--text-muted); font-weight:400;">${escapeHtmlForJs(data.year)} · ${escapeHtmlForJs(data.quarter)}</span></div>
          <div>Abonado: <span style="color:#34d399; font-weight:700;">${fmtEur(data.totalAmount)}</span></div>
          <div style="font-size:0.68rem; color:var(--text-muted); margin-top:2px;">Fecha Emisión: ${escapeHtmlForJs(data.emittedAt)}</div>
        </div>
      </div>
    `;
    lucide.createIcons();
  } catch (err) {
    resultEl.innerHTML = `<div class="error-msg" style="padding: 8px; font-size: 0.72rem;">Error al conectar con el servidor: ${err.message}</div>`;
  }
}

function escapeHtmlForJs(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function loadForceTurnPanelOptions() {
  if (!state.token || !state.user || !state.user.isAdmin) return;

  if (!state.statusData) {
    await loadCommunityStatus();
  }
  const data = state.statusData;
  if (!data) return;

  const monthInput = document.getElementById('admin-force-month');
  if (monthInput && data.state && data.state.currentMonth) {
    monthInput.value = data.state.currentMonth.slice(0, 7);
  }

  const floorSelect = document.getElementById('admin-force-floor');
  if (floorSelect) {
    const activeFloorId = data.state?.currentTurnFloorId || '';
    const eligibleNeighbors = (data.neighbors || [])
      .filter(n => !n.exemptFromCleaning)
      .sort((a, b) => Number(a.id) - Number(b.id));

    floorSelect.innerHTML = eligibleNeighbors
      .map(n => `<option value="${n.id}" ${n.id === activeFloorId ? 'selected' : ''}>${n.floor}</option>`)
      .join('');
  }
}

async function handleForceTurnState(event) {
  event.preventDefault();
  
  if (!state.token || !state.user || !state.user.isAdmin) return;

  const successEl = document.getElementById('admin-force-turn-success');
  const errorEl = document.getElementById('admin-force-turn-error');
  const monthInput = document.getElementById('admin-force-month');
  const floorSelect = document.getElementById('admin-force-floor');

  if (successEl) successEl.classList.add('hidden');
  if (errorEl) errorEl.classList.add('hidden');

  const selectedMonth = monthInput.value;
  const selectedFloorId = floorSelect.value;

  if (!selectedMonth || !selectedFloorId) {
    if (errorEl) {
      errorEl.textContent = 'Debes seleccionar tanto el mes como el vecino en turno.';
      errorEl.classList.remove('hidden');
    }
    return;
  }

  try {
    const monthRes = await fetch(`${API_URL}/admin/turn/set-month`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify({ month: selectedMonth })
    });
    const monthData = await monthRes.json();
    if (!monthRes.ok) {
      throw new Error(monthData.error || 'Error al cambiar el mes de limpieza.');
    }

    const floorRes = await fetch(`${API_URL}/admin/turn/set-active`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify({ floorId: selectedFloorId })
    });
    const floorData = await floorRes.json();
    if (!floorRes.ok) {
      throw new Error(floorData.error || 'Error al cambiar el vecino activo.');
    }

    if (successEl) {
      successEl.textContent = 'Mes y turno activo actualizados correctamente.';
      successEl.classList.remove('hidden');
    }

    await loadCommunityStatus();
    await loadForceTurnPanelOptions();

  } catch (err) {
    if (errorEl) {
      errorEl.textContent = err.message;
      errorEl.classList.remove('hidden');
    }
  }
}

function showToast(message, type = 'success') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast-notification ${type}`;
  
  let iconName = 'check-circle';
  if (type === 'error') iconName = 'alert-triangle';
  else if (type === 'info') iconName = 'info';
  else if (type === 'warning') iconName = 'alert-circle';

  toast.innerHTML = `
    <div class="toast-icon">
      <i data-lucide="${iconName}"></i>
    </div>
    <div class="toast-message">${escapeHtmlForJs(message)}</div>
  `;

  container.appendChild(toast);
  lucide.createIcons();

  // Trigger animation after adding to DOM
  setTimeout(() => {
    toast.classList.add('show');
  }, 10);

  // Auto remove after 3.5s
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => {
      toast.remove();
    }, 400);
  }, 3500);
}
