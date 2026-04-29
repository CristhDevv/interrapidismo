// ============================================================
// main.js — Página pública: búsqueda de guías
// ============================================================

const API = '';

// ── Toast ─────────────────────────────────────────────────
function toast(msg, type = 'info') {
  const icons = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span class="toast-icon">${icons[type]}</span><span>${msg}</span>`;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateX(30px)'; el.style.transition = '.3s'; setTimeout(() => el.remove(), 300); }, 3500);
}

// ── Format helpers ────────────────────────────────────────
function formatCOP(val) {
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 }).format(val);
}

function formatStatus(s) {
  const map = {
    en_oficina: { label: 'En oficina',  class: 'badge-oficina',   icon: '🏢' },
    en_ruta:    { label: 'En ruta',     class: 'badge-ruta',      icon: '🛵' },
    entregado:  { label: 'Entregado',   class: 'badge-entregado', icon: '✅' },
  };
  return map[s] || { label: s, class: '', icon: '📦' };
}

function formatPayment(p) {
  const map = {
    nequi:       { label: 'Nequi',        class: 'badge-nequi',       icon: '💜' },
    efectivo:    { label: 'Efectivo',      class: 'badge-efectivo',    icon: '💵' },
    pago_directo:{ label: 'Pago directo',  class: 'badge-pago-directo',icon: '🏦' },
  };
  return map[p] || { label: p, class: '', icon: '💳' };
}

function formatType(t) {
  return t === 'entrega'
    ? '<span class="badge badge-entrega">📥 Entrega</span>'
    : '<span class="badge badge-envio">📤 Envío</span>';
}

// ── Status timeline ────────────────────────────────────────
function buildTimeline(status) {
  const steps = [
    { key: 'en_oficina', label: 'Oficina', icon: '🏢' },
    { key: 'en_ruta',    label: 'En ruta', icon: '🛵' },
    { key: 'entregado',  label: 'Entregado', icon: '✅' },
  ];
  const idx = steps.findIndex(s => s.key === status);
  return `
    <div class="status-timeline">
      ${steps.map((s, i) => `
        <div class="tl-step ${i < idx ? 'done' : i === idx ? 'active' : ''}">
          <span class="tl-icon">${s.icon}</span>
          <span>${s.label}</span>
        </div>
        ${i < steps.length - 1 ? '<div class="tl-sep"></div>' : ''}
      `).join('')}
    </div>`;
}

// ── Search ────────────────────────────────────────────────
async function searchGuide() {
  const input = document.getElementById('guide-search');
  const q = input.value.trim();
  
  if (!q) { 
    toast('Ingresa un número de guía', 'warning'); 
    input.focus(); 
    return; 
  }

  // 1. Copiar automáticamente al portapapeles
  try {
    await navigator.clipboard.writeText(q);
  } catch (err) {
    console.error('No se pudo copiar el texto: ', err);
  }

  // 2. Abrir el portal oficial en una nueva pestaña
  const url = `https://siguetuenvio.interrapidisimo.com`;
  window.open(url, '_blank');
  
  // 3. Feedback visual con instrucciones claras
  const box = document.getElementById('result-box');
  box.innerHTML = `
    <div class="result-not-found">
      <div class="icon">📋</div>
      <p style="font-size: 1.1rem; color: var(--primary); font-weight: 700;">Número de guía copiado</p>
      <p class="mt-1">Pégalo en el campo de búsqueda de la página oficial que se acaba de abrir.</p>
      <div class="mt-2" style="background: rgba(230,57,70,0.05); padding: 1rem; border-radius: 8px; border: 1px dashed var(--primary);">
        <code style="font-size: 1.3rem; font-weight: 800; color: var(--text-dark);">${q}</code>
      </div>
      <button class="btn btn-secondary mt-2" onclick="window.open('${url}', '_blank')">Abrir portal de nuevo</button>
    </div>`;
  
  toast('Número copiado. ¡Listo para pegar!', 'success');
}

// ── Init ──────────────────────────────────────────────────
document.getElementById('guide-search').focus();
