/**
 * CaptureManager — Orchestrates both capture paths (live stream + native).
 * Determines optimal capture strategy based on mode and conditions.
 */
import { LiveStream } from './LiveStream.js';
import { NativeCapture } from './NativeCapture.js';
import { FrameBuffer } from './FrameBuffer.js';

export class CaptureManager {
  constructor() {
    this.liveStream = new LiveStream();
    this.nativeCapture = new NativeCapture();
    this.frameBuffer = new FrameBuffer(15);
    this.currentMode = 'hdr'; // 'hdr' | 'portrait' | 'night' | 'pro'
    this._onBurstProgress = null;
  }

  /**
   * Initialize both capture paths.
   * @param {HTMLVideoElement} videoEl
   * @param {HTMLInputElement} fileInputEl
   */
  async init(videoEl, fileInputEl) {
    this.nativeCapture.init(fileInputEl);
    try {
      await this.liveStream.start(videoEl);
      this.frameBuffer.startCapturing(this.liveStream);
    } catch (err) {
      console.warn('[CaptureManager] Live stream unavailable, will use native capture only:', err.message);
    }
  }

  /**
   * Set capture mode.
   * @param {'hdr'|'portrait'|'night'|'pro'} mode
   */
  setMode(mode) {
    this.currentMode = mode;
  }

  /**
   * Execute capture based on current mode.
   * @param {object} options
   * @param {number} [options.burstCount] - Override burst frame count
   * @param {Function} [options.onProgress] - Progress callback (framesCaptured, totalFrames)
   * @returns {Promise<{frames: ImageData[], mode: string, metadata: object}>}
   */
  async capture(options = {}) {
    const brightness = this.liveStream.isActive
      ? this.liveStream.estimateBrightness()
      : 0.5;

    const modeConfig = this._getModeConfig(brightness);
    const burstCount = options.burstCount || modeConfig.burstCount;

    let frames;

    switch (this.currentMode) {
      case 'hdr':
      case 'night':
        // Burst capture from live stream buffer
        if (this.liveStream.isActive) {
          frames = this.frameBuffer.captureNFrames(burstCount);
          if (options.onProgress) {
            options.onProgress(frames.length, burstCount);
          }
        } else {
          // Fallback: single native capture
          const img = await this.nativeCapture.capture();
          frames = [img];
        }
        break;

      case 'portrait':
      case 'pro':
        // Single frame — prefer native for full resolution
        if (this.liveStream.isActive) {
          const frame = this.liveStream.grabFrame();
          frames = frame ? [frame] : [await this.nativeCapture.capture()];
        } else {
          frames = [await this.nativeCapture.capture()];
        }
        break;

      default:
        frames = [this.liveStream.grabFrame() || await this.nativeCapture.capture()];
    }

    return {
      frames,
      mode: this.currentMode,
      metadata: {
        brightness,
        burstCount: frames.length,
        resolution: `${frames[0]?.width}×${frames[0]?.height}`,
        timestamp: Date.now(),
        facingMode: this.liveStream.facingMode,
      },
    };
  }

  /**
   * Get mode-specific configuration.
   * @param {number} brightness
   * @returns {object}
   */
  _getModeConfig(brightness) {
    switch (this.currentMode) {
      case 'hdr':
        return {
          burstCount: FrameBuffer.adaptiveFrameCount(brightness),
          denoise: 'moderate',
          tonemap: 'balanced',
        };
      case 'night':
        return {
          burstCount: Math.max(12, FrameBuffer.adaptiveFrameCount(brightness)),
          denoise: 'aggressive',
          tonemap: 'lifted',
        };
      case 'portrait':
        return {
          burstCount: 1,
          denoise: 'moderate',
          tonemap: 'balanced',
          segmentation: true,
          bokeh: true,
        };
      case 'pro':
        return {
          burstCount: 1,
          denoise: 'manual',
          tonemap: 'manual',
        };
      default:
        return { burstCount: 7 };
    }
  }

  /**
   * Switch camera (front/back).
   */
  async switchCamera() {
    this.frameBuffer.clear();
    await this.liveStream.switchCamera();
    this.frameBuffer.startCapturing(this.liveStream);
  }

  /**
   * Resume frame buffer after capture.
   */
  resume() {
    this.frameBuffer.resume();
  }

  /**
   * Stop all capture and release resources.
   */
  destroy() {
    this.frameBuffer.clear();
    this.liveStream.stop();
  }
}
