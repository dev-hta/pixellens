/**
 * NativeCapture — Uses <input type="file" capture> to trigger the native iOS camera.
 * Returns full-resolution images processed through Apple's own computational pipeline.
 */
export class NativeCapture {
  constructor() {
    this.inputEl = null;
    this._resolveCapture = null;
  }

  /**
   * Initialize with a hidden file input element.
   * @param {HTMLInputElement} inputEl
   */
  init(inputEl) {
    this.inputEl = inputEl;

    this.inputEl.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (file && this._resolveCapture) {
        this._resolveCapture(file);
        this._resolveCapture = null;
      }
      // Reset input so same file can be re-selected
      this.inputEl.value = '';
    });
  }

  /**
   * Trigger native camera and wait for user to capture a photo.
   * @returns {Promise<ImageData>} Full-resolution image data.
   */
  async capture() {
    return new Promise((resolve, reject) => {
      this._resolveCapture = async (file) => {
        try {
          const bitmap = await createImageBitmap(file);
          const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(bitmap, 0, 0);
          const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
          bitmap.close();
          resolve(imageData);
        } catch (err) {
          reject(new Error(`Failed to process captured image: ${err.message}`));
        }
      };

      this.inputEl.click();
    });
  }

  /**
   * Load an image file (from gallery or drag-drop) as ImageData.
   * @param {File} file
   * @returns {Promise<ImageData>}
   */
  async loadFile(file) {
    const bitmap = await createImageBitmap(file);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0);
    const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    bitmap.close();
    return imageData;
  }
}
