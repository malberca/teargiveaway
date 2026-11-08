# TEAR Sorteos

Aplicación local de sorteos TEAR.

## Instagram Login local

El Worker incluye un puente OAuth para cuentas profesionales de Instagram mediante el inicio de sesión unificado de Meta. Lee los comentarios de una publicación propia accesible a la cuenta autorizada. No automatiza ni verifica likes, follows o shares.

1. En Meta for Developers, configurá Instagram API con inicio de sesión unificado. Creá una configuración General con token de usuario del sistema, cuentas de Instagram como activo requerido y permisos `instagram_basic` e `instagram_manage_comments`. Guardá su identificador en `INSTAGRAM_CONFIG_ID`.
2. Para desarrollo local, iniciá Vite en el puerto 7001 y exponelo con un túnel HTTPS. Registrá la URL `https://TU-TUNEL.trycloudflare.com/api/instagram/callback` como URI OAuth válida en Meta y usá esa misma URL en `INSTAGRAM_REDIRECT_URI`.
3. Copiá `.dev.vars.example` a `.dev.vars`, completá el App ID y el App Secret desde tu app de Meta y generá una clave aleatoria de 32 bytes en hexadecimal para `INSTAGRAM_SESSION_KEY` (por ejemplo, `openssl rand -hex 32`).
4. Ejecutá `npm run dev -- --host 127.0.0.1 --port 7001 --strictPort` y abrí la URL HTTPS del túnel. En la configuración de la app Meta, agregá la cuenta como tester y aceptá la invitación desde Instagram antes de probar el login en modo desarrollo.

El token no se entrega al frontend: el Worker lo cifra con AES-GCM y lo guarda en una cookie HttpOnly para ese navegador local. La sesión local vence como máximo en 24 horas, aunque el token de Meta dure más. La sesión local es individual y no persiste en una base de datos. Para producción/múltiples usuarios, mover el almacenamiento de tokens a un almacén persistente cifrado y configurar los secretos en Cloudflare antes del deploy. Este repositorio no contiene credenciales ni se realizó un deploy.

### Si Meta autoriza pero no devuelve ninguna cuenta (`assigned_instagram_accounts=ok(0)`)

El panel de la app ofrece "API setup with Unified login" (el que recomienda Meta: no exige Página de Facebook, pide un portfolio y entrega un token de usuario del sistema). Según la documentación oficial de Meta, la cuenta de Instagram se descubre con `GET /me/assigned_instagram_accounts`, que es lo que hace el callback. Si devuelve 0 aunque la autorización haya terminado, a la cuenta le falta quedar **asignada al usuario del sistema de la integración** en la configuración del negocio:

1. En la Configuración del negocio del portfolio, *Cuentas > Cuentas de Instagram*: la cuenta profesional tiene que figurar dentro del portfolio.
2. En *Usuarios > Usuarios del sistema*: abrir el usuario que Meta creó para la app y verificar en *Activos asignados* que la cuenta esté asignada con control total. Si no está, asignarla.
3. Repetir el login una sola vez.

Alternativa: el modo "Instagram API con inicio de sesión de Instagram" (Business Login for Instagram). El código lo soporta y se activa si `.dev.vars` tiene `INSTAGRAM_LOGIN_APP_ID` e `INSTAGRAM_LOGIN_APP_SECRET`, pero solo sirve si el panel de la app ofrece "API setup with Instagram login" (en la app `shooky_giveaway` no aparece en el menú, solo el unificado y el de Facebook). Pide `instagram_business_basic` e `instagram_business_manage_comments`.

Los comentarios importados conservan duplicados. Las condiciones de seguir, dar like y compartir siguen siendo verificaciones manuales.

El flujo unificado usa graph.facebook.com. En este login el intercambio de código no devuelve la cuenta de Instagram, así que el callback (`worker/instagramAccount.ts`) la busca por los caminos documentados de Meta: `user_id` del intercambio, `debug_token` con `granular_scopes` (los activos que el usuario eligió), `/me/accounts` con `instagram_business_account` y `/me/assigned_instagram_accounts`. Si encuentra una sola cuenta, la usa; si encuentra varias, usa la que figura en los activos elegidos. Si no puede decidir, el mensaje de error dice cuántas cuentas devolvió Meta y qué resultado dio cada camino (sin tokens). Las URL de túnel son temporales; al recrearlo, actualizá `INSTAGRAM_REDIRECT_URI` y la URI registrada en Meta.

Pruebas: `npm test` (resolución de la cuenta con respuestas simuladas de Meta, sin credenciales).
