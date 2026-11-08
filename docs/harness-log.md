# Registro de trabajo — TEAR Sorteos

## Alcance

- Inicialización local de una aplicación React, Vite y TypeScript en el repositorio `malberca/teargiveaway`.
- Integración local con Cloudflare Workers mediante `@cloudflare/vite-plugin` y Wrangler.
- Primera pantalla de carga manual de comentarios, resumen de chances y sorteo local de cinco ganadores.
- Sin despliegue, cambios remotos, credenciales reales, conexión real a Instagram ni modificaciones de bases de datos.

## Decisiones

- Se usó la rama local `codex/tear-sorteos-init-2026-11-07` sobre el repositorio remoto vacío (`main`, tamaño 0 al momento de iniciar).
- Se revisó `/Users/malberca/Downloads/tear_sorteos_prototipo_v2.html` y se extrajeron su CSS y banner embebido a `src/prototype-theme.css` y `public/tear-campaign.jpg`.
- Entrada: un comentario por línea en formato `@usuario: texto @mención`. Cada línea agrega una chance y cada mención en el texto agrega otra para quien escribió el comentario. Los comentarios repetidos se acumulan.
- El sorteo toma cinco índices independientes con reemplazo mediante `crypto.getRandomValues` y rechazo de sesgo modular. Un participante puede ganar varias veces.
- La aplicación informa que la carga es manual y que no existe integración real con Instagram.
- El flujo empieza en Mis sorteos con `+ NEW`, permite configurar título, premios, reglas y duplicados, y avanza a participantes y sorteo.
- Like, follow y compartir son condiciones visibles que requieren verificación manual; el mínimo de menciones sí filtra comentarios ingresados. Se mantiene una animación de mezcla y revelado accesible con preferencia de movimiento reducido.
- La composición recupera el prototipo V2: cabecera TEAR, campaña superior, hero tipográfico, estadísticas, paneles, escenario, ranking y transparencia.
- El contenido principal usa el ancho disponible, sin ancho máximo centrado. La imagen de captura de referencia se conserva en `docs/reference/tear-web-header.png`.
- La foto de concierto enviada por el usuario se conserva como `public/tear-live-bottom.jpg` y se presenta al pie de la pantalla.
- La imagen `sooky.jpg` se usa como cabecera con Shooky recortado y transparente; el hero de inicio comparte su tono marrón: `public/shooky-cutout.png`.
- Se quitó la línea clara bajo la barra superior antes de la imagen de Shooky.
- Las imágenes de cabecera anteriores se conservaron bajo `docs/reference/` y ya no se cargan en la aplicación.

## Archivos principales

- `src/screens/App.tsx`: pantalla, resumen de participantes y resultados.
- `src/services/comments.ts`: lectura de comentarios y expansión de chances.
- `src/logic/draw.ts`: selección criptográfica con reemplazo.
- `src/prototype-theme.css`, `src/prototype-layout.css`: identidad visual del prototipo y layout full-width.
- `public/shooky-cutout.png`: recorte transparente de Shooky para la cabecera.
- `public/tear-live-bottom.jpg`: imagen de concierto enviada para el pie.
- `worker/index.ts`: endpoint `GET /api/health` y paso de assets.
- `vite.config.ts`, `wrangler.jsonc`: configuración local Workers/Vite.
- `.dev.vars.example`: plantilla sin secretos reales.

## Verificaciones

- Instalación npm: PASS (134 paquetes auditados, 0 vulnerabilidades reportadas).
- `npm run typecheck`: PASS tras agregar `tsconfig.json` y precisar el tipo del binding `ASSETS`.
- `npm run build`: PASS; generó el bundle del Worker y los assets del cliente con Vite 7.3.7.
- `npm run dev -- --host 127.0.0.1`: PASS; Vite quedó disponible en `http://127.0.0.1:5173/`.
- `GET /api/health`: PASS, HTTP 200 y `{"status":"ok","service":"tear-sorteos"}`.
- `npm run typecheck`: PASS tras alinear el flujo y los componentes con el HTML V2.
- `npm run build`: PASS; generó Worker y assets. Wrangler mostró un aviso EPERM al escribir su archivo de log en `~/Library/Preferences/.wrangler/logs`; el proceso terminó con código 0.

## Pendientes conocidos

- El formato de texto es una carga manual inicial; no obtiene ni valida comentarios de Instagram.
- Los ganadores solo viven en memoria del navegador y no constituyen un acta persistente del sorteo.
- No se configuró ni realizó ningún deploy.
- El repositorio remoto estaba vacío y aún no existe un commit inicial; los cambios quedan en la rama local indicada hasta que se autorice una futura entrega remota.
- Los sorteos no se guardan ni hay verificación automática de follows, likes o stories; esas condiciones se revisan manualmente.

## Seguimiento — 2026-11-07

- Se corrigió `assets.directory` de Wrangler a `./dist/client`, que es donde Vite genera `index.html` y copia `public/`. La ruta anterior servía el fallback de la SPA para las imágenes y hacía que se vieran como archivos faltantes.
- La configuración de cada sorteo ahora permite elegir entre 1 y 20 ganadores. El total seleccionado determina la cantidad de extracciones, el progreso, la animación, el estado final y las tarjetas de resultados. Se conserva 5 como valor inicial y el sorteo sigue permitiendo ganadores repetidos.
- Verificaciones: `git diff --check`, `npm run typecheck` y `npm run build` completados correctamente. Wrangler mostró el aviso conocido `EPERM` al escribir su archivo de log; el build finalizó con código 0 y generó los assets en `dist/client/`.
- El check de Cloudflare para el commit `7accf87` completó `npm run build`, pero falló en el deploy command `npx wrangler preview`: faltaba el bloque superior `"previews": {}` en `wrangler.jsonc`. Se agregó el bloque requerido; queda pendiente el nuevo resultado automático del check del PR.

## Seguimiento — Puente OAuth de Instagram

- Se agregó `worker/instagram.ts` con rutas locales `GET /api/instagram/connect`, `GET /api/instagram/callback`, `GET /api/instagram/status`, `POST /api/instagram/disconnect` y `POST /api/instagram/comments`.
- El login solicita `instagram_business_basic` y `instagram_business_manage_comments`, intercambia el código por token largo y obtiene el usuario y los comentarios de una publicación propia encontrada por permalink. Conserva cada comentario repetido; los requisitos de like, follow y share siguen siendo manuales.
- El token nunca vuelve al frontend: se cifra AES-GCM en el Worker y se guarda en una cookie HttpOnly SameSite=Lax con expiración. Esta entrega solo habilita sesión local de un navegador; producción/múltiples usuarios requiere almacenamiento cifrado persistente.
- Participantes incluye conectar/desconectar la cuenta y cargar comentarios desde la publicación configurada. `.dev.vars.example` lista App ID, App Secret, callback, clave de sesión y versión de Graph API sin incluir credenciales reales. README describe la configuración en Meta.
- Pendiente para probar OAuth real: configurar una app de Meta, registrar el callback, cargar sus secretos localmente y añadir la cuenta profesional como tester (o contar con el acceso requerido para cuentas externas). No se desplegó ni se tocó la configuración remota.
- Verificaciones posteriores a esta integración: `npm run typecheck` PASS. `npm run build` PASS; Wrangler reporta el aviso conocido EPERM al escribir logs en `~/Library/Preferences/.wrangler/logs` pero finaliza con código 0.
