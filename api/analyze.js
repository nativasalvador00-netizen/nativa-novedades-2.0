module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { chatText, date } = req.body || {};
  if (!chatText || !date) return res.status(400).json({ error: 'Faltan datos: chatText o date' });

  const [y, m, d] = date.split('-');
  const fecha = `${d}/${m}/${y}`;

  const prompt = `Eres un asistente especializado en operaciones logísticas de dropshipping en El Salvador.

Analiza el siguiente chat exportado del grupo "Nativa SV x Drop" y extrae TODAS las novedades del día ${fecha}.

CLASIFICACIÓN:
- "novedades": casos reportados POR la transportadora (Boxful, VIP SV, teléfonos +503 6965 7706 o +503 7613 8221) sobre problemas de entrega con clientes.
- "seguimientos": casos iniciados PROACTIVAMENTE por Nativa (identificada como "Tú:", "Nativa Essential" o "Daniela" en el chat) sin que la transportadora lo haya reportado primero.

PARA CADA CASO incluye exactamente estos campos:
- num (número de orden, entero)
- guia (número de guía como string, ej "5741544" o "5743356 / 5741099")
- hora (ej: "10:35 a.m.")
- razon (qué pasó, 1-2 oraciones en español)
- respuesta (qué respondió Nativa y/o la transportadora, con detalle)
- contesto: usa EXACTAMENTE una de estas opciones según estos criterios:
  * "✅ SÍ" = el cliente confirmó recibir, se coordinó entrega, se ordenó devolución, o se resolvió el problema
  * "❌ SIN RESPUESTA" = Nativa no respondió a la transportadora, o el cliente no fue contactado, o no hay acción registrada
  * "⚠️ PARCIAL" = hubo respuesta pero sin resolución definitiva, o el cliente cambió de fecha durante el día
  * "⚠️ CRITICO" = caso escalado sin respuesta, entregado pero cliente dice que no recibió, o guía con error grave sin resolver
- notas (estado final en MAYÚSCULAS, breve)

STATS:
- total: suma de TODOS los casos (novedades + seguimientos)
- resueltas: cuántas tienen "✅ SÍ"
- pendientes: cuántas tienen "❌ SIN RESPUESTA"
- criticos: cuántas tienen "⚠️ PARCIAL" o "⚠️ CRITICO"
- pct_resueltas: entero exacto (resueltas * 100 / total, redondeado)
- motivo_frecuente: motivo más común en novedades (frase corta en minúsculas)

RESPONDE ÚNICAMENTE CON JSON VÁLIDO. Sin markdown, sin texto adicional.

CHAT DEL DÍA ${fecha}:
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
        max_tokens: 4000,
        temperature: 0,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return res.status(response.status).json({ error: err.error?.message || `Error API: ${response.status}` });
    }

    const data = await response.json();
    const text = data.content?.find(b => b.type === 'text')?.text || '';
    const clean = text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    res.json(parsed);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
