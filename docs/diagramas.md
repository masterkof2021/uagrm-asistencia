# Diseño y diagramas

Fuente principal: `Requerimientos_Control_Asistencia.pdf`, RF-01 a RF-15. Complementos: Node.js, MySQL, tres capas, diseño responsivo azul y rojo, ejecución local. Se implementan además vista previa, exportación y mensajes (RF-16 a RF-18).

## Arquitectura de tres capas

```mermaid
flowchart TB
 U[Estudiante o administrador] --> P
 subgraph Presentacion[1. Presentación]
 P[HTML · CSS · JavaScript en cliente] <-->|HTTP / JSON| API[Adaptador Express en backend]
 end
 subgraph Negocio[2. Negocio]
 S[Casos de uso y permisos] --> RE[Reglas: estados, fecha y habilitación]
 end
 subgraph Datos[3. Datos]
 R[Adaptador del contrato de repositorio] --> DB[(MySQL)]
 end
 API -->|Contrato de servicio inyectado| S
 S -->|Contrato de repositorio inyectado| R
 C[server.js: composición] -.-> API
 C -.-> S
 C -.-> R
```

Las flechas entre capas representan llamadas por contrato. Negocio no importa el adaptador MySQL y presentación no importa repositorios. Los estados y permisos pertenecen a negocio. Ver `arquitectura.md` para los contratos y la trazabilidad con RF/RN.

## Clases

```mermaid
classDiagram
 class Administrador {
  int id
  string username
  string passwordHash
 }
 class Modulo {
  int id
  string name
  bool active
 }
 class Estudiante {
  int id
  string registration
  string name
  string email
 }
 class FechaClase {
  int id
  date classDate
  time startTime
  time endTime
 }
 class Asistencia {
  int id
  string status
  datetime markedAt
  datetime updatedAt
 }
 class Actividad {
  int id
  string actor
  string action
  string previousValue
  string newValue
  datetime createdAt
 }
 Modulo "1" *-- "0..*" Estudiante
 Modulo "1" *-- "0..*" FechaClase
 Modulo "1" *-- "0..*" Asistencia
 Modulo "1" *-- "0..*" Actividad
 Estudiante "1" --> "0..*" Asistencia
 FechaClase "1" --> "0..*" Asistencia
 Administrador --> Actividad : genera
 Estudiante --> Actividad : genera
```

Restricciones: módulo activo único; registro único por módulo; asistencia única por estudiante/fecha; claves compuestas impiden mezclar estudiantes y fechas de distintos módulos.

## Casos de uso (representación equivalente)

```mermaid
flowchart LR
 E[Estudiante] --> ACC([Acceder por correo o registro])
 E --> MAR([Marcar asistencia hoy])
 E --> HIS([Consultar historial personal])
 A[Administrador] --> LOGIN([Acceder con credenciales])
 A --> EST([Buscar estudiantes])
 A --> ASIS([Consultar y corregir asistencias])
 A --> ACT([Consultar actividades])
 A --> IMP([Importar Excel y revisar vista previa])
 A --> MOD([Confirmar activación de módulo])
 A --> EXP([Exportar asistencias])
 E --> SAL([Cerrar sesión])
 A --> SAL
```

## Secuencia de marcación

```mermaid
sequenceDiagram
 actor E as Estudiante
 participant P as Frontend
 participant N as Node.js
 participant D as MySQL
 E->>P: Registrar asistencia
 P->>N: POST /api/attendance
 N->>D: Bloquear módulo activo y validar estudiante
 N->>N: Comprobar fecha de Bolivia
 N->>D: Consultar fecha y asistencia existente
 alt Hoy está programado y no hay registro
 N->>D: Insertar Presente y actividad en transacción
 D-->>N: Commit
 N-->>P: Confirmación con estado
 else Registro existente
 N-->>P: Devolver registro sin duplicar
 else Fecha no permitida
 N-->>P: Rechazar
 end
 P-->>E: Mostrar resultado
```

## Secuencia de corrección

```mermaid
sequenceDiagram
 actor A as Administrador
 participant P as Frontend
 participant N as Node.js
 participant D as MySQL
 A->>P: Seleccionar Presente o Falta
 P->>N: PUT /api/attendance
 N->>N: Verificar sesión y rol
 N->>D: Bloquear módulo activo
 N->>D: Validar estudiante y fecha del módulo
 N->>D: Consultar valor anterior
 N->>D: Actualizar estado y registrar actividad
 Note over N,D: Misma transacción; conserva hora de marca original
 D-->>N: Commit
 N-->>P: Resultado
 P-->>A: Estado actualizado
```

## Actividades de importación

```mermaid
flowchart TD
 I([Inicio]) --> E[Subir Excel estudiantes]
 E --> V{¿Válido?}
 V -- No --> ER[Mostrar errores por fila]
 ER --> E
 V -- Sí --> F[Subir Excel fechas]
 F --> VF{¿Válido?}
 VF -- No --> EF[Mostrar errores por fila]
 EF --> F
 VF -- Sí --> P[Vista previa y nombre del módulo]
 P --> C{¿Confirmar?}
 C -- No --> FIN([Mantener módulo actual])
 C -- Sí --> T[Transacción: desactivar anterior y crear nuevo]
 T --> A[Insertar estudiantes, fechas y actividad]
 A --> OK([Confirmar transacción])
```

## Estados de asistencia

```mermaid
stateDiagram-v2
 [*] --> Pendiente
 Pendiente --> Presente: Estudiante marca el día programado
 Pendiente --> Falta: Fecha pasada sin marca, al consultar
 Pendiente --> Presente: Administrador corrige
 Pendiente --> Falta: Administrador corrige
 Presente --> Falta: Administrador corrige
 Falta --> Presente: Administrador corrige
```

Pendiente es un estado visual, no un registro de asistencia almacenado. Falta puede ser derivada o una corrección explícita. Una corrección existente no es reemplazada por una marca estudiantil.

## Navegación

```mermaid
flowchart TD
 L[Acceso] --> E[Panel estudiante]
 L --> A[Panel administrador]
 E --> H[Mi historial]
 E --> M[Registrar asistencia de hoy]
 A --> R[Resumen]
 A --> ES[Estudiantes y búsqueda]
 A --> AS[Asistencias y filtros]
 AS --> C[Corrección]
 AS --> X[Exportar Excel]
 A --> AC[Actividades y filtros]
 A --> N[Nuevo módulo]
 N --> I[Importar archivos]
 I --> CF[Confirmar activación]
 E --> S[Cerrar sesión]
 A --> S
 S --> L
```

## Componentes

```mermaid
flowchart LR
 UI[public: interfaz] --> API[presentation/app.js: HTTP y sesiones]
 API -->|Servicio inyectado| AS[services/attendance.js: casos de uso]
 AS --> RE[services/rules.js: reglas]
 AS -->|Repositorio inyectado| RP[repositories/asistencia.js: SQL]
 RP --> CON[repositories/database.js: conexión y transacciones]
 CON --> DB[(MySQL)]
 COMP[server.js: composición] -.-> API
 COMP -.-> AS
 COMP -.-> RP
 COMP -.-> IM[imports.js: Excel]
 COMP -.-> AUTH[security.js: contraseña]
 AS -->|Funciones inyectadas| IM
 AS -->|Función inyectada| AUTH
 INIT[scripts/init-db.js] --> DB
```

## Despliegue del cliente y backend

```mermaid
flowchart LR
 subgraph Cliente[Equipo cliente · presentación]
 FS[frontend/server.js · puerto 8080] --> B[Navegador · cliente ligero]
 CFG[API_BASE_URL] --> B
 end
 subgraph Backend[Equipo backend · negocio y datos]
 API[Express · IP backend:3000] --> S[Servicios y reglas]
 S --> R[Repositorio]
 R --> MYSQL[(MySQL · 127.0.0.1:3306)]
 end
 B <-->|HTTP / JSON · Bearer · CORS| API
```

Arranque independiente: `npm start` en el cliente; servicio MySQL y `npm run start:backend` en el backend. La IP del backend se configura en `.env.frontend`; el origen del cliente se autoriza en `.env.backend`. El navegador nunca se conecta directamente a MySQL.

## Trazabilidad

| Requisitos | Implementación |
|---|---|
| RF-01, RF-02 | Acceso estudiante/admin, sesión Bearer, cierre de sesión y autorización |
| RF-03, RN-03, RN-04 | `mark`, fecha institucional, restricción única en MySQL |
| RF-04, RF-05 | Historial, Falta derivada al pasar la fecha, resumen personal |
| RF-06, RF-08 | Búsqueda, filtros, totales y listas administrativas |
| RF-07, RF-09, RF-10 | Correcciones y auditoría transaccional, consulta filtrada |
| RF-11, RF-12 | Validación de Excel completa antes de preparar datos |
| RF-13, RF-15 | Confirmación y activación transaccional sin borrar módulos anteriores |
| RF-14 | MySQL, claves foráneas y restricciones |
| RF-16 a RF-18 | Vista previa, exportación y mensajes |

No se implementa consulta histórica de módulos, múltiples módulos activos, QR, geolocalización, reconocimiento facial, notificaciones o atrasos.
