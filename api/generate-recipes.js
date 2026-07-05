// Vercel serverless function — proxies recipe-generation requests to the Gemini API with
// Google Search grounding enabled. The API key lives only in this server-side environment
// variable (set in the Vercel project's Settings > Environment Variables as GEMINI_API_KEY),
// never in the browser.
//
// The client (index.html) doesn't know or care which provider is behind this endpoint — it
// just POSTs { prompt } and expects back the same shape Anthropic's Messages API returns:
//   { content: [ { type: "text", text: "..." }, ... ] }
// so we translate Gemini's very different response shape into that same envelope here,
// keeping the provider swap entirely contained to this one file.

const GEMINI_MODEL = 'gemini-2.5-flash';

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'Server misconfigured: GEMINI_API_KEY is not set in this Vercel project.' });
    return;
  }

  const { prompt } = req.body || {};
  if (!prompt || typeof prompt !== 'string') {
    res.status(400).json({ error: 'Missing "prompt" in request body.' });
    return;
  }

  try {
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          tools: [{ google_search: {} }]
        })
      }
    );

    const data = await geminiRes.json();

    if (!geminiRes.ok) {
      res.status(geminiRes.status).json({ error: 'Gemini API error', details: data });
      return;
    }

    // Translate Gemini's shape (candidates[0].content.parts[].text) into the same
    // { content: [{ type: "text", text }] } envelope the client already parses.
    const candidate = (data.candidates && data.candidates[0]) || null;
    const parts = (candidate && candidate.content && candidate.content.parts) || [];
    const combinedText = parts.map(p => p.text || '').join('\n');

    if (!combinedText.trim()) {
      res.status(502).json({ error: 'Gemini returned no usable text.', details: data });
      return;
    }

    res.status(200).json({ content: [{ type: 'text', text: combinedText }] });
  } catch (e) {
    res.status(502).json({ error: 'Proxy failed to reach the Gemini API.', message: e.message });
  }
}
