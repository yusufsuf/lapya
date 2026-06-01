import { useState } from 'react';
import { Image as ImageIcon, Sparkles, X, Camera, Fingerprint, Download } from 'lucide-react';
import * as falAI from '@fal-ai/client';
import './App.css';

const RESOLUTION_OPTIONS = ['1K', '2K', '4K'];

const ASPECT_OPTIONS = [
  { label: 'Yatay', shape: { w: 28, h: 16 }, value: '16:9' },
  { label: 'Dikey', shape: { w: 16, h: 28 }, value: '9:16' },
  { label: 'Kare',  shape: { w: 22, h: 22 }, value: '1:1' },
];

function App() {
  const [innerShoe, setInnerShoe] = useState(null);
  const [outerShoe, setOuterShoe] = useState(null);
  const [referenceImg, setReferenceImg] = useState(null);
  const [customPrompt, setCustomPrompt] = useState('');
  const [location, setLocation] = useState('');
  const [resolution, setResolution] = useState('1K');
  const [aspect, setAspect] = useState(ASPECT_OPTIONS[2]); // Kare default
  const [numImages, setNumImages] = useState(1);

  const [resultImgs, setResultImgs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [toasts, setToasts] = useState([]);

  const [falKey] = useState(import.meta.env.VITE_FAL_KEY || '');
  const telegramBotToken = import.meta.env.VITE_TELEGRAM_BOT_TOKEN || '';
  const TELEGRAM_CHAT_IDS = (import.meta.env.VITE_TELEGRAM_CHAT_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const showToast = (message, type = 'error') => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 6000);
  };

  const removeToast = (id) => setToasts(prev => prev.filter(t => t.id !== id));

  const friendlyError = (raw) => {
    const msg = (raw || '').toLowerCase();
    if (msg.includes('402') || msg.includes('insufficient') || msg.includes('credits'))
      return 'Bakiyeniz tükenmiştir, fotoğraf üretilemedi.';
    if (msg.includes('401') || msg.includes('unauthorized'))
      return 'API anahtarı geçersiz veya eksik.';
    if (msg.includes('429') || msg.includes('rate limit'))
      return 'İstek limiti aşıldı, lütfen biraz bekleyin.';
    if (msg.includes('zaman aşımı') || msg.includes('timeout'))
      return 'Fotoğraf üretimi zaman aşımına uğradı, tekrar deneyin.';
    if (msg.includes('generation failed') || msg.includes('üretim hatası') || msg.includes('501'))
      return 'Fotoğraf üretimi başarısız oldu, tekrar deneyin.';
    if (msg.includes('storage') || msg.includes('yüklenemedi'))
      return 'Görsel yüklenirken hata oluştu.';
    if (msg.includes('openai') || msg.includes('bağlantı hatası') || msg.includes('prompt'))
      return 'Prompt oluşturulurken hata oluştu.';
    if (msg.includes('taskid') || msg.includes('kie submit'))
      return 'Görsel üretimi başlatılamadı, tekrar deneyin.';
    return 'Beklenmeyen bir hata oluştu.';
  };

  const sendTelegramMessage = async (text) => {
    if (!telegramBotToken || TELEGRAM_CHAT_IDS.length === 0) return;
    for (const chatId of TELEGRAM_CHAT_IDS) {
      try {
        await fetch(`https://api.telegram.org/bot${telegramBotToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId.trim(), text }),
        });
      } catch (e) {
        console.error('Telegram sendMessage hatası:', e);
      }
    }
  };

  const handleFileChange = (e, setter) => {
    const file = e.target.files[0];
    if (file) setter({ file, preview: URL.createObjectURL(file) });
  };

  const removeImage = (e, setter) => {
    e.stopPropagation();
    e.preventDefault();
    setter(null);
  };

  const triggerDownload = async (url) => {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = `lapya-${new Date().getTime()}.jpg`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(downloadUrl);
    } catch (e) {
      console.error("Download failed", e);
    }
  };

  const compressImage = (file, maxSizeMB = 3) => {
    return new Promise((resolve) => {
      const maxBytes = maxSizeMB * 1024 * 1024;
      if (file.size <= maxBytes) { resolve(file); return; }
      const img = document.createElement('img');
      const canvas = document.createElement('canvas');
      const reader = new FileReader();
      reader.onload = (e) => {
        img.onload = () => {
          const ratio = Math.sqrt(maxBytes / file.size);
          canvas.width = Math.round(img.width * ratio);
          canvas.height = Math.round(img.height * ratio);
          canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
          canvas.toBlob((blob) => {
            resolve(new File([blob], file.name, { type: 'image/jpeg' }));
          }, 'image/jpeg', 0.85);
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    });
  };

  const handleGenerate = async () => {
    if (!falKey) { showToast('FAL AI API anahtarı tanımlı değil.'); return; }
    if (!outerShoe) { showToast('En azından Dış Ayakkabı görüntüsü yüklenmelidir.'); return; }

    setLoading(true);
    setResultImgs([]);

    try {
      falAI.fal.config({ credentials: falKey });

      // Step 1: Upload images
      let outerFile = await compressImage(outerShoe.file);
      const outerUrl = await falAI.fal.storage.upload(outerFile).catch(e => {
        throw new Error('Görsel yüklenemedi (FAL Storage). (' + e.message + ')');
      });

      let innerUrl = null;
      if (innerShoe) {
        let innerFile = await compressImage(innerShoe.file);
        innerUrl = await falAI.fal.storage.upload(innerFile).catch(e => {
          throw new Error('İç ayakkabı görseli yüklenemedi. (' + e.message + ')');
        });
      }

      let referenceUrl = null;
      if (referenceImg) {
        let refFile = await compressImage(referenceImg.file);
        referenceUrl = await falAI.fal.storage.upload(refFile).catch(e => {
          throw new Error('Referans görseli yüklenemedi. (' + e.message + ')');
        });
      }

      // Step 2: Generate prompt via OpenAI (always)
      let generatedPrompt = "Premium photorealistic fashion advertising photograph of elegant designer women's shoes worn on a female fashion model's legs and feet, smooth flawless hair-free model legs with even-toned healthy skin and no stubble or visible hair follicles, editorial street-style composition, shot on an 85mm lens, shallow depth of field, soft natural light, ultra-realistic textures, sharp focus, refined colour grading, magazine quality.";

      try {
          let systemPromptText = "You are a world-class creative director and prompt engineer for luxury women's footwear advertising campaigns. All uploaded product images always show a women's shoe, so the prompt must always treat the footwear as women's shoes. ";
          let contentItems = [];
          let nextImageIndex = 1;

          contentItems.push({ type: "image_url", image_url: { url: outerUrl } });
          systemPromptText += `Image ${nextImageIndex} shows the outer profile of a women's shoe. `;
          nextImageIndex++;

          if (innerUrl) {
            contentItems.push({ type: "image_url", image_url: { url: innerUrl } });
            systemPromptText += `Image ${nextImageIndex} shows the inner / top-down angle of the same women's shoe. `;
            nextImageIndex++;
          }

          const userHint = customPrompt.trim();
          const locationHint = location.trim();

          if (referenceUrl) {
            contentItems.push({ type: "image_url", image_url: { url: referenceUrl } });
            systemPromptText += `Image ${nextImageIndex} is a reference photo of a person. Write ONE highly detailed English prompt for an image-to-image AI model. Faithfully recreate the reference photo (Image ${nextImageIndex}) — exact same person, pose, body proportions, clothing, framing and mood — but REPLACE their footwear with the exact women's shoes from the earlier images. Describe the shoes with precise, true-to-source detail: material, finish, colour, stitching, sole, hardware and texture, so they look photorealistic and perfectly fitted on the feet. `;
          } else {
            systemPromptText += `Write ONE highly detailed English prompt for a premium AI image generation model. The prompt must describe a high-end fashion advertising photograph featuring the exact women's shoes from the image(s) above, worn on the feet of an elegant female fashion model. Frame the composition to focus ONLY on her legs and feet — her upper body and face MUST NOT be visible. Describe the shoes precisely and accurately (material, finish, colour, stitching, sole, hardware, texture). The pose must look natural, confident and editorial, like a luxury street-style or campaign shot. The model's legs MUST look like a real professional fashion model's legs: completely hair-free and naturally smooth, with flawless, even-toned skin — absolutely no stubble, no visible hair follicles, no razor irritation, no goosebumps, no ingrown hairs, no shaving rash, no blemishes and no pores that read as rough. The skin should look healthy, softly luminous and well cared for, yet still authentic and photorealistic — never airbrushed, waxy, plastic or CGI. `;
          }

          if (locationHint) {
            systemPromptText += `The scene MUST be set in this specific real-world location: "${locationHint}". Build an authentic, recognisable environment of that place — characteristic architecture, landmarks, surroundings, atmosphere and natural lighting that clearly identify it. `;
          }

          systemPromptText += `Make the result cinematic and genuinely premium: photographed on a full-frame camera with an 85mm lens, shallow depth of field with tasteful background bokeh, soft natural directional light, true-to-life colours, ultra-realistic material textures, crisp sharp focus on the shoes, refined professional colour grading, high dynamic range and magazine-quality composition. Any visible leg skin must always read as smooth, hair-free and flawless professional-model skin — never rough, stubbly, or with visible follicles. Strictly avoid any cartoonish, plastic, CGI, over-saturated or artificial look. `;

          if (userHint) {
            systemPromptText += `You MUST also naturally incorporate this user instruction into the prompt: "${userHint}". `;
          }

          systemPromptText += `Output ONLY the final English prompt as a single plain-text paragraph — no preamble, no quotes, no labels, no formatting.`;

          contentItems.unshift({ type: "text", text: systemPromptText });

          const aiRes = await fetch('/api/generate-prompt', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messages: [{ role: 'user', content: contentItems }] }),
          });
          if (!aiRes.ok) {
            const errText = await aiRes.text();
            let errMsg = errText;
            try { errMsg = JSON.parse(errText).error || errText; } catch {}
            throw new Error(`Sunucu hatası (${aiRes.status}): ${errMsg.slice(0, 200)}`);
          }
          const aiData = await aiRes.json();
          generatedPrompt = aiData.prompt;
          console.log("Generated Prompt:", generatedPrompt);
        } catch (err) {
          console.error("OpenAI Error:", err);
          throw new Error("OpenAI bağlantı hatası: " + (err.message || 'API anahtarını kontrol edin.'));
        }

      // Step 3: Generate image via KIE (nano-banana-2)
      const imageUrls = [outerUrl];
      if (innerUrl) imageUrls.push(innerUrl);
      if (referenceUrl) imageUrls.push(referenceUrl);

      const kieInput = {
        prompt: generatedPrompt,
        image_input: imageUrls,
        aspect_ratio: aspect.value,
        resolution: resolution,
        output_format: 'png',
      };

      const generateOne = async () => {
        const submitRes = await fetch('/api/kie/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(kieInput),
        });
        if (!submitRes.ok) {
          const errBody = await submitRes.json().catch(() => ({}));
          throw new Error(`KIE submit hatası (${submitRes.status}): ${errBody.error || ''}`);
        }
        const { taskId } = await submitRes.json();
        if (!taskId) throw new Error('KIE submit yanıtında taskId yok');

        // Poll status — every 4s, max ~10 min
        for (let attempt = 0; attempt < 150; attempt++) {
          await new Promise((r) => setTimeout(r, 4000));
          const statusRes = await fetch(`/api/kie/status/${taskId}`);
          if (!statusRes.ok) continue;
          const status = await statusRes.json();
          if (status.state === 'success') return status.resultUrls || [];
          if (status.state === 'fail') {
            throw new Error(`KIE üretim hatası: ${status.failMsg || status.failCode || 'bilinmeyen'}`);
          }
        }
        throw new Error('KIE zaman aşımı (10 dakika içinde sonuç gelmedi)');
      };

      const taskResults = await Promise.all(
        Array.from({ length: numImages }, () => generateOne())
      );
      const urls = taskResults.flat();

      if (urls.length > 0) {
        setResultImgs(urls);
        if (TELEGRAM_CHAT_IDS.length > 0) {
          if (!telegramBotToken) {
            console.warn('Telegram: VITE_TELEGRAM_BOT_TOKEN tanımlı değil, gönderim atlanıyor.');
            setError('Görsel hazır ama Telegram gönderilemedi: bot token (VITE_TELEGRAM_BOT_TOKEN) tanımlı değil.');
          } else {
            const telegramFailures = [];
            for (const url of urls) {
              for (const chatId of TELEGRAM_CHAT_IDS) {
                try {
                  const resp = await fetch(`https://api.telegram.org/bot${telegramBotToken}/sendPhoto`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ chat_id: chatId.trim(), photo: url, caption: 'Görsel hazır! ✨' })
                  });
                  const data = await resp.json().catch(() => ({}));
                  if (!resp.ok || data.ok === false) {
                    const desc = data.description || `HTTP ${resp.status}`;
                    console.error(`Telegram ${chatId} hata:`, desc, data);
                    telegramFailures.push(`${chatId}: ${desc}`);
                  } else {
                    console.log(`Telegram ${chatId} -> gönderildi.`);
                  }
                } catch (telErr) {
                  console.error(`Telegram ${chatId} fetch hatası:`, telErr);
                  telegramFailures.push(`${chatId}: ${telErr.message || 'fetch hatası'}`);
                }
              }
            }
            if (telegramFailures.length > 0) {
              showToast(`Telegram gönderiminde sorun: ${telegramFailures.join(' | ')}`);
            }
          }
        }
      } else {
        const msg = 'Görüntü oluşturulamadı veya beklenen formatta dönmedi.';
        showToast(msg);
        sendTelegramMessage(`❌ ${msg}`);
      }

    } catch (err) {
      console.error(err);
      const msg = friendlyError(err.message);
      showToast(msg);
      sendTelegramMessage(`❌ Hata: ${msg}`);
    } finally {
      setLoading(false);
    }
  };

  const UploadBox = ({ label, subLabel, state, setter, icon: Icon, isFull }) => (
    <div className={`upload-box ${state ? 'has-image' : ''} ${isFull ? 'upload-full' : ''}`}>
      {state ? (
        <>
          <img src={state.preview} alt={label} className="preview-image" />
          <button className="remove-btn" onClick={(e) => removeImage(e, setter)}>
            <X size={18} />
          </button>
        </>
      ) : (
        <>
          <Icon size={36} className="upload-icon" />
          <p>{label}</p>
          {subLabel && <span className="sub-text">{subLabel}</span>}
          <input type="file" accept="image/*" onChange={(e) => handleFileChange(e, setter)} />
        </>
      )}
    </div>
  );

  return (
    <>
    <div className="toast-container">
      {toasts.map(t => (
        <div key={t.id} className={`toast toast-${t.type}`}>
          <span className="toast-message">{t.message}</span>
          <button className="toast-close" onClick={() => removeToast(t.id)}>
            <X size={16} />
          </button>
        </div>
      ))}
    </div>
    <div className="app-container">
      <header className="header">
        <h1 className="gradient-text">Lapya Trend</h1>
      </header>

      <main className="main-content">
        <section className="glass-panel upload-section">

          <h2 className="section-title"><Fingerprint size={24} className="icon"/> Giriş Görselleri</h2>

          <div className="upload-grid">
            <UploadBox
              label="Dış Ayakkabı (Zorunlu)"
              subLabel="(Genel dış profil)"
              state={outerShoe}
              setter={setOuterShoe}
              icon={ImageIcon}
            />
            <UploadBox
              label="İç Ayakkabı (Opsiyonel)"
              subLabel="(Tavan veya iç astar açısı)"
              state={innerShoe}
              setter={setInnerShoe}
              icon={ImageIcon}
            />
            <UploadBox
              label="Referans Fotoğraf (Opsiyonel)"
              subLabel="(Ayakkabının giyileceği orijinal manken, yoksa yapay zeka oluşturur)"
              state={referenceImg}
              setter={setReferenceImg}
              icon={Camera}
              isFull={true}
            />
          </div>

          {/* Resolution + Aspect Selector */}
          <div style={{ marginTop: '1.25rem', display: 'flex', gap: '0.75rem' }}>
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>Çözünürlük</p>
              <div style={{ display: 'flex', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '10px', overflow: 'hidden' }}>
                {RESOLUTION_OPTIONS.map((opt, i) => (
                  <button
                    key={opt}
                    onClick={() => setResolution(opt)}
                    className={resolution === opt ? 'neon-active' : ''}
                    style={{
                      flex: 1, padding: '0.6rem', border: 'none',
                      borderRight: i < RESOLUTION_OPTIONS.length - 1 ? '1px solid rgba(255,255,255,0.12)' : 'none',
                      background: 'transparent',
                      color: resolution === opt ? '#fff' : 'var(--text-secondary)',
                      fontWeight: resolution === opt ? '600' : '400',
                      cursor: 'pointer', fontSize: '0.9rem', transition: 'color 0.2s',
                    }}
                  ><span>{opt}</span></button>
                ))}
              </div>
            </div>
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>Boyut</p>
              <div style={{ display: 'flex', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '10px', overflow: 'hidden' }}>
                {ASPECT_OPTIONS.map((opt, i) => (
                  <button
                    key={opt.label}
                    onClick={() => setAspect(opt)}
                    className={aspect.label === opt.label ? 'neon-active' : ''}
                    style={{
                      flex: 1, padding: '0.5rem 0.4rem', border: 'none',
                      borderRight: i < ASPECT_OPTIONS.length - 1 ? '1px solid rgba(255,255,255,0.12)' : 'none',
                      background: 'transparent',
                      color: aspect.label === opt.label ? '#fff' : 'var(--text-secondary)',
                      fontWeight: aspect.label === opt.label ? '600' : '400',
                      cursor: 'pointer', fontSize: '0.75rem', transition: 'color 0.2s',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.3rem',
                    }}
                  >
                    <div style={{
                      width: opt.shape.w, height: opt.shape.h,
                      border: `2px solid ${aspect.label === opt.label ? '#fff' : 'rgba(255,255,255,0.4)'}`,
                      borderRadius: '2px',
                      position: 'relative', zIndex: 2,
                    }} />
                    <span style={{position: 'relative', zIndex: 2}}>{opt.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Num Images Selector */}
          <div style={{ marginTop: '1.25rem' }}>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>Çıktı Adeti</p>
            <div style={{ display: 'flex', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '10px', overflow: 'hidden' }}>
              {[1, 2, 3, 4].map((n, i) => (
                <button
                  key={n}
                  onClick={() => setNumImages(n)}
                  className={numImages === n ? 'neon-active' : ''}
                  style={{
                    flex: 1, padding: '0.6rem', border: 'none',
                    borderRight: i < 3 ? '1px solid rgba(255,255,255,0.12)' : 'none',
                    background: 'transparent',
                    color: numImages === n ? '#fff' : 'var(--text-secondary)',
                    fontWeight: numImages === n ? '600' : '400',
                    cursor: 'pointer', fontSize: '0.9rem', transition: 'color 0.2s',
                  }}
                ><span>{n}</span></button>
              ))}
            </div>
          </div>

          {/* Location */}
          <div style={{ marginTop: '1.25rem' }}>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
              Konum <span style={{ opacity: 0.6 }}>(opsiyonel — görselin geçeceği yer)</span>
            </p>
            <input
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="örn: Paris, Santorini, New York sokakları, sahil..."
              style={{
                width: '100%',
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: '10px',
                color: 'var(--text-primary, #fff)',
                padding: '0.75rem',
                fontSize: '0.85rem',
                outline: 'none',
                fontFamily: 'inherit',
                boxSizing: 'border-box',
              }}
            />
          </div>

          {/* Custom Prompt */}
          <div style={{ marginTop: '1.25rem' }}>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
              Özel Prompt <span style={{ opacity: 0.6 }}>(boş bırakılırsa otomatik oluşturulur)</span>
            </p>
            <textarea
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)}
              placeholder="Görsel için özel bir yönerge yazın... (örn: siyah platformlu topuklu ayakkabı, beyaz arka plan, stüdyo ışığı)"
              rows={3}
              style={{
                width: '100%',
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: '10px',
                color: 'var(--text-primary, #fff)',
                padding: '0.75rem',
                fontSize: '0.85rem',
                resize: 'vertical',
                outline: 'none',
                fontFamily: 'inherit',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <div className="actions">
            <button
              className="btn btn-primary generate-btn"
              onClick={handleGenerate}
              disabled={loading}
            >
              <Sparkles size={20} />
              {loading ? 'İşleniyor...' : 'Görsel Oluştur'}
            </button>
          </div>
        </section>

        <section className="glass-panel result-section">
          <h2 className="section-title"><Sparkles size={24} className="icon"/> Sonuç Görüntüsü</h2>

          <div className="result-container">
            {loading && (
              <div className="loading-overlay">
                <div className="scanner"></div>
                <div className="loader-spinner"></div>
                <div className="loading-text">Görseliniz Hazırlanıyor...</div>
              </div>
            )}

            {resultImgs.length > 0 ? (
              <div style={{
                display: 'grid',
                gridTemplateColumns: resultImgs.length === 1 ? '1fr' : 'repeat(2, 1fr)',
                gap: '0.75rem',
                width: '100%',
              }}>
                {resultImgs.map((url, idx) => (
                  <div key={idx} style={{ position: 'relative' }}>
                    <img src={url} alt={`Sonuç ${idx + 1}`} style={{ width: '100%', borderRadius: '10px', display: 'block' }} />
                    <button
                      onClick={() => triggerDownload(url)}
                      className="btn btn-secondary"
                      style={{ position: 'absolute', bottom: '0.5rem', right: '0.5rem', background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)', borderColor: 'rgba(255,255,255,0.2)', color: 'white', padding: '0.4rem 0.7rem', fontSize: '0.8rem' }}
                    >
                      <Download size={15} /> İndir
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              !loading && (
                <div className="result-placeholder">
                  <ImageIcon size={48} style={{opacity: 0.2}} />
                  <p>Model çıktısı burada görünecektir.</p>
                </div>
              )
            )}
          </div>
        </section>
      </main>
    </div>
    </>
  );
}

export default App;
