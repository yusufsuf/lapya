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
  const [resolution, setResolution] = useState('1K');
  const [aspect, setAspect] = useState(ASPECT_OPTIONS[2]); // Kare default
  const [numImages, setNumImages] = useState(1);

  const [resultImgs, setResultImgs] = useState([]);
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
      let generatedPrompt = "Photorealistic styling of shoes, virtual try on, perfect fit, high quality footwear.";

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

          const userHint = customPrompt.trim();

          if (referenceUrl) {
            contentItems.push({ type: "image_url", image_url: { url: referenceUrl } });
            systemPromptText += `Image ${nextImageIndex} is a reference photo of a person wearing some shoes. Your task is to write a highly detailed text prompt for an image-to-image AI model. The prompt should describe the reference photo (Image ${nextImageIndex}) exactly as it is (person, pose, clothing, background, lighting), BUT replace the shoes they are wearing with the exact shoes shown in the previous images. Describe the new shoes deeply (material, color, style, texture).`;
          } else {
            systemPromptText += `Your task is to write a highly detailed text prompt for an AI image generation model. Create a photorealistic prompt describing the exact shoes shown in the image(s) above (details, material, color, style, texture). The prompt MUST specifically place these shoes onto the feet/legs of a female fashion model. The composition MUST focus ONLY on her legs and feet wearing these shoes. Her upper body MUST NOT be visible. The legs should be positioned elegantly, similar to fashion street photography.`;
          }

          if (userHint) {
            systemPromptText += ` Additionally, the user has provided this specific instruction that you MUST incorporate into the prompt: "${userHint}".`;
          }

          systemPromptText += ` The output must ONLY be the english prompt, no conversational text or formatting.`;

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

      // Step 3: Generate image
      const imageUrls = [outerUrl];
      if (innerUrl) imageUrls.push(innerUrl);
      if (referenceUrl) imageUrls.push(referenceUrl);

      const inputs = {
        prompt: generatedPrompt,
        image_urls: imageUrls,
        aspect_ratio: aspect.value,
        resolution: resolution,
        num_images: numImages,
        output_format: 'png',
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

      let urls = [];
      if (result.data?.images?.length > 0) {
        urls = result.data.images.map(img => img.url);
      } else if (result.data?.image?.url) {
        urls = [result.data.image.url];
      } else {
        const fallback = Object.values(result.data).find(v => typeof v === 'string' && v.startsWith('http'));
        if (fallback) urls = [fallback];
      }

      if (urls.length > 0) {
        setResultImgs(urls);
        if (TELEGRAM_CHAT_IDS.length > 0) {
          for (const url of urls) {
            for (const chatId of TELEGRAM_CHAT_IDS) {
              try {
                await fetch(`https://api.telegram.org/bot${telegramBotToken}/sendPhoto`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ chat_id: chatId.trim(), photo: url, caption: 'Görsel hazır! ✨' })
                });
              } catch (telErr) {
                console.error(`Telegram error for ${chatId}:`, telErr);
              }
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
              <span>{loading ? 'İşleniyor...' : 'Görsel Oluştur'}</span>
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
  );
}

export default App;
