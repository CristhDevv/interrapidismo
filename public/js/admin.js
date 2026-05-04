// ============================================================
// admin.js — Panel Administrador completo (Supabase)
// ============================================================
let currentUser = null;
let MAP = null;
let domMarkers = {};
let selectedGuideIds = new Set();
let guidesCache = [];
let scannedGuides = [];
let currentCaja = null;

const LS_SCANNED_KEY = 'irr_scanned_guides';
const LS_PENDING_KEY = 'guias_pending_sync';

// ── Offline helpers ──────────────────────────────────────────
function getPendingGuides() {
  try { return JSON.parse(localStorage.getItem(LS_PENDING_KEY) || '[]'); }
  catch (e) { return []; }
}

function savePendingGuides(list) {
  localStorage.setItem(LS_PENDING_KEY, JSON.stringify(list));
}

async function syncPendingGuides() {
  const pending = getPendingGuides();
  if (!pending.length) return;
  toast(`Reconectado. Sincronizando ${pending.length} guía(s)...`, 'info');
  const failed = [];
  let synced = 0;
  for (const g of pending) {
    const payload = { ...g };
    delete payload._tempId;
    delete payload._offline;
    const { error } = await supabase.from('guias').insert([payload]);
    if (error) {
      failed.push(g);
    } else {
      synced++;
    }
  }
  savePendingGuides(failed);
  if (synced > 0) toast(`✅ ${synced} guía(s) sincronizadas correctamente`, 'success');
  if (failed.length > 0) toast(`⚠️ ${failed.length} guía(s) pendientes por error`, 'warning');
  loadGuides();
}
window.syncPendingGuides = syncPendingGuides;

window.addEventListener('online', syncPendingGuides);
window.addEventListener('offline', () => toast('📡 Sin conexión — guardando localmente', 'warning'));

function saveScannedGuides() {
  localStorage.setItem(LS_SCANNED_KEY, JSON.stringify(scannedGuides));
}

function loadScannedGuides() {
  const saved = localStorage.getItem(LS_SCANNED_KEY);
  if (saved) {
    try {
      scannedGuides = JSON.parse(saved);
      renderScannedGuides();
      updateSelectedCount();
    } catch (e) { console.error("Error loading saved guides", e); }
  }
}

// ── Helpers ──────────────────────────────────────────────
function toast(msg, type = 'info') {
  const icons = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span class="toast-icon">${icons[type]}</span><span>${msg}</span>`;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => { el.style.opacity='0'; el.style.transform='translateX(30px)'; el.style.transition='.3s'; setTimeout(()=>el.remove(),300); }, 3500);
}

function formatCOP(v) {
  return new Intl.NumberFormat('es-CO', { style:'currency', currency:'COP', minimumFractionDigits:0 }).format(v);
}

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString('es-CO', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' });
}

function statusBadge(s) {
  const m = {
    en_oficina: `<span class="badge badge-oficina">🏢 En oficina</span>`,
    en_ruta:    `<span class="badge badge-ruta">🛵 En ruta</span>`,
    entregado:  `<span class="badge badge-entregado">✅ Entregado</span>`,
  };
  return m[s] || s;
}

function payBadge(p, mixtos = []) {
  const m = {
    nequi:        `<span class="badge badge-nequi">Nequi</span>`,
    efectivo:     `<span class="badge badge-efectivo">💵 Efectivo</span>`,
    pago_directo: `<span class="badge badge-pago-directo">🏦 Pago directo</span>`,
    bancolombia:  `<span class="badge" style="background:#00448d;color:white">Bancolombia</span>`,
    daviplata:   `<span class="badge" style="background:#e30613;color:white">Daviplata</span>`,
    otros:        `<span class="badge badge-secondary">Otros</span>`
  };

  if (p === 'mixto') {
    const hasDetails = mixtos && mixtos.length > 0;
    const details = hasDetails ? mixtos.map(mx => `
      <div style="display:flex; justify-content:space-between; gap:0.5rem; font-size:0.75rem; margin-top:2px;">
        <span style="font-weight:600; text-transform:capitalize;">${mx.metodo || '?'}:</span>
        <span style="color:var(--success)">${formatCOP(mx.monto || 0)}</span>
      </div>
    `).join('') : '<div style="font-size:0.7rem; color:#999; margin-top:2px;">(Sin detalles)</div>';

    return `
      <div style="display:flex; flex-direction:column; min-width:120px;">
        <span class="badge" style="background: linear-gradient(45deg, #FF6B00, #FF0055); color:white; margin-bottom:4px; text-align:center; box-shadow: 0 2px 4px rgba(255,107,0,0.2);">⚖️ Mixto</span>
        ${details}
      </div>
    `;
  }

  return m[p] || `<span class="badge badge-secondary">${p}</span>`;
}

function typeBadge(t) {
  return t === 'entrega'
    ? `<span class="badge badge-entrega">📥 Entrega</span>`
    : `<span class="badge badge-envio">📤 Envío</span>`;
}

function closeModal(id) { document.getElementById(id).classList.add('hidden'); }
function openModal(id)  { document.getElementById(id).classList.remove('hidden'); }

// ── Auth ──────────────────────────────────────────────────
async function doLogin() {
  const email = document.getElementById('login-user').value.trim();
  const password = document.getElementById('login-pass').value;
  const btn = document.getElementById('login-btn');
  const err = document.getElementById('login-error');
  if (!email || !password) { err.textContent = 'Completa todos los campos'; err.style.display='block'; return; }
  btn.disabled = true; btn.textContent = 'Verificando…';
  
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  
  if (error || !data.user) {
    err.textContent = 'Credenciales incorrectas'; err.style.display='block';
    btn.disabled = false; btn.textContent = 'Iniciar sesión';
    return;
  }
  
  const meta = data.user.user_metadata || {};
  if (meta.role !== 'admin') {
    await supabase.auth.signOut();
    err.textContent = 'Solo administradores pueden acceder aquí'; err.style.display='block';
    btn.disabled = false; btn.textContent = 'Iniciar sesión';
    return;
  }
  
  currentUser = data.user;
  initApp(meta.name);
}

// Attach to window to ensure global scope
window.doLogin = doLogin;

async function doLogout() {
  await supabase.auth.signOut();
  window.location.href = 'login.html';
}

window.doLogout = doLogout;

// ── App init ─────────────────────────────────────────────


function initApp(name) {
  const overlay = document.getElementById('login-overlay');
  if (overlay) overlay.classList.add('hidden');
  const shell = document.getElementById('app-shell');
  if (shell) shell.classList.remove('hidden');
  
  const n = name || 'Admin';
  const nameDisp = document.getElementById('user-name-display');
  if (nameDisp) nameDisp.textContent = n;
  const avatar = document.getElementById('user-avatar');
  if (avatar) avatar.textContent = n[0].toUpperCase();
  
  const dateDisp = document.getElementById('dashboard-date');
  if (dateDisp) {
    dateDisp.textContent = new Date().toLocaleDateString('es-CO', { weekday:'long', day:'numeric', month:'long' });
  }
  
  initRealtime();
  loadDashboard();
  loadGuides();
  loadUsers();
  // Llamar al final para asegurar que el DOM de la tabla esté listo
  loadScannedGuides();
  checkCaja();
}

// ── Supabase Realtime ─────────────────────────────────────
let _refreshInterval = null;

function initRealtime() {
  // Limpiar canales previos para evitar el error "cannot add postgres_changes after subscribe"
  supabase.removeAllChannels();

  // guías → refresh guides list + dashboard + caja KPIs instantly
  supabase.channel('public:guias')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'guias' }, payload => {
      loadGuides();
      loadDashboard();
      const cajaSection = document.getElementById('section-caja');
      if (cajaSection?.classList.contains('active')) loadCajaSection();

      if (payload.eventType === 'INSERT') {
        toast(`Nueva guía: ${payload.new.numero_guia}`, 'info');
      } else if (payload.eventType === 'UPDATE' && payload.new.status === 'entregado' && payload.old?.status !== 'entregado') {
        toast(`✅ Entregado: ${payload.new.numero_guia}`, 'success');
      }
    })
    .subscribe();

  // domiciliarios → update map markers instantly
  supabase.channel('public:domiciliarios')
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'domiciliarios' }, payload => {
      updateMapMarker(payload.new);
    })
    .subscribe();

  // caja → re-check cash register state instantly
  supabase.channel('public:caja')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'caja' }, () => {
      checkCaja();
      const cajaSection = document.getElementById('section-caja');
      if (cajaSection?.classList.contains('active')) loadCajaSection();
    })
    .subscribe();

  // Fallback polling every 30 seconds for Dashboard and Caja
  if (_refreshInterval) clearInterval(_refreshInterval);
  _refreshInterval = setInterval(() => {
    loadDashboard();
    const cajaSection = document.getElementById('section-caja');
    if (cajaSection?.classList.contains('active')) loadCajaSection();
  }, 30_000);
}

// ── Section navigation ────────────────────────────────────
const sectionTitles = {
  'dashboard': 'Dashboard',
  'guides': 'Gestión de Guías',
  'assign': 'Asignar Ruta del Día',
  'map': 'Mapa en Vivo',
  'history': 'Historial de Entregas',
  'users': 'Usuarios del Sistema',
  'caja': 'Gestión de Caja',
  'productos': '🛍️ Gestión de Productos',
  'monitor': 'Monitor de Mensajeros'
};

function showSection(id) {
  document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById(`section-${id}`).classList.add('active');
  document.getElementById(`nav-${id}`)?.classList.add('active');
  
  const titleEl = document.getElementById('topbar-title');
  if (titleEl) titleEl.textContent = sectionTitles[id] || '';

  if (id === 'map') initMap();
  if (id === 'assign') loadAssignGuides();
  if (id === 'history') loadHistory();
  if (id === 'users') loadUsers();
  if (id === 'caja') loadCajaSection();
  if (id === 'productos') loadProductos();
  if (id === 'monitor') fetchLiveMonitor('monitor-standalone-container');
}
window.showSection = showSection;

// ── Dashboard ─────────────────────────────────────────────
async function loadDashboard() {
  const today = new Date().toLocaleDateString('sv-SE');
  const { data: guides, error } = await supabase
    .from('guias')
    .select('*, domiciliarios(nombre)')
    .gte('created_at', `${today}T00:00:00Z`);
    
  if (error) { toast('Error al cargar dashboard','error'); return; }
  
  const delivered = guides.filter(g => g.entregado === true || g.bajado_sistema === true);
  const sumValue = delivered.reduce((acc, g) => acc + (g.monto || 0), 0);
  
  const totalEl = document.getElementById('stat-total');
  if (totalEl) totalEl.textContent = guides.length;
  const deliveredEl = document.getElementById('stat-delivered');
  if (deliveredEl) deliveredEl.textContent = delivered.length;
  const valueEl = document.getElementById('stat-value');
  if (valueEl) valueEl.textContent = formatCOP(sumValue);
  
  const recent = [...delivered].sort((a,b) => new Date(b.fecha_entrega) - new Date(a.fecha_entrega)).slice(0, 5);
  const recentTable = document.getElementById('recent-table');
  if (recentTable) {
    recentTable.innerHTML = recent.length
      ? recent.map(r => `<tr>
          <td><code>${r.numero_guia}</code></td>
          <td>${r.domiciliarios?.nombre || 'Desconocido'}</td>
          <td style="color:var(--success)">${formatCOP(r.monto)}</td>
          <td>${payBadge(r.metodo_pago, r.pagos_mixtos)}</td>
          <td class="text-muted text-sm">${formatDate(r.fecha_entrega)}</td>
        </tr>`).join('')
      : `<tr><td colspan="5" class="text-center text-muted">Sin entregas hoy</td></tr>`;
  }
    
  fetchLiveMonitor();
}

// ── Guides ────────────────────────────────────────────────
async function loadGuides() {
  const status = document.getElementById('filter-status')?.value || '';
  const type   = document.getElementById('filter-type')?.value   || '';
  let date     = document.getElementById('filter-date')?.value   || '';
  
  if (!date) {
    date = new Date().toLocaleDateString('sv-SE');
  }
  
  let query = supabase.from('guias').select('*, domiciliarios(nombre)').order('created_at', { ascending: false });
  if (status) query = query.eq('status', status);
  if (type)   query = query.eq('tipo', type);
  if (date) {
    const [y, m, d] = date.split('-').map(Number);
    const nextDay = new Date(y, m - 1, d + 1);
    const nextDateStr = nextDay.toLocaleDateString('sv-SE');

    const isToday = date === new Date().toLocaleDateString('sv-SE');

    if (isToday) {
      query = query
        .gte('created_at', `${date}T05:00:00Z`)
        .lt('created_at', `${nextDateStr}T05:00:00Z`);
    } else {
      query = query.or(
        `and(created_at.gte.${date}T05:00:00Z,created_at.lt.${nextDateStr}T05:00:00Z),` +
        `and(fecha_entrega.gte.${date}T05:00:00Z,fecha_entrega.lt.${nextDateStr}T05:00:00Z)`
      );
    }
  }
  
  const { data, error } = await query;
  if (error) {
    // Fallback offline: mostrar pendientes del localStorage para ese día
    const pending = getPendingGuides();
    const dayStr = date;
    const localForDay = pending.filter(g => (g.created_at || '').startsWith(dayStr));
    if (localForDay.length) {
      toast('Sin conexión — mostrando guías locales pendientes', 'warning');
      guidesCache = localForDay;
      renderGuidesTable(localForDay);
    } else {
      toast('Error al cargar guías y no hay datos locales', 'error');
    }
    return;
  }

  // Mezclar guías online con las offline (pendientes) para el día actual
  const pending = getPendingGuides();
  const combined = [...data, ...pending.map(g => ({ ...g, _offline: true }))];
  guidesCache = combined;
  renderGuidesTable(combined);
  updateBadge();
}
window.loadGuides = loadGuides;

async function searchGuia(term) {
  term = term.trim();
  if (!term) { loadGuides(); return; }
  const { data, error } = await supabase.from('guias')
    .select('*, domiciliarios(nombre)')
    .ilike('numero_guia', `%${term}%`)
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) { toast('Error al buscar', 'error'); return; }
  renderGuidesTable(data || []);
}
window.searchGuia = searchGuia;

function updateBadge() {
  const pending = guidesCache.filter(g => g.status === 'en_oficina').length;
  const badge = document.getElementById('badge-guides');
  if (badge) badge.textContent = pending || '';
}

let editingGuideId = null;

function renderGuidesTable(guides) {
  const countEl = document.getElementById('guides-count');
  if (countEl) countEl.textContent = guides.length;
  const tbody = document.getElementById('guides-tbody');
  if (!tbody) return;
  if (!guides.length) {
    tbody.innerHTML = `<tr><td colspan="9"><div class="empty-state"><div class="empty-icon">📦</div><p>No hay guías</p></div></td></tr>`;
    return;
  }
  tbody.innerHTML = guides.map(g => {
    const isEditing = g.id === editingGuideId;
    return `
    <tr class="${g.bajado_sistema ? 'row-bajado' : 'row-pendiente'}" ${g._offline ? 'style="opacity:0.75;border-left:3px solid #f59e0b"' : ''}>
      <td><code style="font-size:.9rem;font-weight:700">${g.numero_guia}</code></td>
      <td>${typeBadge(g.tipo)}</td>
      <td>
        ${isEditing 
          ? `<input type="number" id="edit-monto-${g.id}" class="inline-input" style="width:100px;padding:0.2rem;font-weight:700;color:var(--success)" value="${g.monto}">`
          : `<span style="color:var(--success);font-weight:700">${formatCOP(g.monto)}</span>`
        }
      </td>
      <td>
        ${isEditing
          ? `<select id="edit-metodo-${g.id}" class="inline-input" style="padding:0.2rem;font-size:0.82rem">
              <option value="nequi" ${g.metodo_pago==='nequi'?'selected':''}>Nequi</option>
              <option value="efectivo" ${g.metodo_pago==='efectivo'?'selected':''}>Efectivo</option>
              <option value="pago_directo" ${g.metodo_pago==='pago_directo'?'selected':''}>Directo</option>
              <option value="mixto" ${g.metodo_pago==='mixto'?'selected':''}>Mixto</option>
             </select>`
          : payBadge(g.metodo_pago, g.pagos_mixtos)
        }
      </td>
      <td>
        ${isEditing
          ? `<input type="text" id="edit-obs-${g.id}" class="inline-input" style="width:150px;padding:0.2rem;font-size:0.82rem" placeholder="Observación..." value="${g.observaciones || ''}">`
          : (g.observaciones || '<span class="text-muted">—</span>')
        }
      </td>
      <td>${statusBadge(g.status)}</td>
      <td>${g.domiciliarios?.nombre ? `🛵 ${g.domiciliarios.nombre}` : '<span class="text-muted">—</span>'}</td>
      <td>
        <label style="display:flex;align-items:center;gap:.4rem;cursor:pointer;font-size:.82rem">
          <input type="checkbox" ${g.bajado_sistema ? 'checked' : ''}
            onchange="toggleDownloaded('${g.id}', this.checked)"
            style="accent-color:var(--primary)">
          ${g.bajado_sistema ? '<span style="color:var(--success)">Sí</span>' : '<span class="text-muted">No</span>'}
        </label>
      </td>
      <td>
        <div style="display:flex;gap:.3rem">
          ${isEditing
            ? `<button class="btn btn-sm btn-success" onclick="saveGuideRow('${g.id}')">💾</button>
               <button class="btn btn-sm btn-secondary" onclick="cancelEditGuideRow()">❌</button>`
            : `<button class="btn btn-sm btn-secondary" onclick="editGuideRow('${g.id}')" title="Editar fila">✏️</button>
               ${g.status !== 'entregado' ? `<button class="btn btn-sm btn-danger" onclick="deleteGuide('${g.id}','${g.numero_guia}')" title="Eliminar">🗑️</button>` : ''}`
          }
        </div>
      </td>
    </tr>`
  }).join('');
}

function clearGuideFilters() {
  const s = document.getElementById('filter-status'); if (s) s.value = '';
  const t = document.getElementById('filter-type'); if (t) t.value = '';
  const d = document.getElementById('filter-date'); if (d) d.value = '';
  const srch = document.getElementById('search-guia'); if (srch) srch.value = '';
  loadGuides();
}
window.clearGuideFilters = clearGuideFilters;

function setInlineGroup(groupId, value) {
  const group = document.getElementById(groupId);
  if (!group) return;
  group.querySelectorAll('button').forEach(btn => {
    if (btn.dataset.value === value) btn.classList.add('active');
    else btn.classList.remove('active');
  });
}
window.setInlineGroup = setInlineGroup;

function toggleMixtoInputs(method) {
  const normalInput = document.getElementById('ng-value');
  const mixtoContainer = document.getElementById('ng-mixto-container');
  if (method === 'mixto') {
    normalInput.style.display = 'none';
    mixtoContainer.style.display = 'flex';
    if (document.getElementById('ng-mixto-rows').children.length === 0) {
      addMixtoRow();
    }
  } else {
    normalInput.style.display = 'block';
    mixtoContainer.style.display = 'none';
  }
}
window.toggleMixtoInputs = toggleMixtoInputs;

function addMixtoRow() {
  const rowsContainer = document.getElementById('ng-mixto-rows');
  const row = document.createElement('div');
  row.style.display = 'flex';
  row.style.gap = '0.4rem';
  row.className = 'mixto-row';
  row.innerHTML = `
    <select class="mixto-method w-100" style="padding:0.3rem;" onchange="calculateMixtoTotal()">
      <option value="efectivo">Efectivo</option>
      <option value="nequi">Nequi</option>
      <option value="bancolombia">Bancolombia</option>
      <option value="daviplata">Daviplata</option>
      <option value="otros">Otros</option>
    </select>
    <input type="number" class="mixto-monto inline-input" placeholder="Valor $" min="0" oninput="calculateMixtoTotal()" style="width: 80px;">
    <button class="btn btn-sm btn-danger" onclick="removeMixtoRow(this)">×</button>
  `;
  rowsContainer.appendChild(row);
}
window.addMixtoRow = addMixtoRow;

function removeMixtoRow(btn) {
  const rowsContainer = document.getElementById('ng-mixto-rows');
  if (rowsContainer.children.length > 1) {
    btn.parentElement.remove();
    calculateMixtoTotal();
  } else {
    toast('Debe haber al menos un método de pago', 'warning');
  }
}
window.removeMixtoRow = removeMixtoRow;

function calculateMixtoTotal() {
  let total = 0;
  document.querySelectorAll('.mixto-monto').forEach(input => {
    total += parseFloat(input.value) || 0;
  });
  document.getElementById('ng-mixto-total').textContent = new Intl.NumberFormat('es-CO').format(total);
  return total;
}
window.calculateMixtoTotal = calculateMixtoTotal;

function getInlineGroupValue(groupId) {
  const activeBtn = document.querySelector(`#${groupId} button.active`);
  return activeBtn ? activeBtn.dataset.value : null;
}

async function createGuideInline() {
  const numero_guia  = document.getElementById('ng-number').value.trim();
  const metodo_pago= getInlineGroupValue('ng-payment-group');
  const tipo          = getInlineGroupValue('ng-type-group');
  const observaciones = document.getElementById('ng-observaciones')?.value.trim() || '';
  
  let monto = 0;
  let pagos_mixtos = [];

  if (metodo_pago === 'mixto') {
    document.querySelectorAll('#ng-mixto-rows .mixto-row').forEach(row => {
      const met = row.querySelector('.mixto-method').value;
      const val = parseFloat(row.querySelector('.mixto-monto').value) || 0;
      if (val > 0) {
        pagos_mixtos.push({ metodo: met, monto: val });
      }
    });
    monto = calculateMixtoTotal();
  } else {
    monto = parseFloat(document.getElementById('ng-value').value);
  }
  
  if (!numero_guia || isNaN(monto) || !metodo_pago || !tipo) { 
    toast('Completa todos los campos','warning'); return; 
  }
  
  const guiaPayload = { numero_guia, monto, metodo_pago, tipo, status: 'en_oficina', pagos_mixtos, observaciones };
  const { error } = await supabase.from('guias').insert([guiaPayload]);
  
  if (error) {
    // ¿Es error de red?
    const isNetworkError = !navigator.onLine || error.message?.toLowerCase().includes('fetch') || error.message?.toLowerCase().includes('network');
    if (isNetworkError) {
      // Guardar en cola offline
      const pending = getPendingGuides();
      const tempId = `offline_${Date.now()}`;
      const now = new Date().toISOString();
      pending.push({ ...guiaPayload, _tempId: tempId, _offline: true, created_at: now, fecha_registro: now });
      savePendingGuides(pending);
      toast(`📡 Sin conexión — guía ${numero_guia} guardada localmente`, 'warning');
    } else {
      toast('Error al crear guía: ' + error.message, 'error');
      return;
    }
  } else {
    toast(`Guía ${numero_guia} creada`, 'success');
  }

  document.getElementById('ng-number').value = '';
  document.getElementById('ng-value').value = '';
  const obsEl = document.getElementById('ng-observaciones');
  if (obsEl) obsEl.value = '';
  document.getElementById('ng-mixto-rows').innerHTML = '';
  if (metodo_pago === 'mixto') addMixtoRow();
  calculateMixtoTotal();
  document.getElementById('ng-number').focus();
  loadGuides();
}
window.createGuideInline = createGuideInline;

async function toggleDownloaded(id, val) {
  await supabase.from('guias').update({ bajado_sistema: val }).eq('id', id);
}
window.toggleDownloaded = toggleDownloaded;

async function deleteGuide(id, num) {
  if (!confirm(`¿Eliminar guía ${num}?`)) return;
  await supabase.from('guias').delete().eq('id', id);
  toast(`Guía ${num} eliminada`,'info');
}
window.deleteGuide = deleteGuide;

function editGuideRow(id) {
  editingGuideId = id;
  renderGuidesTable(guidesCache);
}
window.editGuideRow = editGuideRow;

function cancelEditGuideRow() {
  editingGuideId = null;
  renderGuidesTable(guidesCache);
}
window.cancelEditGuideRow = cancelEditGuideRow;

async function saveGuideRow(id) {
  const monto = parseFloat(document.getElementById(`edit-monto-${id}`).value) || 0;
  const metodo_pago = document.getElementById(`edit-metodo-${id}`).value;
  const observaciones = document.getElementById(`edit-obs-${id}`).value;

  const { error } = await supabase.from('guias').update({ monto, metodo_pago, observaciones }).eq('id', id);
  if (error) {
    toast('Error al guardar: ' + error.message, 'error');
  } else {
    toast('Fila guardada ✅', 'success');
    editingGuideId = null;
    loadGuides(); // Refrescar los datos actualizados desde la base
  }
}
window.saveGuideRow = saveGuideRow;

// ── Assign ────────────────────────────────────────────────
async function loadAssignGuides() {
  updateSelectedCount();
  renderScannedGuides();

  const input = document.getElementById('scan-assign-input');
  if (input) {
    input.value = '';
    input.onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleScanInput(input.value.trim());
        input.value = '';
      }
    };
    setTimeout(() => input.focus(), 200);
  }

  const { data: users } = await supabase.from('domiciliarios').select('*').eq('activo', true);
  if (users) {
    const sel = document.getElementById('assign-dom');
    if (sel) {
      sel.innerHTML = `<option value="">Seleccionar mensajero…</option>` +
        users.map(u => `<option value="${u.id}">${u.nombre}</option>`).join('');
    }
  }
}
window.loadAssignGuides = loadAssignGuides;

function handleScanInput(code) {
  const errEl = document.getElementById('scan-error');
  if (errEl) errEl.style.display = 'none';
  if (!code) return;

  if (scannedGuides.some(g => g.numero_guia === code)) {
    if (errEl) {
      errEl.textContent = 'Esta guía ya fue escaneada.';
      errEl.style.display = 'block';
    }
    return;
  }

  const existing = guidesCache.find(g => g.numero_guia === code);
  const guideEntry = existing || { id: null, numero_guia: code, tipo: 'entrega', monto: 0, status: 'en_oficina' };
  scannedGuides.push(guideEntry);
  saveScannedGuides();
  renderScannedGuides();
  updateSelectedCount();
}
window.handleScanInput = handleScanInput;

function renderScannedGuides() {
  const tbody = document.getElementById('scanned-guides-list');
  if (!tbody) return;
  if (!scannedGuides.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="text-center text-muted">Aún no hay guías escaneadas</td></tr>`;
    return;
  }
  tbody.innerHTML = scannedGuides.map((g, idx) => `
    <tr>
      <td><input type="number" class="inline-input" style="width:45px; padding:0.2rem; font-size:0.8rem" value="${idx + 1}" min="1" max="${scannedGuides.length}" onchange="updateScannedGuideOrder('${g.numero_guia}', this.value)"></td>
      <td><input type="text" class="inline-input" style="width:130px; padding:0.2rem; font-weight:700" value="${g.numero_guia}" onchange="updateScannedGuideNumber('${g.numero_guia}', this.value)"></td>
      <td>
        <input type="number" class="inline-input" style="width:80px; padding:0.2rem" value="${g.monto}" onchange="updateScannedGuideValue('${g.numero_guia}', this.value)">
      </td>
      <td>
        <button class="btn btn-sm btn-danger" onclick="removeScannedGuide('${g.numero_guia}')">✕</button>
      </td>
    </tr>
  `).join('');
}



function updateScannedGuideValue(num, newVal) {
  const g = scannedGuides.find(x => x.numero_guia === num);
  if (g) {
    g.monto = parseFloat(newVal) || 0;
    saveScannedGuides();
  }
}
window.updateScannedGuideValue = updateScannedGuideValue;

function updateScannedGuideNumber(oldNumero, newNumero) {
  newNumero = newNumero.trim();
  if (!newNumero) return;
  const g = scannedGuides.find(x => x.numero_guia === oldNumero);
  if (g) {
    g.numero_guia = newNumero;
    saveScannedGuides(); // Utilizando la función existente de guardado
  }
}
window.updateScannedGuideNumber = updateScannedGuideNumber;

function updateScannedGuideOrder(numero_guia, newOrder) {
  newOrder = parseInt(newOrder) - 1;
  if (isNaN(newOrder) || newOrder < 0) return;
  const idx = scannedGuides.findIndex(x => x.numero_guia === numero_guia);
  if (idx === -1) return;
  const [item] = scannedGuides.splice(idx, 1);
  scannedGuides.splice(newOrder, 0, item);
  saveScannedGuides();
  renderScannedGuides();
}
window.updateScannedGuideOrder = updateScannedGuideOrder;

function removeScannedGuide(num) {
  scannedGuides = scannedGuides.filter(g => g.numero_guia !== num);
  saveScannedGuides();
  renderScannedGuides();
  updateSelectedCount();
  const input = document.getElementById('scan-assign-input');
  if (input) input.focus();
}
window.removeScannedGuide = removeScannedGuide;

function clearScannedAssign() {
  scannedGuides = [];
  localStorage.removeItem(LS_SCANNED_KEY);
  renderScannedGuides();
  updateSelectedCount();
  const input = document.getElementById('scan-assign-input');
  if (input) input.focus();
}
window.clearScannedAssign = clearScannedAssign;

function updateSelectedCount() {
  const n = scannedGuides.length;
  const countEl = document.getElementById('selected-count');
  if (countEl) countEl.textContent = n;
  const btn = document.getElementById('btn-do-assign');
  const domSel = document.getElementById('assign-dom');
  if (btn && domSel) btn.disabled = n === 0 || !domSel.value;
}

document.addEventListener('change', e => {
  if (e.target.id === 'assign-dom') updateSelectedCount();
});

async function doAssign() {
  const domSel = document.getElementById('assign-dom');
  if (!domSel) return;
  const domiciliario_id = domSel.value;
  const base_amount = parseFloat(document.getElementById('assign-base').value) || 0;
  if (!domiciliario_id || !scannedGuides.length) return;
  
  try {
    for (const g of scannedGuides) {
      const original = guidesCache.find(x => x.numero_guia === g.numero_guia);
      if (original && original.monto !== g.monto) {
        const msg = `La guía ${g.numero_guia} ya tiene un valor de ${formatCOP(original.monto)}. ¿Cambiar a ${formatCOP(g.monto)}?`;
        if (!window.confirm(msg)) return;
      }
    }

    // 1. Update or create guides
    for (const g of scannedGuides) {
      if (g.id) {
        await supabase.from('guias').update({
          domiciliario_id, status: 'en_ruta', monto: g.monto, tipo: g.tipo, fecha_asignacion: new Date().toISOString()
        }).eq('id', g.id);
      } else {
        const { data } = await supabase.from('guias').insert([{
          numero_guia: g.numero_guia, monto: g.monto, tipo: g.tipo,
          domiciliario_id, status: 'en_ruta', fecha_asignacion: new Date().toISOString()
        }]).select().single();
        g.id = data.id;
      }
    }

    // 2. Insert into daily_routes
    const today = new Date().toLocaleDateString('sv-SE');
    const routeInserts = scannedGuides.map((g, idx) => ({ domiciliario_id, guia_id: g.id, fecha: today, orden: idx + 1 }));
    await supabase.from('daily_routes').upsert(routeInserts, { onConflict: 'guia_id,fecha' });

    // 3. Update base
    if (base_amount > 0) {
      await supabase.from('courier_bases').upsert([{
        domiciliario_id, fecha: today, base_amount
      }], { onConflict: 'domiciliario_id,fecha' });
    }

    toast(`${scannedGuides.length} guías asignadas ✅`, 'success');
    scannedGuides = [];
    localStorage.removeItem(LS_SCANNED_KEY);
    const baseInp = document.getElementById('assign-base');
    if (baseInp) baseInp.value = '0';
    renderScannedGuides();
    loadAssignGuides();
  } catch (err) {
    console.error('Error en doAssign:', err);
    toast(`Error: ${err.message || 'Error desconocido'}`, 'error');
  }
}
window.doAssign = doAssign;

// ── Live Monitor ──────────────────────────────────────────
async function fetchLiveMonitor(containerId = 'live-couriers-list') {
  const today = new Date().toLocaleDateString('sv-SE');
  
  const { data: doms } = await supabase.from('domiciliarios').select('*').eq('activo', true);
  if (!doms) return;
  
  const summaries = [];
  
  for (const d of doms) {
    const { data: routes } = await supabase.from('daily_routes').select('guia_id').eq('domiciliario_id', d.id).eq('fecha', today);
    if (!routes || !routes.length) continue;
    
    const guideIds = routes.map(r => r.guia_id);
    const { data: guides } = await supabase.from('guias').select('*').in('id', guideIds);
    
    const { data: bases } = await supabase.from('courier_bases').select('base_amount').eq('domiciliario_id', d.id).eq('fecha', today).single();
    const base = bases ? bases.base_amount : 0;
    
    let entregadas = 0, pendientes = 0;
    let efectivo = 0, nequi = 0, pago_directo = 0;
    
    guides.forEach(g => {
      if (g.status === 'entregado') {
        entregadas++;
        if (g.metodo_pago === 'efectivo') efectivo += g.monto;
        else if (g.metodo_pago === 'nequi') nequi += g.monto;
        else if (g.metodo_pago === 'pago_directo') pago_directo += g.monto;
        else if (g.metodo_pago === 'mixto' && g.pagos_mixtos) {
          g.pagos_mixtos.forEach(p => {
            const pm = parseFloat(p.monto) || 0;
            if (p.metodo === 'efectivo') efectivo += pm;
            else nequi += pm; // Assume Nequi for anything not cash in mixed? Or maybe handle others.
          });
        }
      } else {
        pendientes++;
      }
    });
    
    summaries.push({
      domiciliario_id: d.id,
      courier_name: d.nombre,
      entregadas, pendientes, efectivo, nequi, pago_directo, base,
      a_entregar: efectivo + base,
      guias: guides
    });
  }
  
  renderLiveMonitor(summaries, containerId);
}

function renderLiveMonitor(summaries, containerId = 'live-couriers-list') {
  const container = document.getElementById(containerId);
  if (!container) return;

  if (!summaries.length) {
    container.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:80px 20px;color:#9CA3AF">
        <div style="font-size:4rem;margin-bottom:16px">📭</div>
        <div style="font-size:1.1rem;font-weight:600;color:#6B7280">No hay mensajeros en ruta hoy</div>
      </div>`;
    return;
  }

  container.innerHTML = summaries.map(s => {
    const total = s.entregadas + s.pendientes;
    const pct = total > 0 ? Math.round((s.entregadas / total) * 100) : 0;
    const isComplete = s.pendientes === 0 && total > 0;
    const statusColor = isComplete ? '#16a34a' : '#FF6B00';
    const statusBg = isComplete ? '#DCFCE7' : '#FFF7ED';

    const guiasRows = (s.guias || []).map((g, i) => `
      <tr style="background:${i % 2 === 0 ? 'white' : '#FAFAFA'}">
        <td style="padding:14px 20px;font-size:14px;font-family:monospace;font-weight:700;color:#374151;border-bottom:1px solid #F3F4F6">${g.numero_guia}</td>
        <td style="padding:14px 20px;font-size:15px;font-weight:800;color:#1A1A1A;border-bottom:1px solid #F3F4F6">${formatCOP(g.monto)}</td>
        <td style="padding:14px 20px;border-bottom:1px solid #F3F4F6">
          ${payBadge(g.metodo_pago, g.pagos_mixtos)}
        </td>
        <td style="padding:14px 20px;border-bottom:1px solid #F3F4F6">
          ${g.entregado
            ? '<span style="background:#DCFCE7;color:#16a34a;padding:5px 14px;border-radius:20px;font-size:12px;font-weight:700">✓ Entregada</span>'
            : '<span style="background:#FEF3C7;color:#D97706;padding:5px 14px;border-radius:20px;font-size:12px;font-weight:700">⏳ Pendiente</span>'
          }
        </td>
      </tr>
    `).join('');

    return `
      <div style="background:white;border-radius:20px;box-shadow:0 4px 24px rgba(0,0,0,0.08);overflow:hidden;margin-bottom:24px;border:1px solid #E5E7EB;width:100%;box-sizing:border-box">
        
        <!-- HEADER MENSAJERO -->
        <div style="display:flex;align-items:center;justify-content:space-between;padding:24px 32px;background:${statusBg};border-bottom:3px solid ${statusColor}">
          <div style="display:flex;align-items:center;gap:20px">
            <div style="width:64px;height:64px;border-radius:50%;background:${statusColor};color:white;display:flex;align-items:center;justify-content:center;font-size:1.8rem;font-weight:900;box-shadow:0 4px 12px rgba(0,0,0,0.2);flex-shrink:0">
              ${s.courier_name.charAt(0).toUpperCase()}
            </div>
            <div>
              <div style="font-size:1.4rem;font-weight:800;color:#1A1A1A;margin-bottom:4px">🛵 ${s.courier_name}</div>
              <div style="font-size:13px;color:#6B7280;font-weight:500">${s.entregadas} de ${total} entregas completadas</div>
            </div>
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:8px">
            <span style="background:${statusColor};color:white;padding:6px 20px;border-radius:30px;font-size:13px;font-weight:800;letter-spacing:.5px">
              ${isComplete ? '✅ Completo' : '🟢 En ruta'}
            </span>
            <span style="font-size:2rem;font-weight:900;color:${statusColor};line-height:1">${pct}%</span>
          </div>
        </div>

        <!-- BARRA PROGRESO -->
        <div style="height:8px;background:#F3F4F6">
          <div style="height:100%;width:${pct}%;background:${statusColor};transition:width .6s ease"></div>
        </div>

        <!-- KPIs -->
        <div style="display:grid;grid-template-columns:repeat(5,1fr);border-bottom:1px solid #F3F4F6">
          <div style="padding:20px 16px;text-align:center;border-right:1px solid #F3F4F6">
            <div style="font-size:2.2rem;font-weight:900;color:#1A1A1A;line-height:1">${s.entregadas}</div>
            <div style="font-size:11px;color:#6B7280;font-weight:700;margin-top:6px;letter-spacing:.8px">ENTREGADAS</div>
          </div>
          <div style="padding:20px 16px;text-align:center;border-right:1px solid #F3F4F6">
            <div style="font-size:2.2rem;font-weight:900;color:${s.pendientes > 0 ? '#D97706' : '#9CA3AF'};line-height:1">${s.pendientes}</div>
            <div style="font-size:11px;color:#6B7280;font-weight:700;margin-top:6px;letter-spacing:.8px">PENDIENTES</div>
          </div>
          <div style="padding:20px 16px;text-align:center;border-right:1px solid #F3F4F6">
            <div style="font-size:1.4rem;font-weight:900;color:#6366f1;line-height:1">${formatCOP(s.base)}</div>
            <div style="font-size:11px;color:#6B7280;font-weight:700;margin-top:6px;letter-spacing:.8px">💼 BASE</div>
          </div>
          <div style="padding:20px 16px;text-align:center;border-right:1px solid #F3F4F6">
            <div style="font-size:1.4rem;font-weight:900;color:#16a34a;line-height:1">${formatCOP(s.efectivo)}</div>
            <div style="font-size:11px;color:#6B7280;font-weight:700;margin-top:6px;letter-spacing:.8px">EFECTIVO</div>
          </div>
          <div style="padding:20px 16px;text-align:center">
            <div style="font-size:1.4rem;font-weight:900;color:#FF6B00;line-height:1">${formatCOP(s.a_entregar)}</div>
            <div style="font-size:11px;color:#6B7280;font-weight:700;margin-top:6px;letter-spacing:.8px">A ENTREGAR</div>
          </div>
        </div>

        <!-- TABLA GUÍAS -->
        ${(s.guias && s.guias.length > 0) ? `
          <table style="width:100%;border-collapse:collapse">
            <thead>
              <tr style="background:#F9FAFB;border-bottom:2px solid #E5E7EB">
                <th style="padding:14px 20px;font-size:11px;color:#6B7280;text-align:left;font-weight:800;letter-spacing:1px">NÚMERO DE GUÍA</th>
                <th style="padding:14px 20px;font-size:11px;color:#6B7280;text-align:left;font-weight:800;letter-spacing:1px">VALOR</th>
                <th style="padding:14px 20px;font-size:11px;color:#6B7280;text-align:left;font-weight:800;letter-spacing:1px">MÉTODO DE PAGO</th>
                <th style="padding:14px 20px;font-size:11px;color:#6B7280;text-align:left;font-weight:800;letter-spacing:1px">ESTADO</th>
              </tr>
            </thead>
            <tbody>${guiasRows}</tbody>
          </table>
        ` : `
          <div style="padding:40px;text-align:center;color:#9CA3AF;font-size:14px;font-weight:500">
            Sin guías asignadas hoy
          </div>
        `}
        <!-- BOTÓN CERRAR RUTA -->
        <div style="padding:16px 24px;background:#F9FAFB;border-top:1px solid #E5E7EB;display:flex;align-items:center;justify-content:space-between">
          <span style="font-size:12px;color:#6B7280;font-weight:500">
            ${isComplete ? '✅ Todas las guías entregadas' : `⚠️ ${s.pendientes} guía(s) pendiente(s)`}
          </span>
          <button 
            onclick="cerrarRuta('${s.domiciliario_id}', '${s.courier_name}')"
            style="background:${isComplete ? '#16a34a' : '#DC2626'};color:white;border:none;padding:10px 24px;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer;font-family:'Inter',sans-serif">
            🔒 Cerrar Ruta
          </button>
        </div>
      </div>
    `;
  }).join('');
}

// ── Cerrar Ruta ───────────────────────────────────────────
// cerrarRuta redundante eliminada. La versión unificada está al final del archivo.

// ── Map ───────────────────────────────────────────────────
function initMap() {
  if (MAP) return;
  const container = document.getElementById('map-container');
  if (!container) return;
  
  MAP = L.map('map-container').setView([3.1782581, -76.4673551], 15);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap'
  }).addTo(MAP);

  L.marker([3.1782581, -76.4673551], {
    icon: L.divIcon({
      className: '',
      html: '<div style="background:#FF6B00;width:14px;height:14px;border-radius:50%;border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.3)"></div>',
      iconSize: [14, 14],
      iconAnchor: [7, 7]
    })
  }).addTo(MAP).bindPopup('<strong>Interrapidísimo Villa Rica</strong><br>Oficina principal').openPopup();
}

function updateMapMarker(dom) {
  if (!MAP || !dom.latitud || !dom.longitud) return;
  const color = dom.activo ? '#3B82F6' : '#EF4444';
  const icon = L.divIcon({
    className: '',
    html: `<div style="background:${color};width:14px;height:14px;border-radius:50%;border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.3)"></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7]
  });
  if (domMarkers[dom.id]) {
    domMarkers[dom.id].setLatLng([dom.latitud, dom.longitud]);
    domMarkers[dom.id].setIcon(icon);
  } else {
    domMarkers[dom.id] = L.marker([dom.latitud, dom.longitud], { icon })
      .addTo(MAP)
      .bindPopup(`<strong>${dom.nombre || 'Mensajero'}</strong><br>🛵 En ruta`);
  }
}

// ── History ───────────────────────────────────────────────
async function loadHistory() {
  const date = document.getElementById('hist-date').value;
  const dom  = document.getElementById('hist-dom').value;
  
  let query = supabase.from('guias').select('*, domiciliarios(nombre)').eq('status', 'entregado').order('fecha_entrega', { ascending: false });
  if (date) query = query.gte('fecha_entrega', `${date}T00:00:00Z`).lt('fecha_entrega', `${date}T23:59:59Z`);
  if (dom) query = query.eq('domiciliario_id', dom);
  
  const { data } = await query;
  const tbody = document.getElementById('history-tbody');
  if (tbody) {
    tbody.innerHTML = data && data.length
      ? data.map(r => `<tr>
          <td><code>${r.numero_guia}</code></td>
          <td>${typeBadge(r.tipo)}</td>
          <td style="color:var(--success)">${formatCOP(r.monto)}</td>
          <td>${payBadge(r.metodo_pago, r.pagos_mixtos)}</td>
          <td>🛵 ${r.domiciliarios?.nombre}</td>
          <td class="text-sm">${formatDate(r.fecha_entrega)}</td>
          <td class="text-sm">
            ${r.latitud ? `<a href="https://www.google.com/maps?q=${r.latitud},${r.longitud}" target="_blank" style="color:var(--info)">📍 Mapa</a>` : '—'}
          </td>
        </tr>`).join('')
      : `<tr><td colspan="7" class="text-center text-muted">Sin entregas</td></tr>`;
  }
}
window.loadHistory = loadHistory;

async function loadHistDoms() {
  const { data: users } = await supabase.from('domiciliarios').select('*');
  const sel = document.getElementById('hist-dom');
  if (sel) {
    sel.innerHTML = `<option value="">Todos los mensajeros</option>` +
      (users || []).map(u => `<option value="${u.id}">${u.nombre}</option>`).join('');
  }
}

function clearHistFilters() {
  const d = document.getElementById('hist-date'); if (d) d.value = '';
  const m = document.getElementById('hist-dom'); if (m) m.value = '';
  loadHistory();
}
window.clearHistFilters = clearHistFilters;

// ── Users ─────────────────────────────────────────────────
async function loadUsers() {
  const { data: users } = await supabase.from('domiciliarios').select('*');
  const tbody = document.getElementById('users-tbody');
  if (tbody) {
    tbody.innerHTML = users && users.length
      ? users.map(u => `<tr>
          <td><div style="display:flex;align-items:center;gap:.6rem">
            <div class="user-row-avatar">${u.nombre[0].toUpperCase()}</div>
            <code>Mensajero</code>
          </div></td>
          <td>${u.nombre}</td>
          <td><span class="badge badge-ruta">🛵 Mensajero</span></td>
          <td class="text-sm text-muted">${formatDate(u.created_at)}</td>
        </tr>`).join('')
      : `<tr><td colspan="4" class="text-center text-muted">No hay mensajeros registrados</td></tr>`;
  }
  loadHistDoms();
}
window.loadUsers = loadUsers;

function openNewUserModal() {
  toast('Para crear usuarios con autenticación usa Supabase Auth', 'info');
}
window.openNewUserModal = openNewUserModal;

// ── Exportación ───────────────────────────────────────────
function exportarExcel() {
  if (!guidesCache.length) { toast('No hay datos para exportar','warning'); return; }
  const data = guidesCache.map(g => {
    let pagoDisplay = g.metodo_pago;
    if (g.metodo_pago === 'mixto' && g.pagos_mixtos && g.pagos_mixtos.length > 0) {
      pagoDisplay = g.pagos_mixtos.map(p => `${p.metodo}: $${p.monto}`).join(' / ');
    }
    return {
      'Número Guía': g.numero_guia, 'Tipo': g.tipo, 'Valor': g.monto, 'Método Pago': pagoDisplay,
      'Estado': g.status, 'Mensajero': g.domiciliarios?.nombre || 'Sin asignar',
      'Descargado': g.bajado_sistema ? 'Sí' : 'No', 'Fecha Registro': formatDate(g.created_at)
    };
  });
  const worksheet = XLSX.utils.json_to_sheet(data);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Guías");
  XLSX.writeFile(workbook, `Guias_${new Date().toLocaleDateString('sv-SE')}.xlsx`);
  toast('Archivo Excel generado', 'success');
}
window.exportarExcel = exportarExcel;

async function exportarPDF() {
  if (!guidesCache.length) { toast('No hay datos para exportar','warning'); return; }
  
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  
  const title = "Relacion de Guias - Interrapidisimo Villa Rica";
  const date = new Date().toLocaleString();
  
  doc.setFontSize(18);
  doc.text(title, 14, 22);
  doc.setFontSize(11);
  doc.setTextColor(100);
  doc.text(`Generado el: ${date}`, 14, 30);
  
  const tableData = guidesCache.map(g => {
    let pagoDisplay = g.metodo_pago.toUpperCase();
    if (g.metodo_pago === 'mixto' && g.pagos_mixtos && g.pagos_mixtos.length > 0) {
      pagoDisplay = g.pagos_mixtos.map(p => `${p.metodo.toUpperCase()}: $${p.monto}`).join(' / ');
    }
    return [
      g.numero_guia,
      g.tipo.toUpperCase(),
      formatCOP(g.monto),
      pagoDisplay,
      g.status.replace('_', ' ').toUpperCase(),
      g.domiciliarios?.nombre || 'SIN ASIGNAR'
    ];
  });
  
  doc.autoTable({
    startY: 35,
    head: [['Guia', 'Tipo', 'Monto', 'Pago', 'Estado', 'Mensajero']],
    body: tableData,
    theme: 'grid',
    headStyles: { fillColor: [255, 107, 0], textColor: [255, 255, 255] },
    alternateRowStyles: { fillColor: [250, 250, 250] },
    margin: { top: 35 }
  });
  
  doc.save(`Guias_${new Date().toLocaleDateString('sv-SE')}.pdf`);
  toast('Archivo PDF generado', 'success');
}
window.exportarPDF = exportarPDF;

// ── Caja ────────────────────────────────────────────────
async function checkCaja() {
  const today = new Date().toLocaleDateString('sv-SE');
  const { data, error } = await supabase.from('caja')
    .select('*')
    .eq('estado', 'abierta')
    .gte('fecha_apertura', `${today}T05:00:00Z`)
    .order('fecha_apertura', { ascending: false })
    .limit(1);
    
  const btnGuardar = document.getElementById('btn-guardar-guia');

  if (!data || data.length === 0) {
    currentCaja = null;
    document.getElementById('modal-caja-apertura').classList.remove('hidden');
    if (btnGuardar) btnGuardar.disabled = true;
  } else {
    currentCaja = data[0];
    document.getElementById('modal-caja-apertura').classList.add('hidden');
    if (btnGuardar) btnGuardar.disabled = false;
  }
}

async function abrirCaja() {
  const nombre = document.getElementById('ca-nombre').value.trim();
  const base = parseFloat(document.getElementById('ca-base').value) || 0;
  
  if (!nombre) { toast('Debe ingresar su nombre', 'error'); return; }
  
  const btn = document.getElementById('btn-abrir-caja');
  btn.disabled = true;
  btn.textContent = 'Abriendo...';
  
  const { data, error } = await supabase.from('caja').insert([{
    estado: 'abierta',
    nombre_apertura: nombre,
    base_caja: base,
    fecha_apertura: new Date().toISOString()
  }]).select().single();
  
  btn.disabled = false;
  btn.textContent = 'Abrir Caja y Comenzar';
  
  if (error) {
    toast('Error al abrir caja', 'error');
    console.error(error);
    return;
  }
  
  toast('Caja abierta correctamente', 'success');
  currentCaja = data;
  document.getElementById('modal-caja-apertura').classList.add('hidden');
  const btnGuardar = document.getElementById('btn-guardar-guia');
  if (btnGuardar) btnGuardar.disabled = false;
}
window.abrirCaja = abrirCaja;

async function loadCajaSection() {
  const badge = document.getElementById('caja-estado-badge');
  const fechaAp = document.getElementById('caja-fecha-apertura');
  const nomAp = document.getElementById('caja-nombre-apertura');
  
  if (!currentCaja) {
    badge.textContent = 'CERRADA';
    badge.className = 'caja-badge caja-badge-cerrada';
    fechaAp.textContent = '—';
    nomAp.textContent = '—';
    return;
  }
  
  badge.textContent = 'ABIERTA';
  badge.className = 'caja-badge caja-badge-abierta';
  fechaAp.textContent = formatDate(currentCaja.fecha_apertura);
  nomAp.textContent = currentCaja.nombre_apertura;
  
  const cajaDate = currentCaja.fecha_apertura.split('T')[0];

  // Guías admin (domiciliario_id null) — todas cuentan para KPIs
  const { data: guiasAdmin } = await supabase.from('guias')
      .select('monto, metodo_pago, pagos_mixtos')
      .is('domiciliario_id', null)
      .gte('created_at', `${cajaDate}T00:00:00Z`)
      .lt('created_at', `${cajaDate}T23:59:59Z`);

  // Guías mensajero (domiciliario_id not null, entregado=true)
  const { data: guiasMensajero } = await supabase.from('guias')
      .select('monto, metodo_pago, pagos_mixtos')
      .not('domiciliario_id', 'is', null)
      .eq('entregado', true)
      .gte('created_at', `${cajaDate}T00:00:00Z`)
      .lt('created_at', `${cajaDate}T23:59:59Z`);

  const todasGuias = [...(guiasAdmin || []), ...(guiasMensajero || [])];

  // Base de mensajeros del día
  const today = new Date().toLocaleDateString('sv-SE');
  const { data: bases } = await supabase.from('courier_bases')
      .select('base_amount')
      .eq('fecha', today);

  const totalBasesMensajeros = (bases || []).reduce((sum, b) => sum + (parseFloat(b.base_amount) || 0), 0);

  let tEfe = 0, tNeq = 0, tDir = 0;
  let efeAdmin = 0, efeMensajero = 0;

  (guiasAdmin || []).forEach(g => {
      const v = parseFloat(g.monto) || 0;
      if (g.metodo_pago === 'efectivo') efeAdmin += v;
      else if (g.metodo_pago === 'nequi') tNeq += v;
      else if (g.metodo_pago === 'pago_directo') tDir += v;
      else if (g.metodo_pago === 'mixto' && g.pagos_mixtos) {
        g.pagos_mixtos.forEach(p => {
          const pm = parseFloat(p.monto) || 0;
          if (p.metodo === 'efectivo') efeAdmin += pm;
          else tNeq += pm;
        });
      }
  });

  (guiasMensajero || []).forEach(g => {
      const v = parseFloat(g.monto) || 0;
      if (g.metodo_pago === 'efectivo') efeMensajero += v;
      else if (g.metodo_pago === 'nequi') tNeq += v;
      else if (g.metodo_pago === 'pago_directo') tDir += v;
      else if (g.metodo_pago === 'mixto' && g.pagos_mixtos) {
        g.pagos_mixtos.forEach(p => {
          const pm = parseFloat(p.monto) || 0;
          if (p.metodo === 'efectivo') efeMensajero += pm;
          else tNeq += pm;
        });
      }
  });

  tEfe = efeAdmin + efeMensajero;

  document.getElementById('caja-total-efectivo').textContent = formatCOP(tEfe);
  document.getElementById('caja-total-nequi').textContent = formatCOP(tNeq);
  document.getElementById('caja-total-directo').textContent = formatCOP(tDir);

  const base = parseFloat(currentCaja.base_caja) || 0;
  document.getElementById('caja-base').textContent = formatCOP(base);
  // esperado = base caja + efectivo cobrado (oficina + mensajeros)
  // La base del mensajero sale de la caja y regresa con él; no se suma aquí.
  const esperado = base + efeAdmin + efeMensajero;
  document.getElementById('caja-esperado').textContent = formatCOP(esperado);

  // Pre-fill expected in inputs
  document.getElementById('caja-dinero-contado').value = esperado;
}
window.loadCajaSection = loadCajaSection;

async function cerrarCaja() {
  if (!currentCaja) return;
  
  const contado = parseFloat(document.getElementById('caja-dinero-contado').value) || 0;
  const nombre = document.getElementById('caja-nombre-cierre').value.trim();
  const obs = document.getElementById('caja-observaciones').value.trim();
  
  if (!nombre) { toast('Debe ingresar su nombre', 'error'); return; }
  if (confirm('¿Estás seguro de que deseas cerrar la caja del día? Esta acción no se puede deshacer.')) {
    const btn = document.getElementById('btn-cerrar-caja');
    btn.disabled = true;
    btn.textContent = 'Cerrando...';
    
    const esperadoStr = document.getElementById('caja-esperado').textContent.replace(/[^0-9.-]+/g,"");
    const esperado = parseFloat(esperadoStr) || 0;
    
    const efeStr = document.getElementById('caja-total-efectivo').textContent.replace(/[^0-9.-]+/g,"");
    const neqStr = document.getElementById('caja-total-nequi').textContent.replace(/[^0-9.-]+/g,"");
    const dirStr = document.getElementById('caja-total-directo').textContent.replace(/[^0-9.-]+/g,"");
    const totalOficina = parseFloat(efeStr) + parseFloat(neqStr) + parseFloat(dirStr);
    
    const { error } = await supabase.from('caja').update({
      estado: 'cerrada',
      fecha_cierre: new Date().toISOString(),
      nombre_cierre: nombre,
      total_recaudado_oficina: totalOficina,
      total_esperado_caja: esperado,
      observaciones_cierre: `Total contado físico: $${contado}. ` + obs
    }).eq('id', currentCaja.id);
    
    btn.disabled = false;
    btn.textContent = 'Cerrar Caja';
    
    if (error) {
      toast('Error al cerrar caja', 'error');
      console.error(error);
      return;
    }
    
    toast('Caja cerrada correctamente', 'success');
    
    document.getElementById('caja-dinero-contado').value = '';
    document.getElementById('caja-nombre-cierre').value = '';
    document.getElementById('caja-observaciones').value = '';
    
    checkCaja();
    showSection('dashboard');
  }
}
window.cerrarCaja = cerrarCaja;

// ── Productos CRUD ────────────────────────────────────────
let productosCache = [];

const PROD_CAT_LABELS = {
  cremas: '🧴 Cremas',
  lociones: '💧 Lociones',
  desodorantes: '✨ Desodorantes',
  otros: '📦 Otros',
  general: '📦 General'
};

async function loadProductos() {
  const tbody = document.getElementById('productos-tbody');
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted">Cargando…</td></tr>`;

  const { data, error } = await supabase
    .from('productos')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) { toast('Error al cargar productos', 'error'); return; }

  productosCache = data || [];
  const countEl = document.getElementById('prod-count');
  if (countEl) countEl.textContent = productosCache.length;

  if (!productosCache.length) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><div class="empty-icon">🛍️</div><p>No hay productos. Agrega el primero.</p></div></td></tr>`;
    return;
  }

  tbody.innerHTML = productosCache.map(p => {
    const cat = PROD_CAT_LABELS[(p.categoria || 'general').toLowerCase()] || p.categoria;
    const imgCell = p.imagen_url
      ? `<img src="${escAdminHtml(p.imagen_url)}" alt="img" style="width:48px;height:48px;object-fit:cover;border-radius:8px;border:1px solid var(--border)" onerror="this.style.display='none'">`
      : `<span style="font-size:1.5rem;opacity:.4">🛍️</span>`;
    const activoBadge = p.activo
      ? `<span class="badge badge-entregado">✅ Activo</span>`
      : `<span class="badge badge-ruta">⏸ Inactivo</span>`;
    return `
      <tr>
        <td style="text-align:center">${imgCell}</td>
        <td style="font-weight:600">${escAdminHtml(p.nombre)}</td>
        <td>${cat}</td>
        <td style="color:var(--primary);font-weight:700">${p.precio > 0 ? formatCOP(p.precio) : '—'}</td>
        <td>${activoBadge}</td>
        <td>
          <div style="display:flex;gap:.3rem">
            <button class="btn btn-sm btn-secondary" onclick="editProducto('${p.id}')">✏️ Editar</button>
            <button class="btn btn-sm btn-danger" onclick="deleteProducto('${p.id}')">🗑️</button>
          </div>
        </td>
      </tr>`;
  }).join('');
}
window.loadProductos = loadProductos;

function resetProductForm() {
  document.getElementById('prod-edit-id').value = '';
  document.getElementById('prod-nombre').value = '';
  document.getElementById('prod-desc').value = '';
  document.getElementById('prod-precio').value = '';
  document.getElementById('prod-categoria').value = 'cremas';
  document.getElementById('prod-imagen').value = '';
  document.getElementById('prod-activo').checked = true;
  document.getElementById('prod-form-title').textContent = '➕ Nuevo Producto';
  document.getElementById('btn-prod-cancel').style.display = 'none';
  document.getElementById('btn-prod-save').textContent = '💾 Guardar producto';
}
window.resetProductForm = resetProductForm;

function editProducto(id) {
  const p = productosCache.find(x => x.id === id);
  if (!p) return;
  document.getElementById('prod-edit-id').value = p.id;
  document.getElementById('prod-nombre').value = p.nombre || '';
  document.getElementById('prod-desc').value = p.descripcion || '';
  document.getElementById('prod-precio').value = p.precio || '';
  document.getElementById('prod-categoria').value = p.categoria || 'cremas';
  document.getElementById('prod-imagen').value = p.imagen_url || '';
  document.getElementById('prod-activo').checked = !!p.activo;
  document.getElementById('prod-form-title').textContent = '✏️ Editar Producto';
  document.getElementById('btn-prod-cancel').style.display = 'inline-flex';
  document.getElementById('btn-prod-save').textContent = '💾 Actualizar producto';
  // Scroll to form
  document.getElementById('prod-form-title').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
window.editProducto = editProducto;

async function saveProduct() {
  const editId = document.getElementById('prod-edit-id').value;
  const nombre = document.getElementById('prod-nombre').value.trim();
  const descripcion = document.getElementById('prod-desc').value.trim();
  const precio = parseFloat(document.getElementById('prod-precio').value) || 0;
  const categoria = document.getElementById('prod-categoria').value;
  const imagen_url = document.getElementById('prod-imagen').value.trim() || null;
  const activo = document.getElementById('prod-activo').checked;

  if (!nombre) { toast('El nombre es obligatorio', 'warning'); return; }

  const btn = document.getElementById('btn-prod-save');
  btn.disabled = true;
  btn.textContent = 'Guardando…';

  const payload = { nombre, descripcion: descripcion || null, precio, categoria, imagen_url, activo };

  let error;
  if (editId) {
    ({ error } = await supabase.from('productos').update(payload).eq('id', editId));
  } else {
    ({ error } = await supabase.from('productos').insert([payload]));
  }

  btn.disabled = false;
  btn.textContent = editId ? '💾 Actualizar producto' : '💾 Guardar producto';

  if (error) { toast('Error: ' + error.message, 'error'); return; }

  toast(editId ? 'Producto actualizado ✅' : 'Producto creado ✅', 'success');
  resetProductForm();
  loadProductos();
}
window.saveProduct = saveProduct;

async function deleteProducto(id) {
  const p = productosCache.find(x => x.id === id);
  const nombre = p ? p.nombre : 'este producto';
  if (!confirm(`¿Eliminar el producto "${nombre}"? Esta acción no se puede deshacer.`)) return;
  const { error } = await supabase.from('productos').delete().eq('id', id);
  if (error) { toast('Error al eliminar: ' + error.message, 'error'); return; }
  toast('Producto eliminado', 'info');
  loadProductos();
}
window.deleteProducto = deleteProducto;

function escAdminHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
async function cerrarRuta(domiciliarioId, domNombre) {
  const confirmar = confirm(`¿Cerrar la ruta de ${domNombre}?\n\nEsto archivará la jornada y permitirá asignar una nueva ruta.`);
  if (!confirmar) return;

  const today = new Date().toLocaleDateString('sv-SE');

  // 1. Obtener datos de la sesión actual (sin filtrar por fecha para limpiar rutas olvidadas)
  const { data: routes } = await supabase.from('daily_routes')
    .select('guia_id')
    .eq('domiciliario_id', domiciliarioId);

  const { data: bases } = await supabase.from('courier_bases')
    .select('base_amount')
    .eq('domiciliario_id', domiciliarioId)
    .eq('fecha', today);

  const guiaIds = (routes || []).map(r => r.guia_id);
  const { data: guias } = guiaIds.length
    ? await supabase.from('guias').select('monto, metodo_pago, entregado, pagos_mixtos').in('id', guiaIds)
    : { data: [] };

  // 2. Calcular totales
  let tEfe = 0, tNeq = 0, tDir = 0, entregadas = 0;
  (guias || []).forEach(g => {
    if (!g.entregado) return;
    entregadas++;
    const v = parseFloat(g.monto) || 0;
    if (g.metodo_pago === 'efectivo') tEfe += v;
    else if (g.metodo_pago === 'nequi') tNeq += v;
    else if (g.metodo_pago === 'pago_directo') tDir += v;
    else if (g.metodo_pago === 'mixto' && g.pagos_mixtos) {
      g.pagos_mixtos.forEach(p => {
        const pm = parseFloat(p.monto) || 0;
        if (p.metodo === 'efectivo') tEfe += pm;
        else tNeq += pm;
      });
    }
  });

  const base = parseFloat(bases?.[0]?.base_amount) || 0;
  const aEntregar = base + tEfe;

  // 3. Guardar en route_sessions (se registra con la fecha de hoy)
  const { error: sessionError } = await supabase.from('route_sessions').insert([{
    domiciliario_id: domiciliarioId,
    domiciliario_nombre: domNombre,
    fecha: today,
    base_amount: base,
    total_guias: (guias || []).length,
    total_entregadas: entregadas,
    total_efectivo: tEfe,
    total_nequi: tNeq,
    total_pago_directo: tDir,
    a_entregar: aEntregar,
    cerrada_por: 'Administrador'
  }]);

  if (sessionError) {
    toast('Error al cerrar la ruta: ' + sessionError.message, 'error');
    return;
  }

  // 4. Limpiar daily_routes y courier_bases (todos los pendientes del mensajero)
  await supabase.from('daily_routes')
    .delete()
    .eq('domiciliario_id', domiciliarioId);

  await supabase.from('courier_bases')
    .delete()
    .eq('domiciliario_id', domiciliarioId);

  // 5. Eliminar guías no entregadas (según preferencia del usuario)
  if (guiaIds.length) {
    await supabase.from('guias')
      .delete()
      .in('id', guiaIds)
      .eq('entregado', false);
  }

  toast(`✅ Ruta de ${domNombre} cerrada correctamente`, 'success');
  if (window.fetchLiveMonitor) fetchLiveMonitor('monitor-standalone-container');
  if (window.fetchLiveMonitor) fetchLiveMonitor('live-monitor-container');
}
window.cerrarRuta = cerrarRuta;

// Start logic
supabase.auth.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_OUT') {
    const overlay = document.getElementById('login-overlay');
    if (overlay) overlay.classList.remove('hidden');
    const shell = document.getElementById('app-shell');
    if (shell) shell.classList.add('hidden');
    return;
  }

  if (session) {
    const meta = session.user.user_metadata || {};
    if (meta.role === 'admin') {
      if (!currentUser) { // Evitar reinicializar si ya está activo
        currentUser = session.user;
        initApp(meta.name);
      }
    }
  } else {
    // Si no hay sesión inicial, mostrar login
    const overlay = document.getElementById('login-overlay');
    if (overlay) overlay.classList.remove('hidden');
  }
});
