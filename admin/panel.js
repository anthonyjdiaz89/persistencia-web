// El panel por dentro.
//
// Sin framework y sin compilación, como el resto del sitio: esto se edita y se
// despliega con un push, y dentro de un año seguirá abriéndose sin reinstalar
// nada.
//
// Dos reglas de las que depende que esto se sienta como una herramienta y no
// como un formulario:
//
// 1. Las tablas se editan EN EL SITIO y se guardan al salir de la celda. Un
//    formulario aparte por cada línea de presupuesto es lo que hace que la
//    gente acabe llevando las cuentas en una hoja de cálculo.
// 2. Nada de alert/prompt/confirm. Al guardar una celda NO se repinta la tabla:
//    se repintan solo los totales. Repintarla entera roba el foco en mitad de
//    una fila, y con eso se pierde lo que se estaba escribiendo.

const $ = (s, raiz = document) => raiz.querySelector(s);
const $$ = (s, raiz = document) => [...raiz.querySelectorAll(s)];

const pesos = (v) => new Intl.NumberFormat('es-CO', {
  style: 'currency', currency: 'COP', maximumFractionDigits: 0,
}).format(Number(v) || 0);

const pct = (v) => `${((Number(v) || 0) * 100).toFixed(1)}%`;

const miles = (v) => new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 })
  .format(Number(v) || 0);

/** De "$ 1.250.000" a 1250000. En pesos no se usan decimales. */
const aNumero = (t) => Number(String(t ?? '').replace(/[^\d-]/g, '')) || 0;

const esc = (s) => String(s ?? '').replace(/[&<>"]/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun',
  'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

const fechaCorta = (iso) => {
  if (!iso) return '';
  const [a, m, d] = String(iso).slice(0, 10).split('-');
  return `${Number(d)} ${MESES[Number(m) - 1]} ${a}`;
};

/** Días que dura un evento, contando el primero y el último. */
function diasEvento(e) {
  if (!e?.fecha || !e.fecha_fin || e.fecha_fin <= e.fecha) return 1;
  const ms = new Date(`${e.fecha_fin}T12:00:00`) - new Date(`${e.fecha}T12:00:00`);
  return Math.round(ms / 86400000) + 1;
}

/** "14 mar 2026 · 3 días" o solo la fecha si dura uno. */
function rangoEvento(e) {
  if (!e?.fecha) return '';
  const d = diasEvento(e);
  if (d === 1) return fechaCorta(e.fecha);
  return `${fechaCorta(e.fecha)} → ${fechaCorta(e.fecha_fin)} · ${d} días`;
}

const hoy = () => new Date().toISOString().slice(0, 10);

// ───────────────────────────── red ─────────────────────────────

async function api(ruta, opciones = {}) {
  const r = await fetch(`/api${ruta}`, {
    headers: opciones.cuerpo ? { 'Content-Type': 'application/json' } : {},
    body: opciones.cuerpo ? JSON.stringify(opciones.cuerpo) : opciones.body,
    method: opciones.metodo || (opciones.cuerpo ? 'POST' : 'GET'),
    ...opciones.crudo,
  });
  if (r.status === 401) { mostrarPuerta(); throw new Error('sin sesión'); }
  const texto = await r.text();
  if (!r.ok) throw new Error(JSON.parse(texto || '{}').error || `HTTP ${r.status}`);
  return texto ? JSON.parse(texto) : null;
}

// ───────────────────────────── avisos ─────────────────────────────
//
// Se apilan abajo a la derecha y se pueden cerrar. Los que llevan detalle no
// se van solos: si la importación dejó filas fuera, hay que poder leer cuáles
// sin que desaparezcan a los tres segundos.

function avisar(texto, tipo = 'ok', puntos = []) {
  const caja = document.createElement('div');
  caja.className = `aviso ${tipo}`;
  caja.innerHTML = `
    <div class="cuerpo">${esc(texto)}${puntos.length
      ? `<ul>${puntos.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}</div>
    <button class="cerrar" aria-label="Cerrar">×</button>`;
  const quitar = () => caja.remove();
  $('.cerrar', caja).addEventListener('click', quitar);
  $('#avisos').append(caja);
  if (!puntos.length) setTimeout(quitar, tipo === 'mal' ? 7000 : 3600);
  else setTimeout(quitar, 30000);
}

const fallar = (e) => avisar(e?.message || String(e), 'mal');

// ───────────────────────────── diálogos ─────────────────────────────
//
// Un solo <dialog> nativo para todo: trae Esc, el foco atrapado y el fondo
// sin tener que programarlos. Las tres funciones devuelven una promesa, así
// que el código que las usa se lee en línea, igual que se leía con `confirm`.

const dlg = $('#dialogo');
let cerrarActual = null;

function abrirDialogo(html, montar) {
  return new Promise((resolver) => {
    dlg.innerHTML = `<form method="dialog" class="hoja-dialogo">${html}</form>`;
    const forma = $('form', dlg);
    let resuelto = false;
    const terminar = (valor) => {
      if (resuelto) return;
      resuelto = true;
      cerrarActual = null;
      dlg.close();
      resolver(valor);
    };
    cerrarActual = () => terminar(null);
    montar(forma, terminar);
    dlg.onclose = () => terminar(null);     // Esc, o cerrado desde fuera
    dlg.showModal();
    const primero = $('input,select,textarea,button[data-primero]', forma);
    if (primero) primero.focus();
  });
}

/**
 * Formulario en diálogo. Devuelve los valores o null si se cancela.
 *
 * `validar` recibe los valores y, si devuelve texto, se muestra como error y
 * el diálogo NO se cierra: lo que se escribió sigue ahí.
 */
function pedirDatos({ titulo, nota, campos, ok = 'Guardar', validar }) {
  const html = `
    <h3>${esc(titulo)}</h3>
    ${nota ? `<p>${esc(nota)}</p>` : ''}
    <div class="campos">
      ${campos.map((c) => `
        <div class="campo${c.ancho ? ' ancho' : ''}">
          <label for="d-${c.llave}">${esc(c.et)}</label>
          ${c.opciones ? `
            <select id="d-${c.llave}" name="${c.llave}">
              ${c.opciones.map((o) => {
                const v = o.valor ?? o;
                const t = o.et ?? o;
                return `<option value="${esc(v)}"${String(v) === String(c.valor ?? '') ? ' selected' : ''}>${esc(t)}</option>`;
              }).join('')}
            </select>`
            : c.tipo === 'texto-largo' ? `
            <textarea id="d-${c.llave}" name="${c.llave}">${esc(c.valor ?? '')}</textarea>`
            : `<input id="d-${c.llave}" name="${c.llave}" type="${c.tipo || 'text'}"
                 value="${esc(c.valor ?? '')}" ${c.pistaCorta ? `placeholder="${esc(c.pistaCorta)}"` : ''}
                 ${c.tipo === 'email' ? 'autocapitalize="off" spellcheck="false"' : ''}
                 ${c.autocompletar ? `autocomplete="${c.autocompletar}"` : ''}>`}
          ${c.pista ? `<span class="pista">${esc(c.pista)}</span>` : ''}
        </div>`).join('')}
    </div>
    <p class="error-dialogo" data-error></p>
    <div class="pies-dialogo">
      <button type="button" class="plano" data-cancelar>Cancelar</button>
      <button type="button" class="boton" data-ok>${esc(ok)}</button>
    </div>`;

  return abrirDialogo(html, (forma, terminar) => {
    const recoger = () => {
      const v = {};
      campos.forEach((c) => {
        const el = $(`[name="${c.llave}"]`, forma);
        v[c.llave] = c.tipo === 'number' ? Number(el.value) || 0 : el.value.trim();
      });
      return v;
    };
    const aceptar = () => {
      const v = recoger();
      const mal = validar?.(v);
      if (mal) { $('[data-error]', forma).textContent = mal; return; }
      terminar(v);
    };
    $('[data-ok]', forma).addEventListener('click', aceptar);
    $('[data-cancelar]', forma).addEventListener('click', () => terminar(null));
    // Enter en cualquier campo acepta, como en cualquier formulario.
    forma.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') { e.preventDefault(); aceptar(); }
    });
  });
}

/** Sí o no. `peligro` pinta el botón de rojo y lo deja en segundo lugar. */
function confirmar({ titulo, texto, ok = 'Sí', ojo, peligro = false }) {
  const html = `
    <h3>${esc(titulo)}</h3>
    ${texto ? `<p>${esc(texto)}</p>` : ''}
    ${ojo ? `<div class="ojo-dialogo">${esc(ojo)}</div>` : ''}
    <div class="pies-dialogo">
      <button type="button" class="plano" data-primero data-no>Cancelar</button>
      <button type="button" class="boton${peligro ? ' peligro' : ''}" data-si>${esc(ok)}</button>
    </div>`;
  return abrirDialogo(html, (forma, terminar) => {
    $('[data-si]', forma).addEventListener('click', () => terminar(true));
    $('[data-no]', forma).addEventListener('click', () => terminar(false));
  });
}

/** Varias salidas, cada una con su explicación. Devuelve el valor elegido. */
function elegir({ titulo, texto, opciones }) {
  const html = `
    <h3>${esc(titulo)}</h3>
    ${texto ? `<p>${esc(texto)}</p>` : ''}
    <div class="pies-dialogo apilado">
      ${opciones.map((o, i) => `
        <button type="button" class="${o.clase || 'plano'}" data-i="${i}">${esc(o.et)}</button>`).join('')}
      <button type="button" class="plano" data-cancelar>Cancelar</button>
    </div>`;
  return abrirDialogo(html, (forma, terminar) => {
    $$('[data-i]', forma).forEach((b) =>
      b.addEventListener('click', () => terminar(opciones[Number(b.dataset.i)].valor)));
    $('[data-cancelar]', forma).addEventListener('click', () => terminar(null));
  });
}

// ───────────────────────────── entrada ─────────────────────────────

let yo = null;
const puedeEscribir = () => yo && yo.rol !== 'lector';

function mostrarPuerta() {
  if (cerrarActual) cerrarActual();
  $('#puerta').hidden = false;
  $('#panel').hidden = true;
}

$('#formEntrar').addEventListener('submit', async (e) => {
  e.preventDefault();
  const boton = $('#botonEntrar');
  $('#errorEntrar').textContent = '';
  boton.disabled = true;
  boton.textContent = 'Entrando…';
  try {
    await api('/entrar', {
      cuerpo: { correo: $('#correo').value, clave: $('#clave').value },
    });
    $('#clave').value = '';
    await arrancar();
  } catch (err) {
    $('#errorEntrar').textContent = err.message;
  } finally {
    boton.disabled = false;
    boton.textContent = 'Entrar';
  }
});

$('#salir').addEventListener('click', async () => {
  await api('/salir', { metodo: 'POST' }).catch(() => {});
  yo = null;
  mostrarPuerta();
});

// ───────────────────────────── vistas ─────────────────────────────

function ver(nombre) {
  $$('.vista').forEach((v) => (v.hidden = v.id !== `vista-${nombre}`));
  $$('.pestana').forEach((p) =>
    p.classList.toggle('activa', p.dataset.vista === nombre));
  window.scrollTo({ top: 0 });
}

$$('[data-vista]').forEach((b) => b.addEventListener('click', () => {
  const v = b.dataset.vista;
  ver(v);
  if (v === 'eventos') cargarEventos();
  if (v === 'cotizaciones') cargarCotizaciones();
  if (v === 'usuarios') cargarUsuarios();
}));

const cargando = (sel, n = 3) => {
  $(sel).innerHTML = `<div class="cargando">${'<div class="hueso"></div>'.repeat(n)}</div>`;
};

// ───────────────────────── lista de eventos ─────────────────────────

const ESTADOS = ['cotizado', 'confirmado', 'en_curso', 'cerrado', 'perdido'];

const tira = (et, vl, pie = '', clase = '') =>
  `<div class="tira"><div class="et">${esc(et)}</div><div class="vl ${clase}">${vl}</div>${pie ? `<div class="pie">${pie}</div>` : ''}</div>`;
const cifra = (et, vl, clase = '') =>
  `<div class="c"><div class="et">${esc(et)}</div><div class="vl ${clase}">${vl}</div></div>`;
const chip = (estado) =>
  `<span class="marbete ${esc(estado)}">${esc(String(estado).replace('_', ' '))}</span>`;

async function cargarEventos() {
  cargando('#listaEventos');
  let eventos;
  try { eventos = await api('/eventos'); } catch (e) { return fallar(e); }

  const t = eventos.reduce((a, e) => ({
    ingreso: a.ingreso + e.resumen.ingresoPlan,
    utilidad: a.utilidad + e.resumen.utilidadPlan,
    porCobrar: a.porCobrar + e.resumen.porCobrar,
    vencido: a.vencido + e.resumen.vencido,
  }), { ingreso: 0, utilidad: 0, porCobrar: 0, vencido: 0 });

  $('#totalesGlobales').innerHTML = eventos.length ? `
    ${tira('Eventos', eventos.length)}
    ${tira('Ingreso proyectado', pesos(t.ingreso))}
    ${tira('Utilidad proyectada', pesos(t.utilidad), '', t.utilidad < 0 ? 'mal' : '')}
    ${tira('Por cobrar', pesos(t.porCobrar),
      t.vencido ? `${pesos(t.vencido)} vencido` : '', t.vencido ? 'ojo' : '')}
  ` : '';

  $('#listaEventos').innerHTML = eventos.length ? eventos.map((e) => `
    <button class="fila-evento" data-id="${e.id}">
      <div>
        <h3>${esc(e.nombre)}</h3>
        <div class="sub">
          ${[e.cliente, e.sede, rangoEvento(e)].filter(Boolean).map(esc).join(' · ') || 'sin datos'}
          &nbsp;${chip(e.estado)}
        </div>
      </div>
      <div class="cifras">
        ${cifra('Utilidad proy.', pesos(e.resumen.utilidadPlan),
          e.resumen.utilidadPlan < 0 ? 'mal' : '')}
        ${cifra('Margen', pct(e.resumen.margenPlan))}
        ${cifra('Por cobrar', pesos(e.resumen.porCobrar), e.resumen.vencido ? 'mal' : '')}
      </div>
    </button>`).join('')
    : `<p class="vacio"><strong>Todavía no hay eventos.</strong> Crea el primero arriba,
       o abre uno e importa el Excel que ya tengas.</p>`;

  $$('#listaEventos .fila-evento').forEach((f) =>
    f.addEventListener('click', () => abrirEvento(f.dataset.id)));
}

/** Los campos de un evento, en diálogo. Sirve para crear y para editar. */
const CAMPOS_EVENTO = (e = {}) => [
  { llave: 'nombre', et: 'Nombre del evento', valor: e.nombre || '', ancho: true },
  { llave: 'cliente', et: 'Cliente', valor: e.cliente || '' },
  { llave: 'sede', et: 'Sede', valor: e.sede || '' },
  { llave: 'fecha', et: 'Desde', tipo: 'date', valor: e.fecha || '' },
  {
    llave: 'fecha_fin', et: 'Hasta', tipo: 'date', valor: e.fecha_fin || '',
    pista: 'Déjalo vacío si es de un solo día.',
  },
  {
    llave: 'estado', et: 'Estado', valor: e.estado || 'cotizado',
    opciones: ESTADOS.map((s) => ({ valor: s, et: s.replace('_', ' ') })),
  },
  { llave: 'notas', et: 'Notas', tipo: 'texto-largo', valor: e.notas || '', ancho: true },
];

const validarEvento = (v) => {
  if (!v.nombre) return 'El evento necesita un nombre.';
  if (v.fecha_fin && v.fecha && v.fecha_fin < v.fecha) {
    return 'La fecha de fin es anterior a la de inicio.';
  }
  if (v.fecha_fin && !v.fecha) return 'Si pones fecha de fin, pon también la de inicio.';
  return null;
};

const aFilaEvento = (v) => ({
  nombre: v.nombre, cliente: v.cliente || null, sede: v.sede || null,
  fecha: v.fecha || null, fecha_fin: v.fecha_fin || null,
  estado: v.estado, notas: v.notas || null,
});

$('#nuevoEvento').addEventListener('click', async () => {
  const v = await pedirDatos({
    titulo: 'Nuevo evento',
    nota: 'Solo el nombre es obligatorio; lo demás se puede completar después.',
    campos: CAMPOS_EVENTO(), ok: 'Crear', validar: validarEvento,
  });
  if (!v) return;
  try {
    const e = await api('/eventos', { cuerpo: aFilaEvento(v) });
    avisar('Evento creado.');
    abrirEvento(e.id);
  } catch (e) { fallar(e); }
});

// ───────────────────────── ficha de evento ─────────────────────────

let actual = null;
// Cada tabla guarda aquí cómo repintar solo sus totales.
const defs = {};

async function abrirEvento(id) {
  try { actual = await api(`/eventos/${id}`); } catch (e) { return fallar(e); }
  const { evento } = actual;
  ver('evento');
  $('#evNombre').innerHTML = `${esc(evento.nombre)} ${chip(evento.estado)}`;
  $('#evMeta').textContent =
    [evento.cliente, evento.sede, rangoEvento(evento)].filter(Boolean).join(' · ')
    || 'sin cliente ni fecha todavía';
  $('#evExcel').href = `/api/eventos/${id}/excel`;

  pintarPresupuesto();
  pintarMovimientos();
  pintarCobros();
  pintarResumen();
  pintarCategorias();
  aplicarPermisos();
}

/** Repinta la ficha entera. Solo al añadir o quitar filas. */
const refrescar = () => abrirEvento(actual.evento.id);

/**
 * Trae los números del servidor y repinta SOLO lo calculado.
 *
 * Es lo que se llama al guardar una celda: los totales son del servidor —una
 * sola verdad para las cuentas— pero los campos no se vuelven a crear, así
 * que el foco y lo que se está escribiendo se quedan donde estaban.
 */
async function refrescarTotales() {
  actual = await api(`/eventos/${actual.evento.id}`);
  pintarResumen();
  pintarCategorias();
  Object.values(defs).forEach(repintarCalculos);
}

function pintarResumen() {
  const r = actual.resumen;
  $('#evResumen').innerHTML = `
    ${tira('Ingreso', pesos(r.ingresoPlan), `real ${pesos(r.ingresoReal)}`)}
    ${tira('Gasto', pesos(r.gastoPlan), `real ${pesos(r.gastoReal)}`,
      r.sobrecosto > 0 ? 'mal' : '')}
    ${tira('Utilidad proyectada', pesos(r.utilidadPlan), `margen ${pct(r.margenPlan)}`)}
    ${tira('Utilidad real', pesos(r.utilidadReal), `margen ${pct(r.margenReal)}`,
      r.utilidadReal < 0 ? 'mal' : r.utilidadReal > 0 ? 'bien' : '')}
    ${tira('Por cobrar', pesos(r.porCobrar),
      r.vencido ? `${pesos(r.vencido)} vencido` : `de ${pesos(r.facturado)}`,
      r.vencido ? 'mal' : '')}
  `;
  // El sobrecosto se dice con palabras, no solo con un número en rojo.
  $('#evAvisos').innerHTML = r.sobrecosto > 0
    ? `<div class="bloque aviso-bloque">
         <span class="icono">!</span>
         <span>Se ha gastado <strong>${pesos(r.sobrecosto)}</strong> más de lo
         presupuestado. Mira abajo en qué categoría se fue.</span>
       </div>` : '';
}

/* Cada tabla declara sus columnas y se pinta sola. El patrón es el mismo en
   las tres; escribirlo tres veces a mano es como se desincronizan. */

function tabla({ nombre, contenedor, filas, columnas, ruta, pie }) {
  defs[nombre] = { nombre, contenedor, columnas, ruta, pie };
  const el = $(contenedor);
  if (!filas.length) {
    el.innerHTML = `<p class="vacio">Sin líneas todavía.${puedeEscribir()
      ? ' Usa el botón de arriba para añadir la primera.' : ''}</p>`;
    return;
  }
  el.innerHTML = `
    <div class="rueda"><table>
      <thead><tr>
        ${columnas.map((c) => `<th class="${c.num ? 'num' : ''}">${esc(c.et)}</th>`).join('')}
        <th></th>
      </tr></thead>
      <tbody>
        ${filas.map((f) => `<tr data-id="${f.id}">
          ${columnas.map((c) => `<td class="${c.num ? 'num' : ''}">${celda(c, f)}</td>`).join('')}
          <td>${puedeEscribir()
            ? '<button class="quitar" title="Quitar línea" aria-label="Quitar línea">×</button>' : ''}</td>
        </tr>`).join('')}
      </tbody>
      <tfoot></tfoot>
    </table></div>`;

  // Un solo escuchador por tabla, no uno por celda. Y asignado (`onchange`),
  // no añadido: el contenedor sobrevive al repintado, y con addEventListener
  // se irían acumulando hasta guardar la misma celda tres veces.
  el.onchange = (ev) => guardarCelda(defs[nombre], ev.target);
  // El dinero se escribe con puntos de miles en cuanto se sale de la celda.
  el.onfocusout = (ev) => {
    if (ev.target.dataset?.dinero) ev.target.value = miles(aNumero(ev.target.value));
  };
  $$('.quitar', el).forEach((b) => b.addEventListener('click', () => quitarFila(defs[nombre], b)));
  repintarCalculos(defs[nombre]);
}

function celda(c, f) {
  const v = f[c.campo] ?? '';
  if (c.calc) return `<span class="calc" data-calc="${esc(c.et)}"></span>`;
  const soloLectura = !puedeEscribir();
  if (c.opciones) {
    return `<select data-campo="${c.campo}" ${soloLectura ? 'disabled' : ''}>${c.opciones.map((o) =>
      `<option value="${esc(o)}"${o === v ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
  }
  if (c.dinero) {
    return `<input class="num" type="text" inputmode="numeric" data-dinero="1"
      data-campo="${c.campo}" value="${miles(v)}" ${soloLectura ? 'readonly' : ''}
      aria-label="${esc(c.et)}">`;
  }
  const tipo = c.num ? 'number' : (c.fecha ? 'date' : 'text');
  return `<input class="${c.num ? 'num' : ''}${c.corto ? ' corto' : ''}" type="${tipo}"
    ${c.num ? 'min="0" step="any"' : ''} data-campo="${c.campo}" value="${esc(v)}"
    ${soloLectura ? 'readonly' : ''} placeholder="${esc(c.et.toLowerCase())}"
    aria-label="${esc(c.et)}">`;
}

/** La fila local, para poder recalcular sin volver a pedirla. */
const filasDe = (nombre) => actual[nombre] || [];

async function guardarCelda(def, campoEl) {
  const campo = campoEl.dataset?.campo;
  if (!campo) return;
  const tr = campoEl.closest('tr');
  const id = tr.dataset.id;
  const valor = campoEl.dataset.dinero ? aNumero(campoEl.value)
    : campoEl.type === 'number' ? (Number(campoEl.value) || 0)
    : (campoEl.value || null);
  try {
    await api(`/${def.ruta}/${id}`, { metodo: 'PUT', cuerpo: { [campo]: valor } });
    campoEl.classList.remove('guardado');
    void campoEl.offsetWidth;              // reinicia la animación
    campoEl.classList.add('guardado');
    await refrescarTotales();
  } catch (e) {
    fallar(e);
  }
}

async function quitarFila(def, boton) {
  const tr = boton.closest('tr');
  const fila = filasDe(def.nombre).find((f) => f.id === tr.dataset.id);
  const si = await confirmar({
    titulo: 'Quitar esta línea',
    texto: fila?.concepto ? `«${fila.concepto}» se borra de ${def.nombre}.` : '',
    ok: 'Quitar', peligro: true,
  });
  if (!si) return;
  try {
    await api(`/${def.ruta}/${tr.dataset.id}`, { metodo: 'DELETE' });
    await refrescar();
  } catch (e) { fallar(e); }
}

/** Rellena las celdas calculadas y el pie. No toca ningún campo editable. */
function repintarCalculos(def) {
  const tb = $('table', $(def.contenedor));
  if (!tb) return;
  const porId = new Map(filasDe(def.nombre).map((f) => [f.id, f]));
  $$('tbody tr', tb).forEach((tr) => {
    const f = porId.get(tr.dataset.id);
    if (!f) return;
    def.columnas.forEach((c, i) => {
      if (!c.calc) return;
      const celdaEl = $('[data-calc]', tr.children[i]);
      if (celdaEl) celdaEl.textContent = c.calc(f);
    });
  });
  $('tfoot', tb).innerHTML = def.pie(filasDe(def.nombre), def.columnas);
}

/**
 * Una fila de pie alineada con la columna del dinero.
 *
 * `indice` es la columna bajo la que va la cifra. Se calcula desde la
 * definición y no a mano: las cuentas de colspan escritas a dedo se
 * descolocan en cuanto alguien añade una columna, y lo hicimos hoy.
 */
const pieFila = (columnas, indice, et, vl, clase = '') => {
  const detras = columnas.length - indice;   // lo que queda, más la de acciones
  return `<tr class="${clase}">
    <td colspan="${indice}">${et}</td>
    <td class="num">${pesos(vl)}</td>
    ${detras > 0 ? `<td colspan="${detras}"></td>` : ''}</tr>`;
};

const total = (l) => (Number(l.cantidad) || 0) * (Number(l.dias) || 1) * (Number(l.valor_unitario) || 0);

const pieTotales = (lineas, columnas) => {
  const i = columnas.findIndex((c) => c.calc);
  const suma = (t) => lineas.filter((l) => l.tipo === t).reduce((a, l) => a + total(l), 0);
  const ing = suma('ingreso'), gas = suma('gasto');
  return pieFila(columnas, i, 'Ingreso proyectado', ing)
    + pieFila(columnas, i, 'Gasto proyectado', gas)
    + pieFila(columnas, i, 'Utilidad proyectada', ing - gas, 'fuerte');
};

function pintarPresupuesto() {
  tabla({
    nombre: 'presupuesto', contenedor: '#tablaPresupuesto', ruta: 'presupuesto',
    filas: actual.presupuesto,
    columnas: [
      { et: 'Fecha', campo: 'fecha', fecha: true },
      { et: 'Tipo', campo: 'tipo', opciones: ['ingreso', 'gasto'] },
      { et: 'Categoría', campo: 'categoria' },
      { et: 'Concepto', campo: 'concepto' },
      { et: 'Cant.', campo: 'cantidad', num: true, corto: true },
      { et: 'Días', campo: 'dias', num: true, corto: true },
      { et: 'Valor unitario', campo: 'valor_unitario', dinero: true, num: true },
      { et: 'Total', calc: (l) => pesos(total(l)), num: true },
      { et: 'Proveedor', campo: 'proveedor' },
    ],
    pie: pieTotales,
  });
}

function pintarMovimientos() {
  tabla({
    nombre: 'movimientos', contenedor: '#tablaMovimientos', ruta: 'movimientos',
    filas: actual.movimientos,
    columnas: [
      { et: 'Fecha', campo: 'fecha', fecha: true },
      { et: 'Tipo', campo: 'tipo', opciones: ['ingreso', 'gasto'] },
      { et: 'Categoría', campo: 'categoria' },
      { et: 'Concepto', campo: 'concepto' },
      { et: 'Valor', campo: 'valor', dinero: true, num: true },
      { et: 'Comprobante', campo: 'comprobante' },
    ],
    pie: (filas, columnas) => {
      const i = columnas.findIndex((c) => c.campo === 'valor');
      const suma = (t) => filas.filter((m) => m.tipo === t)
        .reduce((a, m) => a + (Number(m.valor) || 0), 0);
      const ing = suma('ingreso'), gas = suma('gasto');
      return pieFila(columnas, i, 'Ingreso real', ing)
        + pieFila(columnas, i, 'Gasto real', gas)
        + pieFila(columnas, i, 'Utilidad real', ing - gas, 'fuerte');
    },
  });
}

function pintarCobros() {
  const fact = (c) => Number(c.valor) || 0;
  const pag = (c) => Number(c.pagado) || 0;
  tabla({
    nombre: 'cobros', contenedor: '#tablaCobros', ruta: 'cobros',
    filas: actual.cobros,
    columnas: [
      { et: 'Concepto', campo: 'concepto' },
      { et: 'Facturado', campo: 'valor', dinero: true, num: true },
      { et: 'Pagado', campo: 'pagado', dinero: true, num: true },
      { et: 'Saldo', calc: (c) => pesos(fact(c) - pag(c)), num: true },
      { et: 'Fecha factura', campo: 'fecha_factura', fecha: true },
      { et: 'Vence', campo: 'vence', fecha: true },
      { et: 'Fecha pago', campo: 'fecha_pago', fecha: true },
    ],
    // Tres cifras seguidas: este pie no usa pieFila.
    pie: (filas, columnas) => `<tr class="fuerte">
      <td>Totales</td>
      <td class="num">${pesos(filas.reduce((a, c) => a + fact(c), 0))}</td>
      <td class="num">${pesos(filas.reduce((a, c) => a + pag(c), 0))}</td>
      <td class="num">${pesos(filas.reduce((a, c) => a + fact(c) - pag(c), 0))}</td>
      <td colspan="${columnas.length - 3}"></td></tr>`,
  });
}

function pintarCategorias() {
  const c = actual.categorias;
  $('#tablaCategorias').innerHTML = c.length ? `
    <div class="rueda"><table>
      <thead><tr><th>Categoría</th><th class="num">Proyectado</th>
        <th class="num">Real</th><th class="num">Desviación</th></tr></thead>
      <tbody>${c.map((f) => `<tr>
        <td class="celda-texto">${esc(f.categoria)}${f.sinPresupuestar
          ? ' <span class="marbete perdido">sin presupuestar</span>' : ''}</td>
        <td class="num calc">${pesos(f.plan)}</td>
        <td class="num calc">${pesos(f.real)}</td>
        <td class="num"><span class="${f.desviacion > 0 ? 'mal' : f.desviacion < 0 ? 'bien' : ''}">
          ${pesos(f.desviacion)}</span></td>
      </tr>`).join('')}</tbody>
    </table></div>` : `<p class="vacio">Sin gastos todavía.</p>`;
}

// agregar línea en cualquiera de las tres tablas
$$('[data-agregar]').forEach((b) => b.addEventListener('click', async () => {
  const cosa = b.dataset.agregar;
  const e = actual.evento;
  const base = { evento_id: e.id };
  const nuevo = {
    // La línea nueva hereda la fecha y los días del evento: si el evento dura
    // tres días, el alquiler dura tres días. Se cambia si no, pero lo normal
    // no debería haber que escribirlo cada vez.
    presupuesto: {
      ...base, tipo: 'gasto', concepto: '', cantidad: 1,
      dias: diasEvento(e), valor_unitario: 0, fecha: e.fecha || null,
      orden: (actual.presupuesto.length + 1) * 10,
    },
    movimientos: { ...base, tipo: 'gasto', concepto: '', valor: 0, fecha: e.fecha || hoy() },
    cobros: { ...base, concepto: '', valor: 0, pagado: 0 },
  }[cosa];
  try {
    await api(`/${cosa}`, { cuerpo: nuevo });
    await refrescar();
    // El foco va al concepto de la fila nueva: se escribe sin tocar el ratón.
    const filas = $$(`${{ presupuesto: '#tablaPresupuesto', movimientos: '#tablaMovimientos', cobros: '#tablaCobros' }[cosa]} tbody tr`);
    $('[data-campo="concepto"]', filas[filas.length - 1])?.focus();
  } catch (e2) { fallar(e2); }
}));

$('#evEditar').addEventListener('click', async () => {
  const e = actual.evento;
  const v = await pedirDatos({
    titulo: 'Datos del evento', campos: CAMPOS_EVENTO(e), validar: validarEvento,
  });
  if (!v) return;
  try {
    await api(`/eventos/${e.id}`, { metodo: 'PUT', cuerpo: aFilaEvento(v) });
    avisar('Datos guardados.');
    await refrescar();
  } catch (err) { fallar(err); }
});

$('#evBorrar').addEventListener('click', async () => {
  const e = actual.evento;
  const si = await confirmar({
    titulo: `Borrar «${e.nombre}»`,
    texto: 'Se borra el evento con su presupuesto, sus movimientos y sus cobros.',
    ojo: 'Esto no se puede deshacer. Si quieres conservarlo, descarga primero su Excel.',
    ok: 'Borrar el evento', peligro: true,
  });
  if (!si) return;
  try {
    await api(`/eventos/${e.id}`, { metodo: 'DELETE' });
    avisar('Evento borrado.');
    ver('eventos');
    cargarEventos();
  } catch (err) { fallar(err); }
});

// ───────────────────────── importar Excel ─────────────────────────

$('#evImportarBoton').addEventListener('click', () => $('#evImportar').click());

$('#evImportar').addEventListener('change', async (ev) => {
  const archivo = ev.target.files[0];
  ev.target.value = '';
  if (!archivo) return;

  // Antes era un confirm donde "Aceptar" borraba. Ahora cada salida dice lo
  // que hace y la que borra está en rojo y de segunda.
  const modo = await elegir({
    titulo: `Importar «${archivo.name}»`,
    texto: 'Las hojas que el archivo no traiga se quedan como están.',
    opciones: [
      { et: 'Sumar a lo que ya hay', valor: 'sumar', clase: 'boton' },
      { et: 'Reemplazar las hojas que traiga', valor: 'reemplazar', clase: 'plano peligro' },
    ],
  });
  if (!modo) return;

  try {
    const r = await api(
      `/eventos/${actual.evento.id}/excel?reemplazar=${modo === 'reemplazar' ? 1 : 0}`, {
        metodo: 'POST',
        crudo: { body: archivo, headers: { 'Content-Type': 'application/octet-stream' } },
      });
    const n = Object.entries(r.metidas).map(([k, v]) => `${v} en ${k}`).join(', ') || 'nada';
    avisar(`Importado: ${n}.`, r.avisos.length ? 'mal' : 'ok', r.avisos);
    await refrescar();
  } catch (e) { fallar(e); }
});

// ───────────────────────── cotizaciones ─────────────────────────

async function cargarCotizaciones() {
  cargando('#listaCotizaciones');
  let cots;
  try { cots = await api('/cotizaciones'); } catch (e) { return fallar(e); }
  $('#listaCotizaciones').innerHTML = cots.length ? cots.map((c) => `
    <button class="fila-evento" data-id="${c.id}">
      <div>
        <h3>${esc(c.titulo)}</h3>
        <div class="sub">${esc(c.cliente)}${c.numero ? ' · ' + esc(c.numero) : ''}
          · ${fechaCorta(c.fecha)} &nbsp;${chip(c.estado)}</div>
      </div>
    </button>`).join('')
    : `<p class="vacio"><strong>Sin cotizaciones.</strong> La primera se crea arriba:
       se llena un formulario y sale la propuesta lista para imprimir.</p>`;
  $$('#listaCotizaciones .fila-evento').forEach((f) =>
    f.addEventListener('click', () => abrirCotizacion(f.dataset.id)));
}

let cotActual = null;

$('#nuevaCotizacion').addEventListener('click', async () => {
  try {
    const base = await api('/cotizaciones/nueva');
    cotActual = {
      ...base, cliente: '', contacto: '', numero: '', titulo: '',
      fecha: hoy(), estado: 'borrador',
      items: [{ concepto: '', detalle: '', cantidad: 1, dias: 1, valor_unitario: 0 }],
    };
    ver('cotizacion');
    pintarCotizacion();
  } catch (e) { fallar(e); }
});

async function abrirCotizacion(id) {
  try { cotActual = await api(`/cotizaciones/${id}`); } catch (e) { return fallar(e); }
  ver('cotizacion');
  pintarCotizacion();
}

const totalItem = (i) =>
  (Number(i.cantidad) || 0) * (Number(i.dias) || 1) * (Number(i.valor_unitario) || 0);

function pintarCotizacion() {
  const c = cotActual;
  $('#cotVer').href = c.id ? `/api/cotizaciones/${c.id}/html` : '#';
  $('#cotVer').style.opacity = c.id ? 1 : .4;
  $('#cotAEvento').hidden = !c.id;
  $('#cotEstado').innerHTML = c.id
    ? `${esc(c.cliente || 'sin cliente')} ${chip(c.estado)}`
    : 'Sin guardar todavía. «Ver / imprimir» se activa al guardar.';

  const campo = (et, llave, tipo = 'text', ancho = false) => `
    <div class="campo${ancho ? ' ancho' : ''}">
      <label>${et}</label>
      <input type="${tipo}" data-c="${llave}" value="${esc(c[llave] ?? '')}">
    </div>`;

  const totalCot = (c.items || []).reduce((t, i) => t + totalItem(i), 0);

  $('#cotFormulario').innerHTML = `
    <div class="bloque">
      <div class="campos">
        ${campo('Cliente', 'cliente')}
        ${campo('Contacto', 'contacto')}
        ${campo('Número', 'numero')}
        ${campo('Fecha', 'fecha', 'date')}
        <div class="campo"><label>Estado</label>
          <select data-c="estado">${['borrador', 'enviada', 'aprobada', 'perdida']
            .map((e) => `<option${e === c.estado ? ' selected' : ''}>${e}</option>`).join('')}</select></div>
        ${campo('Validez (días)', 'validez_dias', 'number')}
        ${campo('Título de la propuesta', 'titulo', 'text', true)}
        <div class="campo ancho"><label>Resumen</label>
          <textarea data-c="resumen">${esc(c.resumen ?? '')}</textarea></div>
      </div>
    </div>

    <div class="bloque">
      <div class="cabecera-bloque">
        <div>
          <h3>Ítems</h3>
          <p class="dim">La columna de días solo sale en la propuesta si alguna línea
            dura más de uno.</p>
        </div>
        <button class="plano" id="cotAddItem">+ ítem</button>
      </div>
      <div class="rueda"><table>
        <thead><tr><th>Concepto</th><th>Detalle</th><th class="num">Cant.</th>
          <th class="num">Días</th><th class="num">Valor unitario</th>
          <th class="num">Total</th><th></th></tr></thead>
        <tbody>${(c.items || []).map((i, n) => `<tr data-n="${n}">
          <td><input data-i="concepto" value="${esc(i.concepto)}" placeholder="concepto"></td>
          <td><input data-i="detalle" value="${esc(i.detalle ?? '')}" placeholder="detalle"></td>
          <td class="num"><input class="num corto" type="number" min="0" step="any" data-i="cantidad" value="${esc(i.cantidad)}"></td>
          <td class="num"><input class="num corto" type="number" min="1" step="any" data-i="dias" value="${esc(i.dias ?? 1)}"></td>
          <td class="num"><input class="num" type="text" inputmode="numeric" data-i="valor_unitario" data-dinero="1" value="${miles(i.valor_unitario)}"></td>
          <td class="num calc">${pesos(totalItem(i))}</td>
          <td><button class="quitar" aria-label="Quitar ítem">×</button></td></tr>`).join('')}</tbody>
        <tfoot><tr class="fuerte"><td colspan="5">Inversión total</td>
          <td class="num">${pesos(totalCot)}</td><td></td></tr></tfoot>
      </table></div>
    </div>

    ${listaEditable('Lo que incluye', 'incluye', c.incluye || [])}
    ${listaEditable('Condiciones', 'condiciones', c.condiciones || [])}

    <div class="bloque">
      <div class="cabecera-bloque"><h3>Forma de pago</h3>
        <button class="plano" data-add-pago>+ paso</button></div>
      <div class="listado-simple" data-lista="pagos">
        ${(c.pagos || []).map((p, n) => `<div class="renglon" data-n="${n}">
          <input type="number" style="max-width:88px;flex:0 0 auto" data-p="pct" value="${esc(p.pct)}" placeholder="%">
          <input data-p="cuando" value="${esc(p.cuando ?? '')}" placeholder="cuándo">
          <span class="calc">${pesos(totalCot * (Number(p.pct) || 0) / 100)}</span>
          <button class="quitar" aria-label="Quitar paso">×</button></div>`).join('')}
      </div>
    </div>`;

  // Los cambios se guardan en memoria; al disco van con "Guardar". Así se puede
  // reordenar una cotización entera sin dejar versiones a medias en la base.
  $('#cotFormulario').oninput = (ev) => {
    const t = ev.target;
    const leer = () => (t.dataset.dinero ? aNumero(t.value)
      : t.type === 'number' ? Number(t.value) || 0 : t.value);
    if (t.dataset.c) {
      cotActual[t.dataset.c] = leer();
    } else if (t.dataset.i) {
      cotActual.items[Number(t.closest('tr').dataset.n)][t.dataset.i] = leer();
    } else if (t.dataset.p) {
      const n = Number(t.closest('.renglon').dataset.n);
      cotActual.pagos[n][t.dataset.p] = t.dataset.p === 'pct' ? Number(t.value) || 0 : t.value;
    } else if (t.dataset.l) {
      cotActual[t.dataset.l][Number(t.closest('.renglon').dataset.n)] = t.value;
    }
  };
  $('#cotFormulario').onchange = (ev) => {
    if (ev.target.dataset.c === 'estado') cotActual.estado = ev.target.value;
    // Los totales de los pasos de pago dependen de los ítems: repintar.
    if (ev.target.dataset.i || ev.target.dataset.p) pintarCotizacion();
  };

  $('#cotAddItem').onclick = () => {
    cotActual.items.push({ concepto: '', detalle: '', cantidad: 1, dias: 1, valor_unitario: 0 });
    pintarCotizacion();
  };
  $$('[data-add-pago]').forEach((b) => (b.onclick = () => {
    (cotActual.pagos ||= []).push({ pct: 0, cuando: '' }); pintarCotizacion();
  }));
  $$('[data-add-lista]').forEach((b) => (b.onclick = () => {
    (cotActual[b.dataset.addLista] ||= []).push(''); pintarCotizacion();
  }));
  $$('#cotFormulario .quitar').forEach((b) => (b.onclick = () => {
    const tr = b.closest('tr'), ren = b.closest('.renglon');
    if (tr) cotActual.items.splice(Number(tr.dataset.n), 1);
    else cotActual[ren.parentElement.dataset.lista].splice(Number(ren.dataset.n), 1);
    pintarCotizacion();
  }));
  aplicarPermisos();
}

const listaEditable = (titulo, llave, valores) => `
  <div class="bloque">
    <div class="cabecera-bloque"><h3>${titulo}</h3>
      <button class="plano" data-add-lista="${llave}">+ línea</button></div>
    <div class="listado-simple" data-lista="${llave}">
      ${valores.map((v, n) => `<div class="renglon" data-n="${n}">
        <input data-l="${llave}" value="${esc(v)}">
        <button class="quitar" aria-label="Quitar línea">×</button></div>`).join('')}
    </div>
  </div>`;

$('#cotGuardar').addEventListener('click', async () => {
  const c = cotActual;
  if (!c.cliente || !c.titulo) return avisar('Falta el cliente o el título.', 'mal');
  try {
    const guardada = c.id
      ? await api(`/cotizaciones/${c.id}`, { metodo: 'PUT', cuerpo: c })
      : await api('/cotizaciones', { cuerpo: c });
    cotActual.id = guardada.id;
    pintarCotizacion();
    avisar('Cotización guardada.');
  } catch (e) { fallar(e); }
});

$('#cotAEvento').addEventListener('click', async () => {
  if (!cotActual.id) return;
  const v = await pedirDatos({
    titulo: 'Cotización aprobada → evento',
    nota: 'Se crea el evento con lo cotizado como ingreso proyectado, y la cotización queda marcada como aprobada.',
    campos: [
      { llave: 'fecha', et: 'Desde', tipo: 'date', valor: '' },
      {
        llave: 'fecha_fin', et: 'Hasta', tipo: 'date', valor: '',
        pista: 'Déjalo vacío si es de un solo día.',
      },
    ],
    ok: 'Crear el evento',
    validar: (x) => (x.fecha_fin && x.fecha && x.fecha_fin < x.fecha
      ? 'La fecha de fin es anterior a la de inicio.' : null),
  });
  if (!v) return;
  try {
    const r = await api(`/cotizaciones/${cotActual.id}/a-evento`, {
      cuerpo: { fecha: v.fecha || null, fecha_fin: v.fecha_fin || null },
    });
    avisar('Evento creado desde la cotización.');
    abrirEvento(r.evento.id);
  } catch (e) { fallar(e); }
});

// ───────────────────────────── usuarios ─────────────────────────────

const ROLES = [
  { valor: 'admin', et: 'admin — todo, incluidos los usuarios' },
  { valor: 'editor', et: 'editor — todo menos los usuarios' },
  { valor: 'lector', et: 'lector — solo mirar y descargar' },
];

async function cargarUsuarios() {
  cargando('#tablaUsuarios', 2);
  let us;
  try { us = await api('/usuarios'); } catch (e) { return fallar(e); }

  // Con la tabla vacía, todo el mundo entra con la misma clave y no se sabe
  // quién tocó qué. Decirlo es más útil que un listado en blanco.
  $('#notaUsuarios').innerHTML = us.length ? '' : `
    <div class="bloque aviso-bloque">
      <span class="icono">!</span>
      <span>Todavía no hay usuarios: se entra con la clave maestra, que es la
      misma para todos. Crea una cuenta por persona y sabrás quién entra.</span>
    </div>`;

  $('#tablaUsuarios').innerHTML = us.length ? `
    <div class="rueda"><table>
      <thead><tr><th>Nombre</th><th>Correo</th><th>Rol</th><th>Estado</th>
        <th>Último acceso</th><th></th></tr></thead>
      <tbody>${us.map((u) => `<tr data-id="${u.id}">
        <td class="celda-texto">${esc(u.nombre)}${u.id === yo?.id
          ? ' <span class="marbete">tú</span>' : ''}</td>
        <td class="celda-texto">${esc(u.correo)}</td>
        <td class="celda-texto"><span class="marbete ${esc(u.rol)}">${esc(u.rol)}</span></td>
        <td class="celda-texto">${u.activo
          ? '<span class="marbete cerrado">activo</span>'
          : '<span class="marbete inactivo">inactivo</span>'}</td>
        <td class="celda-texto dim">${u.ultimo_acceso
          ? fechaCorta(u.ultimo_acceso.slice(0, 10)) : 'nunca'}</td>
        <td class="num">
          <button class="plano" data-editar="${u.id}">Editar</button>
          <button class="quitar" data-borrar="${u.id}" aria-label="Borrar usuario">×</button>
        </td>
      </tr>`).join('')}</tbody>
    </table></div>` : `<p class="vacio">Sin usuarios todavía.</p>`;

  $$('[data-editar]').forEach((b) => b.addEventListener('click', () =>
    editarUsuario(us.find((u) => u.id === b.dataset.editar))));
  $$('[data-borrar]').forEach((b) => b.addEventListener('click', () =>
    borrarUsuario(us.find((u) => u.id === b.dataset.borrar))));
}

const camposUsuario = (u = {}, nuevo) => [
  { llave: 'nombre', et: 'Nombre', valor: u.nombre || '', ancho: true },
  {
    llave: 'correo', et: 'Correo', tipo: 'email', valor: u.correo || '', ancho: true,
    autocompletar: 'off',
  },
  { llave: 'rol', et: 'Rol', valor: u.rol || 'editor', opciones: ROLES, ancho: true },
  {
    llave: 'activo', et: 'Entra al panel', valor: u.activo === false ? 'no' : 'si',
    opciones: [{ valor: 'si', et: 'sí' }, { valor: 'no', et: 'no — cuenta desactivada' }],
  },
  {
    llave: 'clave', et: nuevo ? 'Clave' : 'Clave nueva', tipo: 'password',
    valor: '', ancho: true, autocompletar: 'new-password',
    pista: nuevo ? 'Mínimo 8 caracteres.'
      : 'Déjalo vacío para no cambiar la clave que ya tiene.',
  },
];

const validarUsuario = (nuevo) => (v) => {
  if (!v.nombre) return 'Falta el nombre.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.correo)) return 'Ese correo no parece válido.';
  if (nuevo && !v.clave) return 'Pon una clave para esta cuenta.';
  if (v.clave && v.clave.length < 8) return 'La clave necesita al menos 8 caracteres.';
  return null;
};

const aFilaUsuario = (v) => ({
  nombre: v.nombre, correo: v.correo, rol: v.rol,
  activo: v.activo !== 'no',
  ...(v.clave ? { clave: v.clave } : {}),
});

$('#nuevoUsuario').addEventListener('click', async () => {
  const v = await pedirDatos({
    titulo: 'Nuevo usuario',
    nota: 'La clave se guarda cifrada: ni yo ni nadie puede volver a leerla, solo cambiarla.',
    campos: camposUsuario({}, true), ok: 'Crear', validar: validarUsuario(true),
  });
  if (!v) return;
  try {
    await api('/usuarios', { cuerpo: aFilaUsuario(v) });
    avisar(`${v.nombre} ya puede entrar.`);
    cargarUsuarios();
  } catch (e) { fallar(e); }
});

async function editarUsuario(u) {
  if (!u) return;
  const v = await pedirDatos({
    titulo: u.nombre, campos: camposUsuario(u, false), validar: validarUsuario(false),
  });
  if (!v) return;
  try {
    await api(`/usuarios/${u.id}`, { metodo: 'PUT', cuerpo: aFilaUsuario(v) });
    avisar(v.clave ? 'Datos y clave actualizados.' : 'Datos actualizados.');
    cargarUsuarios();
  } catch (e) { fallar(e); }
}

async function borrarUsuario(u) {
  if (!u) return;
  const si = await confirmar({
    titulo: `Borrar a ${u.nombre}`,
    texto: `${u.correo} dejará de poder entrar al panel.`,
    ojo: 'Si solo quieres cerrarle el paso un tiempo, edítalo y pon «no» en «Entra al panel»: así conservas el registro.',
    ok: 'Borrar', peligro: true,
  });
  if (!si) return;
  try {
    await api(`/usuarios/${u.id}`, { metodo: 'DELETE' });
    avisar('Usuario borrado.');
    cargarUsuarios();
  } catch (e) { fallar(e); }
}

// ───────────────────────────── permisos ─────────────────────────────
//
// Esconder un botón NO es un permiso —el servidor comprueba el rol en cada
// petición—, pero ofrecerle a un lector botones que le van a dar 403 es
// mentirle sobre lo que puede hacer.

function aplicarPermisos() {
  const escribe = puedeEscribir();
  // Solo esconde; nunca muestra. Hay botones ocultos por otros motivos —el de
  // "aprobada → evento" mientras la cotización no esté guardada— y mostrarlos
  // aquí los resucitaría.
  if (!escribe) {
    $$('[data-escribe], #cotFormulario .quitar, #cotFormulario .plano')
      .forEach((b) => (b.hidden = true));
  }
  $('#pestanaUsuarios').hidden = yo?.rol !== 'admin';
}

// ───────────────────────────── arranque ─────────────────────────────

async function arrancar() {
  try {
    yo = await api('/yo');
  } catch {
    return;                               // la puerta ya se mostró
  }
  $('#puerta').hidden = true;
  $('#panel').hidden = false;
  $('#yoNombre').textContent = yo.nombre;
  $('#yoRol').textContent = yo.rol;
  $('#yoRol').className = `marbete ${yo.rol}`;
  aplicarPermisos();
  ver('eventos');
  cargarEventos();
}

arrancar();
