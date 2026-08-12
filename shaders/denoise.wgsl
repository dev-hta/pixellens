// Dual-Domain Denoise Compute Shader
// Gentle Bilateral Filter on Luminance + Aggressive Blur on Chrominance

struct DenoiseParams {
    width : u32,
    height : u32,
    lumaStrength : f32,
    chromaStrength : f32,
    revertFactor : f32,
};

@group(0) @binding(0) var inTex : texture_2d<f32>;
@group(0) @binding(1) var outTex : texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<uniform> params : DenoiseParams;

fn rgbToYCbCr(rgb : vec3<f32>) -> vec3<f32> {
    let y = 0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b;
    let cb = -0.169 * rgb.r - 0.331 * rgb.g + 0.500 * rgb.b;
    let cr = 0.500 * rgb.r - 0.419 * rgb.g - 0.081 * rgb.b;
    return vec3<f32>(y, cb, cr);
}

fn yCbCrToRgb(ycbcr : vec3<f32>) -> vec3<f32> {
    let r = ycbcr.x + 1.402 * ycbcr.z;
    let g = ycbcr.x - 0.344 * ycbcr.y - 0.714 * ycbcr.z;
    let b = ycbcr.x + 1.772 * ycbcr.y;
    return saturate(vec3<f32>(r, g, b));
}

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) global_id : vec3<u32>) {
    let coords = vec2<i32>(i32(global_id.x), i32(global_id.y));

    if (global_id.x >= params.width || global_id.y >= params.height) {
        return;
    }

    let centerColor = textureLoad(inTex, coords, 0).rgb;
    let centerYCbCr = rgbToYCbCr(centerColor);

    let lumaRangeSigma = max(params.lumaStrength, 0.01);
    let chromaRadius = i32(clamp(params.chromaStrength, 1.0, 5.0));

    var lumaSum = 0.0;
    var lumaW = 0.0;

    var cbSum = 0.0;
    var crSum = 0.0;
    var chromaCount = 0.0;

    // Bilateral on Luma + Box blur on Chroma in one pass
    for (var dy = -chromaRadius; dy <= chromaRadius; dy = dy + 1) {
        for (var dx = -chromaRadius; dx <= chromaRadius; dx = dx + 1) {
            let nx = clamp(coords.x + dx, 0, i32(params.width) - 1);
            let ny = clamp(coords.y + dy, 0, i32(params.height) - 1);

            let nColor = textureLoad(inTex, vec2<i32>(nx, ny), 0).rgb;
            let nYCbCr = rgbToYCbCr(nColor);

            // Luma bilateral weight (only within 3x3 window)
            if (abs(dx) <= 1 && abs(dy) <= 1) {
                let distSpatial = f32(dx * dx + dy * dy);
                let distRange = (centerYCbCr.x - nYCbCr.x) * (centerYCbCr.x - nYCbCr.x);
                let w = exp(-distSpatial / 4.5 - distRange / (2.0 * lumaRangeSigma * lumaRangeSigma));
                lumaSum = lumaSum + nYCbCr.x * w;
                lumaW = lumaW + w;
            }

            // Chroma blur sum
            cbSum = cbSum + nYCbCr.y;
            crSum = crSum + nYCbCr.z;
            chromaCount = chromaCount + 1.0;
        }
    }

    let denoisedLuma = lumaSum / max(lumaW, 0.0001);
    let denoisedCb = cbSum / chromaCount;
    let denoisedCr = crSum / chromaCount;

    // Detail Revert on Luma
    let finalLuma = mix(denoisedLuma, centerYCbCr.x, params.revertFactor);

    let finalRGB = yCbCrToRgb(vec3<f32>(finalLuma, denoisedCb, denoisedCr));
    textureStore(outTex, coords, vec4<f32>(finalRGB, 1.0));
}
