# UAGRM · Control de asistencia

Aplicación en tres capas con **cliente ligero y backend que se levantan por separado**. El navegador consume la API por la IP/URL configurada. El equipo backend ejecuta Node.js/Express y MySQL; el cliente no necesita MySQL ni ejecuta reglas de negocio.

## Levantar solo el cliente

Necesita Node.js 22 o superior. No requiere instalar las dependencias del backend para servir la interfaz.

```bash
cp .env.frontend.example .env.frontend
npm start
```

En `.env.frontend`, configura la dirección del equipo backend:

```dotenv
FRONTEND_HOST=0.0.0.0
FRONTEND_PORT=8080
API_BASE_URL=http://192.168.1.30:3000
```

La IP es un ejemplo: reemplázala por la real. `API_BASE_URL` contiene protocolo, IP y puerto, sin `/api`; el cliente agrega ese prefijo. Abre `http://localhost:8080` en el equipo cliente. Para otros equipos, usa `http://IP_DEL_CLIENTE:8080`. Reinicia el servidor cliente después de cambiar su configuración.

`npm start` y `npm run dev` levantan únicamente presentación. También están disponibles `npm run start:frontend` y `npm run dev:frontend`. Sin `.env.frontend`, se usan puerto 8080 y backend `http://127.0.0.1:3000`, útiles para probar dos procesos en el mismo equipo. La pantalla de acceso puede abrirse sin backend; las operaciones requieren conexión y muestran un error si no está disponible.

## Levantar negocio y datos en el equipo backend

Necesita Node.js 22 o superior y MySQL Server 8.0 o superior en ejecución. Copia la configuración y sustituye las credenciales antes de inicializar:

```bash
cp .env.backend.example .env.backend
npm install
npm run db:init
npm run start:backend
```

Ejemplo de configuración para cliente `192.168.1.20` y backend `192.168.1.30`:

```dotenv
BACKEND_HOST=0.0.0.0
PORT=3000
FRONTEND_ORIGINS=http://192.168.1.20:8080,http://localhost:8080
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=tu_clave_mysql
DB_NAME=uagrm_asistencia
ADMIN_USER=admin
ADMIN_PASSWORD=elige_una_clave_propia_de_al_menos_12_caracteres
INSTITUTION_TIMEZONE=America/La_Paz
```

`FRONTEND_ORIGINS` enumera los orígenes exactos desde los que se abre el cliente, separados por comas: protocolo, IP/nombre y puerto. Si el usuario abre la interfaz en `http://192.168.1.20:8080`, ese es el origen permitido, aunque su navegador esté en un tercer equipo. El backend debe ser accesible desde el navegador en el puerto configurado. MySQL puede permanecer en `127.0.0.1` del backend: el cliente nunca se conecta a su puerto.

El backend solo sirve `/api`; no sirve HTML/CSS/JavaScript. Para desarrollo usa `npm run dev:backend`. MySQL se inicia como servicio aparte y no se lanza desde el cliente. `.env.backend` contiene secretos y está excluido de Git. `.env.frontend` contiene solo configuración pública. En un despliegue con HTTPS, configura también la API con HTTPS.

`npm run db:init` crea la base y tablas sin borrar información. El administrador existente conserva su contraseña: cambiar la variable después de inicializar no modifica esa cuenta.

## Primera utilización y Excel

1. Ingresa como administrador y abre Nuevo módulo.
2. Descarga las plantillas y carga los estudiantes y fechas reales.
3. Importa ambos archivos, revisa los datos y confirma la activación.
4. El estudiante puede ingresar por registro o correo del módulo activo y marcar en el día programado.

Solo archivos `.xlsx`, hasta 3 MB y 5000 filas, primera hoja y encabezados en primera fila. Guarda el registro como texto para conservar ceros iniciales. Se rechazan fórmulas, campos inválidos y registros/fechas duplicados; ningún archivo se importa parcialmente.

| Estudiantes | Fechas |
|---|---|
| Número de registro | Fecha |
| Nombre completo | Hora inicio |
| Correo electrónico | Hora fin |

Fechas `DD/MM/AAAA` o `AAAA-MM-DD`; horas `HH:MM` o celdas de hora de Excel. La hora final debe ser posterior a la inicial; los horarios son informativos. Las descargas e importaciones se realizan contra la API remota con la sesión autenticada.

## Reglas y alcance

- Un módulo activo y una marca por estudiante/fecha.
- Marcas durante todo el día de clase, sin atrasos ni tolerancias; fecha/hora del backend en `America/La_Paz`.
- Fechas pasadas sin marca se muestran como Falta; hoy y fechas futuras sin registro, como Pendiente. Los estados son calculados en negocio y usados por pantalla y exportación.
- El estudiante no edita asistencias. Solo el administrador puede corregir cualquier fecha del módulo activo; se conserva la hora original y se auditan valores anterior/nuevo.
- Marcas, correcciones y auditoría se guardan en transacciones.
- Activar otro módulo exige confirmación, conserva los datos anteriores e inicia sin asistencias. No se añade consulta histórica.
- Búsquedas, filtros, totales, vista previa y exportación Excel disponibles. Actividades: hasta 500 resultados; paginación visual de 20 filas.
- Sesión de ocho horas en backend, token en `sessionStorage` del navegador. Recargar conserva la sesión en esa pestaña; cerrar la pestaña elimina su token y reiniciar el backend pierde las sesiones y borradores.
- RF-01 mantiene el ingreso estudiantil por correo o registro sin contraseña. El administrador usa contraseña propia almacenada con scrypt y salt.

## Arquitectura

```text
frontend/server.js         Servidor cliente: archivos y configuración pública
public/                    Presentación en navegador; conexión a API remota
src/presentation/app.js    Adaptador HTTP del backend: CORS, token y respuestas
src/services/              Negocio: casos de uso, permisos y reglas
src/repositories/          Datos: consultas MySQL y transacciones
src/server.js              Composición y arranque exclusivo del backend
database/schema.sql        Esquema y restricciones
scripts/init-db.js         Inicialización sin borrar datos
docs/arquitectura.md        Contratos y trazabilidad con requisitos
docs/diagramas.md          Diagramas de capas y despliegue
```

Las tres capas lógicas se despliegan en dos aplicaciones: presentación en el cliente y negocio/datos en el backend. El adaptador HTTP también es una frontera de presentación, alojada junto al negocio. Negocio no depende de Express o MySQL; recibe el repositorio por contrato. Datos no depende de negocio ni presentación. El punto de composición conecta sus implementaciones.

## Validación

```bash
npm test
npm run check
```

Las pruebas HTTP abren puertos temporales locales. Se verifican reglas con repositorio en memoria, API con servicio sustituto, arranque independiente del cliente, CORS, tokens y descargas. La prueba con MySQL real y dos equipos se describe en `docs/verificacion.md`.

Si falla la conexión, comprueba IP/puerto en `.env.frontend`, disponibilidad del backend y que el origen del cliente esté en `FRONTEND_ORIGINS`. Para errores de MySQL, revisa el servicio y `.env.backend`. Usa `npm start` para el cliente y `npm run start:backend` para la API; Live Server no configura `/config.js` ni ejecuta el backend.
