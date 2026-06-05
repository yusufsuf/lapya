import { useState } from 'react';
import { Image as ImageIcon, Sparkles, X, Camera, Fingerprint, Download } from 'lucide-react';
import './App.css';

const RESOLUTION_OPTIONS = ['1K', '2K', '4K'];

const ASPECT_OPTIONS = [
  { label: 'Yatay', shape: { w: 28, h: 16 }, value: '16:9' },
  { label: 'Dikey', shape: { w: 16, h: 28 }, value: '9:16' },
  { label: 'Kare',  shape: { w: 22, h: 22 }, value: '1:1' },
];

const MAX_OUTPUTS = 10;

// Distinct camera angles / poses so a multi-output request returns varied shots
// of the same shoe instead of near-identical frames.
const ANGLE_VARIATIONS = [
  'Render THIS frame as a clean full side profile of the legs and feet, the shoe shown in lateral view, model standing naturally.',
  'Render THIS frame from a low three-quarter front angle looking slightly upward, a confident dynamic stance with both shoes clearly visible.',
  'Render THIS frame as a tight close-up / macro on the shoes from a three-quarter angle, emphasising the material, texture and detailing, with only the lower legs visible.',
  'Render THIS frame from a high angle looking down at the feet and shoes on the ground, with an elegant crossed-leg or pointed-toe pose.',
  'Render THIS frame from behind, showing the heels and the back of the shoes, the model captured mid-step walking away.',
  'Render THIS frame from a frontal angle with the model stepping forward and one foot lifted in natural walking motion.',
  'Render THIS frame as a relaxed seated editorial pose, the legs elegantly angled and the shoes shown from a soft three-quarter view.',
  'Render THIS frame as a ground-level hero angle very close to the surface, the shoes large and prominent in the foreground with shallow depth of field.',
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

  // Telegram delivery is handled server-side (/api/telegram/send): keeps the bot
  // token off the client, avoids browser CORS, and uploads large images as files.
  const sendTelegramMessage = async (text) => {
    try {
      await fetch('/api/telegram/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
    } catch (e) {
      console.error('Telegram mesaj hatası:', e);
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

  const triggerDownload = (url) => {
    // Route through our server so the cross-origin image is streamed back with an
    // attachment header — a direct fetch/blob is blocked by CORS and silently fails.
    const link = document.createElement('a');
    link.href = `/api/download?url=${encodeURIComponent(url)}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
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

  const fileToBase64 = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result); // data URL (KIE accepts data URL or pure base64)
    reader.onerror = () => reject(new Error('Dosya okunamadı'));
    reader.readAsDataURL(file);
  });

  // Upload an image to KIE storage (via our server) and return a public URL.
  const uploadImage = async (file, label) => {
    const compressed = await compressImage(file);
    const base64Data = await fileToBase64(compressed);
    const res = await fetch('/api/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ base64Data, fileName: compressed.name || 'image.jpg' }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(`${label} yüklenemedi: ${body.error || `HTTP ${res.status}`}`);
    }
    const { url } = await res.json();
    if (!url) throw new Error(`${label} yüklenemedi: sunucudan URL gelmedi`);
    return url;
  };

  const handleGenerate = async () => {
    if (!outerShoe) { showToast('En azından Dış Ayakkabı görüntüsü yüklenmelidir.'); return; }

    setLoading(true);
    setResultImgs([]);

    const userHint = customPrompt.trim();
    const locationHint = location.trim();

    try {
      // Step 1: Upload images to KIE storage
      const outerUrl = await uploadImage(outerShoe.file, 'Dış ayakkabı görseli');
      let innerUrl = innerShoe ? await uploadImage(innerShoe.file, 'İç ayakkabı görseli') : null;
      let referenceUrl = referenceImg ? await uploadImage(referenceImg.file, 'Referans görseli') : null;

      // Step 2: Generate prompt via OpenAI (always)
      let generatedPrompt = "Premium photorealistic fashion advertising photograph of elegant designer women's shoes worn on a female fashion model's legs and feet, smooth flawless hair-free model legs with even-toned healthy skin and no stubble or visible hair follicles, editorial street-style composition, shot on an 85mm lens, shallow depth of field, soft natural light, ultra-realistic textures, sharp focus, refined colour grading, magazine quality.";

      try {
          let systemPromptText = "You are a world-class creative director and prompt engineer for luxury women's footwear advertising campaigns. FIRST, carefully study and analyse the uploaded shoe image(s) in detail before writing anything: identify the exact shoe type and silhouette (e.g. heeled sandal, stiletto, block heel, ballet flat, loafer, mule, boot, sneaker), the precise colour(s) and finish (matte, glossy, metallic, patent, suede), the material and texture, the heel shape and height, the toe shape, any straps, buckles, laces, embellishments, stitching, the sole and any hardware. Base your ENTIRE prompt STRICTLY on what you actually observe in the images — reproduce the real shoe faithfully and accurately, and never invent, generalise, guess or substitute a different shoe. All uploaded product images always show a women's shoe, so the prompt must always treat the footwear as women's shoes. ";
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

          if (referenceUrl) {
            contentItems.push({ type: "image_url", image_url: { url: referenceUrl } });
            systemPromptText += `Image ${nextImageIndex} is a reference photo of a person. Write ONE highly detailed English prompt for an image-to-image AI model. Faithfully recreate the reference photo (Image ${nextImageIndex}) — exact same person, pose, body proportions, clothing and mood — but REPLACE their footwear with the exact women's shoes from the earlier images. Describe the shoes with precise, true-to-source detail: material, finish, colour, stitching, sole, hardware and texture, so they look photorealistic and perfectly fitted on the feet. `;
            if (locationHint) {
              systemPromptText += `IMPORTANT: change the background/setting of the recreated scene to the location described below (do NOT keep the reference photo's original background). `;
            }
          } else {
            systemPromptText += `Write ONE highly detailed English prompt for a premium AI image generation model. The prompt must describe a high-end fashion advertising photograph featuring the exact women's shoes from the image(s) above, worn on the feet of an elegant female fashion model. Frame the composition to focus ONLY on her legs and feet — her upper body and face MUST NOT be visible. Describe the shoes precisely and accurately (material, finish, colour, stitching, sole, hardware, texture). The pose must look natural, confident and editorial, like a luxury street-style or campaign shot. The model's legs MUST look like a real professional fashion model's legs: completely hair-free and naturally smooth, with flawless, even-toned skin — absolutely no stubble, no visible hair follicles, no razor irritation, no goosebumps, no ingrown hairs, no shaving rash, no blemishes and no pores that read as rough. The skin should look healthy, softly luminous and well cared for, yet still authentic and photorealistic — never airbrushed, waxy, plastic or CGI. `;
          }

          if (locationHint) {
            systemPromptText += `The scene MUST be set in this specific real-world location: "${locationHint}". Convey the location ONLY through its real visual elements — the actual landmark itself, characteristic architecture, surroundings, atmosphere and natural lighting. NEVER identify the place using any written text, place-name sign, plaque, engraving, stone tablet, label or caption; the location must be recognisable purely from the imagery, with no words anywhere. `;
          }

          systemPromptText += `Make the result cinematic and genuinely premium: photographed on a full-frame camera with an 85mm lens, shallow depth of field with tasteful background bokeh, soft natural directional light, true-to-life colours, ultra-realistic material textures, crisp sharp focus on the shoes, refined professional colour grading, high dynamic range and magazine-quality composition. Any visible leg skin must always read as smooth, hair-free and flawless professional-model skin — never rough, stubbly, or with visible follicles. Strictly avoid any cartoonish, plastic, CGI, over-saturated or artificial look. `;

          if (userHint) {
            systemPromptText += `You MUST also naturally incorporate this user instruction into the prompt: "${userHint}". `;
          }

          systemPromptText += `CRITICAL FIDELITY: reproduce the uploaded shoe EXACTLY as it appears — identical shape, colour, finish, material and perforation/pattern. Do NOT add, remove, alter or invent any detail. In particular, do NOT add any logo, brand name, metal tag, badge, plaque, buckle, stud, charm, embellishment or hardware that is not clearly visible on the uploaded shoe; if the real shoe has no such element, the generated shoe must have none either. `;

          systemPromptText += `The generated image MUST contain absolutely NO text of any kind — no letters, words, captions, labels, place-name signs, street signs, shop signs, engraved plaques, stone tablets, posters, logos, watermarks, brand names, numbers or typography anywhere in the frame. Explicitly state this no-text requirement inside the prompt you write. `;

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
          console.log("OpenAI raw prompt:", generatedPrompt);
        } catch (err) {
          console.error("OpenAI Error:", err);
          throw new Error("OpenAI bağlantı hatası: " + (err.message || 'API anahtarını kontrol edin.'));
        }

      // Guarantee the chosen location is present in the final prompt,
      // regardless of how OpenAI phrased its output.
      if (locationHint && !generatedPrompt.toLowerCase().includes(locationHint.toLowerCase())) {
        generatedPrompt += ` The entire scene is set in ${locationHint}, recognisable purely through its real landmark, architecture, surroundings and natural lighting — never through any written place name, sign, plaque, engraving or text.`;
      }

      // Always guarantee strict no-text + shoe-fidelity instructions reach the image model.
      generatedPrompt += ` The depicted shoe must match the uploaded product shoe exactly, with no added logos, metal tags, badges, buckles, hardware or embellishments that are not on the original. Absolutely no text of any kind anywhere in the image — no letters, words, captions, labels, place-name signs, street signs, shop signs, engraved plaques, stone tablets, posters, logos, watermarks, brand names or numbers; the result must be a purely photographic image with zero written characters.`;

      console.log("Final prompt sent to KIE:", generatedPrompt);

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

      const generateOne = async (index) => {
        // Each output gets a different camera angle / pose so a multi-shot request
        // returns varied views of the same shoe — skipped when recreating a
        // reference photo (its pose must stay fixed) or for a single output.
        let taskPrompt = generatedPrompt;
        if (!referenceUrl && numImages > 1) {
          taskPrompt += ' ' + ANGLE_VARIATIONS[index % ANGLE_VARIATIONS.length];
        }
        const submitRes = await fetch('/api/kie/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...kieInput, prompt: taskPrompt }),
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
        Array.from({ length: numImages }, (_, i) => generateOne(i))
      );
      const urls = taskResults.flat();

      if (urls.length > 0) {
        setResultImgs(urls);
        try {
          const tgRes = await fetch('/api/telegram/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ urls }),
          });
          const tgData = await tgRes.json().catch(() => ({}));
          if (tgData.failures?.length > 0) {
            console.error('Telegram gönderim hataları:', tgData.failures);
            showToast(`Telegram gönderiminde sorun: ${tgData.failures.join(' | ')}`);
          }
        } catch (telErr) {
          console.error('Telegram gönderim isteği hatası:', telErr);
          showToast('Görseller hazır ama Telegram\'a gönderilemedi.');
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

          {/* Output / Angle Count */}
          <div style={{ marginTop: '1.25rem' }}>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
              Açı / Çıktı Sayısı <span style={{ opacity: 0.6 }}>(kaç farklı açıda görsel üretilsin, 1–{MAX_OUTPUTS})</span>
            </p>
            <input
              type="number"
              min={1}
              max={MAX_OUTPUTS}
              value={numImages}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                if (Number.isNaN(v)) { setNumImages(1); return; }
                setNumImages(Math.max(1, Math.min(MAX_OUTPUTS, v)));
              }}
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
            <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', opacity: 0.7, display: 'block', marginTop: '0.4rem' }}>
              Birden fazla girilirse her görsel ayakkabıyı farklı açı ve pozda gösterir.
            </span>
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
