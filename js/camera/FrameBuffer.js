/**
 * FrameBuffer — Circular buffer that continuously stores video frames.
 * Implements the Zero Shutter Lag (ZSL) concept from GCam HDR+.
 */
export class FrameBuffer {
  constructor(maxSize = 15) {
    this.maxSize = maxSize;
    this.buffer = new Array(maxSize).fill(null);
    this.writeIndex = 0;
    this.frameCount = 0;
    this.frozen = false;
    this._animFrameId = null;
    this._liveStream = null;
  }

  /**
   * Start continuously capturing frames from a LiveStream.
   * @param {import('./LiveStream.js').LiveStream} liveStream
   */
  startCapturing(liveStream) {
    this._liveStream = liveStream;
    this.frozen = false;
    this._captureLoop();
  }

  /**
   * Internal capture loop using requestAnimationFrame.
   */
  _captureLoop() {
    if (this.frozen || !this._liveStream?.isActive) return;

    const frame = this._liveStream.grabFrame();
    if (frame) {
      this.buffer[this.writeIndex] = frame;
      this.writeIndex = (this.writeIndex + 1) % this.maxSize;
      this.frameCount++;
    }

    this._animFrameId = requestAnimationFrame(() => this._captureLoop());
  }

  /**
   * Freeze the buffer (stop writing) and extract the most recent N frames.
   * This is called on shutter press.
   * @param {number} count - Number of frames to extract.
   * @returns {ImageData[]} Array of frames, most recent last.
   */
  captureNFrames(count) {
    this.frozen = true;
    if (this._animFrameId) {
      cancelAnimationFrame(this._animFrameId);
      this._animFrameId = null;
    }

    count = Math.min(count, this.maxSize);
    const frames = [];

    // Read backwards from the most recent write position
    for (let i = 0; i < count; i++) {
      const idx = (this.writeIndex - 1 - i + this.maxSize) % this.maxSize;
      if (this.buffer[idx] !== null) {
        frames.unshift(this.buffer[idx]);
      }
    }

    return frames;
  }

  /**
   * Calculate optimal frame count based on lighting conditions.
   * Mirrors GCam's adaptive burst strategy.
   * @param {number} brightness - Average brightness (0.0 - 1.0)
   * @returns {number}
   */
  static adaptiveFrameCount(brightness) {
    if (brightness > 0.7) return 3;   // Bright daylight
    if (brightness > 0.3) return 7;   // Indoor / overcast
    if (brightness > 0.1) return 12;  // Dim / evening
    return 15;                         // Near darkness
  }

  /**
   * Resume capturing after a capture cycle.
   */
  resume() {
    this.frozen = false;
    if (this._liveStream?.isActive) {
      this._captureLoop();
    }
  }

  /**
   * Clear the buffer and release memory.
   */
  clear() {
    this.buffer.fill(null);
    this.writeIndex = 0;
    this.frameCount = 0;
    this.frozen = false;
    if (this._animFrameId) {
      cancelAnimationFrame(this._animFrameId);
      this._animFrameId = null;
    }
  }

  /**
   * Get the total number of valid frames currently in the buffer.
   * @returns {number}
   */
  get validFrameCount() {
    return this.buffer.filter((f) => f !== null).length;
  }
}
