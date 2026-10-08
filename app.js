/* ========= CONFIGURACIÓN =========
 * API_URL : URL del Worker de Cloudflare (https://limpiezas-api.TU-SUBDOMINIO.workers.dev)
 *           (o, sin Worker, la URL /exec de Apps Script: funciona igual pero más lento)
 * La clave va en el enlace que compartes:  https://…github.io/…/#k=TU_CLAVE
 * Vista de prueba sin datos reales : añade ?demo al final del enlace
 */
const API_URL = 'https://limpiezas-api.quiniouthomas-pro.workers.dev/';
/* ================================= */

const $ = s => document.querySelector(s);
const eur = n => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(n || 0);
const parseD = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const today = (() => { const t = new Date(); t.setHours(0, 0, 0, 0); return t; })();
const fmtLong = d => d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
const fmtShort = d => d.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' });
const dayDiff = d => Math.round((d - today) / 864e5);
const rel = d => { const n = dayDiff(d); return n === 0 ? 'hoy' : n === 1 ? 'mañana' : n === -1 ? 'ayer' : n > 1 ? `en ${n} días` : `hace ${-n} días`; };
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const starsTxt = n => '★'.repeat(n) + '☆'.repeat(5 - n);
const isDemo = new URLSearchParams(location.search).has('demo');

let BASE = null;      // última respuesta del servidor
let DATA = null;      // lo que se muestra = BASE + acciones todavía en curso
let filter = 'Todos';
const queue = [];     // acciones pendientes, se envían una a una
let running = false, seq = 0;

const ERRORS = {
  unauthorized: 'Enlace incompleto. Pide a Tom el enlace completo.',
  estrellas_obligatorias: 'Elige de 1 a 5 estrellas.',
  datos_cambiados: 'Los datos han cambiado. Vuelve a intentarlo.',
  fecha_futura: 'No se puede marcar una limpieza futura.',
  ya_pagada: 'Esta limpieza ya está pagada, no se puede deshacer.',
  texto_vacio: 'Escribe lo que hace falta comprar.',
  lista_llena: 'La lista está llena, avisa a Tom.',
  piso_desconocido: 'Piso desconocido, recarga la página.',
};

function key() { return new URLSearchParams(location.hash.slice(1)).get('k') || ''; }

/* ---------- Datos ---------- */

function prep(j) {
  j.rows.forEach(r => { r.d = parseD(r.date); });
  j.rows.sort((a, b) => a.d - b.d);
  j.compras = j.compras || [];
  j.pisos = (j.pisos && j.pisos.length) ? j.pisos : [...new Set(j.rows.map(r => r.piso))].filter(Boolean);
  return j;
}
const clone = j => prep(JSON.parse(JSON.stringify(j, (k, v) => (k === 'd' ? undefined : v))));
function setBase(j, fromServer = true) {
  if (fromServer && j.warnings && j.warnings.length) {
    setTimeout(() => toast(j.warnings.map(w => w.msg).join(' '), true), 300);
  }
  delete j.warnings;
  BASE = prep(j);
  if (fromServer && !isDemo) saveLocal(j);
}

// Copia local en el móvil: la página se muestra al instante y luego se actualiza en segundo plano
const LS_KEY = 'limpiezas_cache_v1';
function saveLocal(j) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(j, (k, v) => (k === 'd' ? undefined : v))); } catch (e) {}
}
function readLocal() {
  try { const t = localStorage.getItem(LS_KEY); return t ? JSON.parse(t) : null; } catch (e) { return null; }
}
let refreshing = false;

// Vista = datos del servidor + acciones en curso (se ven al instante, en gris, hasta que Google confirma)
function recompute() {
  DATA = clone(BASE);
  queue.forEach(op => op.apply(DATA));
  render();
  updateStatus();
}

function enqueue(op) {
  op.id = ++seq;
  queue.push(op);
  recompute();
  run();
}

async function run() {
  if (running) return;
  running = true;
  while (queue.length) {
    const op = queue[0];
    try {
      setBase(await api(op.action, op.payload));
      queue.shift();
      if (op.okMsg) toast(op.okMsg);
    } catch (e) {
      queue.shift();
      toast((ERRORS[e.message] || 'No se pudo guardar') + (op.what ? ` (${op.what})` : '') + '. Inténtalo de nuevo.', true);
    }
    recompute();
  }
  running = false;
}

function updateStatus() {
  const el = $('#status');
  const n = queue.length;
  el.classList.toggle('show', n > 0);
  el.innerHTML = n ? `<span class="spinner"></span>Guardando${n > 1 ? ` (${n})` : ''}… <small>no cierres la página</small>` : '';
}
window.addEventListener('beforeunload', e => { if (queue.length) { e.preventDefault(); e.returnValue = ''; } });

const todayStr = () => { const t = today; return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; };

async function load() {
  const btn = $('#refresh');
  if (queue.length || refreshing) return;          // no pisar acciones en curso
  refreshing = true; btn.classList.add('spin');
  // 1) mostrar al instante lo último que se vio en este móvil
  if (!BASE && !isDemo && key()) {
    const local = readLocal();
    if (local) { setBase(local, false); recompute(); }
  }
  if (BASE) setUpdated(true);
  // 2) pedir los datos frescos
  try {
    if (isDemo) {
      if (!BASE) setBase(demo(), false);
      else await new Promise(r => setTimeout(r, 1200));
    } else {
      if (!key()) throw new Error('unauthorized');
      const r = await fetch(`${API_URL}?k=${encodeURIComponent(key())}&t=${Date.now()}`);
      const j = await r.json();
      if (j.error) throw new Error(j.error);
      if (!queue.length) setBase(j);
    }
    refreshing = false;
    recompute();
  } catch (e) {
    const nokey = e.message === 'unauthorized';
    if (BASE && !nokey) {
      $('#updated').innerHTML = `<span class="warn-txt">Sin conexión · datos de ${esc(fmtUpdated(BASE.updated))}</span>`;
    } else {
      $('#app').innerHTML = `<div class="card msg"><h3>${nokey ? 'Enlace incompleto' : 'No se pudieron cargar los datos'}</h3>
        <div class="sub">${nokey ? 'Pide a Tom el enlace completo.' : 'Comprueba la conexión y pulsa ⟳ para reintentar.'}</div></div>`;
      $('#updated').textContent = '';
    }
  } finally { refreshing = false; btn.classList.remove('spin'); }
}

const fmtUpdated = iso => { const u = new Date(iso);
  return `${u.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })} a las ${u.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`; };
function setUpdated(loading) {
  $('#updated').innerHTML = loading
    ? `<span class="spinner sm"></span>Actualizando…`
    : `Actualizado ${esc(fmtUpdated(DATA.updated))}`;
}

async function api(action, payload) {
  if (isDemo) return demoApi(action, payload);
  // Content-Type text/plain (por defecto) => sin "preflight" CORS, compatible con Apps Script
  const r = await fetch(API_URL, { method: 'POST', body: JSON.stringify({ k: key(), action, ...payload }) });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j;
}

/* ---------- Acciones (optimistas) ---------- */

const findRow = (d, row) => d.rows.find(x => x.row === row);
const findItem = (d, row) => d.compras.find(x => x.row === row);

function doMark(r, estrellas, comentario) {
  enqueue({
    action: 'done', what: 'valoración', okMsg: r.hecho ? 'Valoración guardada ✓' : 'Limpieza marcada como hecha ✓',
    payload: { row: r.row, date: r.date, piso: r.piso, estrellas, comentario },
    apply: d => { const x = findRow(d, r.row); if (!x) return;
      if (!x.hecho) { x.hecho = true; x.pendiente = Math.max(0, x.precio - x.recibido); }
      x.estrellas = estrellas; x.comentario = comentario; x.pending = true; },
  });
}
function doUndo(r) {
  enqueue({
    action: 'undo', what: 'deshacer', okMsg: 'Limpieza desmarcada ✓',
    payload: { row: r.row, date: r.date, piso: r.piso },
    apply: d => { const x = findRow(d, r.row); if (!x) return;
      x.hecho = false; x.pendiente = 0; x.estrellas = 0; x.comentario = ''; x.pending = true; },
  });
}
function doAdd(piso, texto) {
  const tmp = 'tmp' + (seq + 1);
  enqueue({
    action: 'addItem', what: texto, okMsg: `«${texto}» añadido ✓`,
    payload: { piso, texto },
    apply: d => d.compras.push({ row: tmp, piso, texto, por: 'Margarita', fecha: todayStr(), comprado: false, pending: 'Añadiendo…', tmp: true }),
  });
}
function doToggle(it, comprado) {
  enqueue({
    action: 'toggleItem', what: it.texto, okMsg: null,
    payload: { row: it.row, texto: it.texto, comprado },
    apply: d => { const x = findItem(d, it.row); if (x) { x.comprado = comprado; x.pending = 'Guardando…'; } },
  });
}
function doDelete(it) {
  enqueue({
    action: 'deleteItem', what: it.texto, okMsg: `«${it.texto}» eliminado ✓`,
    payload: { row: it.row, texto: it.texto },
    apply: d => { const x = findItem(d, it.row); if (x) { x.pending = 'Eliminando…'; x.deleting = true; } },
  });
}

/* ---------- Render ---------- */

function render() {
  const all = DATA.rows;
  const pisos = DATA.pisos;
  const rows = filter === 'Todos' ? all : all.filter(r => r.piso === filter);

  const unpaid = rows.filter(r => r.hecho && !r.pagado);
  const debt = unpaid.reduce((s, r) => s + (r.pendiente || 0), 0);
  const toMark = rows.filter(r => !r.hecho && r.d <= today);          // hoy o pasadas, sin marcar
  const upcoming = rows.filter(r => !r.hecho && r.d > today);
  const unrated = rows.filter(r => r.hecho && !r.estrellas);
  const paid = rows.filter(r => r.hecho && r.pagado).sort((a, b) => b.d - a.d);
  const next = upcoming[0];

  setUpdated(refreshing);

  let h = '';

  // Resumen
  h += debt > 0
    ? `<div class="card hero"><div class="label">Pendiente de cobrar</div><div class="amount">${eur(debt)}</div>
       <div class="note">${unpaid.length} limpieza${unpaid.length > 1 ? 's' : ''} sin pagar todavía</div></div>`
    : `<div class="card hero paid"><div class="label">Pendiente de cobrar</div><div class="amount">${eur(0)}</div>
       <div class="note">Todo pagado ✓</div></div>`;

  // Filtros
  if (pisos.length > 1) {
    h += `<div class="filters" role="group" aria-label="Filtrar por piso">` +
      ['Todos', ...pisos].map(p => `<button class="chip" data-f="${esc(p)}" aria-pressed="${p === filter}">${esc(p)}</button>`).join('') + `</div>`;
  }

  // Por marcar (acción principal)
  if (toMark.length || unrated.length) {
    h += `<section><h2><span>Por marcar</span><span class="count">${toMark.length + unrated.length}</span></h2><div class="card list todo">`;
    h += toMark.map(r => row(r, `<button class="btn primary" data-act="mark" data-row="${r.row}">Marcar hecha</button>`, rel(r.d))).join('');
    h += unrated.map(r => row(r, `<button class="btn" data-act="mark" data-row="${r.row}">Valorar ★</button>`, 'falta la valoración')).join('');
    h += `</div></section>`;
  }

  // Próxima
  if (next) {
    h += `<div class="card next"><div class="datebox"><div class="d">${next.d.getDate()}</div>
      <div class="m">${next.d.toLocaleDateString('es-ES', { month: 'short' }).replace('.', '')}</div></div>
      <div><div class="sub">Próxima limpieza · ${rel(next.d)}</div>
      <div class="t">${esc(cap(fmtLong(next.d)))}</div>
      <div class="s"><span class="dot ${esc(next.piso)}" style="display:inline-block;margin-right:6px"></span>${esc(next.piso)}</div></div></div>`;
  }

  // Pendiente de pago
  h += `<section><h2><span>Pendiente de pago</span><span class="count">${unpaid.length}</span></h2><div class="card list">`;
  h += unpaid.length ? unpaid.map(r => {
    const detail = r.recibido > 0 ? `<div class="detail">${eur(r.precio)} − ${eur(r.recibido)} ya recibido</div>` : '';
    return row(r, `<div class="price">${eur(r.pendiente)}</div>${detail}`, null, true);
  }).join('') : `<div class="empty">Nada pendiente 🎉</div>`;
  h += `</div></section>`;

  // Lista de compras
  const pisosShown = filter === 'Todos' ? pisos : [filter];
  const pend = DATA.compras.filter(c => !c.comprado && pisosShown.includes(c.piso)).length;
  h += `<section><h2><span>Lista de compras</span><span class="count">${pend}</span></h2>`;
  pisosShown.forEach(p => {
    const items = DATA.compras.filter(c => c.piso === p).sort((a, b) => a.comprado - b.comprado);
    h += `<div class="card shop"><div class="shop-head"><span class="dot ${esc(p)}"></span>${esc(p)}</div>`;
    h += items.length ? items.map(c => `
      <div class="item${c.comprado ? ' done' : ''}${c.pending ? ' pending' : ''}${c.deleting ? ' deleting' : ''}">
        <label class="ilab">
          <input type="checkbox" data-act="toggle" data-row="${c.row}" ${c.comprado ? 'checked' : ''} ${c.pending ? 'disabled' : ''}>
          <span class="itxt">${esc(c.texto)}<small>${c.pending ? `<span class="spinner sm"></span>${esc(c.pending)}`
            : esc(c.por) + (c.fecha ? ' · ' + esc(cap(fmtShort(parseD(c.fecha)))) : '')}</small></span>
        </label>
        ${c.pending ? '' : `<button class="del" data-act="del" data-row="${c.row}" aria-label="Eliminar ${esc(c.texto)}">✕</button>`}
      </div>`).join('') : `<div class="empty small">No falta nada</div>`;
    h += `<form class="add" data-piso="${esc(p)}"><input name="t" maxlength="120" placeholder="Añadir… (p. ej. papel higiénico)" autocomplete="off" aria-label="Añadir a la lista de ${esc(p)}">
      <button class="btn primary" type="submit" aria-label="Añadir">+</button></form></div>`;
  });
  h += `</section>`;

  // Próximas
  h += `<section><h2><span>Próximas limpiezas</span><span class="count">${upcoming.length}</span></h2><div class="card list">`;
  h += upcoming.length ? upcoming.map(r => row(r, `<span class="badge info">${rel(r.d)}</span>`)).join('') : `<div class="empty">No hay limpiezas programadas</div>`;
  h += `</div></section>`;

  // Historial por mes
  h += `<section><h2><span>Historial pagado</span><span class="count">${paid.length}</span></h2>`;
  if (!paid.length) h += `<div class="card empty">Todavía no hay limpiezas pagadas</div>`;
  const months = {};
  paid.forEach(r => { const k = `${r.d.getFullYear()}-${String(r.d.getMonth() + 1).padStart(2, '0')}`; (months[k] = months[k] || []).push(r); });
  Object.keys(months).sort().reverse().forEach((k, i) => {
    const list = months[k]; const [y, m] = k.split('-').map(Number);
    const total = list.reduce((s, r) => s + (r.precio || 0), 0);
    const name = new Date(y, m - 1, 1).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
    h += `<details class="card month"${i === 0 ? ' open' : ''}><summary><span class="mname">${esc(cap(name))}</span>
      <span class="msum">${list.length} · ${eur(total)} <span class="chev">›</span></span></summary>
      ${list.map(r => row(r, `<div class="price">${eur(r.precio)}</div><span class="badge ok">Pagado</span>`, null, true)).join('')}</details>`;
  });
  h += `</section>`;

  if (pisos.length > 1)
    h += `<div class="legend">${pisos.map(p => `<span><i class="dot ${esc(p)}"></i>${esc(p)}</span>`).join('')}</div>`;

  $('#app').innerHTML = h;
}

function row(r, right, sub, showStars) {
  const stars = showStars && r.estrellas
    ? `<button class="stars-mini" data-act="mark" data-row="${r.row}" aria-label="Modificar valoración e incidencias">
         <span class="st">${starsTxt(r.estrellas)}</span>${r.comentario ? '<span class="has-c">💬</span>' : ''}<span class="edit">✎ Modificar</span></button>`
    : '';
  if (r.pending) right = `<span class="badge saving"><span class="spinner sm"></span>Guardando…</span>`;
  return `<div class="row${r.pending ? ' pending' : ''}"><span class="dot ${esc(r.piso)}"></span>
    <div class="main"><div class="when">${esc(cap(fmtShort(r.d)))}</div>
      <div class="where">${esc(r.piso)}${sub ? ' · ' + esc(sub) : ''}</div></div>
    <div class="right">${right}</div>
    ${r.pending || !stars ? '' : `<div class="row-foot">${stars}</div>`}</div>`;
}

/* ---------- Ventana "Marcar hecha / Valorar" ---------- */

function openSheet(r) {
  let stars = r.estrellas || 0;
  const dlg = $('#sheet');
  const label = r.hecho ? 'Guardar' : 'Hecha ✓';
  dlg.innerHTML = `
    <form class="sheet-in">
      <div class="grab"></div>
      <div class="sub">${esc(r.piso)} · ${esc(cap(fmtLong(r.d)))}</div>
      <h3>${r.hecho ? 'Valoración de la limpieza' : 'Marcar como hecha'}</h3>
      <div class="q">¿Cómo estaba el piso? <span class="req">obligatorio</span></div>
      <div class="stars" role="radiogroup" aria-label="Estrellas">
        ${[1, 2, 3, 4, 5].map(n => `<button type="button" role="radio" data-s="${n}" aria-label="${n} estrella${n > 1 ? 's' : ''}">★</button>`).join('')}
      </div>
      <div class="q">Incidencias de esta estancia <span class="opt">opcional</span></div>
      <div class="hint">Solo lo que ha pasado <b>con estos huéspedes</b>: algo <b>roto</b>, <b>manchado</b> o que <b>ha desaparecido</b> y antes estaba.</div>
      <div class="hint alt">¿Hace falta comprar algo (café, papel, jabón…)? Eso va en la <button type="button" class="linkish" data-goshop>Lista de compras</button>, no aquí.</div>
      <textarea rows="3" maxlength="500" placeholder="Ej.: vaso roto, falta una toalla, mancha en el sofá…">${esc(r.comentario || '')}</textarea>
      <button class="btn primary big" type="submit" data-ok disabled>${label}</button>
      ${r.hecho && !r.pagado ? `<button class="btn link" type="button" data-undo>Deshacer «hecha»</button>` : ''}
      <button class="btn link" type="button" data-close>Cancelar</button>
    </form>`;
  const ok = dlg.querySelector('[data-ok]');
  const paint = () => {
    dlg.querySelectorAll('[data-s]').forEach(b => {
      const n = +b.dataset.s; b.classList.toggle('on', n <= stars); b.setAttribute('aria-checked', String(n === stars));
    });
    ok.disabled = !stars;
  };
  dlg.querySelectorAll('[data-s]').forEach(b => b.onclick = () => { stars = +b.dataset.s; paint(); });
  dlg.querySelector('[data-close]').onclick = () => dlg.close();
  dlg.onclick = e => { if (e.target === dlg) dlg.close(); };   // clic fuera = Cancelar
  dlg.querySelector('[data-goshop]').onclick = () => {
    dlg.close();
    const f = document.querySelector(`form.add[data-piso="${CSS.escape(r.piso)}"]`) || document.querySelector('form.add');
    if (f) { f.scrollIntoView({ behavior: 'smooth', block: 'center' }); setTimeout(() => f.querySelector('input').focus(), 400); }
  };
  const undo = dlg.querySelector('[data-undo]');
  if (undo) undo.onclick = () => {
    if (!confirm('¿Seguro que quieres desmarcar esta limpieza?')) return;
    dlg.close(); doUndo(r);
  };
  dlg.querySelector('form').onsubmit = ev => {
    ev.preventDefault();
    if (!stars) return;
    const comentario = dlg.querySelector('textarea').value.trim();
    dlg.close(); doMark(r, stars, comentario);
  };
  paint();
  dlg.showModal();
}

/* ---------- Eventos ---------- */

document.addEventListener('click', e => {
  const chip = e.target.closest('.chip');
  if (chip) { filter = chip.dataset.f; render(); return; }
  const m = e.target.closest('[data-act="mark"]');
  if (m) { const r = DATA.rows.find(x => x.row === +m.dataset.row); if (r && !r.pending) openSheet(r); return; }
  const del = e.target.closest('[data-act="del"]');
  if (del) {
    const it = DATA.compras.find(c => String(c.row) === del.dataset.row);
    if (it && !it.pending && confirm(`¿Eliminar «${it.texto}» de la lista?`)) doDelete(it);
  }
});

document.addEventListener('change', e => {
  const cb = e.target.closest('[data-act="toggle"]');
  if (!cb) return;
  const it = DATA.compras.find(c => String(c.row) === cb.dataset.row);
  if (!it || it.pending) { cb.checked = !cb.checked; return; }
  doToggle(it, cb.checked);
});

document.addEventListener('submit', e => {
  const f = e.target.closest('form.add');
  if (!f) return;
  e.preventDefault();
  const input = f.querySelector('input');
  const texto = input.value.trim();
  if (!texto) { input.focus(); return; }
  input.value = '';
  doAdd(f.dataset.piso, texto);
  // volver a poner el foco en el campo para añadir varias cosas seguidas
  setTimeout(() => { const n = document.querySelector(`form.add[data-piso="${CSS.escape(f.dataset.piso)}"] input`); if (n) n.focus(); }, 0);
});

function toast(msg, isErr) {
  const t = $('#toast');
  t.textContent = msg; t.className = 'toast show' + (isErr ? ' err' : '');
  clearTimeout(toast._t); toast._t = setTimeout(() => { t.className = 'toast'; }, 2600);
}

/* ---------- Demo ---------- */

function demo() {
  const d = n => { const x = new Date(today); x.setDate(x.getDate() + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
  return {
    updated: new Date().toISOString(), pisos: ['Fenals', 'Caprabo'], rows: [
      { row: 5, date: d(-23), piso: 'Fenals', hecho: true, pagado: true, precio: 120, recibido: 0, pendiente: 0, estrellas: 4, comentario: '' },
      { row: 6, date: d(-15), piso: 'Caprabo', hecho: true, pagado: true, precio: 75, recibido: 0, pendiente: 0, estrellas: 2, comentario: 'Mucha arena en el suelo' },
      { row: 7, date: d(-6), piso: 'Fenals', hecho: true, pagado: true, precio: 70, recibido: 0, pendiente: 0, estrellas: 0, comentario: '' },
      { row: 8, date: d(-3), piso: 'Fenals', hecho: true, pagado: false, precio: 70, recibido: 10, pendiente: 60, estrellas: 5, comentario: '' },
      { row: 9, date: d(-1), piso: 'Caprabo', hecho: true, pagado: false, precio: 70, recibido: 30, pendiente: 40, estrellas: 4, comentario: '' },
      { row: 10, date: d(0), piso: 'Fenals', hecho: false, pagado: false, precio: 70, recibido: 0, pendiente: 0, estrellas: 0, comentario: '' },
      { row: 11, date: d(10), piso: 'Fenals', hecho: false, pagado: false, precio: 70, recibido: 0, pendiente: 0, estrellas: 0, comentario: '' },
      { row: 12, date: d(13), piso: 'Caprabo', hecho: false, pagado: false, precio: 70, recibido: 0, pendiente: 0, estrellas: 0, comentario: '' },
    ],
    compras: [
      { row: 2, piso: 'Fenals', texto: 'Papel higiénico', por: 'Margarita', fecha: d(-2), comprado: false },
      { row: 3, piso: 'Caprabo', texto: 'Bombilla cocina', por: 'Tom', fecha: d(-4), comprado: false },
      { row: 4, piso: 'Caprabo', texto: 'Lavavajillas', por: 'Margarita', fecha: d(-6), comprado: true },
    ],
  };
}

function demoApi(action, p) {
  const j = JSON.parse(JSON.stringify(BASE, (k, v) => (k === 'd' ? undefined : v)));
  if (action === 'done') {
    if (!(p.estrellas >= 1)) return Promise.reject(new Error('estrellas_obligatorias'));
    const r = j.rows.find(x => x.row === p.row);
    if (!r.hecho) { r.hecho = true; r.pendiente = Math.max(0, r.precio - r.recibido); }
    r.estrellas = p.estrellas; r.comentario = p.comentario;
  } else if (action === 'undo') {
    const r = j.rows.find(x => x.row === p.row); r.hecho = false; r.pendiente = 0; r.estrellas = 0; r.comentario = '';
  } else if (action === 'addItem') {
    j.compras.push({ row: 100 + j.compras.length, piso: p.piso, texto: p.texto, por: 'Margarita', fecha: todayStr(), comprado: false });
  } else if (action === 'toggleItem') {
    j.compras.find(c => c.row === p.row).comprado = p.comprado;
  } else if (action === 'deleteItem') {
    j.compras = j.compras.filter(c => c.row !== p.row);
  }
  j.updated = new Date().toISOString();
  return new Promise(res => setTimeout(() => res(j), 2500));   // simula la lentitud de Google
}

$('#refresh').onclick = load;
document.addEventListener('visibilitychange', () => { if (!document.hidden && BASE && !isDemo && !queue.length && !$('#sheet').open) load(); });
load();
