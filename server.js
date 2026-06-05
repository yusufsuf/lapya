import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: '12mb' }));
app.use(express.static(join(__dirname, 'dist')));

app.post('/api/generate-prompt', async (req, res) => {
  const { messages } = req.body;
  const openaiKey = process.env.OPENAI_KEY || process.env.VITE_OPENAI_KEY;

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

// Upload an image to KIE storage and return a public URL.
// Keeps KIE_API_KEY server-side and removes the FAL dependency.
app.post('/api/upload', async (req, res) => {
  const kieKey = process.env.KIE_API_KEY;
  if (!kieKey) return res.status(500).json({ error: 'KIE_API_KEY sunucuda tanımlı değil' });

  const { base64Data, fileName } = req.body || {};
  if (!base64Data) return res.status(400).json({ error: 'base64Data eksik' });

  try {
    const r = await fetch('https://kieai.redpandaai.co/api/file-base64-upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${kieKey}`,
      },
      body: JSON.stringify({
        base64Data,
        uploadPath: 'images/lapya-uploads',
        fileName: fileName || `upload-${Date.now()}.jpg`,
      }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || data.success === false || (data.code && data.code !== 200)) {
      return res.status(r.ok ? 502 : r.status).json({ error: data.msg || `HTTP ${r.status}` });
    }
    const url = data.data?.downloadUrl || data.data?.fileUrl;
    if (!url) return res.status(502).json({ error: 'Yükleme yanıtında URL yok' });
    res.json({ url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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

// Send generated images and/or a text alert to Telegram — server-side so the
// bot token stays off the client, CORS is avoided, and large 2K/4K images are
// uploaded as multipart (sendPhoto URL mode caps at 5MB and often fails).
app.post('/api/telegram/send', async (req, res) => {
  const token = process.env.TELEGRAM_BOT_TOKEN || process.env.VITE_TELEGRAM_BOT_TOKEN;
  const chatIds = (process.env.TELEGRAM_CHAT_IDS || process.env.VITE_TELEGRAM_CHAT_IDS || '')
    .split(',').map((s) => s.trim()).filter(Boolean);

  // Not configured → skip silently (caller treats this as a no-op, not an error).
  if (!token || chatIds.length === 0) return res.json({ ok: false, skipped: true });

  const { urls, text } = req.body || {};
  const failures = [];

  if (text) {
    for (const chatId of chatIds) {
      try {
        const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text }),
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok || data.ok === false) failures.push(`${chatId}: ${data.description || `HTTP ${r.status}`}`);
      } catch (e) {
        failures.push(`${chatId}: ${e.message}`);
      }
    }
  }

  if (Array.isArray(urls)) {
    for (const url of urls) {
      let buffer = null;
      let contentType = 'image/png';
      try {
        const imgRes = await fetch(url);
        if (!imgRes.ok) throw new Error(`indirme HTTP ${imgRes.status}`);
        contentType = imgRes.headers.get('content-type') || contentType;
        buffer = Buffer.from(await imgRes.arrayBuffer());
      } catch (e) {
        failures.push(`${url}: görsel indirilemedi (${e.message})`);
        continue;
      }
      // sendPhoto (multipart) caps at ~10MB; bigger files go as a document to keep full quality.
      const asPhoto = buffer.length <= 9.5 * 1024 * 1024;
      const method = asPhoto ? 'sendPhoto' : 'sendDocument';
      const field = asPhoto ? 'photo' : 'document';
      const ext = contentType.includes('jpeg') ? 'jpg' : 'png';
      for (const chatId of chatIds) {
        try {
          const form = new FormData();
          form.append('chat_id', chatId);
          form.append('caption', 'Görsel hazır! ✨');
          form.append(field, new Blob([buffer], { type: contentType }), `lapya.${ext}`);
          const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', body: form });
          const data = await r.json().catch(() => ({}));
          if (!r.ok || data.ok === false) failures.push(`${chatId}: ${data.description || `HTTP ${r.status}`}`);
        } catch (e) {
          failures.push(`${chatId}: ${e.message}`);
        }
      }
    }
  }

  if (failures.length > 0) return res.status(502).json({ ok: false, failures });
  res.json({ ok: true });
});

app.get('*', (_req, res) => {
  res.sendFile(join(__dirname, 'dist', 'index.html'));
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Listening on port ${port}`));
