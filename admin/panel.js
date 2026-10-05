// El panel por dentro.
//
// Sin framework y sin compilación, como el resto del sitio: esto se edita y se
// despliega con un push, y dentro de un año seguirá abriéndose sin reinstalar
// nada.
//
// Las tablas se editan EN EL SITIO y se guardan al salir de la celda. Un
// formulario aparte por cada línea de presupuesto es lo que hace que la gente
// acabe llevando las cuentas en una hoja de cálculo.

const $ = (s, raiz = document) => raiz.querySelector(s);
const $$ = (s, raiz = document) => [...raiz.querySelectorAll(s)];

const pesos = (v) => new Intl.NumberFormat('es-CO', {
  style: 'currency', currency: 'COP', maximumFractionDigits: 0,
}).format(Number(v) || 0);

const pct = (v) => `${((Number(v) || 0) * 100).toFixed(1)}%`;

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

let relojAviso;
function avisar(texto, mal = false, puntos = []) {
  const caja = $('#aviso');
  caja.className = `aviso${mal ? ' mal' : ''}`;
  caja.innerHTML = texto + (puntos.length
    ? `<ul>${puntos.map((p) => `<li>${p}</li>`).join('')}</ul>` : '');
  caja.hidden = false;
  clearTimeout(relojAviso);
  // Los avisos con detalle se quedan: si la importación dejó filas fuera, hay
  // que poder leer cuáles sin que desaparezcan a los tres segundos.
  relojAviso = setTimeout(() => (caja.hidden = true), puntos.length ? 20000 : 3600);
}

// ───────────────────────────── entrada ─────────────────────────────

function mostrarPuerta() {
  $('#puerta').hidden = false;
  $('#panel').hidden = true;
}

$('#formEntrar').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#errorEntrar').textContent = '';
  try {
    await api('/entrar', { cuerpo: { clave: $('#clave').value } });
    $('#clave').value = '';
    arrancar();
  } catch (err) {
    $('#errorEntrar').textContent = err.message;
  }
});

$('#salir').addEventListener('click', async () => {
  await api('/salir', { metodo: 'POST' }).catch(() => {});
  mostrarPuerta();
});

// ───────────────────────────── vistas ─────────────────────────────

function ver(nombre) {
  $$('.vista').forEach((v) => (v.hidden = v.id !== `vista-${nombre}`));
  $$('.pestana').forEach((p) =>
    p.classList.toggle('activa', p.dataset.vista === nombre));
}

$$('[data-vista]').forEach((b) => b.addEventListener('click', () => {
  const v = b.dataset.vista;
  ver(v);
  if (v === 'eventos') cargarEventos();
  if (v === 'cotizaciones') cargarCotizaciones();
}));

// ───────────────────────── lista de eventos ─────────────────────────

const ESTADOS = ['cotizado', 'confirmado', 'en_curso', 'cerrado', 'perdido'];

async function cargarEventos() {
  const eventos = await api('/eventos');
  const t = eventos.reduce((a, e) => ({
    ingreso: a.ingreso + e.resumen.ingresoPlan,
    utilidad: a.utilidad + e.resumen.utilidadPlan,
    porCobrar: a.porCobrar + e.resumen.porCobrar,
    vencido: a.vencido + e.resumen.vencido,
  }), { ingreso: 0, utilidad: 0, porCobrar: 0, vencido: 0 });

  $('#totalesGlobales').innerHTML = eventos.length ? `
    ${tira('Eventos', eventos.length)}
    ${tira('Ingreso proyectado', pesos(t.ingreso))}
    ${tira('Utilidad proyectada', pesos(t.utilidad))}
    ${tira('Por cobrar', pesos(t.porCobrar), t.vencido ? `${pesos(t.vencido)} vencido` : '', t.vencido ? 'ojo' : '')}
  ` : '';

  $('#listaEventos').innerHTML = eventos.length ? eventos.map((e) => `
    <div class="fila-evento" data-id="${e.id}">
      <div>
        <h3>${esc(e.nombre)}</h3>
        <div class="sub">
          ${[e.cliente, e.sede, e.fecha].filter(Boolean).map(esc).join(' · ') || 'sin datos'}
          &nbsp;<span class="marbete">${esc(e.estado)}</span>
        </div>
      </div>
      <div class="cifras">
        ${cifra('Utilidad proy.', pesos(e.resumen.utilidadPlan))}
        ${cifra('Margen', pct(e.resumen.margenPlan))}
        ${cifra('Por cobrar', pesos(e.resumen.porCobrar),
          e.resumen.vencido ? 'mal' : '')}
      </div>
    </div>`).join('')
    : `<p class="vacio">Todavía no hay eventos. El primero se crea arriba, o se importa un Excel desde la ficha.</p>`;

  $$('#listaEventos .fila-evento').forEach((f) =>
    f.addEventListener('click', () => abrirEvento(f.dataset.id)));
}

const tira = (et, vl, pie = '', clase = '') =>
  `<div class="tira"><div class="et">${et}</div><div class="vl ${clase}">${vl}</div>${pie ? `<div class="pie">${pie}</div>` : ''}</div>`;
const cifra = (et, vl, clase = '') =>
  `<div class="c"><div class="et">${et}</div><div class="vl ${clase}">${vl}</div></div>`;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

$('#nuevoEvento').addEventListener('click', async () => {
  const nombre = prompt('Nombre del evento');
  if (!nombre) return;
  const e = await api('/eventos', { cuerpo: { nombre } });
  abrirEvento(e.id);
});

// ───────────────────────── ficha de evento ─────────────────────────

let actual = null;

async function abrirEvento(id) {
  actual = await api(`/eventos/${id}`);
  const { evento, resumen: r } = actual;
  ver('evento');
  $('#evNombre').textContent = evento.nombre;
  $('#evMeta').textContent =
    [evento.cliente, evento.sede, evento.fecha, evento.estado].filter(Boolean).join(' · ');
  $('#evExcel').href = `/api/eventos/${id}/excel`;

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
    ? `<div class="bloque" style="border-color:var(--ojo)">
         Se ha gastado <strong>${pesos(r.sobrecosto)}</strong> más de lo presupuestado.
       </div>` : '';

  pintarPresupuesto();
  pintarMovimientos();
  pintarCobros();
  pintarCategorias();
}

/** Redibuja la ficha tras guardar, para que los totales no mientan. */
const refrescar = () => abrirEvento(actual.evento.id);

/* Cada tabla declara sus columnas y se pinta sola. El patrón es el mismo en
   las tres; escribirlo tres veces a mano es como se desincronizan. */

function tabla(contenedor, filas, columnas, tablaApi, pieHTML = '') {
  const el = $(contenedor);
  if (!filas.length) {
    el.innerHTML = `<p class="vacio">Sin líneas todavía.</p>`;
    return;
  }
  el.innerHTML = `
    <table>
      <thead><tr>
        ${columnas.map((c) => `<th class="${c.num ? 'num' : ''}">${c.et}</th>`).join('')}
        <th></th>
      </tr></thead>
      <tbody>
        ${filas.map((f) => `<tr data-id="${f.id}">
          ${columnas.map((c) => `<td class="${c.num ? 'num' : ''}">${celda(c, f)}</td>`).join('')}
          <td><button class="quitar" title="Quitar">×</button></td>
        </tr>`).join('')}
      </tbody>
      ${pieHTML}
    </table>`;

  el.oninput = null;
  el.onchange = async (ev) => {
    const campo = ev.target.dataset.campo;
    if (!campo) return;
    const id = ev.target.closest('tr').dataset.id;
    const valor = ev.target.type === 'number'
      ? Number(ev.target.value) || 0
      : ev.target.value || null;
    try {
      await api(`/${tablaApi}/${id}`, { metodo: 'PUT', cuerpo: { [campo]: valor } });
      refrescar();
    } catch (e) { avisar(e.message, true); }
  };
  $$('.quitar', el).forEach((b) => b.addEventListener('click', async () => {
    const id = b.closest('tr').dataset.id;
    if (!confirm('¿Quitar esta línea?')) return;
    await api(`/${tablaApi}/${id}`, { metodo: 'DELETE' });
    refrescar();
  }));
}

function celda(c, f) {
  const v = f[c.campo] ?? '';
  if (c.calc) return `<span class="calc">${c.calc(f)}</span>`;
  if (c.opciones) {
    return `<select data-campo="${c.campo}">${c.opciones.map((o) =>
      `<option value="${o}"${o === v ? ' selected' : ''}>${o}</option>`).join('')}</select>`;
  }
  const tipo = c.num ? 'number' : (c.fecha ? 'date' : 'text');
  return `<input class="${c.num ? 'num' : ''}" type="${tipo}" data-campo="${c.campo}"
    value="${esc(v)}" placeholder="${c.et.toLowerCase()}">`;
}

const total = (l) => (Number(l.cantidad) || 0) * (Number(l.valor_unitario) || 0);

function pintarPresupuesto() {
  const filas = actual.presupuesto;
  const suma = (t) => filas.filter((l) => l.tipo === t).reduce((a, l) => a + total(l), 0);
  tabla('#tablaPresupuesto', filas, [
    { et: 'Tipo', campo: 'tipo', opciones: ['ingreso', 'gasto'] },
    { et: 'Categoría', campo: 'categoria' },
    { et: 'Concepto', campo: 'concepto' },
    { et: 'Cant.', campo: 'cantidad', num: true },
    { et: 'Valor unitario', campo: 'valor_unitario', num: true },
    { et: 'Total', calc: (l) => pesos(total(l)), num: true },
    { et: 'Proveedor', campo: 'proveedor' },
  ], 'presupuesto', `<tfoot>
      <tr><td colspan="5">Ingreso proyectado</td><td class="num">${pesos(suma('ingreso'))}</td><td></td><td></td></tr>
      <tr><td colspan="5">Gasto proyectado</td><td class="num">${pesos(suma('gasto'))}</td><td></td><td></td></tr>
    </tfoot>`);
}

function pintarMovimientos() {
  const filas = actual.movimientos;
  const suma = (t) => filas.filter((m) => m.tipo === t).reduce((a, m) => a + (Number(m.valor) || 0), 0);
  tabla('#tablaMovimientos', filas, [
    { et: 'Fecha', campo: 'fecha', fecha: true },
    { et: 'Tipo', campo: 'tipo', opciones: ['ingreso', 'gasto'] },
    { et: 'Categoría', campo: 'categoria' },
    { et: 'Concepto', campo: 'concepto' },
    { et: 'Valor', campo: 'valor', num: true },
    { et: 'Comprobante', campo: 'comprobante' },
  ], 'movimientos', `<tfoot>
      <tr><td colspan="4">Ingreso real</td><td class="num">${pesos(suma('ingreso'))}</td><td></td><td></td></tr>
      <tr><td colspan="4">Gasto real</td><td class="num">${pesos(suma('gasto'))}</td><td></td><td></td></tr>
    </tfoot>`);
}

function pintarCobros() {
  const filas = actual.cobros;
  const f = (c) => Number(c.valor) || 0, p = (c) => Number(c.pagado) || 0;
  tabla('#tablaCobros', filas, [
    { et: 'Concepto', campo: 'concepto' },
    { et: 'Facturado', campo: 'valor', num: true },
    { et: 'Pagado', campo: 'pagado', num: true },
    { et: 'Saldo', calc: (c) => pesos(f(c) - p(c)), num: true },
    { et: 'Vence', campo: 'vence', fecha: true },
    { et: 'Fecha pago', campo: 'fecha_pago', fecha: true },
  ], 'cobros', `<tfoot><tr>
      <td>Totales</td>
      <td class="num">${pesos(filas.reduce((a, c) => a + f(c), 0))}</td>
      <td class="num">${pesos(filas.reduce((a, c) => a + p(c), 0))}</td>
      <td class="num">${pesos(filas.reduce((a, c) => a + f(c) - p(c), 0))}</td>
      <td></td><td></td><td></td>
    </tr></tfoot>`);
}

function pintarCategorias() {
  const c = actual.categorias;
  $('#tablaCategorias').innerHTML = c.length ? `
    <table>
      <thead><tr><th>Categoría</th><th class="num">Proyectado</th>
        <th class="num">Real</th><th class="num">Desviación</th></tr></thead>
      <tbody>${c.map((f) => `<tr>
        <td>${esc(f.categoria)}${f.sinPresupuestar
          ? ' <span class="marbete">sin presupuestar</span>' : ''}</td>
        <td class="num calc">${pesos(f.plan)}</td>
        <td class="num calc">${pesos(f.real)}</td>
        <td class="num"><span class="${f.desviacion > 0 ? 'mal' : f.desviacion < 0 ? 'bien' : ''}">
          ${pesos(f.desviacion)}</span></td>
      </tr>`).join('')}</tbody>
    </table>` : `<p class="vacio">Sin gastos todavía.</p>`;
}

// agregar línea en cualquiera de las tres tablas
$$('[data-agregar]').forEach((b) => b.addEventListener('click', async () => {
  const cosa = b.dataset.agregar;
  const base = { evento_id: actual.evento.id };
  const nuevo = {
    presupuesto: { ...base, tipo: 'gasto', concepto: '', cantidad: 1, valor_unitario: 0 },
    movimientos: { ...base, tipo: 'gasto', concepto: '', valor: 0 },
    cobros: { ...base, concepto: '', valor: 0, pagado: 0 },
  }[cosa];
  await api(`/${cosa}`, { cuerpo: nuevo });
  refrescar();
}));

$('#evEditar').addEventListener('click', async () => {
  const e = actual.evento;
  const nombre = prompt('Nombre', e.nombre); if (nombre === null) return;
  const cliente = prompt('Cliente', e.cliente || ''); if (cliente === null) return;
  const sede = prompt('Sede', e.sede || ''); if (sede === null) return;
  const fecha = prompt('Fecha (AAAA-MM-DD)', e.fecha || ''); if (fecha === null) return;
  const estado = prompt(`Estado (${ESTADOS.join(' / ')})`, e.estado); if (estado === null) return;
  await api(`/eventos/${e.id}`, {
    metodo: 'PUT',
    cuerpo: { nombre, cliente: cliente || null, sede: sede || null,
      fecha: fecha || null, estado: ESTADOS.includes(estado) ? estado : e.estado },
  });
  refrescar();
});

$('#evImportar').addEventListener('change', async (ev) => {
  const archivo = ev.target.files[0];
  if (!archivo) return;
  const reemplazar = confirm(
    'Aceptar = REEMPLAZA lo que ya hay en las hojas que traiga el archivo.\n' +
    'Cancelar = lo SUMA a lo existente.');
  try {
    const r = await api(`/eventos/${actual.evento.id}/excel?reemplazar=${reemplazar ? 1 : 0}`, {
      metodo: 'POST',
      crudo: { body: archivo, headers: { 'Content-Type': 'application/octet-stream' } },
    });
    const n = Object.entries(r.metidas).map(([k, v]) => `${v} en ${k}`).join(', ') || 'nada';
    avisar(`Importado: ${n}.`, false, r.avisos);
    refrescar();
  } catch (e) { avisar(e.message, true); }
  ev.target.value = '';
});

// ───────────────────────── cotizaciones ─────────────────────────

async function cargarCotizaciones() {
  const cots = await api('/cotizaciones');
  $('#listaCotizaciones').innerHTML = cots.length ? cots.map((c) => `
    <div class="fila-evento" data-id="${c.id}">
      <div>
        <h3>${esc(c.titulo)}</h3>
        <div class="sub">${esc(c.cliente)}${c.numero ? ' · ' + esc(c.numero) : ''} · ${esc(c.fecha)}
          &nbsp;<span class="marbete">${esc(c.estado)}</span></div>
      </div>
    </div>`).join('')
    : `<p class="vacio">Sin cotizaciones. La primera se crea arriba.</p>`;
  $$('#listaCotizaciones .fila-evento').forEach((f) =>
    f.addEventListener('click', () => abrirCotizacion(f.dataset.id)));
}

let cotActual = null;

$('#nuevaCotizacion').addEventListener('click', async () => {
  const base = await api('/cotizaciones/nueva');
  cotActual = {
    ...base, cliente: '', contacto: '', numero: '', titulo: '',
    fecha: new Date().toISOString().slice(0, 10), estado: 'borrador',
    items: [{ concepto: '', detalle: '', cantidad: 1, valor_unitario: 0 }],
  };
  ver('cotizacion');
  pintarCotizacion();
});

async function abrirCotizacion(id) {
  cotActual = await api(`/cotizaciones/${id}`);
  ver('cotizacion');
  pintarCotizacion();
}

function pintarCotizacion() {
  const c = cotActual;
  $('#cotVer').href = c.id ? `/api/cotizaciones/${c.id}/html` : '#';
  $('#cotVer').style.opacity = c.id ? 1 : .4;
  $('#cotAEvento').style.display = c.id ? '' : 'none';

  const campo = (et, llave, tipo = 'text', ancho = false) => `
    <div class="campo${ancho ? ' ancho' : ''}">
      <label>${et}</label>
      <input type="${tipo}" data-c="${llave}" value="${esc(c[llave] ?? '')}">
    </div>`;

  const totalCot = (c.items || []).reduce(
    (t, i) => t + (Number(i.cantidad) || 0) * (Number(i.valor_unitario) || 0), 0);

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
      <div class="cabecera-bloque"><h3>Ítems</h3><button class="plano" id="cotAddItem">+ ítem</button></div>
      <table>
        <thead><tr><th>Concepto</th><th>Detalle</th><th class="num">Cant.</th>
          <th class="num">Valor unitario</th><th class="num">Total</th><th></th></tr></thead>
        <tbody>${(c.items || []).map((i, n) => `<tr data-n="${n}">
          <td><input data-i="concepto" value="${esc(i.concepto)}" placeholder="concepto"></td>
          <td><input data-i="detalle" value="${esc(i.detalle ?? '')}" placeholder="detalle"></td>
          <td class="num"><input class="num" type="number" data-i="cantidad" value="${i.cantidad}"></td>
          <td class="num"><input class="num" type="number" data-i="valor_unitario" value="${i.valor_unitario}"></td>
          <td class="num calc">${pesos((Number(i.cantidad) || 0) * (Number(i.valor_unitario) || 0))}</td>
          <td><button class="quitar">×</button></td></tr>`).join('')}</tbody>
        <tfoot><tr><td colspan="4">Inversión total</td>
          <td class="num">${pesos(totalCot)}</td><td></td></tr></tfoot>
      </table>
    </div>

    ${listaEditable('Lo que incluye', 'incluye', c.incluye || [])}
    ${listaEditable('Condiciones', 'condiciones', c.condiciones || [])}

    <div class="bloque">
      <div class="cabecera-bloque"><h3>Forma de pago</h3>
        <button class="plano" data-add-pago>+ paso</button></div>
      <div class="listado-simple" data-lista="pagos">
        ${(c.pagos || []).map((p, n) => `<div class="renglon" data-n="${n}">
          <input type="number" style="max-width:90px" data-p="pct" value="${p.pct}" placeholder="%">
          <input data-p="cuando" value="${esc(p.cuando ?? '')}" placeholder="cuándo">
          <span class="calc">${pesos(totalCot * (Number(p.pct) || 0) / 100)}</span>
          <button class="quitar">×</button></div>`).join('')}
      </div>
    </div>`;

  // Los cambios se guardan en memoria; al disco van con "Guardar". Así se puede
  // reordenar una cotización entera sin dejar versiones a medias en la base.
  $('#cotFormulario').oninput = (ev) => {
    const t = ev.target;
    if (t.dataset.c) {
      cotActual[t.dataset.c] = t.type === 'number' ? Number(t.value) || 0 : t.value;
    } else if (t.dataset.i) {
      const n = Number(t.closest('tr').dataset.n);
      cotActual.items[n][t.dataset.i] = t.type === 'number' ? Number(t.value) || 0 : t.value;
    } else if (t.dataset.p) {
      const n = Number(t.closest('.renglon').dataset.n);
      cotActual.pagos[n][t.dataset.p] = t.dataset.p === 'pct' ? Number(t.value) || 0 : t.value;
    } else if (t.dataset.l) {
      const n = Number(t.closest('.renglon').dataset.n);
      cotActual[t.dataset.l][n] = t.value;
    }
  };
  $('#cotFormulario').onchange = (ev) => {
    if (ev.target.dataset.c === 'estado') cotActual.estado = ev.target.value;
    // Los totales de los pasos de pago dependen de los ítems: repintar.
    if (ev.target.dataset.i || ev.target.dataset.p) pintarCotizacion();
  };

  $('#cotAddItem').onclick = () => {
    cotActual.items.push({ concepto: '', detalle: '', cantidad: 1, valor_unitario: 0 });
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
    else {
      const lista = ren.parentElement.dataset.lista;
      cotActual[lista].splice(Number(ren.dataset.n), 1);
    }
    pintarCotizacion();
  }));
}

const listaEditable = (titulo, llave, valores) => `
  <div class="bloque">
    <div class="cabecera-bloque"><h3>${titulo}</h3>
      <button class="plano" data-add-lista="${llave}">+ línea</button></div>
    <div class="listado-simple" data-lista="${llave}">
      ${valores.map((v, n) => `<div class="renglon" data-n="${n}">
        <input data-l="${llave}" value="${esc(v)}">
        <button class="quitar">×</button></div>`).join('')}
    </div>
  </div>`;

$('#cotGuardar').addEventListener('click', async () => {
  const c = cotActual;
  if (!c.cliente || !c.titulo) return avisar('Falta el cliente o el título.', true);
  try {
    const guardada = c.id
      ? await api(`/cotizaciones/${c.id}`, { metodo: 'PUT', cuerpo: c })
      : await api('/cotizaciones', { cuerpo: c });
    cotActual.id = guardada.id;
    pintarCotizacion();
    avisar('Cotización guardada.');
  } catch (e) { avisar(e.message, true); }
});

$('#cotAEvento').addEventListener('click', async () => {
  if (!cotActual.id) return;
  if (!confirm('Crear un evento con lo cotizado como ingreso proyectado?')) return;
  const fecha = prompt('Fecha del evento (AAAA-MM-DD), opcional', '') || null;
  const r = await api(`/cotizaciones/${cotActual.id}/a-evento`, { cuerpo: { fecha } });
  avisar('Evento creado desde la cotización.');
  abrirEvento(r.evento.id);
});

// ───────────────────────────── arranque ─────────────────────────────

async function arrancar() {
  try {
    await api('/eventos');          // si no hay sesión, esto manda a la puerta
    $('#puerta').hidden = true;
    $('#panel').hidden = false;
    ver('eventos');
    cargarEventos();
  } catch { /* la puerta ya se mostró */ }
}

arrancar();
