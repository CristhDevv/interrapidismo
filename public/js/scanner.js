// ============================================================
// scanner.js — Lógica completa del mensajero (Supabase)
// ============================================================
let currentUser = null;
let domiciliarioId = null; // ID real en tabla domiciliarios (distinto al Auth ID)
let myGuides = [];
let deliverCoords = { lat: null, lng: null };
let gpsWatchId = null;
let gpsInterval = null;
let quaggaActive = false;

// Map guideId -> selected payment method for inline cards
const inlinePayment = {};

// ── Toast ─────────────────────────────────────────────────
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

// ── Auth ──────────────────────────────────────────────────
async function doLogin() {
  const email = document.getElementById('login-user').value.trim();
  const password = document.getElementById('login-pass').value;
  const btn = document.getElementById('login-btn');
  const err = document.getElementById('login-error');
  
  if (!email || !password) { err.textContent='Completa todos los campos'; err.style.display='block'; return; }
  btn.disabled=true; btn.textContent='Verificando…';
  
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  
  if (error || !data.user) { 
    err.textContent = 'Credenciales incorrectas'; err.style.display='block'; 
    btn.disabled=false; btn.textContent='Entrar';
    return; 
  }
  
  const meta = data.user.user_metadata || {};
  if (meta.role !== 'domiciliario' && meta.role !== 'admin') {
    await supabase.auth.signOut();
    err.textContent = 'Solo mensajeros pueden acceder aquí'; err.style.display='block';
    btn.disabled=false; btn.textContent='Entrar';
    return;
  }
  
  currentUser = data.user;
  initApp(meta.name);
}
window.doLogin = doLogin;

async function doLogout() {
  stopGPS(); stopScanner();
  await supabase.auth.signOut();
  window.location.href = 'login.html';
}
window.doLogout = doLogout;

async function checkSession() {
  const { data: { session } } = await supabase.auth.getSession();
  if (session) {
    const meta = session.user.user_metadata || {};
    if (meta.role === 'domiciliario' || meta.role === 'admin') {
      currentUser = session.user;
      initApp(meta.name);
      return;
    } else {
      await supabase.auth.signOut();
    }
  } else {
    document.getElementById('login-overlay').classList.remove('hidden');
  }
}

async function initApp(name) {
  document.getElementById('login-overlay').classList.add('hidden');
  document.getElementById('dom-shell').classList.remove('hidden');
  document.getElementById('dom-user-name').textContent = name || 'Mensajero';
  
  // Resolver el domiciliario_id real desde la tabla domiciliarios
  const { data: domData } = await supabase
      .from('domiciliarios')
      .select('id')
      .eq('user_id', currentUser.id)
      .single();

  if (domData) {
      domiciliarioId = domData.id;
  } else {
      // Fallback: usar el Auth ID directamente
      domiciliarioId = currentUser.id;
  }
  
  initRealtime();
  syncAll();
}

// ── Supabase Realtime ─────────────────────────────────────
function initRealtime() {
  if (!currentUser) return;
  
  supabase.channel('domiciliario_routes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'daily_routes', filter: `domiciliario_id=eq.${domiciliarioId}` }, () => {
      toast('¡Rutas actualizadas!', 'info');
      if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
      syncAll();
    })
    .subscribe();
    
  supabase.channel('domiciliario_guias')
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'guias', filter: `domiciliario_id=eq.${domiciliarioId}` }, payload => {
      // Refresh local cache
      const idx = myGuides.findIndex(g => g.id === payload.new.id);
      if (idx !== -1) {
        myGuides[idx] = payload.new;
        renderGuidesList();
        updateStats();
        fetchLiveMonitor();
      }
    })
    .subscribe();
}

// ── Live Monitor ──────────────────────────────────────────
async function fetchLiveMonitor() {
  if (!currentUser) return;
  const today = new Date().toISOString().split('T')[0];
  
  try {
    const { data: routes } = await supabase.from('daily_routes').select('guia_id').eq('domiciliario_id', domiciliarioId).eq('fecha', today);
    if (!routes || !routes.length) {
      renderSummary({ efectivo:0, nequi:0, pago_directo:0, base:0, a_entregar:0 });
      return;
    }
    
    const guideIds = routes.map(r => r.guia_id);
    const { data: guides } = await supabase.from('guias').select('*').in('id', guideIds);
    
    const { data: bases } = await supabase.from('courier_bases').select('base_amount').eq('domiciliario_id', domiciliarioId).eq('fecha', today).single();
    const base = bases ? bases.base_amount : 0;
    
    let efectivo = 0, nequi = 0, pago_directo = 0;
    
    (guides || []).forEach(g => {
      if (g.status === 'entregado') {
        if (g.metodo_pago === 'efectivo') efectivo += g.monto;
        else if (g.metodo_pago === 'nequi') nequi += g.monto;
        else if (g.metodo_pago === 'pago_directo') pago_directo += g.monto;
      }
    });
    
    renderSummary({
      efectivo, nequi, pago_directo, base,
      a_entregar: efectivo + base
    });
  } catch(e) {}
}

function renderSummary(s) {
  document.getElementById('summ-efectivo').textContent = formatCOP(s.efectivo);
  document.getElementById('summ-nequi').textContent = formatCOP(s.nequi);
  document.getElementById('summ-directo').textContent = formatCOP(s.pago_directo);
  document.getElementById('summ-base').textContent = formatCOP(s.base);
  document.getElementById('summ-total').textContent = formatCOP(s.a_entregar);
}

// ── Tabs ──────────────────────────────────────────────────
function showTab(id) {
  document.querySelectorAll('.dom-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.dom-tab-panel').forEach(p => p.classList.remove('active'));
  document.getElementById(`tab-${id}`).classList.add('active');
  document.getElementById(`panel-${id}`).classList.add('active');
  if (id !== 'scanner' && quaggaActive) stopScanner();
}

// ── Sync ──────────────────────────────────────────────────
async function syncAll() {
  const btn = document.getElementById('sync-btn');
  if (btn) btn.classList.add('syncing');
  await loadMyGuides();
  await fetchLiveMonitor();
  if (btn) btn.classList.remove('syncing');
}

// ── My guides ─────────────────────────────────────────────
async function loadMyGuides() {
  if (!currentUser) return;
  const today = new Date().toLocaleDateString('sv-SE');
  
  try {
    const { data: routes } = await supabase.from('daily_routes')
      .select('guia_id, orden')
      .eq('domiciliario_id', domiciliarioId)
      .eq('fecha', today)
      .order('orden', { ascending: true });

    if (!routes || !routes.length) {
      // Fallback: Consultar directamente en guias si no hay daily_routes
      const { data: fallbackGuides } = await supabase.from('guias')
        .select('*')
        .eq('domiciliario_id', domiciliarioId)
        .gte('fecha_asignacion', `${today}T00:00:00Z`)
        .lt('fecha_asignacion', `${today}T23:59:59Z`);

      if (!fallbackGuides || !fallbackGuides.length) {
        myGuides = [];
        renderGuidesList();
        updateStats();
        return;
      }

      myGuides = fallbackGuides.map((g, idx) => ({ ...g, orden: idx + 1 }));
      renderGuidesList();
      updateStats();
      return;
    }

    const guideIds = routes.map(r => r.guia_id);
    const { data: guides } = await supabase.from('guias').select('*').in('id', guideIds);

    // Cruzar orden con datos de guías
    const ordenMap = {};
    routes.forEach(r => { ordenMap[r.guia_id] = r.orden; });
    myGuides = (guides || [])
      .map(g => ({ ...g, orden: ordenMap[g.id] || 999 }))
      .sort((a, b) => a.orden - b.orden);
    renderGuidesList();
    updateStats();
  } catch(e) { toast('Error al cargar guías', 'error'); }
}

function renderGuidesList() {
  const list = document.getElementById('guides-list');
  if (!myGuides.length) {
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">📦</div><p>No tienes guías asignadas hoy</p></div>`;
    return;
  }
  // Ordenar: pendientes primero
  const sorted = [...myGuides].sort((a,b) => {
    if (a.status === 'entregado' && b.status !== 'entregado') return 1;
    if (a.status !== 'entregado' && b.status === 'entregado') return -1;
    return 0;
  });
  list.innerHTML = sorted.map(g => guideCardHTML(g)).join('');
  // Start getting GPS in background for faster delivery
  prefetchGPS();
}

function guideCardHTML(g) {
  if (g.status === 'entregado') {
    return `
    <div class="guide-item entregado" id="gi-${g.id}">
      <div class="guide-item-header">
        <div class="guide-item-num">
          ${g.orden ? `<span style="background:#FF6B00;color:white;border-radius:50%;width:20px;height:20px;display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;margin-right:6px">${g.orden}</span>` : ''}${g.numero_guia}
        </div>
        <div class="guide-item-badges">
          ${g.tipo === 'entrega' ? '<span class="badge badge-entrega">📥 Entrega</span>' : '<span class="badge badge-envio">📤 Envío</span>'}
        </div>
      </div>
      <div class="guide-item-value">${formatCOP(g.monto)}</div>
      <div class="guide-item-footer">
        <button class="btn-deliver entregado" disabled>✅ Entregado</button>
      </div>
    </div>`;
  }
  return `
  <div class="guide-item en_ruta" id="gi-${g.id}">
    <div class="guide-item-header">
      <div class="guide-item-num">
        ${g.orden ? `<span style="background:#FF6B00;color:white;border-radius:50%;width:20px;height:20px;display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;margin-right:6px">${g.orden}</span>` : ''}${g.numero_guia}
      </div>
      <div class="guide-item-badges">
        ${g.tipo === 'entrega' ? '<span class="badge badge-entrega">📥 Entrega</span>' : '<span class="badge badge-envio">📤 Envío</span>'}
        <span class="badge badge-ruta">🛵 Pendiente</span>
      </div>
    </div>
    <div class="guide-item-value">${formatCOP(g.monto)}</div>

    <!-- Inline delivery controls -->
    <div class="inline-deliver">
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:6px">
        <button class="pay-inline-btn" id="ipay-efectivo-${g.id}" onclick="selectInlinePayment('${g.id}', 'efectivo')">💵 Efectivo</button>
        <button class="pay-inline-btn" id="ipay-nequi-${g.id}" onclick="selectInlinePayment('${g.id}', 'nequi')">📱 Nequi</button>
        <button class="pay-inline-btn" id="ipay-directo-${g.id}" onclick="selectInlinePayment('${g.id}', 'pago_directo')">🏦 Directo</button>
        <button class="btn-deliver" id="ibtn-${g.id}" onclick="confirmInlineDeliver('${g.id}')" disabled style="opacity:.5;flex:1;min-width:80px">✓ Entregar</button>
      </div>
    </div>
  </div>`;
}

function updateStats() {
  const total   = myGuides.length;
  const done    = myGuides.filter(g => g.status === 'entregado').length;
  const pending = total - done;
  document.getElementById('stat-total').textContent   = total;
  document.getElementById('stat-pending').textContent = pending;
  document.getElementById('stat-done').textContent    = done;
}

// ── Inline delivery ───────────────────────────────────────
function prefetchGPS() {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    pos => { deliverCoords.lat = pos.coords.latitude; deliverCoords.lng = pos.coords.longitude; },
    () => {},
    { timeout: 10000, enableHighAccuracy: true }
  );
}

function selectInlinePayment(guideId, method) {
  inlinePayment[guideId] = method;
  // Update button styles
  ['efectivo','nequi','directo'].forEach(m => {
    const realMethod = m === 'directo' ? 'pago_directo' : m;
    const btn = document.getElementById(`ipay-${m}-${guideId}`);
    if (btn) btn.classList.toggle('active', realMethod === method);
  });
  // Enable confirm button
  const confirmBtn = document.getElementById(`ibtn-${guideId}`);
  if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.style.opacity = '1'; }
}

async function confirmInlineDeliver(guideId) {
  const g = myGuides.find(x => x.id === guideId);
  const payMethod = inlinePayment[guideId];
  if (!g || !payMethod) { toast('Selecciona un método de pago', 'warning'); return; }

  const btn = document.getElementById(`ibtn-${guideId}`);
  btn.disabled = true; btn.textContent = 'Guardando…';

  // Get fresh GPS if we don't have it
  if (!deliverCoords.lat) {
    await new Promise(resolve => {
      navigator.geolocation?.getCurrentPosition(
        pos => { deliverCoords.lat = pos.coords.latitude; deliverCoords.lng = pos.coords.longitude; resolve(); },
        () => resolve(),
        { timeout: 5000, enableHighAccuracy: true }
      ) ?? resolve();
    });
  }

  try {
    const { error } = await supabase.from('guias').update({
      status: 'entregado',
      entregado: true,
      metodo_pago: payMethod,
      fecha_entrega: new Date().toISOString(),
      latitud: deliverCoords.lat,
      longitud: deliverCoords.lng
    }).eq('id', guideId);
    
    if (error) { toast(error.message || 'Error', 'error'); btn.disabled=false; btn.textContent='✓ Entregar'; return; }
    
    toast(`✅ Guía ${g.numero_guia} entregada`, 'success');
    delete inlinePayment[guideId];
    await syncAll();
  } catch(e) {
    toast('Error de conexión', 'error');
    btn.disabled = false; btn.textContent = '✓ Entregar';
  }
}

// ── GPS tracking ──────────────────────────────────────────
function startGPS() {
  if (!navigator.geolocation) { toast('GPS no disponible','error'); return; }
  const dot  = document.getElementById('loc-dot');
  const text = document.getElementById('loc-status');
  dot.className = 'location-dot pulse';
  text.textContent = 'Iniciando GPS…';
  document.getElementById('btn-gps').disabled = true;

  async function sendLocation(pos) {
    const lat = pos.coords.latitude;
    const lng = pos.coords.longitude;
    dot.className = 'location-dot active';
    text.textContent = 'GPS activo — reportando';
    document.getElementById('gps-coords').textContent = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    
    if (currentUser) {
      await supabase.from('domiciliarios').update({ latitud: lat, longitud: lng, ultima_ubicacion: new Date().toISOString() }).eq('id', domiciliarioId);
    }
  }

  gpsWatchId = navigator.geolocation.watchPosition(sendLocation, () => {
    dot.className  = 'location-dot error';
    text.textContent = 'Error de GPS';
  }, { enableHighAccuracy: true, maximumAge: 10000 });
}

function stopGPS() {
  if (gpsWatchId !== null) { navigator.geolocation.clearWatch(gpsWatchId); gpsWatchId = null; }
  if (gpsInterval)         { clearInterval(gpsInterval); gpsInterval = null; }
  const dot  = document.getElementById('loc-dot');
  const text = document.getElementById('loc-status');
  if (dot)  dot.className = 'location-dot';
  if (text) text.textContent = 'GPS detenido';
  const btn = document.getElementById('btn-gps');
  if (btn) btn.disabled = false;
}

// ── QuaggaJS Scanner ──────────────────────────────────────
function startScanner() {
  if (quaggaActive) return;
  const wrap = document.getElementById('scanner-video-wrap');
  Quagga.init({
    inputStream: {
      name: 'Live',
      type: 'LiveStream',
      target: wrap,
      constraints: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
    },
    decoder: {
      readers: ['code_128_reader','ean_13_reader','ean_8_reader','code_39_reader','upc_reader']
    },
    locate: true,
    numOfWorkers: 2,
    frequency: 10,
  }, err => {
    if (err) { toast('No se pudo acceder a la cámara', 'error'); return; }
    Quagga.start();
    quaggaActive = true;
    document.getElementById('btn-start-scan').style.display = 'none';
    document.getElementById('btn-stop-scan').style.display  = '';
  });

  let lastCode = '';
  let lastTime = 0;
  Quagga.onDetected(result => {
    const code = result.codeResult.code;
    const now  = Date.now();
    if (code === lastCode && now - lastTime < 2000) return;
    lastCode = code; lastTime = now;
    document.getElementById('scanner-result').classList.remove('hidden');
    document.getElementById('scanner-result-text').textContent = code;
    // Beep
    try {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator(); osc.frequency.value = 880;
      osc.connect(ctx.destination); osc.start(); osc.stop(ctx.currentTime + .15);
    } catch {}
    findAndShowGuide(code);
  });
}

function stopScanner() {
  if (!quaggaActive) return;
  Quagga.stop();
  quaggaActive = false;
  document.getElementById('btn-start-scan').style.display = '';
  document.getElementById('btn-stop-scan').style.display  = 'none';
  document.getElementById('scanner-result').classList.add('hidden');
}

function searchManual() {
  const val = document.getElementById('manual-guide').value.trim();
  if (!val) { toast('Ingresa un número de guía','warning'); return; }
  findAndShowGuide(val);
}

function findAndShowGuide(code) {
  const g = myGuides.find(x => x.numero_guia.trim() === code.trim());
  const box = document.getElementById('scan-found');
  box.classList.remove('hidden');
  if (!g) {
    box.innerHTML = `<div class="guide-item en_oficina">
      <div class="guide-item-header"><div class="guide-item-num">${code}</div></div>
      <p class="text-muted text-sm mt-1">Esta guía no está en tu ruta de hoy</p>
    </div>`;
    return;
  }
  box.innerHTML = `<div class="guide-item ${g.status}">
    <div class="guide-item-header">
      <div class="guide-item-num">${g.numero_guia}</div>
      ${g.status === 'entregado'
        ? '<span class="badge badge-entregado">✅ Entregado</span>'
        : '<span class="badge badge-ruta">🛵 Pendiente</span>'}
    </div>
    <div class="guide-item-value">${formatCOP(g.monto)}</div>
    <div class="guide-item-footer">
      ${g.status !== 'entregado'
        ? `<button class="btn-deliver" onclick="showTab('guides')" style="margin-top:.3rem">📋 Ver en lista</button>`
        : `<button class="btn-deliver entregado" disabled>✅ Entregado</button>`}
    </div>
  </div>`;
}

// Check session on load
document.addEventListener('DOMContentLoaded', checkSession);
