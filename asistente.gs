/**
 * ═══════════════════════════════════════════════════════════════
 *  ASISTENTE VIRTUAL — Minimercado MyM
 *  Pegá este archivo como un archivo NUEVO dentro de tu proyecto
 *  de Apps Script (el mismo que ya usa la página).
 *
 *  Después, al PRINCIPIO de tu función doPost(e) existente, agregá:
 *
 *      const datos = JSON.parse(e.postData.contents);
 *      if (datos.action === 'chat') return uruResponderChat(datos);
 *
 *  (si tu doPost ya hace JSON.parse, usá esa variable en vez de "datos")
 * ═══════════════════════════════════════════════════════════════
 */

// ── CONFIGURACIÓN ──────────────────────────────────────────────
const URU_TOKEN        = 'uru2026-abc123';      // el mismo SECRET_TOKEN de la página
const URU_MODELO       = 'claude-haiku-5-5';    // rápido y económico para atención al cliente
const URU_MAX_POR_HORA = 300;                   // tope de mensajes por hora (protege tu saldo)

// Información del negocio que el asistente puede usar.
// Editala cuando cambie algo (formas de pago, días, zonas, etc.).
const URU_INFO_NEGOCIO = `
- Nombre: Minimercado MyM. Venta mayorista para comercios.
- Zona de reparto: Viedma y Carmen de Patagones. El reparto es SIN CARGO.
- Días de atención y reparto: martes a sábados.
- Cierre de pedidos: 12:30 hs. Pedidos antes de las 12:30 se entregan HOY; después, se entregan al día siguiente de reparto.
- Mínimo de compra: $30.000.
- Cómo comprar: elegir productos en la web, tocar "Agregar", abrir el carrito, completar nombre del comercio y dirección, y tocar "Enviar por WhatsApp".
- En cada producto se puede elegir comprar por UNIDAD o por BULTO (cuando el producto tiene precio de bulto, suele salir más barato por unidad).
- WhatsApp de contacto: +54 9 2920 248292.
- Formas de pago: (completar acá, por ejemplo: efectivo, transferencia, Mercado Pago).
`;

// ── FUNCIÓN PRINCIPAL ─────────────────────────────────────────
function uruResponderChat(datos) {
  try {
    if (datos.token !== URU_TOKEN) return uruJson({ ok: false, error: 'Token inválido' });
    if (!uruDentroDelLimite())    return uruJson({ ok: false, error: 'Demasiadas consultas, probá en un rato' });

    const apiKey = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
    if (!apiKey) return uruJson({ ok: false, error: 'Falta ANTHROPIC_API_KEY en Propiedades del script' });

    // Historial limpio: solo user/assistant, texto, últimos 10, empezando por "user"
    let mensajes = (datos.mensajes || [])
      .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .map(m => ({ role: m.role, content: m.content.slice(0, 1500) }))
      .slice(-10);
    while (mensajes.length && mensajes[0].role !== 'user') mensajes.shift();
    if (!mensajes.length) return uruJson({ ok: false, error: 'Mensaje vacío' });

    const carrito = datos.carrito || {};
    const contextoCliente =
      `Momento actual del cliente: ${String(datos.hora || '').slice(0, 60)}\n` +
      `Descuento web activo hoy: ${carrito.descuentoActivo ? carrito.descuentoActivo + '% (se aplica solo en el total)' : 'no hay'}\n` +
      `Carrito actual del cliente: ${(carrito.items || []).length ? (carrito.items || []).slice(0, 40).join('; ') : 'vacío'}\n` +
      `Total del carrito: $${Number(carrito.total || 0).toLocaleString('es-AR')}`;

    const body = {
      model: URU_MODELO,
      max_tokens: 600,
      system: [
        { type: 'text', text: uruInstrucciones() },
        // El catálogo va en un bloque cacheado: abarata mucho las consultas seguidas
        { type: 'text', text: 'CATÁLOGO ACTUAL (nombre | precio unidad | categoría | stock | bulto | etiquetas):\n' + uruCatalogoTexto(),
          cache_control: { type: 'ephemeral' } },
        { type: 'text', text: contextoCliente }
      ],
      messages: mensajes
    };

    const res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      payload: JSON.stringify(body),
      muteHttpExceptions: true
    });

    const json = JSON.parse(res.getContentText());
    if (res.getResponseCode() !== 200) {
      console.error('Claude API', res.getResponseCode(), res.getContentText());
      return uruJson({ ok: false, error: 'Error del asistente' });
    }

    const respuesta = (json.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n')
      .trim();

    return uruJson({ ok: true, respuesta: respuesta });

  } catch (err) {
    console.error('uruResponderChat', err);
    return uruJson({ ok: false, error: 'Error interno' });
  }
}

// ── INSTRUCCIONES DEL ASISTENTE ───────────────────────────────
function uruInstrucciones() {
  return `Sos el asistente virtual de la web de pedidos de Minimercado MyM.
Atendés a dueños de comercios (almacenes, kioscos, autoservicios) que compran al por mayor.

CÓMO HABLAR:
- Español rioplatense, con voseo ("tenés", "querés"). Cordial, directo y breve: 1 a 4 oraciones.
- Nada de listas largas. Si hay muchos productos que coinciden, mostrá los 3 a 5 más relevantes.

PRODUCTOS:
- Usá SOLO el catálogo que tenés abajo. Nunca inventes productos, precios, stock ni promociones.
- Cada vez que menciones un producto concreto del catálogo, escribilo en una línea aparte así: [[NOMBRE EXACTO DEL CATÁLOGO]]
  La página lo convierte en una tarjeta con foto, precio y botón para agregar al carrito, así que no repitas el precio en el texto.
- Si un producto tiene stock 0, decí que está sin stock y ofrecé alternativas parecidas que sí tengan stock.
- Si conviene el bulto, mencionalo (ej: "por bulto te sale más barato por unidad").
- Si algo no está en el catálogo, decilo y sugerí consultar por WhatsApp.

INFORMACIÓN DEL NEGOCIO:
${URU_INFO_NEGOCIO}

REGLAS:
- Si te preguntan algo que no está en esta información (formas de pago no cargadas, reclamos, facturas, deudas, cambios de un pedido ya enviado), no lo inventes: pedí que escriban por WhatsApp al +54 9 2920 248292.
- No podés tomar pedidos ni confirmar entregas vos mismo: el pedido se envía desde el carrito por WhatsApp.
- Usá el momento actual del cliente para responder si su pedido llega hoy o al próximo día de reparto.
- Si el carrito no llega al mínimo de $30.000, podés decirle cuánto le falta.
- Solo hablás del minimercado y sus productos. Si preguntan otra cosa, volvé amablemente al tema.`;
}

// ── CATÁLOGO DESDE LA PLANILLA ────────────────────────────────
// Lee la misma hoja que publica la página (gid=0) y la guarda 5 minutos en caché.
function uruCatalogoTexto() {
  const cache = CacheService.getScriptCache();
  const enCache = cache.get('uru_catalogo');
  if (enCache) return enCache;

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const hoja = ss.getSheets().find(h => h.getSheetId() === 0) || ss.getSheets()[0];
  const filas = hoja.getDataRange().getDisplayValues();
  const enc = filas[0].map(h => String(h).trim().toLowerCase());
  const col = (n) => enc.findIndex(h => h.includes(n));

  const iNom = col('nombre'), iPre = col('precio'), iCat = col('categor');
  const iStock = enc.findIndex(h => h.includes('stock') && !h.includes('inicial') && !h.includes('costo'));
  const iBultos = col('bultos'), iDesc = col('descuento'), iNuevo = col('nuevo'), iOferta = col('oferta');
  const val = (f, i) => (i >= 0 ? String(f[i] || '').trim() : '');
  const num = (s) => parseInt(String(s).replace(/[^0-9]/g, ''), 10) || 0;

  const lineas = [];
  filas.slice(1).forEach(f => {
    const nom = val(f, iNom);
    if (!nom) return;
    const precio = num(val(f, iPre));
    const stock  = parseFloat(String(val(f, iStock)).replace(',', '.')) || 0;
    const packCant = num(val(f, iBultos)), packPre = num(val(f, iDesc));
    const etiquetas = [];
    if (val(f, iNuevo).toLowerCase() === 'si')  etiquetas.push('NUEVO');
    if (val(f, iOferta).toLowerCase() === 'si') etiquetas.push('OFERTA');
    lineas.push([
      nom,
      '$' + precio.toLocaleString('es-AR'),
      val(f, iCat) || 'VARIOS',
      'stock ' + stock,
      packCant > 0 && packPre > 0 ? `bulto x${packCant} $${packPre.toLocaleString('es-AR')}` : '-',
      etiquetas.join(' ') || '-'
    ].join(' | '));
  });

  const texto = lineas.join('\n');
  try { cache.put('uru_catalogo', texto, 300); } catch (e) { /* catálogo muy grande para caché: se lee cada vez */ }
  return texto;
}

// ── LÍMITE DE USO ─────────────────────────────────────────────
function uruDentroDelLimite() {
  const cache = CacheService.getScriptCache();
  const clave = 'uru_uso_' + Utilities.formatDate(new Date(), 'America/Argentina/Buenos_Aires', 'yyyyMMddHH');
  const usados = parseInt(cache.get(clave) || '0', 10);
  if (usados >= URU_MAX_POR_HORA) return false;
  cache.put(clave, String(usados + 1), 3700);
  return true;
}

function uruJson(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ── PRUEBA ────────────────────────────────────────────────────
// Ejecutá esta función desde el editor (botón ▶) para probar sin la página.
function probarAsistente() {
  const r = uruResponderChat({
    token: URU_TOKEN,
    mensajes: [{ role: 'user', content: '¿Qué yerbas tenés y hasta qué hora puedo pedir?' }],
    carrito: { items: [], total: 0, descuentoActivo: 0 },
    hora: 'martes 10:15'
  });
  console.log(r.getContent());
}
