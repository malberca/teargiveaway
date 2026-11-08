# TEAR Sorteos

Aplicación local de sorteos TEAR.

## Instagram Login local

El Worker incluye un puente OAuth para cuentas profesionales de Instagram mediante el inicio de sesión unificado de Meta. Lee los comentarios de una publicación propia accesible a la cuenta autorizada. No automatiza ni verifica likes, follows o shares.

1. En Meta for Developers, configurá Instagram API con inicio de sesión unificado. Creá una configuración General con token de usuario del sistema, cuentas de Instagram como activo requerido y permisos `instagram_basic` e `instagram_manage_comments`. Guardá su identificador en `INSTAGRAM_CONFIG_ID`.
2. Para desarrollo local, iniciá Vite en el puerto 7001 y exponelo con un túnel HTTPS. Registrá la URL `https://TU-TUNEL.trycloudflare.com/api/instagram/callback` como URI OAuth válida en Meta y usá esa misma URL en `INSTAGRAM_REDIRECT_URI`.
3. Copiá `.dev.vars.example` a `.dev.vars`, completá el App ID y el App Secret desde tu app de Meta y generá una clave aleatoria de 32 bytes en hexadecimal para `INSTAGRAM_SESSION_KEY` (por ejemplo, `openssl rand -hex 32`).
4. Ejecutá `npm run dev -- --host 127.0.0.1 --port 7001 --strictPort` y abrí la URL HTTPS del túnel. En la configuración de la app Meta, agregá la cuenta como tester y aceptá la invitación desde Instagram antes de probar el login en modo desarrollo.

El token no se entrega al frontend: el Worker lo cifra con AES-GCM y lo guarda en una cookie HttpOnly para ese navegador local. La cookie vence junto con el token de larga duración (hasta 60 días). La sesión local es individual y no persiste en una base de datos. Para producción/múltiples usuarios, mover el almacenamiento de tokens a un almacén persistente cifrado y configurar los secretos en Cloudflare antes del deploy. Este repositorio no contiene credenciales ni se realizó un deploy.

Los comentarios importados conservan duplicados. Las condiciones de seguir, dar like y compartir siguen siendo verificaciones manuales.

El flujo unificado usa graph.facebook.com y /me/assigned_instagram_accounts. Autorizá exactamente una cuenta por sesión. La sesión local vence como máximo en 24 horas. Las URL de túnel son temporales; al recrearlo, actualizá `INSTAGRAM_REDIRECT_URI` y la URI registrada en Meta.
