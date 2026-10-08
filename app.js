/* ========= CONFIGURACIÓN =========
 * API_URL : URL de la aplicación web de Apps Script (termina en /exec)
 * La clave va en el enlace que compartes:  https://…github.io/…/#k=TU_CLAVE
 * Vista de prueba sin datos reales : añade ?demo al final del enlace
 */
const API_URL = 'https://script.google.com/macros/s/AKfycbxYrwbLOvNmZOn2UWrMDdBqj8H1bldweHUSn9VYlyBIA_YL1kOlasA7Z5OvaiA0MzF5/exec';
/* ================================= */

const $ = s => document.querySelector(s);
const eur = n => new Intl.NumberFormat('es-ES',{style:'currency',currency:'EUR'}).format(n||0);
const parseD = s => { const [y,m,d]=s.split('-').map(Number); return new Date(y,m-1,d); };
const today = (()=>{const t=new Date();t.setHours(0,0,0,0);return t;})();
const fmtLong = d => d.toLocaleDateString('es-ES',{weekday:'long',day:'numeric',month:'long'});
const fmtShort = d => d.toLocaleDateString('es-ES',{weekday:'short',day:'numeric',month:'short'});
const dayDiff = d => Math.round((d-today)/864e5);
const rel = d => { const n=dayDiff(d); return n===0?'hoy':n===1?'mañana':n===-1?'ayer':n>1?`en ${n} días`:`hace ${-n} días`; };
const cap = s => s.charAt(0).toUpperCase()+s.slice(1);
const esc = s => String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

let DATA = null;
let filter = 'Todos';

function key(){
  const h = new URLSearchParams(location.hash.slice(1));
  return h.get('k') || '';
}

async function load(){
  const btn=$('#refresh'); btn.classList.add('spin');
  try{
    if (new URLSearchParams(location.search).has('demo')) DATA = demo();
    else {
      if (!key()) throw new Error('nokey');
      const r = await fetch(`${API_URL}?k=${encodeURIComponent(key())}&t=${Date.now()}`);
      const j = await r.json();
      if (j.error) throw new Error(j.error);
      DATA = j;
    }
    DATA.rows.forEach(r=>{ r.d = parseD(r.date); });
    DATA.rows.sort((a,b)=>a.d-b.d);
    render();
  }catch(e){
    const nokey = e.message==='nokey' || e.message==='unauthorized';
    $('#app').innerHTML = `<div class="card msg"><h3>${nokey?'Enlace incompleto':'No se pudieron cargar los datos'}</h3>
      <div class="sub">${nokey?'Pide a Tom el enlace completo.':'Comprueba la conexión y pulsa ⟳ para reintentar.'}</div></div>`;
    $('#updated').textContent = '';
  }finally{ btn.classList.remove('spin'); }
}

function render(){
  const all = DATA.rows;
  const pisos = [...new Set(all.map(r=>r.piso))].filter(Boolean);
  const rows = filter==='Todos' ? all : all.filter(r=>r.piso===filter);

  const unpaid = rows.filter(r=>r.hecho && !r.pagado);
  const debt = unpaid.reduce((s,r)=>s+(r.pendiente||0),0);
  const upcoming = rows.filter(r=>!r.hecho && r.d>=today);
  const overdue = rows.filter(r=>!r.hecho && r.d<today);   // pasadas sin marcar como hechas
  const paid = rows.filter(r=>r.hecho && r.pagado).sort((a,b)=>b.d-a.d);
  const next = upcoming[0];

  const u = new Date(DATA.updated);
  $('#updated').textContent = `Actualizado ${u.toLocaleDateString('es-ES',{day:'numeric',month:'short'})} a las ${u.toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'})}`;

  let h = '';

  // Resumen
  h += debt>0
    ? `<div class="card hero"><div class="label">Pendiente de cobrar</div><div class="amount">${eur(debt)}</div>
       <div class="note">${unpaid.length} limpieza${unpaid.length>1?'s':''} sin pagar todavía</div></div>`
    : `<div class="card hero paid"><div class="label">Pendiente de cobrar</div><div class="amount">${eur(0)}</div>
       <div class="note">Todo pagado ✓</div></div>`;

  // Próxima
  if (next){
    h += `<div class="card next"><div class="datebox"><div class="d">${next.d.getDate()}</div>
      <div class="m">${next.d.toLocaleDateString('es-ES',{month:'short'}).replace('.','')}</div></div>
      <div><div class="sub">Próxima limpieza · ${rel(next.d)}</div>
      <div class="t">${esc(cap(fmtLong(next.d)))}</div>
      <div class="s"><span class="dot ${esc(next.piso)}" style="display:inline-block;margin-right:6px"></span>${esc(next.piso)}</div></div></div>`;
  }

  // Filtros
  if (pisos.length>1){
    h += `<div class="filters" role="group" aria-label="Filtrar por piso">` +
      ['Todos',...pisos].map(p=>`<button class="chip" data-f="${esc(p)}" aria-pressed="${p===filter}">${esc(p)}</button>`).join('') + `</div>`;
  }

  // Pendiente de pago
  h += `<section><h2><span>Pendiente de pago</span><span class="count">${unpaid.length}</span></h2><div class="card list">`;
  h += unpaid.length ? unpaid.map(r=>{
      const detail = r.recibido>0 ? `<div class="detail">${eur(r.precio)} − ${eur(r.recibido)} ya recibido</div>` : '';
      return row(r, `<div class="price">${eur(r.pendiente)}</div>${detail}`);
    }).join('') : `<div class="empty">Nada pendiente 🎉</div>`;
  h += `</div></section>`;

  // Próximas
  h += `<section><h2><span>Próximas limpiezas</span><span class="count">${upcoming.length+overdue.length}</span></h2><div class="card list">`;
  const up = overdue.map(r=>row(r,`<span class="badge warn">¿Hecha?</span>`))
    .concat(upcoming.map(r=>row(r,`<span class="badge info">${rel(r.d)}</span>`)));
  h += up.length ? up.join('') : `<div class="empty">No hay limpiezas programadas</div>`;
  h += `</div></section>`;

  // Historial por mes
  h += `<section><h2><span>Historial pagado</span><span class="count">${paid.length}</span></h2>`;
  if (!paid.length) h += `<div class="card empty">Todavía no hay limpiezas pagadas</div>`;
  const months = {};
  paid.forEach(r=>{ const k=`${r.d.getFullYear()}-${String(r.d.getMonth()+1).padStart(2,'0')}`; (months[k]=months[k]||[]).push(r); });
  Object.keys(months).sort().reverse().forEach((k,i)=>{
    const list = months[k]; const [y,m]=k.split('-').map(Number);
    const total = list.reduce((s,r)=>s+(r.precio||0),0);
    const name = new Date(y,m-1,1).toLocaleDateString('es-ES',{month:'long',year:'numeric'});
    h += `<details class="card month"${i===0?' open':''}><summary><span class="mname">${esc(cap(name))}</span>
      <span class="msum">${list.length} · ${eur(total)} <span class="chev">›</span></span></summary>
      ${list.map(r=>row(r,`<div class="price">${eur(r.precio)}</div><span class="badge ok">Pagado</span>`)).join('')}</details>`;
  });
  h += `</section>`;

  if (pisos.length>1)
    h += `<div class="legend">${pisos.map(p=>`<span><i class="dot ${esc(p)}"></i>${esc(p)}</span>`).join('')}</div>`;

  $('#app').innerHTML = h;
  document.querySelectorAll('.chip').forEach(b=>b.onclick=()=>{ filter=b.dataset.f; render(); });
}

function row(r, right){
  return `<div class="row"><span class="dot ${esc(r.piso)}"></span>
    <div class="main"><div class="when">${esc(cap(fmtShort(r.d)))}</div><div class="where">${esc(r.piso)}</div></div>
    <div class="right">${right}</div></div>`;
}

function demo(){
  const d = n => { const x=new Date(today); x.setDate(x.getDate()+n); return x.toISOString().slice(0,10); };
  return { updated: new Date().toISOString(), rows: [
    {date:d(-23),piso:'Fenals',hecho:true,pagado:true,precio:120,recibido:0,pendiente:0},
    {date:d(-15),piso:'Caprabo',hecho:true,pagado:true,precio:75,recibido:0,pendiente:0},
    {date:d(-6),piso:'Fenals',hecho:true,pagado:true,precio:70,recibido:0,pendiente:0},
    {date:d(-3),piso:'Fenals',hecho:true,pagado:false,precio:70,recibido:10,pendiente:60},
    {date:d(-1),piso:'Caprabo',hecho:true,pagado:false,precio:70,recibido:30,pendiente:40},
    {date:d(10),piso:'Fenals',hecho:false,pagado:false,precio:70,recibido:0,pendiente:0},
    {date:d(13),piso:'Caprabo',hecho:false,pagado:false,precio:70,recibido:0,pendiente:0},
    {date:d(23),piso:'Caprabo',hecho:false,pagado:false,precio:70,recibido:0,pendiente:0},
  ]};
}

$('#refresh').onclick = load;
document.addEventListener('visibilitychange', ()=>{ if(!document.hidden && DATA) load(); });
load();
