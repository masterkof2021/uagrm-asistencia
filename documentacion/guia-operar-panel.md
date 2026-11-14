# Guía para operar el panel de Asistencia

El panel administra las instituciones. Cada institución tiene su propia aplicación de asistencia y sus propios usuarios.

## Entrar y registrar una institución

1. Pide al responsable técnico que inicie el panel en tu equipo y te entregue el usuario y la contraseña por un canal privado. Si tú preparas el equipo, sigue el [manual técnico](manual-reproduccion-ia.md#5-arrancar-el-panel-con-aws-y-registrar-un-tenant).
2. Abre [el panel local](http://127.0.0.1:4173) e inicia sesión.
3. Pulsa **Registrar tenant**. Completa nombre, identificador único, correo de contacto, entorno, plan y motor. Para practicar, usa datos ficticios, el entorno **Pruebas** y **OpenTofu**.
4. Revisa el resumen y pulsa **Guardar tenant**. En **Tenants**, localiza la institución por su nombre o identificador. El estado inicial es **Registrado**.

## Ponerla en funcionamiento

1. En su fila, pulsa **Desplegar en AWS**. El despliegue crea recursos facturables.
2. Espera a que figure **Operativo**. **Ver actividad** abre una vista lateral en la misma página con los eventos más recientes primero, colores por herramienta y resultados de escaneo cuando están habilitados. Usa el selector para consultar intentos previos y **Actividad del operador** para ver quién solicitó cada acción.
3. Si el estado es **Error**, revisa la última fase en el historial. Una vez resuelta la causa, usa la opción **Reintentar** de la misma institución. Así conservas su historial.

## Abrir la aplicación

1. En la fila de una institución operativa, localiza **Acceso por Systems Manager**. Copia su comando en una terminal preparada para AWS y añade `--profile <perfil-autorizado>` si el responsable técnico te asignó un perfil específico. Mantén esa terminal abierta.
2. Abre la dirección que muestra el panel. Si vas a trabajar con dos instituciones, usa una terminal y una pestaña por cada una. En un registro nuevo, las dos primeras direcciones son `http://127.0.0.1:8081` y `http://127.0.0.1:8082`.
3. Inicia sesión en la aplicación con las credenciales de esa institución. Como administrador de asistencia, puedes usar **Nuevo módulo** para importar los Excel de estudiantes y fechas y activar el módulo. El estudiante entra con su matrícula o correo y puede marcar en una fecha programada. Consulta y exporta los registros desde la vista de administrador.
4. Para desconectar una aplicación, cierra su túnel con `Ctrl+C` en la terminal correspondiente.

## Suspender, reanudar y retirar

- **Suspender** apaga las tres instancias y conserva los datos. El almacenamiento sigue generando costo. Usa **Reanudar** para volver a ponerlas en servicio. Cuando el estado sea **Operativo**, abre de nuevo el túnel.
- **Preparar retiro** calcula qué recursos se eliminarán. Espera a que aparezca **Revisar retiro** y comprueba el nombre de la institución y sus discos. Si hay datos que conservar, expórtalos antes. **Confirmar retiro** elimina la infraestructura y sus discos. **Cancelar retiro** descarta la revisión.
- Verifica **Retirado** y consulta el historial para confirmar el resultado. Cuando termines, pulsa **Cerrar sesión** en el panel.

Si el monitor está activo, en **Tenants** puedes consultar **Alertas activas**, los eventos recientes y **Abrir Grafana**. Si la aplicación no abre, confirma que está **Operativo** y que su terminal sigue conectada al puerto indicado.
