const formulario = document.getElementById('acceso');
formulario.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  const boton = formulario.querySelector('button');
  const mensaje = document.getElementById('error-acceso');
  boton.disabled = true;
  mensaje.textContent = '';
  try {
    const respuesta = await fetch('/api/sesion', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.fromEntries(new FormData(formulario))),
    });
    if (respuesta.ok) {
      location.reload();
      return;
    }
    mensaje.textContent = (await respuesta.json()).mensaje;
  } catch {
    mensaje.textContent = 'No se pudo conectar con el panel.';
  } finally {
    formulario.elements.clave.value = '';
    boton.disabled = false;
  }
});
