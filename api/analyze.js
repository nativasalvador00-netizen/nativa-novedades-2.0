module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { chatText, date } = req.body || {};
  if (!chatText || !date) return res.status(400).json({ error: 'Faltan datos' });

  const [y, m, d] = date.split('-');
  const fecha = `${d}/${m}/${y}`;

  const guiaMatches = chatText.match(/\b5\d{6}\b/g) || [];
  const guiasUnicas = [...new Set(guiaMatches)].sort();

  const prompt = `Eres un asistente de operaciones logísticas. Analiza este chat de WhatsApp del grupo "Nativa SV x Drop" del día ${fecha} y extrae las novedades de entrega.

GUÍAS ENCONTRADAS EN EL CHAT: ${guiasUnicas.join(', ')}
Incluye exactamente UNA entrada por cada guía. No agregues ni quites ninguna.

QUIÉN ES QUIÉN:
- TRANSPORTADORA (reporta novedades): +503 6965 7706, +503 7613 8221, +503 6986 6171, Boxful, VIP SV, Josias
- NATIVA (gestiona): Tú, Nativa Essential, Nativa Essential SLV, Daniela Jimenez, Daniela

CLASIFICACIÓN EN DOS SECCIONES:
- "novedades": la TRANSPORTADORA mencionó la guía primero (reportó un problema)
- "seguimientos": NATIVA mencionó la guía primero (seguimiento proactivo)

PARA CADA GUÍA, mirá TODOS los mensajes que la mencionan en orden cronológico para determinar el estado FINAL:

REGLAS DE CLASIFICACIÓN (usa exactamente: "SI", "NO", "PARCIAL", "CRITICO"):
- "SI" SOLO si hay una resolución definitiva al final del hilo:
  * El cliente confirmó una fecha/hora CONCRETA de entrega ("confirma mañana viernes a las 3pm", "recibirá el sábado", "puede recibir hoy en 1 hora")
  * Se ordenó devolución formalmente ("se ordena la devolución", "devolución solicitada")
  * El cliente confirmó recoger en agencia
  * El paquete fue entregado y confirmado

- "NO" si:
  * Nativa no respondió nada sobre esa guía
  * La transportadora preguntó número alterno y Nativa nunca respondió

- "PARCIAL" si:
  * Nativa solo dijo "en contacto con el cliente" pero NO hay mensaje posterior con resolución concreta
  * El cliente cambió de fecha durante el día sin confirmar nueva fecha definitiva
  * Se pidió información a la transportadora y no respondieron

- "CRITICO" si:
  * El caso fue escalado a personas específicas (Erick Amaya, Guillermo Mejia) sin respuesta
  * El sistema marca el pedido como entregado pero el cliente dice que NO lo recibió
  * La guía estaba anulada pero igual salió a reparto y hay disputa de cobro
  * El cliente bloqueó al mensajero o tercer intento fallido con devolución forzada

IMPORTANTE: "en contacto con el cliente" por sí solo es PARCIAL, no SI. Para ser SI necesita un mensaje POSTERIOR confirmando el resultado.

FORMATO DE CADA CASO:
{
  "num": número de orden,
  "guia": "número exacto",
  "hora": "hora del primer mensaje sobre esta guía",
  "razon": "qué reportó la transportadora o qué inició Nativa (1-2 oraciones)",
  "respuesta": "qué hizo Nativa y qué respondió la transportadora, con el resultado final",
  "contesto": "SI" | "NO" | "PARCIAL" | "CRITICO",
  "notas": "ESTADO FINAL EN MAYÚSCULAS (máximo 12 palabras)"
}

RESPONDE SOLO CON ESTE JSON, sin markdown:
{
  "novedades": [...],
  "seguimientos": [...],
  "stats": {
    "total": número total de guías (${guiasUnicas.length}),
    "resueltas": conteo de SI,
    "pendientes": conteo de NO,
    "criticos": conteo de PARCIAL + CRITICO,
    "pct_resueltas": entero,
    "motivo_frecuente": "motivo más común en novedades en minúsculas"
  }
}

CHAT DEL ${fecha}:
${chatText}`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 8000,
        temperature: 0,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return res.status(response.status).json({ error: err.error?.message || `Error ${response.status}` });
    }

    const data = await response.json();
    const rawText = data.content?.find(b => b.type === 'text')?.text || '';
    const clean = rawText.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);

    // Mapear a emojis y recalcular stats en el servidor (no confiar en los de la IA)
    const map = { 'SI':'✅ SÍ', 'NO':'❌ SIN RESPUESTA', 'PARCIAL':'⚠️ PARCIAL', 'CRITICO':'⚠️ CRITICO' };
    const todos = [...(parsed.novedades||[]), ...(parsed.seguimientos||[])];
    todos.forEach(r => { r.contesto = map[r.contesto] || r.contesto; });

    const resueltas = todos.filter(r => r.contesto === '✅ SÍ').length;
    const pendientes = todos.filter(r => r.contesto === '❌ SIN RESPUESTA').length;
    const criticos   = todos.filter(r => r.contesto?.includes('⚠️')).length;
    const total      = todos.length;

    parsed.stats = {
      total,
      resueltas,
      pendientes,
      criticos,
      pct_resueltas: total > 0 ? Math.round(resueltas * 100 / total) : 0,
      motivo_frecuente: parsed.stats?.motivo_frecuente || 'cliente no responde llamadas'
    };

    res.json(parsed);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
