import { useState } from 'react';
import { Image as ImageIcon, Sparkles, X, Camera, Fingerprint, Download } from 'lucide-react';
import * as falAI from '@fal-ai/client';
import './App.css';

const RESOLUTION_OPTIONS = ['1K', '2K', '4K'];
const RESOLUTION_BASE = { '1K': 1024, '2K': 2048, '4K': 4096 };

const ASPECT_OPTIONS = [
  { label: '16:9', w: 16, h: 9 },
  { label: '9:16', w: 9, h: 16 },
  { label: 'Kare', w: 1, h: 1 },
];

function getImageSize(resolution, aspect) {
  const base = RESOLUTION_BASE[resolution];
  const { w, h } = aspect;
  if (w >= h) {
    return { width: base, height: Math.round(base * h / w) };
  } else {
    return { width: Math.round(base * w / h), height: base };
  }
}

function App() {
  const [innerShoe, setInnerShoe] = useState(null);
  const [outerShoe, setOuterShoe] = useState(null);
  const [referenceImg, setReferenceImg] = useState(null);
  const [customPrompt, setCustomPrompt] = useState('');
  const [resolution, setResolution] = useState('1K');
  const [aspect, setAspect] = useState(ASPECT_OPTIONS[2]); // Kare default

  const [resultImg, setResultImg] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [falKey] = useState(import.meta.env.VITE_FAL_KEY || '');
  const telegramBotToken = import.meta.env.VITE_TELEGRAM_BOT_TOKEN || '';
  const TELEGRAM_CHAT_IDS = ['7463074399'];

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
    if (!falKey) { setError('FAL AI API anahtarı tanımlı değil.'); return; }
    if (!outerShoe) { setError('En azından Dış Ayakkabı görüntüsü yüklenmelidir.'); return; }

    setLoading(true);
    setError(null);
    setResultImg(null);

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

      // Step 2: Generate or use custom prompt
      let generatedPrompt = customPrompt.trim();

      if (!generatedPrompt) {
        try {
          let systemPromptText = "You are an expert AI prompt engineer. ";
          let contentItems = [];
          let nextImageIndex = 1;

          contentItems.push({ type: "image_url", image_url: { url: outerUrl } });
          systemPromptText += `Image ${nextImageIndex} is the outer angle of a shoe. `;
          nextImageIndex++;

          if (innerUrl) {
            contentItems.push({ type: "image_url", image_url: { url: innerUrl } });
            systemPromptText += `Image ${nextImageIndex} is the inner angle of the same shoe. `;
            nextImageIndex++;
          }

          if (referenceUrl) {
            contentItems.push({ type: "image_url", image_url: { url: referenceUrl } });
            systemPromptText += `Image ${nextImageIndex} is a reference photo of a person wearing some shoes. Your task is to write a highly detailed text prompt for an image-to-image AI model. The prompt should describe the reference photo (Image ${nextImageIndex}) exactly as it is (person, pose, clothing, background, lighting), BUT replace the shoes they are wearing with the exact shoes shown in the previous images. Describe the new shoes deeply (material, color, style, texture). The output must ONLY be the english prompt, no conversational text or formatting.`;
          } else {
            systemPromptText += `Your task is to write a highly detailed text prompt for an AI image generation model. Create a photorealistic prompt describing the exact shoes shown in the image(s) above (details, material, color, style, texture). The prompt MUST specifically place these shoes onto the feet/legs of a female fashion model. The composition MUST focus ONLY on her legs and feet wearing these shoes. Her upper body MUST NOT be visible. The legs should be positioned elegantly, similar to fashion street photography. The output must ONLY be the english prompt, no conversational text or formatting.`;
          }

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
      }

      // Step 3: Generate image
      const imageSize = getImageSize(resolution, aspect);
      const imageUrls = [outerUrl];
      if (innerUrl) imageUrls.push(innerUrl);
      if (referenceUrl) imageUrls.push(referenceUrl);

      const inputs = {
        prompt: generatedPrompt,
        image_urls: imageUrls,
        image_size: imageSize,
      };

      const result = await falAI.fal.subscribe('fal-ai/nano-banana-2/edit', {
        input: inputs,
        logs: true,
        onQueueUpdate: (update) => {
          if (update.status === 'IN_PROGRESS') {
            update.logs.map((log) => log.message).forEach(console.log);
          }
        },
      }).catch(e => {
        throw new Error('Görsel oluşturma hatası (FAL AI): ' + e.message);
      });

      let finalImageUrl = null;
      if (result.data?.images?.length > 0) {
        finalImageUrl = result.data.images[0].url;
      } else if (result.data?.image?.url) {
        finalImageUrl = result.data.image.url;
      } else {
        finalImageUrl = Object.values(result.data).find(v => typeof v === 'string' && v.startsWith('http'));
      }

      if (finalImageUrl) {
        setResultImg(finalImageUrl);
        if (TELEGRAM_CHAT_IDS.length > 0) {
          for (const chatId of TELEGRAM_CHAT_IDS) {
            try {
              await fetch(`https://api.telegram.org/bot${telegramBotToken}/sendPhoto`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: chatId.trim(), photo: finalImageUrl, caption: 'Görsel hazır! ✨' })
              });
            } catch (telErr) {
              console.error(`Telegram error for ${chatId}:`, telErr);
            }
          }
        }
      } else {
        setError("Görüntü oluşturulamadı veya beklenen formatta dönmedi.");
      }

    } catch (err) {
      console.error(err);
      setError('Bir hata oluştu: ' + (err.message || JSON.stringify(err)));
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
                    style={{
                      flex: 1, padding: '0.6rem', border: 'none',
                      borderRight: i < RESOLUTION_OPTIONS.length - 1 ? '1px solid rgba(255,255,255,0.12)' : 'none',
                      background: resolution === opt ? 'var(--accent-color, #3b82f6)' : 'transparent',
                      color: resolution === opt ? '#fff' : 'var(--text-secondary)',
                      fontWeight: resolution === opt ? '600' : '400',
                      cursor: 'pointer', fontSize: '0.9rem', transition: 'background 0.2s',
                    }}
                  >{opt}</button>
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
                    style={{
                      flex: 1, padding: '0.6rem', border: 'none',
                      borderRight: i < ASPECT_OPTIONS.length - 1 ? '1px solid rgba(255,255,255,0.12)' : 'none',
                      background: aspect.label === opt.label ? 'var(--accent-color, #3b82f6)' : 'transparent',
                      color: aspect.label === opt.label ? '#fff' : 'var(--text-secondary)',
                      fontWeight: aspect.label === opt.label ? '600' : '400',
                      cursor: 'pointer', fontSize: '0.9rem', transition: 'background 0.2s',
                    }}
                  >{opt.label}</button>
                ))}
              </div>
            </div>
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

          {error && <div style={{color: 'var(--danger-color)', padding: '1rem', background: 'rgba(239,68,68,0.1)', borderRadius: '8px', marginTop: '1rem'}}>{error}</div>}

          <div className="actions">
            <button
              className="btn btn-primary generate-btn"
              onClick={handleGenerate}
              disabled={loading}
            >
              <Sparkles size={20} />
              {loading ? 'İşleniyor...' : 'Sanal Denemeyi Başlat'}
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

            {resultImg ? (
              <>
                <img src={resultImg} alt="Try On Sonucu" className="result-image" />
                <button
                  onClick={() => triggerDownload(resultImg)}
                  className="btn btn-secondary"
                  style={{position: 'absolute', bottom: '1rem', right: '1rem', background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)', borderColor: 'rgba(255,255,255,0.2)', color: 'white'}}
                >
                  <Download size={18} /> İndir
                </button>
              </>
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
  );
}

export default App;
