// Excel de ida y de vuelta.
//
// El mismo libro que se descarga se puede volver a subir. Eso no es un lujo:
// un presupuesto se arma a cuatro manos en una hoja de cálculo y después
// alguien lo tiene que meter al sistema. Si la importación no acepta lo que la
// exportación produjo, nadie la usa.
//
// REGLA: la importación NUNCA calla un error. Toda fila que no entró sale
// nombrada en los avisos, con su número de fila. Una importación que dice
// "listo" y se comió tres líneas es peor que una que falla entera.

import ExcelJS from 'exceljs';
import { totalLinea, resumen as calcularResumen, porCategoria } from './calculos.js';

const MARCA = { argb: 'FF0B0F1A' };
const TINTA = { argb: 'FFFFFFFF' };

const sinTildes = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/** Sinónimos aceptados por columna. Se es generoso al leer y estricto al escribir. */
const COLUMNAS = {
  tipo: ['tipo'],
  categoria: ['categoria', 'rubro', 'area'],
  concepto: ['concepto', 'descripcion', 'detalle', 'item'],
  cantidad: ['cantidad', 'cant', 'qty'],
  valor_unitario: ['valor unitario', 'valor unit', 'unitario', 'precio', 'vr unitario'],
  valor: ['valor', 'total', 'monto', 'importe'],
  proveedor: ['proveedor', 'tercero'],
  nota: ['nota', 'notas', 'observacion', 'observaciones'],
  fecha: ['fecha'],
  comprobante: ['comprobante', 'factura', 'soporte'],
  pagado: ['pagado', 'abonado'],
  fecha_factura: ['fecha factura', 'facturado el'],
  vence: ['vence', 'vencimiento', 'fecha vencimiento'],
  fecha_pago: ['fecha pago', 'pagado el'],
  medio: ['medio', 'forma de pago', 'metodo'],
};

function mapaDeCabeceras(fila) {
  const mapa = {};
  fila.eachCell((celda, i) => {
    const txt = sinTildes(celda.value);
    for (const [campo, nombres] of Object.entries(COLUMNAS)) {
      if (nombres.includes(txt)) mapa[campo] = i;
    }
  });
  return mapa;
}

const leerNumero = (v) => {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'object' && v.result != null) return Number(v.result) || 0; // fórmula
  // "1.250.000" y "1,250,000" y "$ 1.250.000" entran igual
  const limpio = String(v).replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.');
  return Number(limpio) || 0;
};

const leerTexto = (v) => {
  if (v == null) return '';
  if (typeof v === 'object') return String(v.text ?? v.result ?? '').trim();
  return String(v).trim();
};

const leerFecha = (v) => {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const t = leerTexto(v);
  const m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[0];
  const d = new Date(t);
  return isNaN(d) ? null : d.toISOString().slice(0, 10);
};

// ───────────────────────────── exportar ─────────────────────────────

function encabezar(hoja, titulos, anchos) {
  hoja.columns = titulos.map((t, i) => ({ header: t, key: `c${i}`, width: anchos[i] }));
  const fila = hoja.getRow(1);
  fila.font = { bold: true, color: TINTA };
  fila.fill = { type: 'pattern', pattern: 'solid', fgColor: MARCA };
  fila.alignment = { vertical: 'middle' };
  fila.height = 22;
  hoja.views = [{ state: 'frozen', ySplit: 1 }];
}

const MONEDA = '"$"#,##0;[Red]-"$"#,##0';

export async function exportarEvento(datos) {
  const { evento, presupuesto = [], movimientos = [], cobros = [] } = datos;
  const r = calcularResumen(datos);
  const libro = new ExcelJS.Workbook();
  libro.creator = 'Persistencia Digital';
  libro.created = new Date();

  // ── Resumen ──
  const res = libro.addWorksheet('Resumen');
  res.columns = [{ width: 32 }, { width: 20 }, { width: 20 }, { width: 20 }];
  res.addRow([evento.nombre || 'Evento']).font = { bold: true, size: 16 };
  res.addRow([`${evento.cliente || ''}${evento.sede ? ' · ' + evento.sede : ''}${evento.fecha ? ' · ' + evento.fecha : ''}`]);
  res.addRow([]);
  res.addRow(['', 'Proyectado', 'Real', 'Diferencia']).font = { bold: true };
  const linea = (nombre, plan, real) => {
    const f = res.addRow([nombre, plan, real, real - plan]);
    [2, 3, 4].forEach((i) => (f.getCell(i).numFmt = MONEDA));
    return f;
  };
  linea('Ingresos', r.ingresoPlan, r.ingresoReal);
  linea('Gastos', r.gastoPlan, r.gastoReal);
  const fu = linea('Utilidad', r.utilidadPlan, r.utilidadReal);
  fu.font = { bold: true };
  const fm = res.addRow([
    'Margen',
    r.margenPlan,
    r.margenReal,
    r.margenReal - r.margenPlan,
  ]);
  [2, 3, 4].forEach((i) => (fm.getCell(i).numFmt = '0.0%'));
  res.addRow([]);
  res.addRow(['Cartera']).font = { bold: true };
  [['Facturado', r.facturado], ['Pagado', r.pagado], ['Por cobrar', r.porCobrar], ['Vencido', r.vencido]]
    .forEach(([n, v]) => {
      const f = res.addRow([n, v]);
      f.getCell(2).numFmt = MONEDA;
    });

  res.addRow([]);
  res.addRow(['Gasto por categoría']).font = { bold: true };
  res.addRow(['Categoría', 'Proyectado', 'Real', 'Desviación']).font = { bold: true };
  porCategoria(datos, 'gasto').forEach((c) => {
    const f = res.addRow([
      c.categoria + (c.sinPresupuestar ? '  (sin presupuestar)' : ''),
      c.plan,
      c.real,
      c.desviacion,
    ]);
    [2, 3, 4].forEach((i) => (f.getCell(i).numFmt = MONEDA));
  });

  // ── Presupuesto ──
  const pre = libro.addWorksheet('Presupuesto');
  encabezar(pre, ['Tipo', 'Categoría', 'Concepto', 'Cantidad', 'Valor unitario', 'Total', 'Proveedor', 'Nota'],
    [10, 18, 42, 10, 16, 16, 22, 30]);
  presupuesto.forEach((l) => {
    const f = pre.addRow([l.tipo, l.categoria || '', l.concepto, Number(l.cantidad) || 0,
      Number(l.valor_unitario) || 0, totalLinea(l), l.proveedor || '', l.nota || '']);
    f.getCell(5).numFmt = MONEDA;
    f.getCell(6).numFmt = MONEDA;
  });

  // ── Real ──
  const mov = libro.addWorksheet('Real');
  encabezar(mov, ['Fecha', 'Tipo', 'Categoría', 'Concepto', 'Valor', 'Proveedor', 'Comprobante', 'Nota'],
    [12, 10, 18, 42, 16, 22, 18, 30]);
  movimientos.forEach((m) => {
    const f = mov.addRow([m.fecha || '', m.tipo, m.categoria || '', m.concepto,
      Number(m.valor) || 0, m.proveedor || '', m.comprobante || '', m.nota || '']);
    f.getCell(5).numFmt = MONEDA;
  });

  // ── Cobros ──
  const cob = libro.addWorksheet('Cobros');
  encabezar(cob, ['Concepto', 'Valor', 'Pagado', 'Saldo', 'Fecha factura', 'Vence', 'Fecha pago', 'Medio', 'Nota'],
    [38, 16, 16, 16, 14, 12, 14, 16, 28]);
  cobros.forEach((c) => {
    const f = cob.addRow([c.concepto, Number(c.valor) || 0, Number(c.pagado) || 0,
      (Number(c.valor) || 0) - (Number(c.pagado) || 0), c.fecha_factura || '', c.vence || '',
      c.fecha_pago || '', c.medio || '', c.nota || '']);
    [2, 3, 4].forEach((i) => (f.getCell(i).numFmt = MONEDA));
  });

  return Buffer.from(await libro.xlsx.writeBuffer());
}

/** Una fila por evento, para ver la temporada entera de un vistazo. */
export async function exportarEventos(filas) {
  const libro = new ExcelJS.Workbook();
  libro.creator = 'Persistencia Digital';
  const h = libro.addWorksheet('Eventos');
  encabezar(h, ['Evento', 'Cliente', 'Fecha', 'Estado', 'Ingreso proy.', 'Gasto proy.',
    'Utilidad proy.', 'Margen proy.', 'Ingreso real', 'Gasto real', 'Utilidad real',
    'Facturado', 'Pagado', 'Por cobrar'],
    [34, 22, 12, 12, 15, 15, 15, 12, 15, 15, 15, 15, 15, 15]);
  filas.forEach(({ evento, resumen: r }) => {
    const f = h.addRow([evento.nombre, evento.cliente || '', evento.fecha || '', evento.estado,
      r.ingresoPlan, r.gastoPlan, r.utilidadPlan, r.margenPlan,
      r.ingresoReal, r.gastoReal, r.utilidadReal, r.facturado, r.pagado, r.porCobrar]);
    [5, 6, 7, 9, 10, 11, 12, 13, 14].forEach((i) => (f.getCell(i).numFmt = MONEDA));
    f.getCell(8).numFmt = '0.0%';
  });
  return Buffer.from(await libro.xlsx.writeBuffer());
}

// ───────────────────────────── importar ─────────────────────────────

/**
 * Lee un libro y devuelve lo que entendió, más la lista de lo que NO.
 *
 * Acepta el libro que exporta este mismo panel y también una hoja armada a
 * mano, siempre que la primera fila tenga cabeceras reconocibles. Si una hoja
 * no trae cabeceras, se dice; no se adivina por posición de columna, que es
 * como se cuelan los datos en la casilla equivocada.
 */
export async function importarEvento(buffer) {
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.load(buffer);

  const avisos = [];
  const sacar = (nombres, leerFila) => {
    const hoja = libro.worksheets.find((h) => nombres.includes(sinTildes(h.name)));
    if (!hoja) return null; // hoja ausente: no es error, simplemente no se toca
    const cab = mapaDeCabeceras(hoja.getRow(1));
    if (!Object.keys(cab).length) {
      avisos.push(`Hoja "${hoja.name}": no reconocí ninguna cabecera en la fila 1, así que no importé nada de ahí.`);
      return null;
    }
    const filas = [];
    hoja.eachRow((fila, n) => {
      if (n === 1) return;
      const v = (campo) => (cab[campo] ? fila.getCell(cab[campo]).value : null);
      const salida = leerFila(v, n, avisos, hoja.name);
      if (salida) filas.push(salida);
    });
    return filas;
  };

  const tipoValido = (t, n, avisos, hoja, porDefecto) => {
    const x = sinTildes(t);
    if (x === 'ingreso' || x === 'gasto') return x;
    if (!x) return porDefecto;
    avisos.push(`Hoja "${hoja}", fila ${n}: tipo "${t}" no es ingreso ni gasto — la dejé fuera.`);
    return null;
  };

  const presupuesto = sacar(['presupuesto', 'proyectado', 'plan'], (v, n, av, hoja) => {
    const concepto = leerTexto(v('concepto'));
    if (!concepto) return null;
    const tipo = tipoValido(leerTexto(v('tipo')), n, av, hoja, 'gasto');
    if (!tipo) return null;
    let unitario = leerNumero(v('valor_unitario'));
    const cantidad = leerNumero(v('cantidad')) || 1;
    // Si solo vino el total, se reparte: es lo que hace una hoja hecha a mano.
    if (!unitario) {
      const total = leerNumero(v('valor'));
      if (total) unitario = total / cantidad;
    }
    return {
      tipo, concepto, categoria: leerTexto(v('categoria')) || null,
      cantidad, valor_unitario: unitario,
      proveedor: leerTexto(v('proveedor')) || null, nota: leerTexto(v('nota')) || null,
      orden: n,
    };
  });

  const movimientos = sacar(['real', 'ejecutado', 'gastos reales', 'movimientos'], (v, n, av, hoja) => {
    const concepto = leerTexto(v('concepto'));
    if (!concepto) return null;
    const tipo = tipoValido(leerTexto(v('tipo')), n, av, hoja, 'gasto');
    if (!tipo) return null;
    const valor = leerNumero(v('valor')) || leerNumero(v('valor_unitario'));
    if (!valor) {
      av.push(`Hoja "${hoja}", fila ${n}: "${concepto}" sin valor — la dejé fuera.`);
      return null;
    }
    return {
      tipo, concepto, categoria: leerTexto(v('categoria')) || null, valor,
      fecha: leerFecha(v('fecha')) || new Date().toISOString().slice(0, 10),
      proveedor: leerTexto(v('proveedor')) || null,
      comprobante: leerTexto(v('comprobante')) || null,
      nota: leerTexto(v('nota')) || null,
    };
  });

  const cobros = sacar(['cobros', 'cartera', 'facturacion'], (v, n, av, hoja) => {
    const concepto = leerTexto(v('concepto'));
    if (!concepto) return null;
    const valor = leerNumero(v('valor'));
    if (!valor) {
      av.push(`Hoja "${hoja}", fila ${n}: "${concepto}" sin valor facturado — la dejé fuera.`);
      return null;
    }
    return {
      concepto, valor, pagado: leerNumero(v('pagado')),
      fecha_factura: leerFecha(v('fecha_factura')),
      vence: leerFecha(v('vence')),
      fecha_pago: leerFecha(v('fecha_pago')),
      medio: leerTexto(v('medio')) || null,
      nota: leerTexto(v('nota')) || null,
    };
  });

  if (!presupuesto && !movimientos && !cobros) {
    avisos.push('No encontré ninguna hoja llamada Presupuesto, Real o Cobros. Descarga el Excel del panel y usa ese libro como molde.');
  }

  return { presupuesto, movimientos, cobros, avisos };
}
