// PixelLens PWA Service Worker — Offline Support & Caching

const CACHE_NAME = 'pixellens-v1';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './config/default.json',
  './css/app.css',
  './icons/icon-192.svg',
  './js/app.js',
  './js/camera/CaptureManager.js',
  './js/camera/FrameBuffer.js',
  './js/camera/LiveStream.js',
  './js/camera/NativeCapture.js',
  './js/gpu/WebGPUContext.js',
  './js/pipeline/PipelineOrchestrator.js',
  './js/portrait/Segmentor.js',
  './js/portrait/BokehRenderer.js',
  './shaders/downsample.wgsl',
  './shaders/alignment.wgsl',
  './shaders/merge.wgsl',
  './shaders/denoise.wgsl',
  './shaders/tonemap.wgsl',
  './shaders/sharpen.wgsl',
  './shaders/bokeh.wgsl'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then((res) => {
      return res || fetch(e.request);
    })
  );
});
