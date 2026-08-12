/**
 * Segmentor & DepthEstimator — Lightweight, high-speed subject isolation
 * Generates person foreground masks and synthetic depth maps for Portrait Mode.
 */
export class Segmentor {
  /**
   * Generate subject segmentation mask and depth map.
   * @param {ImageData} image
   * @returns {{mask: Float32Array, depthMap: Float32Array}}
   */
  static process(image) {
    const w = image.width;
    const h = image.height;
    const data = image.data;

    const mask = new Float32Array(w * h);
    const depthMap = new Float32Array(w * h);

    const centerX = w / 2;
    const centerY = h * 0.45; // Subject center (head/body focus region)
    const maxDist = Math.sqrt(centerX * centerX + centerY * centerY);

    // Salient subject detection using center-weighted skin-tone and luminance variance
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x);
        const pi = i * 4;

        const r = data[pi];
        const g = data[pi + 1];
        const b = data[pi + 2];

        // Skin tone detection metric
        const isSkin = (r > 95 && g > 40 && b > 20 && (Math.max(r, g, b) - Math.min(r, g, b) > 15) && Math.abs(r - g) > 15 && r > g && r > b);

        // Center proximity
        const dx = x - centerX;
        const dy = y - centerY;
        const dist = Math.sqrt(dx * dx + dy * dy) / maxDist;
        const proximity = Math.max(0, 1.0 - dist * 1.4);

        // Combine skin tone + center weight + vertical gradient
        let subjectWeight = (isSkin ? 0.7 : 0.3) * proximity;
        if (y > h * 0.2 && y < h * 0.8 && Math.abs(x - centerX) < w * 0.3) {
          subjectWeight += 0.4;
        }

        const isForeground = subjectWeight > 0.45 ? 1.0 : 0.0;
        mask[i] = isForeground;

        // Depth map: 0.0 = foreground subject, 1.0 = distant background
        depthMap[i] = isForeground > 0.5 ? 0.0 : Math.min(1.0, dist * 1.2);
      }
    }

    return { mask, depthMap };
  }
}
