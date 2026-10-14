# Verificación de la separación de capas

- 24 pruebas aprobadas: 10 originales (reglas, contraseña e importación Excel), 8 casos de uso, 2 de límites arquitectónicos, 2 de HTTP/cliente y 2 de comportamiento del cliente.
- Casos de uso probados con repositorio en memoria: acceso activo, roles, estados derivados, habilitación, marca única, hora original, auditoría, corrección de fechas pasadas, activación confirmada, conservación histórica e invalidación de acceso al módulo anterior.
- Rollback verificado en el repositorio de prueba ante fallo de auditoría o inserción durante activación.
- Adaptador HTTP probado con servicio sustituto: CORS permitido/rechazado, OPTIONS, token Bearer, dashboard, descargas, traducción de errores y cierre de sesión.
- `npm run check`: sintaxis de composición, presentación, negocio, datos y frontend.
- No se modificó el esquema ni se ejecutó inicialización/migración de datos.

Ejecutar `npm test` y `npm run check`. La prueba HTTP abre un puerto temporal en `127.0.0.1`; el entorno debe permitir conexiones locales.

## Pendiente: integración real con MySQL

No se dispone de una conexión MySQL configurada en este proyecto. No se afirma haber verificado bloqueos, rollback o restricciones contra una base real. Configure `.env.backend`, inicialice con `npm run db:init` e inicie con `npm run start:backend`. Configure `.env.frontend` con la IP del backend e inicie el cliente con `npm start`.

1. Importe estudiantes y fechas de ayer, hoy y mañana. Compruebe Falta/Pendiente y botón habilitado solo hoy sin registro.
2. Marque hoy y repita la solicitud: una sola asistencia y una sola actividad.
3. Corrija desde administración, incluida una fecha pasada. Verifique valores anterior/nuevo y conservación de hora original.
4. Compruebe historial, filtros, totales y que el Excel exportado coincida con los estados de pantalla.
5. Active otro módulo con confirmación. Compruebe que inicia sin marcas y los datos anteriores siguen almacenados. El estudiante anterior debe volver a ingresar.
6. Reinicie Node.js: los datos persisten, la sesión y borradores de importación deben prepararse nuevamente.

La verificación visual previa de la pantalla de acceso consta en las capturas existentes en `tmp/`; no constituye una prueba visual de los flujos modificados en esta refactorización.

## Prueba de despliegue en dos equipos

1. Backend: MySQL local en ejecución, `.env.backend` configurado y API en `0.0.0.0:3000`.
2. Cliente: `.env.frontend` con `API_BASE_URL=http://IP_BACKEND:3000`, servidor de archivos en 8080 y navegador abierto en la URL del cliente.
3. Autorice esa URL exacta en `FRONTEND_ORIGINS` del backend y reinícielo.
4. Compruebe ingreso, importación y descargas de plantillas/exportación, marcación y corrección.
5. Detenga el backend: el cliente continúa sirviendo la interfaz, pero las operaciones muestran error de conexión. Reinicie la API e ingrese nuevamente.

Estas pruebas no se han ejecutado en dos equipos físicos ni contra MySQL real. Las pruebas automatizadas usan puertos separados locales y contratos sustitutos.
