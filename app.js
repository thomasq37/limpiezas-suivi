/* ========= CONFIGURACIÓN =========
 * API_URL : URL de la aplicación web de Apps Script (termina en /exec)
 * La clave va en el enlace que compartes:  https://…github.io/…/#k=TU_CLAVE
 * Vista de prueba sin datos reales : añade ?demo al final del enlace
 */
const API_URL = 'https://script.google.com/macros/s/AKfycbxYrwbLOvNmZOn2UWrMDdBqj8H1bldweHUSn9VYlyBIA_YL1kOlasA7Z5OvaiA0MzF5/exec';
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

let DATA = null;
let filter = 'Todos';
let busy = false;

const ERRORS = {
  unauthorized: 'Enlace incompleto. Pide a Tom el enlace completo.',
  estrellas_obligatorias: 'Elige de 1 a 5 estrellas.',
  datos_cambiados: 'Los datos han cambiado. Vuelve a intentarlo.',
  fecha_futura: 'No se puede marcar una limpieza futura.',
  ya_pagada: 'Esta limpieza ya está pagada, no se puede deshacer.',
  texto_vacio: 'Escribe lo que hace falta comprar.',
  lista_llena: 'La lista está llena, avisa a Tom.',
};

function key() { return new URLSearchParams(location.hash.slice(1)).get('k') || ''; }

/* ---------- Datos ---------- */

function setData(j) {
  DATA = j;
  DATA.rows.forEach(r => { r.d = parseD(r.date); });
  DATA.rows.sort((a, b) => a.d - b.d);
  DATA.compras = DATA.compras || [];
  DATA.pisos = (DATA.pisos && DATA.pisos.length) ? DATA.pisos : [...new Set(DATA.rows.map(r => r.piso))].filter(Boolean);
}

async function load() {
  const btn = $('#refresh'); btn.classList.add('spin');
  try {
    if (isDemo) { if (!DATA) setData(demo()); }
    else {
      if (!key()) throw new Error('unauthorized');
      const r = await fetch(`${API_URL}?k=${encodeURIComponent(key())}&t=${Date.now()}`);
      const j = await r.json();
      if (j.error) throw new Error(j.error);
      setData(j);
    }
    render();
  } catch (e) {
    const nokey = e.message === 'unauthorized';
    $('#app').innerHTML = `<div class="card msg"><h3>${nokey ? 'Enlace incompleto' : 'No se pudieron cargar los datos'}</h3>
      <div class="sub">${nokey ? 'Pide a Tom el enlace completo.' : 'Comprueba la conexión y pulsa ⟳ para reintentar.'}</div></div>`;
    $('#updated').textContent = '';
  } finally { btn.classList.remove('spin'); }
}

async function api(action, payload) {
  if (isDemo) return demoApi(action, payload);
  // Content-Type text/plain (por defecto) => sin "preflight" CORS, compatible con Apps Script
  const r = await fetch(API_URL, { method: 'POST', body: JSON.stringify({ k: key(), action, ...payload }) });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j;
}

async function act(action, payload, okMsg) {
  if (busy) return false;
  busy = true; document.body.classList.add('busy');
  try {
    setData(await api(action, payload));
    render();
    if (okMsg) toast(okMsg);
    return true;
  } catch (e) {
    toast(ERRORS[e.message] || 'No se pudo guardar. Inténtalo de nuevo.', true);
    return false;
  } finally { busy = false; document.body.classList.remove('busy'); }
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

  const u = new Date(DATA.updated);
  $('#updated').textContent = `Actualizado ${u.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })} a las ${u.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`;

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
      <label class="item${c.comprado ? ' done' : ''}">
        <input type="checkbox" data-act="toggle" data-row="${c.row}" ${c.comprado ? 'checked' : ''}>
        <span class="itxt">${esc(c.texto)}<small>${esc(c.por)}${c.fecha ? ' · ' + esc(cap(fmtShort(parseD(c.fecha)))) : ''}</small></span>
      </label>`).join('') : `<div class="empty small">No falta nada</div>`;
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
    ? `<button class="stars-mini" data-act="mark" data-row="${r.row}" aria-label="Ver valoración">${starsTxt(r.estrellas)}${r.comentario ? ' 💬' : ''}</button>`
    : '';
  return `<div class="row"><span class="dot ${esc(r.piso)}"></span>
    <div class="main"><div class="when">${esc(cap(fmtShort(r.d)))}</div>
      <div class="where">${esc(r.piso)}${sub ? ' · ' + esc(sub) : ''}</div>${stars}</div>
    <div class="right">${right}</div></div>`;
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
      <div class="q">Comentario <span class="opt">opcional</span></div>
      <textarea rows="3" maxlength="500" placeholder="Algo roto, falta algo, muy sucio…">${esc(r.comentario || '')}</textarea>
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
  const undo = dlg.querySelector('[data-undo]');
  if (undo) undo.onclick = async () => {
    if (!confirm('¿Seguro que quieres desmarcar esta limpieza?')) return;
    if (await act('undo', { row: r.row, date: r.date, piso: r.piso }, 'Limpieza desmarcada')) dlg.close();
  };
  dlg.querySelector('form').onsubmit = async ev => {
    ev.preventDefault();
    if (!stars) return;
    ok.disabled = true; ok.textContent = 'Guardando…';
    const done = await act('done', { row: r.row, date: r.date, piso: r.piso, estrellas: stars, comentario: dlg.querySelector('textarea').value },
      r.hecho ? 'Valoración guardada' : '¡Limpieza marcada como hecha!');
    if (done) dlg.close(); else { ok.disabled = false; ok.textContent = label; }
  };
  paint();
  dlg.showModal();
}

/* ---------- Eventos ---------- */

document.addEventListener('click', e => {
  const chip = e.target.closest('.chip');
  if (chip) { filter = chip.dataset.f; render(); return; }
  const m = e.target.closest('[data-act="mark"]');
  if (m) { const r = DATA.rows.find(x => x.row === +m.dataset.row); if (r) openSheet(r); }
});

document.addEventListener('change', e => {
  const cb = e.target.closest('[data-act="toggle"]');
  if (!cb) return;
  const it = DATA.compras.find(c => c.row === +cb.dataset.row);
  if (!it) return;
  act('toggleItem', { row: it.row, texto: it.texto, comprado: cb.checked }, cb.checked ? 'Marcado como comprado' : null)
    .then(ok => { if (!ok) cb.checked = !cb.checked; });
});

document.addEventListener('submit', async e => {
  const f = e.target.closest('form.add');
  if (!f) return;
  e.preventDefault();
  const input = f.querySelector('input');
  const texto = input.value.trim();
  if (!texto) return;
  if (await act('addItem', { piso: f.dataset.piso, texto }, 'Añadido a la lista')) input.value = '';
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
  const j = JSON.parse(JSON.stringify(DATA, (k, v) => (k === 'd' ? undefined : v)));
  if (action === 'done') {
    if (!(p.estrellas >= 1)) return Promise.reject(new Error('estrellas_obligatorias'));
    const r = j.rows.find(x => x.row === p.row);
    if (!r.hecho) { r.hecho = true; r.pendiente = Math.max(0, r.precio - r.recibido); }
    r.estrellas = p.estrellas; r.comentario = p.comentario;
  } else if (action === 'undo') {
    const r = j.rows.find(x => x.row === p.row); r.hecho = false; r.pendiente = 0; r.estrellas = 0; r.comentario = '';
  } else if (action === 'addItem') {
    j.compras.push({ row: 100 + j.compras.length, piso: p.piso, texto: p.texto, por: 'Margarita', fecha: j.rows[0].date, comprado: false });
  } else if (action === 'toggleItem') {
    j.compras.find(c => c.row === p.row).comprado = p.comprado;
  }
  j.updated = new Date().toISOString();
  return new Promise(res => setTimeout(() => res(j), 250));
}

$('#refresh').onclick = load;
document.addEventListener('visibilitychange', () => { if (!document.hidden && DATA && !isDemo && !$('#sheet').open) load(); });
load();
