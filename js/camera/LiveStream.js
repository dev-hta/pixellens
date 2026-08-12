/**
 * LiveStream — Manages getUserMedia video stream for real-time capture.
 * Handles camera selection, resolution negotiation, and frame extraction.
 */
export class LiveStream {
  constructor() {
    this.stream = null;
    this.videoEl = null;
    this.facingMode = 'environment'; // 'environment' (back) or 'user' (front)
    this.actualWidth = 0;
    this.actualHeight = 0;
    this._offscreenCanvas = null;
    this._offscreenCtx = null;
  }

  /**
   * Start the camera stream and attach to a <video> element.
   * @param {HTMLVideoElement} videoEl - The video element to display the stream.
   * @param {string} facingMode - 'environment' for back camera, 'user' for front.
   * @returns {Promise<{width: number, height: number}>} Actual resolution obtained.
   */
  async start(videoEl, facingMode = 'environment') {
    this.videoEl = videoEl;
    this.facingMode = facingMode;

    // Stop any existing stream
    this.stop();

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: facingMode },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 30 },
        },
        audio: false,
      });
    } catch (err) {
      console.error('[LiveStream] getUserMedia failed:', err);
      throw new Error(`Camera access denied: ${err.message}`);
    }

    videoEl.srcObject = this.stream;

    // Wait for video to be ready
    await new Promise((resolve) => {
      videoEl.onloadedmetadata = () => {
        videoEl.play().then(resolve).catch(resolve);
      };
    });

    // Check actual resolution
    const track = this.stream.getVideoTracks()[0];
    const settings = track.getSettings();
    this.actualWidth = settings.width || videoEl.videoWidth;
    this.actualHeight = settings.height || videoEl.videoHeight;

    // Prepare offscreen canvas for frame extraction
    this._offscreenCanvas = new OffscreenCanvas(this.actualWidth, this.actualHeight);
    this._offscreenCtx = this._offscreenCanvas.getContext('2d', { willReadFrequently: true });

    console.log(`[LiveStream] Started: ${this.actualWidth}×${this.actualHeight} @ ${settings.frameRate || '?'}fps`);
    return { width: this.actualWidth, height: this.actualHeight };
  }

  /**
   * Switch between front and back camera.
   * @returns {Promise<{width: number, height: number}>}
   */
  async switchCamera() {
    this.facingMode = this.facingMode === 'environment' ? 'user' : 'environment';
    return this.start(this.videoEl, this.facingMode);
  }

  /**
   * Grab a single frame from the video stream as ImageData.
   * @returns {ImageData|null}
   */
  grabFrame() {
    if (!this.videoEl || !this._offscreenCtx || this.videoEl.readyState < 2) {
      return null;
    }

    this._offscreenCtx.drawImage(this.videoEl, 0, 0, this.actualWidth, this.actualHeight);
    return this._offscreenCtx.getImageData(0, 0, this.actualWidth, this.actualHeight);
  }

  /**
   * Estimate average brightness of the current frame (0.0 = black, 1.0 = white).
   * Samples a grid of pixels for performance.
   * @returns {number}
   */
  estimateBrightness() {
    const frame = this.grabFrame();
    if (!frame) return 0.5;

    const data = frame.data;
    const step = Math.max(1, Math.floor(data.length / (4 * 1000))); // Sample ~1000 pixels
    let sum = 0;
    let count = 0;

    for (let i = 0; i < data.length; i += step * 4) {
      // Luminance: 0.299R + 0.587G + 0.114B
      sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      count++;
    }

    return (sum / count) / 255;
  }

  /**
   * Check if the stream is active.
   * @returns {boolean}
   */
  get isActive() {
    return this.stream !== null && this.stream.active;
  }

  /**
   * Get resolution string for display.
   * @returns {string}
   */
  get resolutionLabel() {
    if (this.actualWidth >= 3840) return '4K';
    if (this.actualWidth >= 1920) return '1080p';
    if (this.actualWidth >= 1280) return '720p';
    if (this.actualWidth >= 640) return '480p';
    return `${this.actualWidth}×${this.actualHeight}`;
  }

  /**
   * Stop the stream and release resources.
   */
  stop() {
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }
    if (this.videoEl) {
      this.videoEl.srcObject = null;
    }
  }
}
