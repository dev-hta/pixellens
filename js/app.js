/**
 * PixelLens — Main Application Controller
 * GCam computational photography philosophy as a web app for iPhone 13+
 */
import { WebGPUContext } from './gpu/WebGPUContext.js';
import { CaptureManager } from './camera/CaptureManager.js';
import { PipelineOrchestrator } from './pipeline/PipelineOrchestrator.js';

class PixelLensApp {
  constructor() {
    this.gpu = new WebGPUContext();
    this.capture = new CaptureManager();
    this.pipeline = null;
    this.deviceProfile = null;
    this.currentMode = 'hdr';
    this.isProcessing = false;
    this.lastResult = null;

    // DOM Elements
    this.dom = {};
  }

  /**
   * Boot the application.
   */
  async init() {
    this._cacheDom();
    this._updateSplash('Initializing WebGPU…');

    // 1. Initialize GPU
    const backend = await this.gpu.init();
    this.dom.gpuBadge.textContent = backend === 'webgpu' ? 'WebGPU' : backend === 'webgl2' ? 'WebGL2' : 'CPU';
    this._updateSplash(`GPU: ${backend}`);

    if (backend !== 'webgpu') {
      this.dom.gpuBadge.classList.remove('badge-accent');
      this.dom.gpuBadge.style.background = 'rgba(248, 113, 113, 0.15)';
      this.dom.gpuBadge.style.color = '#f87171';
    }

    this.dom.settingGpuInfo.textContent = backend;

    // 2. Load device profile
    this._updateSplash('Loading device profile…');
    this.deviceProfile = await this._loadDeviceProfile();

    // 3. Create pipeline
    this.pipeline = new PipelineOrchestrator(this.gpu, this.deviceProfile);
    this.pipeline.onProgress((percent, stage) => {
      this._updateProcessing(percent, stage);
    });

    // 4. Initialize camera
    this._updateSplash('Accessing camera…');
    try {
      await this.capture.init(this.dom.viewfinder, this.dom.nativeCapture);
      this.dom.resolutionBadge.textContent = this.capture.liveStream.resolutionLabel;
    } catch (err) {
      console.warn('[App] Camera init warning:', err.message);
      this.dom.resolutionBadge.textContent = 'Native';
    }

    // 5. Setup event listeners
    this._bindEvents();

    // 6. Hide splash
    this._updateSplash('Ready');
    await this._delay(400);
    this.dom.splashScreen.classList.add('fade-out');
    setTimeout(() => {
      this.dom.splashScreen.classList.add('hidden');
      this.dom.cameraScreen.classList.remove('hidden');
    }, 600);
  }

  /**
   * Cache all DOM element references.
   */
  _cacheDom() {
    this.dom = {
      // Splash
      splashScreen: document.getElementById('splash-screen'),
      splashStatus: document.getElementById('splash-status'),

      // Camera
      cameraScreen: document.getElementById('camera-screen'),
      viewfinder: document.getElementById('viewfinder'),
      previewCanvas: document.getElementById('preview-canvas'),
      resolutionBadge: document.getElementById('resolution-badge'),
      gpuBadge: document.getElementById('gpu-badge'),

      // Controls
      btnShutter: document.getElementById('btn-shutter'),
      btnSwitchCamera: document.getElementById('btn-switch-camera'),
      btnFlash: document.getElementById('btn-flash'),
      btnSettings: document.getElementById('btn-settings'),
      btnGallery: document.getElementById('btn-gallery'),

      // Mode selector
      modeBtns: document.querySelectorAll('.mode-btn'),

      // Burst counter
      burstCounter: document.getElementById('burst-counter'),
      burstCount: document.getElementById('burst-count'),
      burstTotal: document.getElementById('burst-total'),

      // Grid
      gridOverlay: document.getElementById('grid-overlay'),

      // Processing
      processingOverlay: document.getElementById('processing-overlay'),
      processingPercent: document.getElementById('processing-percent'),
      processingRingProgress: document.getElementById('processing-ring-progress'),
      processingStage: document.getElementById('processing-stage'),

      // Review
      reviewScreen: document.getElementById('review-screen'),
      resultCanvas: document.getElementById('result-canvas'),
      btnBackCamera: document.getElementById('btn-back-camera'),
      btnSave: document.getElementById('btn-save'),

      // Edit controls
      editDenoise: document.getElementById('edit-denoise'),
      editShadows: document.getElementById('edit-shadows'),
      editHighlights: document.getElementById('edit-highlights'),
      editVibrance: document.getElementById('edit-vibrance'),

      // Settings
      settingsPanel: document.getElementById('settings-panel'),
      btnCloseSettings: document.getElementById('btn-close-settings'),
      settingGrid: document.getElementById('setting-grid'),
      settingGpuInfo: document.getElementById('setting-gpu-info'),

      // Native capture
      nativeCapture: document.getElementById('native-capture'),

      // Focus ring
      focusRing: document.getElementById('focus-ring'),
    };
  }

  /**
   * Bind all event listeners.
   */
  _bindEvents() {
    // Shutter button
    this.dom.btnShutter.addEventListener('click', () => this._onShutter());

    // Camera switch
    this.dom.btnSwitchCamera.addEventListener('click', () => this._onSwitchCamera());

    // Mode selector
    this.dom.modeBtns.forEach((btn) => {
      btn.addEventListener('click', () => this._onModeChange(btn.dataset.mode));
    });

    // Settings
    this.dom.btnSettings.addEventListener('click', () => this._showSettings());
    this.dom.btnCloseSettings.addEventListener('click', () => this._hideSettings());
    this.dom.settingsPanel.querySelector('.settings-backdrop')?.addEventListener('click', () => this._hideSettings());

    // Gallery thumbnail click -> save/share latest photo
    this.dom.btnGallery.addEventListener('click', () => this._savePhoto());

    // Grid toggle
    this.dom.settingGrid.addEventListener('change', (e) => {
      this.dom.gridOverlay.classList.toggle('hidden', !e.target.checked);
    });

    // Tap to focus
    this.dom.viewfinder.addEventListener('click', (e) => this._onTapFocus(e));
  }

  /**
   * Handle shutter press.
   */
  async _onShutter() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    // Haptic feedback (if available)
    navigator.vibrate?.(50);

    // Animate shutter
    this.dom.btnShutter.classList.add('capturing');

    try {
      // Show burst counter for multi-frame modes
      if (this.currentMode === 'hdr' || this.currentMode === 'night') {
        const brightness = this.capture.liveStream.estimateBrightness();
        const totalFrames = this.capture.frameBuffer.constructor.adaptiveFrameCount(brightness);
        this.dom.burstTotal.textContent = totalFrames;
        this.dom.burstCounter.classList.remove('hidden');
      }

      // Capture frames
      const { frames, mode, metadata } = await this.capture.capture({
        onProgress: (captured, total) => {
          this.dom.burstCount.textContent = captured;
        },
      });

      this.dom.burstCounter.classList.add('hidden');
      console.log(`[App] Captured ${frames.length} frames in ${mode} mode`, metadata);

      // Show processing overlay
      this._showProcessing();

      // Process through pipeline
      const { processed, original } = await this.pipeline.process(frames, mode, {
        denoise: 50,
        shadows: 60,
        highlights: 40,
        vibrance: 55,
      });

      this.lastResult = { processed, original, metadata };

      // Update gallery thumbnail with processed image
      this._updateGalleryThumbnail(processed);

      // Hide processing overlay & return immediately to viewfinder
      this._hideProcessing();

      // Automatically trigger photo save/share (iOS Save to Photos)
      await this._savePhoto(processed);

    } catch (err) {
      console.error('[App] Capture/processing error:', err);
      this._hideProcessing();
      alert(`Error: ${err.message}`);
    } finally {
      this.dom.btnShutter.classList.remove('capturing');
      this.isProcessing = false;
      this.capture.resume();
    }
  }

  /**
   * Handle mode change.
   */
  _onModeChange(mode) {
    this.currentMode = mode;
    this.capture.setMode(mode);

    this.dom.modeBtns.forEach((btn) => {
      btn.setAttribute('aria-pressed', btn.dataset.mode === mode ? 'true' : 'false');
    });

    // Haptic
    navigator.vibrate?.(20);
  }

  /**
   * Handle camera switch.
   */
  async _onSwitchCamera() {
    try {
      await this.capture.switchCamera();
      this.dom.resolutionBadge.textContent = this.capture.liveStream.resolutionLabel;
    } catch (err) {
      console.error('[App] Camera switch failed:', err);
    }
  }

  /**
   * Handle tap-to-focus.
   */
  _onTapFocus(e) {
    const rect = this.dom.viewfinder.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const ring = this.dom.focusRing;
    ring.style.left = `${x}px`;
    ring.style.top = `${y}px`;
    ring.classList.remove('hidden');

    // Remove after animation
    setTimeout(() => ring.classList.add('hidden'), 800);
  }

  /**
   * Show processing overlay with progress.
   */
  _showProcessing() {
    this.dom.processingOverlay.classList.remove('hidden');
    this._updateProcessing(0, 'Starting…');
  }

  _updateProcessing(percent, stage) {
    this.dom.processingPercent.textContent = `${percent}%`;
    this.dom.processingStage.textContent = stage;

    // Update ring SVG
    const circumference = 2 * Math.PI * 42;
    const offset = circumference - (percent / 100) * circumference;
    this.dom.processingRingProgress.style.strokeDashoffset = offset;
  }

  _hideProcessing() {
    this.dom.processingOverlay.classList.add('hidden');
  }

  /**
   * Update gallery thumbnail with processed image.
   */
  _updateGalleryThumbnail(processed) {
    const canvas = document.createElement('canvas');
    canvas.width = processed.width;
    canvas.height = processed.height;
    const ctx = canvas.getContext('2d');
    ctx.putImageData(processed, 0, 0);

    const thumbCanvas = document.createElement('canvas');
    thumbCanvas.width = 96;
    thumbCanvas.height = 96;
    const thumbCtx = thumbCanvas.getContext('2d');
    thumbCtx.drawImage(canvas, 0, 0, 96, 96);

    const thumbInner = this.dom.btnGallery.querySelector('.gallery-thumb-inner');
    if (thumbInner) {
      thumbInner.style.backgroundImage = `url(${thumbCanvas.toDataURL('image/jpeg', 0.8)})`;
    }
  }

  /**
   * Save processed photo directly.
   */
  async _savePhoto(processedImage) {
    const imgData = processedImage || this.lastResult?.processed;
    if (!imgData) return;

    const canvas = document.createElement('canvas');
    canvas.width = imgData.width;
    canvas.height = imgData.height;
    const ctx = canvas.getContext('2d');
    ctx.putImageData(imgData, 0, 0);

    const quality = parseInt(document.getElementById('setting-quality')?.value ?? 100) / 100;
    const fileName = `pixellens_${Date.now()}.jpg`;

    canvas.toBlob(async (blob) => {
      if (!blob) return;

      const file = new File([blob], fileName, { type: 'image/jpeg' });

      // iOS Safari native Web Share API (allows direct "Save to Photos / Camera Roll")
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({
            files: [file],
            title: 'PixelLens Photo',
            text: 'Enhanced with PixelLens Computational Photography',
          });
          navigator.vibrate?.(100);
          return;
        } catch (err) {
          if (err.name !== 'AbortError') {
            console.warn('[App] Web Share failed, falling back to download:', err);
          }
        }
      }

      // Fallback: standard web download
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);

      navigator.vibrate?.(100);
    }, 'image/jpeg', quality);
  }

  /**
   * Handle edit slider changes (re-process with new parameters).
   */
  async _onEditChange() {
    if (!this.lastResult || this.isProcessing) return;

    // Re-process original with new settings
    this.isProcessing = true;
    try {
      const { processed } = await this.pipeline.process(
        [this.lastResult.original],
        this.currentMode,
        {
          denoise: parseInt(this.dom.editDenoise.value),
          shadows: parseInt(this.dom.editShadows.value),
          highlights: parseInt(this.dom.editHighlights.value),
          vibrance: parseInt(this.dom.editVibrance.value),
        }
      );

      const canvas = this.dom.resultCanvas;
      const ctx = canvas.getContext('2d');
      ctx.putImageData(processed, 0, 0);
      this.lastResult.processed = processed;
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Show settings panel.
   */
  _showSettings() {
    this.dom.settingsPanel.classList.remove('hidden');
  }

  _hideSettings() {
    this.dom.settingsPanel.classList.add('hidden');
  }

  /**
   * Load device profile (with auto-detection attempt).
   */
  async _loadDeviceProfile() {
    try {
      const res = await fetch('./config/default.json');
      return await res.json();
    } catch {
      // Inline fallback profile
      return {
        noise_model: { ao: 600, as: 1200000, bo: 18000, bs: 80000 },
        denoise: { levels: [{ luma: 180, chroma: 400, revert: 0.05 }] },
        tone_mapping: { shadow_lift: 18, highlight_compress: 12, contrast_slope: 1.15, vibrance: 1.12 },
        color: { white_balance_bias: { r: 1.0, g: 1.0, b: 1.02 } },
      };
    }
  }

  /**
   * Update splash screen status.
   */
  _updateSplash(msg) {
    if (this.dom.splashStatus) {
      this.dom.splashStatus.textContent = msg;
    }
  }

  /**
   * Delay helper.
   */
  _delay(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }
}

// --- Boot ---
const app = new PixelLensApp();
app.init().catch((err) => {
  console.error('[PixelLens] Fatal init error:', err);
  document.getElementById('splash-status').textContent = `Error: ${err.message}`;
});
