import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(join(__dirname, 'dist')));

app.post('/api/generate-prompt', async (req, res) => {
  const { messages } = req.body;
  const openaiKey = process.env.OPENAI_KEY;

  if (!openaiKey) {
    return res.status(500).json({ error: 'OPENAI_KEY sunucuda tanımlı değil' });
  }

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({ model: 'gpt-4o', messages, max_tokens: 600 }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).json({ error: errText });
    }

    const data = await response.json();
    res.json({ prompt: data.choices[0].message.content.trim() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const KIE_BASE = 'https://api.kie.ai/api/v1';

app.post('/api/kie/generate', async (req, res) => {
  const kieKey = process.env.KIE_API_KEY;
  if (!kieKey) return res.status(500).json({ error: 'KIE_API_KEY sunucuda tanımlı değil' });

  try {
    const r = await fetch(`${KIE_BASE}/jobs/createTask`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${kieKey}`,
      },
      body: JSON.stringify({ model: 'nano-banana-2', input: req.body }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || data.code !== 200) {
      return res.status(r.ok ? 502 : r.status).json({ error: data.msg || `HTTP ${r.status}` });
    }
    res.json({ taskId: data.data?.taskId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/kie/status/:taskId', async (req, res) => {
  const kieKey = process.env.KIE_API_KEY;
  if (!kieKey) return res.status(500).json({ error: 'KIE_API_KEY sunucuda tanımlı değil' });

  try {
    const url = `${KIE_BASE}/jobs/recordInfo?taskId=${encodeURIComponent(req.params.taskId)}`;
    const r = await fetch(url, { headers: { 'Authorization': `Bearer ${kieKey}` } });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return res.status(r.status).json({ error: data.msg || `HTTP ${r.status}` });

    const d = data.data || {};
    let resultUrls = [];
    if (d.resultJson) {
      try { resultUrls = JSON.parse(d.resultJson).resultUrls || []; } catch {}
    }
    res.json({
      state: d.state,
      resultUrls,
      failMsg: d.failMsg || null,
      failCode: d.failCode || null,
      progress: d.progress ?? null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('*', (_req, res) => {
  res.sendFile(join(__dirname, 'dist', 'index.html'));
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Listening on port ${port}`));
