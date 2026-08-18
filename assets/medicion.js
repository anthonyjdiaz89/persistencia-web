// Medición centralizada del sitio. UN solo lugar para conectar todo:
// 1) Pixel de Meta: pegar el ID en PD_PIXEL_ID y redesplegar — nada más.
// 2) Vercel Web Analytics: se activa con el toggle del dashboard (Analytics),
//    el script se inyecta solo; este archivo no necesita cambios para eso.
(function () {
  var PD_PIXEL_ID = '1637889434357483'; // Pixel Persistencia Digital (creado por API 2026-08-18)

  if (PD_PIXEL_ID) {
    !(function (f, b, e, v, n, t, s) {
      if (f.fbq) return;
      n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); };
      if (!f._fbq) f._fbq = n;
      n.push = n; n.loaded = !0; n.version = '2.0'; n.queue = [];
      t = b.createElement(e); t.async = !0; t.src = v;
      s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s);
    })(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
    fbq('init', PD_PIXEL_ID);
    fbq('track', 'PageView');
    // conversión: cualquier clic hacia WhatsApp cuenta como Lead
    document.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('a[href*="wa.me"]');
      if (a) fbq('track', 'Lead');
    });
  }
})();
