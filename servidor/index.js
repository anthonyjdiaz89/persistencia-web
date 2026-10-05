// El servidor del panel.
//
// NO sirve el sitio: de eso sigue encargándose nginx, con sus tipos MIME para
// glb/mind/wasm, su caché de 30 días y sus URLs limpias. Esa configuración ya
// está probada en producción y las experiencias AR dependen de ella — moverla
// para añadir un panel de presupuestos sería apostar el sitio vivo por una
// comodidad. Aquí solo vive /api, y nginx le pasa esas rutas.
//
// Si este proceso se cae, el sitio sigue en pie. Solo el panel deja de
// responder.

import express from 'express';
import crypto from 'node:crypto';
import { bd, baseViva } from './datos.js';
import { resumen, porCategoria } from './calculos.js';
import { exportarEvento, exportarEventos, importarEvento } from './excel.js';
import { cotizacionHTML, COTIZACION_EN_BLANCO } from './cotizacion.js';

const app = express();
const PUERTO = Number(process.env.PUERTO || 3000);
const CLAVE = process.env.CLAVE_ADMIN || '';
const SECRETO = process.env.SECRETO_SESION || crypto.randomBytes(32).toString('hex');

if (!CLAVE) {
  console.error('FALTA CLAVE_ADMIN — sin clave el panel quedaría abierto. No arranco.');
  process.exit(1);
}

app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));

// ───────────────────────────── sesión ─────────────────────────────
//
// Cookie firmada, sin base de sesiones: un solo usuario y un solo secreto.
// La firma lleva la fecha de caducidad dentro, así que una cookie vieja no
// sirve aunque alguien la guarde.

const firmar = (hasta) =>
  `${hasta}.${crypto.createHmac('sha256', SECRETO).update(String(hasta)).digest('hex')}`;

function sesionValida(cookie) {
  if (!cookie) return false;
  const [hasta, firma] = String(cookie).split('.');
  if (!hasta || !firma) return false;
  const esperada = crypto.createHmac('sha256', SECRETO).update(hasta).digest('hex');
  // timingSafeEqual exige mismo largo: una firma truncada no debe tirar excepción
  if (firma.length !== esperada.length) return false;
  if (!crypto.timingSafeEqual(Buffer.from(firma), Buffer.from(esperada))) return false;
  return Number(hasta) > Date.now();
}

const leerCookie = (req, nombre) =>
  (req.headers.cookie || '')
    .split(';')
    .map((c) => c.trim().split('='))
    .find(([k]) => k === nombre)?.[1];

app.post('/api/entrar', (req, res) => {
  const dada = String(req.body?.clave || '');
  const ok =
    dada.length === CLAVE.length &&
    crypto.timingSafeEqual(Buffer.from(dada), Buffer.from(CLAVE));
  if (!ok) {
    // Demora fija ante el fallo: hace cara la fuerza bruta sin castigar al
    // que simplemente se equivocó al teclear.
    return setTimeout(() => res.status(401).json({ error: 'Clave incorrecta' }), 700);
  }
  const hasta = Date.now() + 12 * 60 * 60 * 1000; // la jornada
  res.setHeader('Set-Cookie',
    `pd_panel=${firmar(hasta)}; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age=43200`);
  res.json({ ok: true });
});

app.post('/api/salir', (_req, res) => {
  res.setHeader('Set-Cookie', 'pd_panel=; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age=0');
  res.json({ ok: true });
});

app.get('/api/salud', async (_req, res) => {
  res.json({ ok: true, base: await baseViva() });
});

app.use('/api', (req, res, siguiente) => {
  if (sesionValida(leerCookie(req, 'pd_panel'))) return siguiente();
  res.status(401).json({ error: 'sin sesión' });
});

// ──────────────────────────── eventos ────────────────────────────

/** Trae el evento con todo lo suyo; es lo que necesita la ficha completa. */
async function eventoCompleto(id) {
  const [evento, presupuesto, movimientos, cobros] = await Promise.all([
    bd.uno('pd_eventos', id),
    bd.listar('pd_presupuesto', `evento_id=eq.${id}&order=orden,concepto`),
    bd.listar('pd_movimientos', `evento_id=eq.${id}&order=fecha.desc`),
    bd.listar('pd_cobros', `evento_id=eq.${id}&order=vence`),
  ]);
  if (!evento) return null;
  const datos = { evento, presupuesto, movimientos, cobros };
  return { ...datos, resumen: resumen(datos), categorias: porCategoria(datos, 'gasto') };
}

app.get('/api/eventos', async (_req, res, sig) => {
  try {
    const eventos = await bd.listar('pd_eventos', 'select=*&order=fecha.desc.nullslast,creado.desc');
    // Una pasada por tabla en vez de una por evento: con 50 eventos, lo otro
    // son 150 viajes a la base.
    const [pres, movs, cobs] = await Promise.all([
      bd.listar('pd_presupuesto', 'select=evento_id,tipo,cantidad,valor_unitario'),
      bd.listar('pd_movimientos', 'select=evento_id,tipo,valor'),
      bd.listar('pd_cobros', 'select=evento_id,valor,pagado,vence'),
    ]);
    const por = (filas) => filas.reduce((m, f) => {
      (m[f.evento_id] ||= []).push(f); return m;
    }, {});
    const [p, m, c] = [por(pres), por(movs), por(cobs)];
    res.json(eventos.map((evento) => ({
      ...evento,
      resumen: resumen({
        presupuesto: p[evento.id] || [], movimientos: m[evento.id] || [], cobros: c[evento.id] || [],
      }),
    })));
  } catch (e) { sig(e); }
});

app.get('/api/eventos/:id', async (req, res, sig) => {
  try {
    const todo = await eventoCompleto(req.params.id);
    todo ? res.json(todo) : res.status(404).json({ error: 'ese evento no existe' });
  } catch (e) { sig(e); }
});

app.post('/api/eventos', async (req, res, sig) => {
  try { res.json(await bd.crear('pd_eventos', req.body)); } catch (e) { sig(e); }
});

app.put('/api/eventos/:id', async (req, res, sig) => {
  try {
    res.json(await bd.actualizar('pd_eventos', req.params.id,
      { ...req.body, actualizado: new Date().toISOString() }));
  } catch (e) { sig(e); }
});

app.delete('/api/eventos/:id', async (req, res, sig) => {
  try { await bd.borrar('pd_eventos', req.params.id); res.json({ ok: true }); } catch (e) { sig(e); }
});

// ────────────── líneas, movimientos y cobros: mismo trato ──────────────

const TABLAS = {
  presupuesto: 'pd_presupuesto',
  movimientos: 'pd_movimientos',
  cobros: 'pd_cobros',
};

app.post('/api/:cosa(presupuesto|movimientos|cobros)', async (req, res, sig) => {
  try { res.json(await bd.crear(TABLAS[req.params.cosa], req.body)); } catch (e) { sig(e); }
});

app.put('/api/:cosa(presupuesto|movimientos|cobros)/:id', async (req, res, sig) => {
  try { res.json(await bd.actualizar(TABLAS[req.params.cosa], req.params.id, req.body)); }
  catch (e) { sig(e); }
});

app.delete('/api/:cosa(presupuesto|movimientos|cobros)/:id', async (req, res, sig) => {
  try { await bd.borrar(TABLAS[req.params.cosa], req.params.id); res.json({ ok: true }); }
  catch (e) { sig(e); }
});

// ───────────────────────────── Excel ─────────────────────────────

const nombreArchivo = (s) =>
  String(s || 'evento').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();

app.get('/api/eventos/:id/excel', async (req, res, sig) => {
  try {
    const todo = await eventoCompleto(req.params.id);
    if (!todo) return res.status(404).json({ error: 'ese evento no existe' });
    const buffer = await exportarEvento(todo);
    res.setHeader('Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition',
      `attachment; filename="${nombreArchivo(todo.evento.nombre)}.xlsx"`);
    res.send(buffer);
  } catch (e) { sig(e); }
});

app.get('/api/excel', async (_req, res, sig) => {
  try {
    const eventos = await bd.listar('pd_eventos', 'select=*&order=fecha.desc.nullslast');
    const filas = [];
    for (const e of eventos) {
      const todo = await eventoCompleto(e.id);
      if (todo) filas.push({ evento: todo.evento, resumen: todo.resumen });
    }
    const buffer = await exportarEventos(filas);
    res.setHeader('Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="eventos-persistencia.xlsx"');
    res.send(buffer);
  } catch (e) { sig(e); }
});

/**
 * Importa un libro contra un evento.
 *
 * `?reemplazar=1` borra lo que hubiera antes en las hojas que traiga el libro.
 * Sin eso, suma. Por defecto SUMA: borrar es lo irreversible, y un clic
 * distraído no debería vaciar un presupuesto.
 */
app.post('/api/eventos/:id/excel',
  express.raw({ type: '*/*', limit: '20mb' }),
  async (req, res, sig) => {
    try {
      const evento = await bd.uno('pd_eventos', req.params.id);
      if (!evento) return res.status(404).json({ error: 'ese evento no existe' });

      const { presupuesto, movimientos, cobros, avisos } = await importarEvento(req.body);
      const reemplazar = req.query.reemplazar === '1';
      const metidas = {};

      const guardar = async (tabla, filas, clave) => {
        if (!filas) return;                         // hoja ausente: no se toca nada
        if (reemplazar) await bd.borrarPorEvento(tabla, evento.id);
        const conEvento = filas.map((f) => ({ ...f, evento_id: evento.id }));
        await bd.crearVarias(tabla, conEvento);
        metidas[clave] = conEvento.length;
      };

      await guardar('pd_presupuesto', presupuesto, 'presupuesto');
      await guardar('pd_movimientos', movimientos, 'movimientos');
      await guardar('pd_cobros', cobros, 'cobros');

      res.json({ ok: true, metidas, avisos, reemplazo: reemplazar });
    } catch (e) { sig(e); }
  });

// ─────────────────────────── cotizaciones ───────────────────────────

app.get('/api/cotizaciones', async (_req, res, sig) => {
  try {
    res.json(await bd.listar('pd_cotizaciones', 'select=*&order=fecha.desc,creado.desc'));
  } catch (e) { sig(e); }
});

app.get('/api/cotizaciones/nueva', (_req, res) => res.json(COTIZACION_EN_BLANCO));

app.get('/api/cotizaciones/:id', async (req, res, sig) => {
  try {
    const [cot, items] = await Promise.all([
      bd.uno('pd_cotizaciones', req.params.id),
      bd.listar('pd_cotizacion_items', `cotizacion_id=eq.${req.params.id}&order=orden`),
    ]);
    cot ? res.json({ ...cot, items }) : res.status(404).json({ error: 'no existe' });
  } catch (e) { sig(e); }
});

/** Crea o reemplaza: la cotización llega entera con sus ítems. */
async function guardarCotizacion(id, cuerpo) {
  const { items = [], ...cab } = cuerpo;
  const cot = id
    ? await bd.actualizar('pd_cotizaciones', id, cab)
    : await bd.crear('pd_cotizaciones', cab);
  await bd.listar('pd_cotizacion_items', `cotizacion_id=eq.${cot.id}&select=id`)
    .then((v) => Promise.all(v.map((f) => bd.borrar('pd_cotizacion_items', f.id))));
  await bd.crearVarias('pd_cotizacion_items',
    items.map((i, n) => ({ ...i, cotizacion_id: cot.id, orden: n })));
  return cot;
}

app.post('/api/cotizaciones', async (req, res, sig) => {
  try { res.json(await guardarCotizacion(null, req.body)); } catch (e) { sig(e); }
});

app.put('/api/cotizaciones/:id', async (req, res, sig) => {
  try { res.json(await guardarCotizacion(req.params.id, req.body)); } catch (e) { sig(e); }
});

app.delete('/api/cotizaciones/:id', async (req, res, sig) => {
  try { await bd.borrar('pd_cotizaciones', req.params.id); res.json({ ok: true }); }
  catch (e) { sig(e); }
});

/** La propuesta lista para imprimir. Ctrl+P → PDF y se manda. */
app.get('/api/cotizaciones/:id/html', async (req, res, sig) => {
  try {
    const [cot, items] = await Promise.all([
      bd.uno('pd_cotizaciones', req.params.id),
      bd.listar('pd_cotizacion_items', `cotizacion_id=eq.${req.params.id}&order=orden`),
    ]);
    if (!cot) return res.status(404).send('no existe');
    res.type('html').send(cotizacionHTML(cot, items));
  } catch (e) { sig(e); }
});

/**
 * De cotización aprobada a evento con presupuesto.
 *
 * Es el paso que en la práctica se hacía copiando a mano, y donde se perdían
 * los números: lo cotizado entra como el INGRESO proyectado del evento, que es
 * exactamente lo que es.
 */
app.post('/api/cotizaciones/:id/a-evento', async (req, res, sig) => {
  try {
    const [cot, items] = await Promise.all([
      bd.uno('pd_cotizaciones', req.params.id),
      bd.listar('pd_cotizacion_items', `cotizacion_id=eq.${req.params.id}&order=orden`),
    ]);
    if (!cot) return res.status(404).json({ error: 'no existe' });

    const evento = await bd.crear('pd_eventos', {
      nombre: cot.titulo, cliente: cot.cliente, estado: 'confirmado',
      fecha: req.body?.fecha || null,
      notas: `Desde la cotización ${cot.numero || cot.id}`,
    });
    await bd.crearVarias('pd_presupuesto', items.map((i, n) => ({
      evento_id: evento.id, tipo: 'ingreso', categoria: 'cotizado',
      concepto: i.concepto, cantidad: i.cantidad, valor_unitario: i.valor_unitario,
      nota: i.detalle || null, orden: n,
    })));
    await bd.actualizar('pd_cotizaciones', cot.id, { estado: 'aprobada', evento_id: evento.id });
    res.json({ ok: true, evento });
  } catch (e) { sig(e); }
});

// ──────────────────────────── errores ────────────────────────────
//
// Se devuelve el motivo real. Un "error al guardar" obliga a abrir los logs
// del servidor para saber que faltaba un campo.

app.use((err, _req, res, _sig) => {
  console.error('[panel]', err?.message || err);
  res.status(err?.estado && err.estado < 500 ? err.estado : 500)
    .json({ error: String(err?.message || err).slice(0, 600) });
});

// En producción el panel lo sirve nginx como archivos estáticos; esto es para
// poder levantarlo entero en una sola máquina sin montar nginx:
//   SERVIR_ADMIN=1 node index.js
if (process.env.SERVIR_ADMIN === '1') {
  app.use('/admin', express.static(new URL('../admin', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')));
  app.get('/', (_req, res) => res.redirect('/admin/'));
}

app.listen(PUERTO, process.env.SERVIR_ADMIN === '1' ? '0.0.0.0' : '127.0.0.1', () =>
  console.log(`[panel] escuchando en 127.0.0.1:${PUERTO}`));
