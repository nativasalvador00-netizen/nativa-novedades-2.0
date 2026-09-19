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

  // Extraccion determinista de guias con regex (no IA)
  const guiaMatches = chatText.match(/\b5\d{6}\b/g) || [];
  const guiasUnicas = [...new Set(guiaMatches)].sort();

  const prompt = `Eres un asistente especializado en operaciones logisticas de dropshipping en El Salvador.

Analiza el siguiente chat del grupo "Nativa SV x Drop" del dia ${fecha}.

Se encontraron EXACTAMENTE estas guias en el chat: ${guiasUnicas.join(', ')}.
DEBES incluir una entrada por CADA guia de esa lista, sin agregar ni quitar ninguna.

Para cada guia determina si fue reportada por la TRANSPORTADORA (Boxful, VIP SV, +503 6965 7706, +503 7613 8221) va en "novedades", o si fue iniciada por NATIVA (Tu:, Nativa Essential, Daniela) va en "seguimientos".

Para cada caso incluye:
- num: numero de orden
- guia: numero de guia exacto
- hora: hora del primer reporte ("10:35 a.m.")
- razon: que paso (1-2 oraciones en espanol)
- respuesta: que respondio Nativa y la transportadora (detallado)
- contesto: EXACTAMENTE una de estas:
  "Si" = cliente confirmo recibir, se coordino entrega, se ordeno devolucion, o problema resuelto
  "No" = sin accion registrada, Nativa no respondio, o cliente no contactado
  "Parcial" = respuesta sin resolucion definitiva, o cliente cambio de fecha
  "Critico" = caso escalado sin respuesta, entregado pero no recibido, o error grave sin resolver
- notas: estado final en MAYUSCULAS

Nota: En el JSON usa exactamente estos valores para contesto: "SI", "NO", "PARCIAL", "CRITICO"

STATS:
- total: ${guiasUnicas.length} (fijo, es el numero exacto de guias encontradas)
- resueltas: cuantas tienen contesto "SI"
- pendientes: cuantas tienen contesto "NO"
- criticos: cuantas tienen contesto "PARCIAL" o "CRITICO"
- pct_resueltas: entero (resueltas * 100 / total)
- motivo_frecuente: motivo mas comun en novedades (minusculas)

RESPONDE SOLO CON JSON VALIDO. Sin markdown ni texto adicional.

CHAT:
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

    // Mapear contesto de vuelta a emojis para el frontend
    const mapContesto = (c) => {
      if (c === 'SI')      return '✅ SÍ';
      if (c === 'NO')      return '❌ SIN RESPUESTA';
      if (c === 'PARCIAL') return '⚠️ PARCIAL';
      if (c === 'CRITICO') return '⚠️ CRITICO';
      return c;
    };
    (parsed.novedades || []).forEach(r => r.contesto = mapContesto(r.contesto));
    (parsed.seguimientos || []).forEach(r => r.contesto = mapContesto(r.contesto));

    // Calcular stats directamente en el servidor (no depender de la IA)
    const todos = [...(parsed.novedades || []), ...(parsed.seguimientos || [])];
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
