/**
 * BokehRenderer — Renders synthetic depth-of-field lens bokeh
 * Blurs background dynamically based on depth map while keeping subject razor sharp.
 */
export class BokehRenderer {
  /**
   * Apply depth-dependent bokeh blur to image.
   * @param {ImageData} image
   * @param {Float32Array} depthMap
   * @param {number} maxBokehRadius - Max blur radius in pixels (default 18)
   * @returns {ImageData}
   */
  static render(image, depthMap, maxBokehRadius = 18) {
    const w = image.width;
    const h = image.height;
    const srcData = image.data;
    const output = new ImageData(new Uint8ClampedArray(srcData), w, h);
    const outData = output.data;

    // Fast box-disk bokeh synthesis
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const depth = depthMap[i];

        // Subject at depth 0.0 stays 100% sharp
        if (depth < 0.1) continue;

        const radius = Math.round(depth * maxBokehRadius);
        if (radius < 2) continue;

        let rSum = 0, gSum = 0, bSum = 0, count = 0;

        // Sample circular disk neighbourhood
        for (let dy = -radius; dy <= radius; dy += 2) {
          for (let dx = -radius; dx <= radius; dx += 2) {
            if (dx * dx + dy * dy <= radius * radius) {
              const nx = Math.min(w - 1, Math.max(0, x + dx));
              const ny = Math.min(h - 1, Math.max(0, y + dy));
              const npi = (ny * w + nx) * 4;

              rSum += srcData[npi];
              gSum += srcData[npi + 1];
              bSum += srcData[npi + 2];
              count++;
            }
          }
        }

        const pi = i * 4;
        outData[pi] = Math.round(rSum / count);
        outData[pi + 1] = Math.round(gSum / count);
        outData[pi + 2] = Math.round(bSum / count);
      }
    }

    return output;
  }
}
