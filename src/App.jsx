import { useState } from 'react';
import { Upload, Image as ImageIcon, Sparkles, X, Camera, Fingerprint, Download, Lock } from 'lucide-react';
import * as falAI from '@fal-ai/client';
import './App.css';

function App() {
  const [innerShoe, setInnerShoe] = useState(null);
  const [outerShoe, setOuterShoe] = useState(null);
  const [referenceImg, setReferenceImg] = useState(null);
  
  const [resultImg, setResultImg] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Settings
  const [falKey] = useState(import.meta.env.VITE_FAL_KEY || '');

  // Telegram Settings
  const telegramBotToken = import.meta.env.VITE_TELEGRAM_BOT_TOKEN || '';
  
  // Lütfen otomatik gönderim yapılmasını istediğiniz Telegram ID'leri bu listeye ekleyin.
  // Virgülle ayırarak birden fazla ID ekleyebilirsiniz. Örn: ['123', '456']
  const TELEGRAM_CHAT_IDS = ['7463074399'];

  const handleFileChange = (e, setter) => {
    const file = e.target.files[0];
    if (file) {
      setter({
        file,
        preview: URL.createObjectURL(file)
      });
    }
  };

  const removeImage = (e, setter) => {
    e.stopPropagation();
    e.preventDefault();
    setter(null);
  };

  // Helper function to force native download on click
  const triggerDownload = async (url) => {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = `sanal-deneme-${new Date().getTime()}.jpg`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(downloadUrl);
    } catch (e) {
      console.error("Auto download failed", e);
    }
  };

  const compressImage = (file, maxSizeMB = 3) => {
    return new Promise((resolve) => {
      const maxBytes = maxSizeMB * 1024 * 1024;
      if (file.size <= maxBytes) {
        resolve(file);
        return;
      }
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
    if (!falKey) {
      setError('Lütfen bir Fal AI API Anahtarı girin.');
      return;
    }
    if (!outerShoe) {
      setError('En azından Dış Ayakkabı görüntüsü yüklenmelidir.');
      return;
    }

    setLoading(true);
    setError(null);
    setResultImg(null);

    try {
      // Configure client setup parameters
      falAI.fal.config({
        credentials: falKey
      });

      // Step 1: Compress and upload images to Fal Storage
      setError(null);
      let outerFile = await compressImage(outerShoe.file);
      const outerUrl = await falAI.fal.storage.upload(outerFile).catch(e => {
        throw new Error('Görsel yüklenemedi (FAL Storage). Lütfen bağlantınızı kontrol edin. (' + e.message + ')');
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

      // Step 2: Use OpenAI to analyze the images and create a detailed prompt
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
        console.log("OpenAI Generated Prompt:", generatedPrompt);
      } catch (err) {
        console.error("OpenAI Error:", err);
        throw new Error("OpenAI bağlantı hatası: " + (err.message || 'API anahtarını kontrol edin.'));
      }

      // Step 3: Call the exact Nano Banana 2 API Endpoint
      const imageUrls = [outerUrl];
      if (innerUrl) imageUrls.push(innerUrl);
      if (referenceUrl) imageUrls.push(referenceUrl);

      const inputs = {
        prompt: generatedPrompt,
        image_urls: imageUrls,
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

      // Assume output returns an image url field named 'image' or an array of 'images'
      let finalImageUrl = null;
      if (result.data && result.data.images && result.data.images.length > 0) {
         finalImageUrl = result.data.images[0].url;
      } else if (result.data && result.data.image && result.data.image.url) {
         finalImageUrl = result.data.image.url;
      } else {
         // Fallback: look for any url property in data
         finalImageUrl = Object.values(result.data).find(v => typeof v === 'string' && v.startsWith('http'));
      }

      if (finalImageUrl) {
        setResultImg(finalImageUrl);
        
        // Telegram Sending Logic (Toplu Gönderim)
        if (TELEGRAM_CHAT_IDS.length > 0) {
          for (const chatId of TELEGRAM_CHAT_IDS) {
            try {
              await fetch(`https://api.telegram.org/bot${telegramBotToken}/sendPhoto`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  chat_id: chatId.trim(),
                  photo: finalImageUrl,
                  caption: 'Görsel hazır! ✨'
                })
              });
              console.log(`Telegram message sent successfully to -> ${chatId}`);
            } catch (telErr) {
              console.error(`Telegram API Error for ${chatId}:`, telErr);
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
              label="İç Ayakkabı (Opsiyonel)" 
              subLabel="(Tavan veya iç astar açısı)"
              state={innerShoe} 
              setter={setInnerShoe} 
              icon={ImageIcon} 
            />
            <UploadBox 
              label="Dış Ayakkabı (Zorunlu)" 
              subLabel="(Genel dış profil)"
              state={outerShoe} 
              setter={setOuterShoe} 
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
