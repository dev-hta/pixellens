/**
 * WebGPUContext — Initializes and manages WebGPU device, adapter, and shader compilation.
 * Falls back to WebGL 2.0 or Canvas 2D if WebGPU is unavailable.
 */
export class WebGPUContext {
  constructor() {
    this.adapter = null;
    this.device = null;
    this.backend = 'none';
    this.capabilities = {};
    this.shaderCache = new Map();
  }

  /**
   * Initialize GPU backend with automatic fallback.
   * @returns {Promise<string>} The backend that was initialized: 'webgpu', 'webgl2', or 'canvas2d'.
   */
  async init() {
    // Try WebGPU first (iOS 26+ / Safari 26+)
    if (navigator.gpu) {
      try {
        this.adapter = await navigator.gpu.requestAdapter({
          powerPreference: 'high-performance',
        });

        if (this.adapter) {
          const adapterInfo = await this.adapter.requestAdapterInfo?.() ?? {};
          
          this.device = await this.adapter.requestDevice({
            requiredFeatures: [],
            requiredLimits: {
              maxStorageBufferBindingSize: Math.min(
                this.adapter.limits.maxStorageBufferBindingSize,
                128 * 1024 * 1024 // 128MB
              ),
              maxComputeWorkgroupSizeX: 256,
              maxComputeWorkgroupSizeY: 256,
              maxComputeWorkgroupsPerDimension: 65535,
              maxBufferSize: Math.min(
                this.adapter.limits.maxBufferSize,
                256 * 1024 * 1024
              ),
            },
          });

          this.device.lost.then((info) => {
            console.error('[WebGPU] Device lost:', info.message);
            if (info.reason !== 'destroyed') {
              this.init(); // Attempt to re-initialize
            }
          });

          this.backend = 'webgpu';
          this.capabilities = {
            maxTextureSize: this.device.limits.maxTextureDimension2D,
            maxBufferSize: this.device.limits.maxBufferSize,
            maxComputeWorkgroupSize: this.device.limits.maxComputeWorkgroupSizeX,
            adapterInfo,
          };

          console.log('[WebGPU] Initialized:', this.capabilities);
          return this.backend;
        }
      } catch (e) {
        console.warn('[WebGPU] Failed to init:', e);
      }
    }

    // Fallback to WebGL 2.0
    const testCanvas = document.createElement('canvas');
    const gl = testCanvas.getContext('webgl2');
    if (gl) {
      this.backend = 'webgl2';
      this.capabilities = {
        maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
        renderer: gl.getParameter(gl.RENDERER),
      };
      console.log('[WebGL2] Fallback initialized:', this.capabilities);
      return this.backend;
    }

    // Last resort: Canvas 2D
    this.backend = 'canvas2d';
    console.log('[Canvas2D] Fallback initialized');
    return this.backend;
  }

  /**
   * Compile and cache a WGSL compute shader.
   * @param {string} name - Shader identifier for caching.
   * @param {string} code - WGSL shader source code.
   * @returns {GPUShaderModule}
   */
  createShaderModule(name, code) {
    if (this.backend !== 'webgpu') {
      throw new Error(`Cannot create shader on backend: ${this.backend}`);
    }

    if (this.shaderCache.has(name)) {
      return this.shaderCache.get(name);
    }

    const module = this.device.createShaderModule({
      label: name,
      code,
    });

    this.shaderCache.set(name, module);
    return module;
  }

  /**
   * Create a compute pipeline from a shader module.
   * @param {string} label
   * @param {GPUShaderModule} shaderModule
   * @param {string} entryPoint
   * @returns {GPUComputePipeline}
   */
  createComputePipeline(label, shaderModule, entryPoint = 'main') {
    return this.device.createComputePipeline({
      label,
      layout: 'auto',
      compute: { module: shaderModule, entryPoint },
    });
  }

  /**
   * Create a GPU buffer.
   * @param {string} label
   * @param {number} size
   * @param {number} usage - GPUBufferUsage flags
   * @returns {GPUBuffer}
   */
  createBuffer(label, size, usage) {
    return this.device.createBuffer({ label, size, usage });
  }

  /**
   * Create a GPU texture from dimensions.
   * @param {string} label
   * @param {number} width
   * @param {number} height
   * @param {string} format
   * @returns {GPUTexture}
   */
  createTexture(label, width, height, format = 'rgba8unorm') {
    return this.device.createTexture({
      label,
      size: [width, height, 1],
      format,
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.STORAGE_BINDING |
        GPUTextureUsage.COPY_SRC |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.RENDER_ATTACHMENT,
    });
  }

  /**
   * Upload ImageData to a GPU texture.
   * @param {GPUTexture} texture
   * @param {ImageData} imageData
   */
  writeImageDataToTexture(texture, imageData) {
    this.device.queue.writeTexture(
      { texture },
      imageData.data,
      {
        bytesPerRow: imageData.width * 4,
        rowsPerImage: imageData.height,
      },
      [imageData.width, imageData.height, 1]
    );
  }

  /**
   * Read pixels back from a GPU texture to an ImageData.
   * @param {GPUTexture} texture
   * @param {number} width
   * @param {number} height
   * @returns {Promise<ImageData>}
   */
  async readTextureToImageData(texture, width, height) {
    const bytesPerRow = Math.ceil((width * 4) / 256) * 256; // Align to 256
    const bufferSize = bytesPerRow * height;

    const readBuffer = this.device.createBuffer({
      label: 'read-back',
      size: bufferSize,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });

    const commandEncoder = this.device.createCommandEncoder();
    commandEncoder.copyTextureToBuffer(
      { texture },
      { buffer: readBuffer, bytesPerRow, rowsPerImage: height },
      [width, height, 1]
    );
    this.device.queue.submit([commandEncoder.finish()]);

    await readBuffer.mapAsync(GPUMapMode.READ);
    const rawData = new Uint8Array(readBuffer.getMappedRange());

    // Unpad rows if bytesPerRow was padded
    const pixels = new Uint8ClampedArray(width * height * 4);
    const actualBytesPerRow = width * 4;
    for (let row = 0; row < height; row++) {
      const srcOffset = row * bytesPerRow;
      const dstOffset = row * actualBytesPerRow;
      pixels.set(rawData.subarray(srcOffset, srcOffset + actualBytesPerRow), dstOffset);
    }

    readBuffer.unmap();
    readBuffer.destroy();

    return new ImageData(pixels, width, height);
  }

  /**
   * Dispatch a compute shader.
   * @param {GPUComputePipeline} pipeline
   * @param {GPUBindGroup} bindGroup
   * @param {number} workgroupsX
   * @param {number} workgroupsY
   * @param {number} workgroupsZ
   */
  dispatch(pipeline, bindGroup, workgroupsX, workgroupsY = 1, workgroupsZ = 1) {
    const commandEncoder = this.device.createCommandEncoder();
    const pass = commandEncoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(workgroupsX, workgroupsY, workgroupsZ);
    pass.end();
    this.device.queue.submit([commandEncoder.finish()]);
  }

  /**
   * Clean up GPU resources.
   */
  destroy() {
    if (this.device) {
      this.device.destroy();
      this.device = null;
    }
    this.shaderCache.clear();
  }
}
