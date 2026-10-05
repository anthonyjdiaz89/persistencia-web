// La cotización, en una sola página.
//
// El formato que veníamos usando son dos páginas con la fuente de marca
// embebida: ~200 KB de HTML por propuesta, hecho a mano cada vez. Se veía
// bien, pero hacer una nueva costaba editar un archivo.
//
// Esta versión conserva lo que hacía que funcionara —marca arriba, qué
// incluye, un precio que se lee de lejos, pasos de pago con porcentajes,
// condiciones y vigencia— y suelta lo que impedía automatizarla: la fuente va
// por CDN con respaldo del sistema, el color es el de la web, y TODO el
// contenido sale de la base. Hacer una cotización para un cliente nuevo es
// llenar un formulario, no editar HTML.
//
// Sale como HTML imprimible: Ctrl+P → PDF da el archivo que se manda. Sin
// cadena de render ni dependencia de un servicio que se cae.

const pesos = (v) =>
  new Intl.NumberFormat('es-CO', {
    style: 'currency', currency: 'COP', maximumFractionDigits: 0,
  }).format(Number(v) || 0);

const esc = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const fechaLarga = (iso) => {
  if (!iso) return '';
  const [a, m, d] = String(iso).slice(0, 10).split('-');
  const meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
    'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  return `${Number(d)} de ${meses[Number(m) - 1]} de ${a}`;
};

const sumarDias = (iso, dias) => {
  const f = new Date(`${String(iso).slice(0, 10)}T12:00:00`);
  f.setDate(f.getDate() + Number(dias || 0));
  return f.toISOString().slice(0, 10);
};

export function cotizacionHTML(cot, items = []) {
  const total = items.reduce(
    (t, i) => t + (Number(i.cantidad) || 0) * (Number(i.valor_unitario) || 0), 0);

  // Con un solo ítem la tabla sobra: el precio se dice y ya. Con varios, la
  // tabla ES el argumento, porque muestra en qué se va la plata.
  const variosItems = items.length > 1;

  const filas = items.map((i) => {
    const sub = (Number(i.cantidad) || 0) * (Number(i.valor_unitario) || 0);
    return `<tr>
      <td>
        <strong>${esc(i.concepto)}</strong>
        ${i.detalle ? `<span class="detalle">${esc(i.detalle)}</span>` : ''}
      </td>
      <td class="num">${Number(i.cantidad) || 0}</td>
      <td class="num">${pesos(i.valor_unitario)}</td>
      <td class="num fuerte">${pesos(sub)}</td>
    </tr>`;
  }).join('');

  const incluye = (cot.incluye || []).map((t) => `<li>${esc(t)}</li>`).join('');
  const condiciones = (cot.condiciones || []).map((t) => `<li>${esc(t)}</li>`).join('');

  const pagos = (cot.pagos || []).map((p) => `
    <div class="paso">
      <div class="pct">${esc(p.pct)}%</div>
      <div class="cuando">${esc(p.cuando || '')}</div>
      <div class="monto">${pesos((total * (Number(p.pct) || 0)) / 100)}</div>
    </div>`).join('');

  const vence = cot.fecha ? sumarDias(cot.fecha, cot.validez_dias ?? 15) : null;

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(cot.titulo)} — ${esc(cot.cliente)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;800&display=swap" rel="stylesheet">
<style>
  /* Los colores son los de la web, no unos nuevos: una propuesta que no se
     parece al sitio del que vienes no parece de la misma casa. */
  :root{
    --bg:#060609; --elev:#0c0c14; --fg:#f4f5fa; --muted:#a8adc0; --dim:#6f7488;
    --cyan:#4deeea; --purple:#7b4de0; --linea:#1c1c28;
  }
  *{box-sizing:border-box}
  body{
    margin:0; background:var(--bg); color:var(--fg);
    font-family:'Inter',system-ui,-apple-system,'Segoe UI',sans-serif;
    font-size:14px; line-height:1.6;
    -webkit-print-color-adjust:exact; print-color-adjust:exact;
  }
  .hoja{max-width:860px; margin:0 auto; padding:48px 56px 64px}
  header{display:flex; justify-content:space-between; align-items:flex-start;
    gap:24px; padding-bottom:20px; border-bottom:1px solid var(--linea)}
  .marca{font-weight:800; letter-spacing:.14em; font-size:13px; text-transform:uppercase}
  .marca span{background:linear-gradient(90deg,var(--cyan),var(--purple));
    -webkit-background-clip:text; background-clip:text; color:transparent}
  .meta{text-align:right; font-size:12px; color:var(--dim); line-height:1.7}
  h1{font-size:28px; line-height:1.2; margin:32px 0 8px; font-weight:800; letter-spacing:-.02em}
  .para{color:var(--muted); font-size:15px; margin:0 0 4px}
  .resumen{color:var(--muted); margin:18px 0 0; max-width:62ch}
  h2{font-size:11px; letter-spacing:.18em; text-transform:uppercase;
    color:var(--dim); margin:38px 0 14px; font-weight:600}
  table{width:100%; border-collapse:collapse; font-size:13.5px}
  th{text-align:left; font-size:11px; letter-spacing:.1em; text-transform:uppercase;
    color:var(--dim); font-weight:600; padding:0 10px 10px; border-bottom:1px solid var(--linea)}
  th.num,td.num{text-align:right}
  td{padding:13px 10px; border-bottom:1px solid var(--linea); vertical-align:top}
  td .detalle{display:block; color:var(--dim); font-size:12.5px; margin-top:3px}
  .fuerte{font-weight:600; white-space:nowrap}
  .total{display:flex; justify-content:space-between; align-items:baseline;
    margin-top:26px; padding:20px 22px; background:var(--elev);
    border:1px solid var(--linea); border-radius:12px}
  .total .et{font-size:11px; letter-spacing:.18em; text-transform:uppercase; color:var(--dim)}
  .total .vl{font-size:30px; font-weight:800; letter-spacing:-.02em}
  ul{margin:0; padding-left:18px; color:var(--muted)}
  ul li{margin-bottom:7px}
  .pagos{display:flex; gap:12px; flex-wrap:wrap}
  .paso{flex:1 1 150px; background:var(--elev); border:1px solid var(--linea);
    border-radius:12px; padding:16px 18px}
  .paso .pct{font-size:22px; font-weight:800; color:var(--cyan)}
  .paso .cuando{color:var(--muted); font-size:13px; margin:2px 0 8px}
  .paso .monto{font-weight:600}
  footer{margin-top:44px; padding-top:18px; border-top:1px solid var(--linea);
    display:flex; justify-content:space-between; gap:20px;
    font-size:12px; color:var(--dim); flex-wrap:wrap}
  .vigencia{color:var(--muted)}
  @media print{
    @page{size:A4; margin:12mm}
    body{font-size:11.5pt}
    .hoja{padding:0; max-width:none}
    .paso,.total{break-inside:avoid}
    h2{margin-top:22px}
  }
  @media (max-width:640px){ .hoja{padding:28px 20px} h1{font-size:23px} }
</style>
</head>
<body>
<div class="hoja">
  <header>
    <div>
      <div class="marca"><span>Persistencia Digital</span></div>
      <div style="font-size:12px;color:var(--dim);margin-top:4px">Experiencias inmersivas</div>
    </div>
    <div class="meta">
      ${cot.numero ? `Cotización ${esc(cot.numero)}<br>` : ''}
      ${fechaLarga(cot.fecha)}
    </div>
  </header>

  <h1>${esc(cot.titulo)}</h1>
  <p class="para">Para <strong>${esc(cot.cliente)}</strong>${cot.contacto ? ` · ${esc(cot.contacto)}` : ''}</p>
  ${cot.resumen ? `<p class="resumen">${esc(cot.resumen)}</p>` : ''}

  ${variosItems ? `
  <h2>Detalle</h2>
  <table>
    <thead><tr><th>Concepto</th><th class="num">Cant.</th><th class="num">Valor unitario</th><th class="num">Total</th></tr></thead>
    <tbody>${filas}</tbody>
  </table>` : ''}

  <div class="total">
    <div>
      <div class="et">Inversión total</div>
      ${!variosItems && items[0] ? `<div style="color:var(--muted);font-size:13px;margin-top:4px">${esc(items[0].concepto)}</div>` : ''}
    </div>
    <div class="vl">${pesos(total)}</div>
  </div>

  ${incluye ? `<h2>Lo que incluye</h2><ul>${incluye}</ul>` : ''}
  ${pagos ? `<h2>Forma de pago</h2><div class="pagos">${pagos}</div>` : ''}
  ${condiciones ? `<h2>Condiciones</h2><ul>${condiciones}</ul>` : ''}

  <footer>
    <div>
      persistenciadigital.com · WhatsApp 320 733 3874<br>
      Barranquilla, Colombia
    </div>
    ${vence ? `<div class="vigencia">Esta propuesta tiene vigencia hasta el<br><strong>${fechaLarga(vence)}</strong></div>` : ''}
  </footer>
</div>
</body>
</html>`;
}

/**
 * Lo que trae una cotización nueva antes de que nadie escriba nada.
 *
 * No son ejemplos de relleno: son las condiciones que la casa ya viene
 * poniendo en sus propuestas. Se editan en el panel, pero estar ahí de
 * entrada es lo que hace que cotizar sea llenar y no redactar.
 */
export const COTIZACION_EN_BLANCO = {
  titulo: '',
  resumen: '',
  incluye: [],
  condiciones: [
    'Los valores están en pesos colombianos e incluyen IVA.',
    'La fecha del evento se bloquea con el primer pago.',
    'Cualquier alcance no descrito aquí se cotiza aparte.',
  ],
  pagos: [
    { pct: 50, cuando: 'a la firma' },
    { pct: 50, cuando: 'el día del evento' },
  ],
  validez_dias: 15,
};
