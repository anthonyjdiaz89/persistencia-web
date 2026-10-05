# El sitio lo sigue sirviendo nginx; Node solo atiende /api del panel.
#
# Dos procesos en un contenedor, a propósito: la configuración de nginx ya
# está probada en producción —los tipos MIME de glb/mind/wasm que necesitan
# las experiencias AR, la caché de 30 días, las URLs limpias— y mover el sitio
# entero a Node para añadir un panel de presupuestos sería apostar lo que
# funciona por una comodidad. Si el panel se cae, el sitio sigue en pie.

FROM node:22-alpine

RUN apk add --no-cache nginx

# Las dependencias primero: así una edición del sitio no obliga a reinstalar.
WORKDIR /app
COPY servidor/package.json servidor/package-lock.json* ./
RUN npm ci --omit=dev 2>/dev/null || npm install --omit=dev

COPY servidor/ /app/
COPY . /usr/share/nginx/html
COPY nginx.conf /etc/nginx/http.d/default.conf

# Lo que no debe quedar publicado dentro de la raíz web.
RUN rm -rf /usr/share/nginx/html/Dockerfile \
           /usr/share/nginx/html/nginx.conf \
           /usr/share/nginx/html/servidor \
           /usr/share/nginx/html/admin/esquema.sql

EXPOSE 80

# Sin script .sh: un archivo con finales de línea CRLF no arranca dentro del
# contenedor, y ya costó una vez en otro proyecto de la casa.
CMD ["sh", "-c", "node /app/index.js & exec nginx -g 'daemon off;'"]
