# PixelLens — GCam Computational Photography for iPhone 13+

PixelLens brings the legendary **Google Camera (GCam) computational photography philosophy** (from the iconic Poco F1 / Pixel ports) directly to iPhone Safari as a zero-dependency web application powered by **WebGPU**.

---

## 🌟 Key Features

- **HDR+ Burst Engine**: Multi-frame Zero Shutter Lag alignment and robust temporal Wiener merging to reduce sensor noise by $\sqrt{N}$ while preserving fine textures.
- **Sensor Noise Model Calibration**: Custom noise profiles mapped from Sony camera sensors (analogous to GCam `.xml` config files).
- **Dual-Domain Denoising**: Gentle bilateral luminance filtering paired with aggressive chrominance noise removal to eliminate color noise without "oil painting" artifacts.
- **Google Color Science & Tone Mapping**: Shadow lifting, highlight protection, S-curve contrast, and vibrance adjustment tailored for natural skin tones and deep dynamic range.
- **Dual-Path Capture Architecture**:
  - **Live Path**: Real-time viewfinder & burst capture via `getUserMedia` video stream.
  - **Native Path**: Full 12MP resolution capture leveraging Apple's native camera interface via HTML Media Capture.
- **Zero-Dependency Architecture**: Pure static web application (HTML5, Vanilla CSS, ES Modules, WebGPU WGSL compute shaders). No Node.js build step or npm dependencies required — perfect for GitHub Pages!

---

## 🚀 How to Host on GitHub Pages (1-Minute Guide)

You can host this app on GitHub Pages for free in just a few steps:

### Option A: Via GitHub Desktop or Web Interface
1. Create a new repository on GitHub (e.g. `pixellens`).
2. Upload all files from the `gcam-web` folder into your new repository.
3. Go to **Settings** → **Pages**.
4. Under **Build and deployment**, set **Source** to `Deploy from a branch`.
5. Select `main` (or `master`) branch and folder `/ (root)`, then click **Save**.
6. GitHub will provide your live URL: `https://<your-username>.github.io/pixellens/`.

### Option B: Via Command Line (Git CLI)
```bash
cd "gcam-web"
git init
git add .
git commit -m "Initial release of PixelLens"
git branch -M main
git remote add origin https://github.com/<your-username>/pixellens.git
git push -u origin main
```
Then enable GitHub Pages under Repository Settings → Pages → Deploy from branch (`main` / root).

---

## 📱 Testing on iPhone (Safari)

1. Open Safari on your iPhone 13 / 14 / 15 / 16.
2. Navigate to your GitHub Pages URL (e.g., `https://<your-username>.github.io/pixellens/`).
3. Tap **Allow** when prompted for camera access.
4. Tap the **Shutter Button** to capture and process with HDR+ computational photography!
5. Optional: Tap **"Add to Home Screen"** in Safari's Share menu to install PixelLens as a full-screen Progressive Web App (PWA).

---

## 📂 Project Architecture

```
gcam-web/
├── index.html                 # Main UI structure (Viewfinder, Controls, Settings, Review)
├── manifest.json              # PWA manifest
├── README.md                  # Documentation & GitHub Pages guide
│
├── config/
│   └── default.json           # Sensor noise model & color profile (iPhone 13 calibrated)
│
├── css/
│   └── app.css                # Glassmorphism design system & camera UI styling
│
├── js/
│   ├── app.js                 # App controller & UI event binding
│   ├── camera/
│   │   ├── CaptureManager.js  # Dual-path capture orchestrator
│   │   ├── FrameBuffer.js     # Zero Shutter Lag (ZSL) circular frame buffer
│   │   ├── LiveStream.js      # getUserMedia stream & frame extraction
│   │   └── NativeCapture.js   # Full 12MP native camera interface
│   ├── gpu/
│   │   └── WebGPUContext.js   # WebGPU compute context & WebGL2/Canvas2D fallback
│   └── pipeline/
│       └── PipelineOrchestrator.js # GCam alignment, merge, denoise & tone mapping engine
│
└── shaders/                   # WebGPU Compute Shaders (WGSL)
    ├── alignment.wgsl         # Tile-based motion estimation & warp
    ├── denoise.wgsl           # Dual-domain luma + chroma denoise
    ├── downsample.wgsl        # Image pyramid downsampling
    ├── merge.wgsl             # Robust temporal Wiener merge
    ├── sharpen.wgsl           # Unsharp mask detail enhancement
    └── tonemap.wgsl           # HDR tone mapping & color science
```

---

## 🛠 Tech Stack

- **Graphics & Compute**: WebGPU (WGSL Compute Shaders), WebGL2 / Canvas2D Fallback
- **Camera API**: `navigator.mediaDevices.getUserMedia` + HTML5 Media Capture (`<input type="file" capture>`)
- **Structure**: Vanilla HTML5, CSS3 Custom Properties (Design Tokens), ES6 Modules
