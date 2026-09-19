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

  // Solo enviamos líneas que mencionan guías — reduce el input a la mitad
  const guiaPattern = /\b5\d{6}\b/;
  const lines = chatText.split('\n');
  const compactLines = [];
  lines.forEach((line, i) => {
    if (guiaPattern.test(line)) {
      // Incluir 2 líneas de contexto antes y 3 después
      for (let j = Math.max(0, i-2); j <= Math.min(lines.length-1, i+3); j++) {
        if (!compactLines.includes(lines[j])) compactLines.push(lines[j]);
      }
    }
  });
  const compactChat = compactLines.join('\n');

  const guiaMatches = chatText.match(/\b5\d{6}\b/g) || [];
  const guiasUnicas = [...new Set(guiaMatches)].sort();

  const prompt = `Eres un asistente de operaciones logísticas. Analiza este chat de WhatsApp del grupo "Nativa SV x Drop" del día ${fecha} y extrae las novedades de entrega.

GUÍAS EN EL CHAT: ${guiasUnicas.join(', ')}
Incluye UNA entrada por cada guía. No agregues ni quites ninguna.

QUIÉN ES QUIÉN:
- TRANSPORTADORA: +503 6965 7706, +503 7613 8221, +503 6986 6171, Boxful, VIP SV, Josias
- NATIVA: Tú, Nativa Essential, Nativa Essential SLV, Daniela Jimenez, Daniela

SECCIONES:
- "novedades": transportadora mencionó la guía primero
- "seguimientos": Nativa la mencionó primero

CLASIFICACIÓN (usa exactamente: "SI", "NO", "PARCIAL", "CRITICO"):
- SI: cliente confirmó fecha/hora concreta, devolución ordenada, entregado y confirmado, recoger en agencia
- NO: Nativa nunca respondió sobre esa guía
- PARCIAL: Nativa solo dijo "en contacto" sin resultado posterior, cliente cambió de fecha sin confirmar
- CRITICO: escalado sin respuesta, entregado pero cliente dice que no recibió, guía anulada con disputa, 3 intentos fallidos

"en contacto" solo = PARCIAL, NO = SI.

PARA CADA CASO:
{ "num": N, "guia": "XXXXXXX", "hora": "HH:MM a.m.", "razon": "qué pasó (1-2 oraciones)", "respuesta": "qué hizo Nativa y resultado final", "contesto": "SI|NO|PARCIAL|CRITICO", "notas": "ESTADO FINAL MAYÚSCULAS" }

RESPONDE SOLO CON JSON:
{ "novedades": [...], "seguimientos": [...], "stats": { "total": ${guiasUnicas.length}, "resueltas": N, "pendientes": N, "criticos": N, "pct_resueltas": N, "motivo_frecuente": "texto" } }

CHAT:
${compactChat}`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 4000,
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

    const map = { 'SI':'✅ SÍ', 'NO':'❌ SIN RESPUESTA', 'PARCIAL':'⚠️ PARCIAL', 'CRITICO':'⚠️ CRITICO' };
    const todos = [...(parsed.novedades||[]), ...(parsed.seguimientos||[])];
    todos.forEach(r => { r.contesto = map[r.contesto] || r.contesto; });

    const resueltas = todos.filter(r => r.contesto === '✅ SÍ').length;
    const pendientes = todos.filter(r => r.contesto === '❌ SIN RESPUESTA').length;
    const criticos   = todos.filter(r => r.contesto?.includes('⚠️')).length;
    const total      = todos.length;

    parsed.stats = {
      total, resueltas, pendientes, criticos,
      pct_resueltas: total > 0 ? Math.round(resueltas * 100 / total) : 0,
      motivo_frecuente: parsed.stats?.motivo_frecuente || 'cliente no responde llamadas'
    };

    res.json(parsed);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
