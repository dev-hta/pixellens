/**
 * PipelineOrchestrator — Controls the full GCam-style image processing pipeline.
 * Coordinates alignment, merging, denoising, tone mapping, color science, and sharpening.
 */
export class PipelineOrchestrator {
  /**
   * @param {import('../gpu/WebGPUContext.js').WebGPUContext} gpu
   * @param {object} deviceProfile - Device-specific configuration (noise model, tone, color)
   */
  constructor(gpu, deviceProfile) {
    this.gpu = gpu;
    this.profile = deviceProfile;
    this._progressCallback = null;
    this._stages = [
      { name: 'Analyzing frames…', weight: 5 },
      { name: 'Aligning frames…', weight: 25 },
      { name: 'Merging burst…', weight: 20 },
      { name: 'Reducing noise…', weight: 20 },
      { name: 'Tone mapping…', weight: 15 },
      { name: 'Color science…', weight: 10 },
      { name: 'Sharpening…', weight: 5 },
    ];
  }

  /**
   * Set progress callback.
   * @param {Function} cb - (percent: number, stage: string) => void
   */
  onProgress(cb) {
    this._progressCallback = cb;
  }

  /**
   * Report progress.
   */
  _reportProgress(stageIndex, stagePercent = 1.0) {
    if (!this._progressCallback) return;
    let totalPercent = 0;
    for (let i = 0; i < stageIndex; i++) {
      totalPercent += this._stages[i].weight;
    }
    totalPercent += this._stages[stageIndex].weight * stagePercent;
    this._progressCallback(
      Math.round(totalPercent),
      this._stages[stageIndex].name
    );
  }

  /**
   * Run the full processing pipeline.
   * @param {ImageData[]} frames - Burst frames (1 for portrait/pro, N for HDR/night)
   * @param {string} mode - 'hdr' | 'night' | 'portrait' | 'pro'
   * @param {object} overrides - User-adjustable parameter overrides
   * @returns {Promise<{processed: ImageData, original: ImageData}>}
   */
  async process(frames, mode, overrides = {}) {
    if (!frames || frames.length === 0) {
      throw new Error('No frames to process');
    }

    const width = frames[0].width;
    const height = frames[0].height;
    const original = frames[0]; // Keep reference for before/after

    // Stage 0: Analyze
    this._reportProgress(0, 0);
    const referenceIdx = this._selectReferenceFrame(frames);
    const reference = frames[referenceIdx];
    this._reportProgress(0, 1);

    let merged;

    if (frames.length > 1) {
      // Stage 1: Alignment
      this._reportProgress(1, 0);
      const alignedFrames = [];
      for (let i = 0; i < frames.length; i++) {
        if (i === referenceIdx) {
          alignedFrames.push(reference);
        } else {
          const aligned = this._alignFrame(reference, frames[i]);
          alignedFrames.push(aligned);
        }
        this._reportProgress(1, (i + 1) / frames.length);
      }

      // Stage 2: Merge
      this._reportProgress(2, 0);
      merged = this._mergeFrames(reference, alignedFrames);
      this._reportProgress(2, 1);
    } else {
      merged = reference;
      this._reportProgress(1, 1);
      this._reportProgress(2, 1);
    }

    // Stage 3: Denoise
    this._reportProgress(3, 0);
    const denoised = this._denoise(merged, mode, overrides);
    this._reportProgress(3, 1);

    // Stage 4: Tone mapping
    this._reportProgress(4, 0);
    const tonemapped = this._toneMap(denoised, mode, overrides);
    this._reportProgress(4, 1);

    // Stage 5: Color science
    this._reportProgress(5, 0);
    const colored = this._applyColorScience(tonemapped, overrides);
    this._reportProgress(5, 1);

    // Stage 6: Sharpen
    this._reportProgress(6, 0);
    const sharpened = this._sharpen(colored, overrides);
    this._reportProgress(6, 1);

    return { processed: sharpened, original };
  }

  /**
   * Select the sharpest frame as reference (by edge gradient magnitude).
   * @param {ImageData[]} frames
   * @returns {number} Index of sharpest frame
   */
  _selectReferenceFrame(frames) {
    if (frames.length === 1) return 0;

    let bestIdx = 0;
    let bestSharpness = -1;

    for (let f = 0; f < frames.length; f++) {
      const data = frames[f].data;
      const w = frames[f].width;
      let sharpness = 0;

      // Sample: compute horizontal gradient on luminance, stride for speed
      const step = 8;
      for (let y = 0; y < frames[f].height; y += step) {
        for (let x = 1; x < w - 1; x += step) {
          const idx = (y * w + x) * 4;
          const lum = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
          const lumPrev = 0.299 * data[idx - 4] + 0.587 * data[idx - 3] + 0.114 * data[idx - 2];
          sharpness += Math.abs(lum - lumPrev);
        }
      }

      if (sharpness > bestSharpness) {
        bestSharpness = sharpness;
        bestIdx = f;
      }
    }

    return bestIdx;
  }

  /**
   * Align an alternate frame to the reference using tile-based matching.
   * CPU fallback implementation (WebGPU version in shaders/).
   * @param {ImageData} reference
   * @param {ImageData} alternate
   * @returns {ImageData}
   */
  _alignFrame(reference, alternate) {
    const w = reference.width;
    const h = reference.height;

    if (this.gpu.backend === 'webgpu') {
      // TODO: Use WebGPU alignment shader for GPU-accelerated alignment
      // For now, fall through to CPU implementation
    }

    // CPU tile-based alignment (simplified)
    const tileSize = 32;
    const searchRadius = 8;
    const tilesX = Math.floor(w / tileSize);
    const tilesY = Math.floor(h / tileSize);

    // Compute motion vectors per tile
    const motionField = new Float32Array(tilesX * tilesY * 2);

    for (let ty = 0; ty < tilesY; ty++) {
      for (let tx = 0; tx < tilesX; tx++) {
        const ox = tx * tileSize;
        const oy = ty * tileSize;

        let bestDx = 0, bestDy = 0;
        let bestSAD = Infinity;

        for (let dy = -searchRadius; dy <= searchRadius; dy++) {
          for (let dx = -searchRadius; dx <= searchRadius; dx++) {
            let sad = 0;
            let count = 0;

            // Compare tiles using Sum of Absolute Differences on luminance
            for (let py = 0; py < tileSize; py += 4) {
              for (let px = 0; px < tileSize; px += 4) {
                const rx = ox + px;
                const ry = oy + py;
                const ax = rx + dx;
                const ay = ry + dy;

                if (ax < 0 || ax >= w || ay < 0 || ay >= h) {
                  sad += 128; // Penalty for out-of-bounds
                  count++;
                  continue;
                }

                const ri = (ry * w + rx) * 4;
                const ai = (ay * w + ax) * 4;

                const rLum = 0.299 * reference.data[ri] + 0.587 * reference.data[ri + 1] + 0.114 * reference.data[ri + 2];
                const aLum = 0.299 * alternate.data[ai] + 0.587 * alternate.data[ai + 1] + 0.114 * alternate.data[ai + 2];

                sad += Math.abs(rLum - aLum);
                count++;
              }
            }

            sad /= count;
            if (sad < bestSAD) {
              bestSAD = sad;
              bestDx = dx;
              bestDy = dy;
            }
          }
        }

        const idx = (ty * tilesX + tx) * 2;
        motionField[idx] = bestDx;
        motionField[idx + 1] = bestDy;
      }
    }

    // Warp alternate frame using motion field
    const aligned = new ImageData(w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        // Find which tile this pixel belongs to
        const tx = Math.min(Math.floor(x / tileSize), tilesX - 1);
        const ty = Math.min(Math.floor(y / tileSize), tilesY - 1);
        const mi = (ty * tilesX + tx) * 2;
        const dx = motionField[mi];
        const dy = motionField[mi + 1];

        const sx = Math.round(x + dx);
        const sy = Math.round(y + dy);

        const di = (y * w + x) * 4;
        if (sx >= 0 && sx < w && sy >= 0 && sy < h) {
          const si = (sy * w + sx) * 4;
          aligned.data[di] = alternate.data[si];
          aligned.data[di + 1] = alternate.data[si + 1];
          aligned.data[di + 2] = alternate.data[si + 2];
          aligned.data[di + 3] = 255;
        } else {
          // Out of bounds — copy from reference
          aligned.data[di] = reference.data[di];
          aligned.data[di + 1] = reference.data[di + 1];
          aligned.data[di + 2] = reference.data[di + 2];
          aligned.data[di + 3] = 255;
        }
      }
    }

    return aligned;
  }

  /**
   * Merge aligned frames using robust temporal averaging (Wiener-like).
   * @param {ImageData} reference
   * @param {ImageData[]} alignedFrames
   * @returns {ImageData}
   */
  _mergeFrames(reference, alignedFrames) {
    const w = reference.width;
    const h = reference.height;
    const merged = new ImageData(w, h);
    const noiseModel = this.profile.noise_model || { ao: 600, as: 1200000 };

    for (let i = 0; i < w * h * 4; i += 4) {
      for (let c = 0; c < 3; c++) {
        const refVal = reference.data[i + c];
        const signal = refVal / 255;
        const noiseVar = noiseModel.ao + noiseModel.as * signal;
        const noiseStd = Math.sqrt(noiseVar) / 255 * 50; // Scaled to pixel domain

        let sum = refVal;
        let weightSum = 1.0;

        for (let f = 0; f < alignedFrames.length; f++) {
          if (alignedFrames[f] === reference) continue;
          const altVal = alignedFrames[f].data[i + c];
          const diff = Math.abs(altVal - refVal);

          // Robustness: reject if difference >> expected noise
          if (diff < 3.0 * noiseStd) {
            const weight = 1.0 / (1.0 + (diff / Math.max(noiseStd, 1)) ** 2);
            sum += altVal * weight;
            weightSum += weight;
          }
        }

        merged.data[i + c] = Math.round(sum / weightSum);
      }
      merged.data[i + 3] = 255; // Alpha
    }

    return merged;
  }

  /**
   * Dual-domain denoising: gentle luma + aggressive chroma.
   * @param {ImageData} image
   * @param {string} mode
   * @param {object} overrides
   * @returns {ImageData}
   */
  _denoise(image, mode, overrides) {
    const w = image.width;
    const h = image.height;
    const result = new ImageData(new Uint8ClampedArray(image.data), w, h);

    const lumaStrength = (overrides.denoise ?? this.profile.denoise?.levels?.[0]?.luma ?? 180) / 1000;
    const chromaStrength = (overrides.chroma ?? this.profile.denoise?.levels?.[0]?.chroma ?? 400) / 100;
    const revertFactor = this.profile.denoise?.levels?.[0]?.revert ?? 0.05;

    // Convert to YCbCr, denoise, convert back
    const Y = new Float32Array(w * h);
    const Cb = new Float32Array(w * h);
    const Cr = new Float32Array(w * h);

    // RGB → YCbCr
    for (let i = 0; i < w * h; i++) {
      const pi = i * 4;
      const r = image.data[pi] / 255;
      const g = image.data[pi + 1] / 255;
      const b = image.data[pi + 2] / 255;
      Y[i] = 0.299 * r + 0.587 * g + 0.114 * b;
      Cb[i] = -0.169 * r - 0.331 * g + 0.500 * b;
      Cr[i] = 0.500 * r - 0.419 * g - 0.081 * b;
    }

    // Luma denoise: simple 3×3 bilateral filter
    const Y_denoised = new Float32Array(w * h);
    const spatialSigma = 1.5;
    const rangeSigma = lumaStrength;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const ci = y * w + x;
        let sum = 0, wSum = 0;

        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const ny = y + dy, nx = x + dx;
            if (ny < 0 || ny >= h || nx < 0 || nx >= w) continue;
            const ni = ny * w + nx;
            const spatialDist = dx * dx + dy * dy;
            const rangeDist = (Y[ci] - Y[ni]) ** 2;
            const weight = Math.exp(-spatialDist / (2 * spatialSigma * spatialSigma) - rangeDist / (2 * rangeSigma * rangeSigma));
            sum += Y[ni] * weight;
            wSum += weight;
          }
        }

        Y_denoised[ci] = sum / wSum;
      }
    }

    // Chroma denoise: box blur
    const blurRadius = Math.round(chromaStrength);
    const Cb_denoised = this._boxBlur(Cb, w, h, blurRadius);
    const Cr_denoised = this._boxBlur(Cr, w, h, blurRadius);

    // Detail revert: blend back some original luminance
    for (let i = 0; i < w * h; i++) {
      const yFinal = Y_denoised[i] * (1 - revertFactor) + Y[i] * revertFactor;
      const cb = Cb_denoised[i];
      const cr = Cr_denoised[i];

      // YCbCr → RGB
      const r = yFinal + 1.402 * cr;
      const g = yFinal - 0.344 * cb - 0.714 * cr;
      const b = yFinal + 1.772 * cb;

      const pi = i * 4;
      result.data[pi] = Math.round(Math.min(1, Math.max(0, r)) * 255);
      result.data[pi + 1] = Math.round(Math.min(1, Math.max(0, g)) * 255);
      result.data[pi + 2] = Math.round(Math.min(1, Math.max(0, b)) * 255);
    }

    return result;
  }

  /**
   * Box blur helper.
   */
  _boxBlur(channel, w, h, radius) {
    if (radius < 1) return channel;
    const result = new Float32Array(w * h);
    const size = (2 * radius + 1);

    // Horizontal pass
    const temp = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let sum = 0, count = 0;
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx;
          if (nx >= 0 && nx < w) {
            sum += channel[y * w + nx];
            count++;
          }
        }
        temp[y * w + x] = sum / count;
      }
    }

    // Vertical pass
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let sum = 0, count = 0;
        for (let dy = -radius; dy <= radius; dy++) {
          const ny = y + dy;
          if (ny >= 0 && ny < h) {
            sum += temp[ny * w + x];
            count++;
          }
        }
        result[y * w + x] = sum / count;
      }
    }

    return result;
  }

  /**
   * Tone mapping: local Reinhard + shadow lift + highlight compression + S-curve.
   * @param {ImageData} image
   * @param {string} mode
   * @param {object} overrides
   * @returns {ImageData}
   */
  _toneMap(image, mode, overrides) {
    const w = image.width;
    const h = image.height;
    const result = new ImageData(new Uint8ClampedArray(image.data), w, h);

    const shadowStrength = (overrides.shadows ?? this.profile.tone_mapping?.shadow_lift ?? 18) / 100;
    const highlightStrength = (overrides.highlights ?? this.profile.tone_mapping?.highlight_compress ?? 12) / 100;
    const contrastSlope = this.profile.tone_mapping?.contrast_slope ?? 1.15;

    for (let i = 0; i < w * h; i++) {
      const pi = i * 4;
      let r = result.data[pi] / 255;
      let g = result.data[pi + 1] / 255;
      let b = result.data[pi + 2] / 255;
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;

      // Shadow lifting
      const shadowMask = this._smoothstep(0, 0.3, 1.0 - lum);
      const shadowLift = shadowMask * shadowStrength;
      r = r + shadowLift * (1.0 - r);
      g = g + shadowLift * (1.0 - g);
      b = b + shadowLift * (1.0 - b);

      // Highlight compression
      const highlightMask = this._smoothstep(0.7, 1.0, lum);
      const highlightCompress = highlightMask * highlightStrength;
      r = r - highlightCompress * r;
      g = g - highlightCompress * g;
      b = b - highlightCompress * b;

      // S-curve contrast
      r = this._sigmoid(r, 0.5, contrastSlope);
      g = this._sigmoid(g, 0.5, contrastSlope);
      b = this._sigmoid(b, 0.5, contrastSlope);

      result.data[pi] = Math.round(Math.min(1, Math.max(0, r)) * 255);
      result.data[pi + 1] = Math.round(Math.min(1, Math.max(0, g)) * 255);
      result.data[pi + 2] = Math.round(Math.min(1, Math.max(0, b)) * 255);
    }

    return result;
  }

  _smoothstep(edge0, edge1, x) {
    const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
  }

  _sigmoid(x, midpoint, slope) {
    return 1.0 / (1.0 + Math.exp(-slope * 10 * (x - midpoint)));
  }

  /**
   * Color science: white balance, vibrance, skin tone protection.
   * @param {ImageData} image
   * @param {object} overrides
   * @returns {ImageData}
   */
  _applyColorScience(image, overrides) {
    const w = image.width;
    const h = image.height;
    const result = new ImageData(new Uint8ClampedArray(image.data), w, h);

    const vibrance = (overrides.vibrance ?? this.profile.tone_mapping?.vibrance ?? 1.12);
    const vibranceFactor = typeof vibrance === 'number' && vibrance <= 1.5 ? vibrance : vibrance / 100 + 0.5;
    const wb = this.profile.color?.white_balance_bias || { r: 1.0, g: 1.0, b: 1.0 };

    for (let i = 0; i < w * h; i++) {
      const pi = i * 4;
      let r = result.data[pi] / 255;
      let g = result.data[pi + 1] / 255;
      let b = result.data[pi + 2] / 255;

      // White balance
      r *= wb.r;
      g *= wb.g;
      b *= wb.b;

      // Vibrance (boost less-saturated colors more)
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      const sat = Math.max(r, g, b) - Math.min(r, g, b);
      const boost = 1.0 + (vibranceFactor - 1.0) * (1.0 - sat);

      r = lum + (r - lum) * boost;
      g = lum + (g - lum) * boost;
      b = lum + (b - lum) * boost;

      result.data[pi] = Math.round(Math.min(255, Math.max(0, r * 255)));
      result.data[pi + 1] = Math.round(Math.min(255, Math.max(0, g * 255)));
      result.data[pi + 2] = Math.round(Math.min(255, Math.max(0, b * 255)));
    }

    return result;
  }

  /**
   * Unsharp mask sharpening.
   * @param {ImageData} image
   * @param {object} overrides
   * @returns {ImageData}
   */
  _sharpen(image, overrides) {
    const w = image.width;
    const h = image.height;
    const amount = (overrides.sharpness ?? 50) / 100;

    if (amount < 0.05) return image;

    const result = new ImageData(new Uint8ClampedArray(image.data), w, h);

    // Simple 3×3 unsharp mask
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const ci = (y * w + x) * 4;

        for (let c = 0; c < 3; c++) {
          const center = image.data[ci + c];
          // 3×3 average of neighbors
          const avg = (
            image.data[((y - 1) * w + x - 1) * 4 + c] +
            image.data[((y - 1) * w + x) * 4 + c] +
            image.data[((y - 1) * w + x + 1) * 4 + c] +
            image.data[(y * w + x - 1) * 4 + c] +
            center +
            image.data[(y * w + x + 1) * 4 + c] +
            image.data[((y + 1) * w + x - 1) * 4 + c] +
            image.data[((y + 1) * w + x) * 4 + c] +
            image.data[((y + 1) * w + x + 1) * 4 + c]
          ) / 9;

          const diff = center - avg;
          const sharpened = center + diff * amount * 2;
          result.data[ci + c] = Math.min(255, Math.max(0, Math.round(sharpened)));
        }
      }
    }

    return result;
  }
}
