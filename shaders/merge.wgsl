// Robust Temporal Merge Compute Shader
// Merges aligned frame with reference using noise model-aware Wiener weighting.

struct MergeParams {
    width : u32,
    height : u32,
    noiseAo : f32,
    noiseAs : f32,
    frameWeight : f32,
};

@group(0) @binding(0) var refTex : texture_2d<f32>;
@group(0) @binding(1) var alignedTex : texture_2d<f32>;
@group(0) @binding(2) var outTex : texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(3) var<uniform> params : MergeParams;

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) global_id : vec3<u32>) {
    let coords = vec2<i32>(i32(global_id.x), i32(global_id.y));

    if (global_id.x >= params.width || global_id.y >= params.height) {
        return;
    }

    let refCol = textureLoad(refTex, coords, 0);
    let altCol = textureLoad(alignedTex, coords, 0);

    let lum = 0.299 * refCol.r + 0.587 * refCol.g + 0.114 * refCol.b;
    let noiseVar = params.noiseAo + params.noiseAs * lum;
    let noiseStd = max(sqrt(max(noiseVar, 0.0)) / 255.0 * 50.0, 0.01);

    var mergedR = refCol.r;
    var mergedG = refCol.g;
    var mergedB = refCol.b;
    var wSum = 1.0;

    let diffR = abs(altCol.r - refCol.r);
    let diffG = abs(altCol.g - refCol.g);
    let diffB = abs(altCol.b - refCol.b);
    let avgDiff = (diffR + diffG + diffB) / 3.0;

    // Reject motion artifacts (pixels with difference > 3 * noiseStd)
    if (avgDiff < 3.0 * noiseStd) {
        let weight = 1.0 / (1.0 + (avgDiff / noiseStd) * (avgDiff / noiseStd)) * params.frameWeight;
        mergedR = mergedR + altCol.r * weight;
        mergedG = mergedG + altCol.g * weight;
        mergedB = mergedB + altCol.b * weight;
        wSum = wSum + weight;
    }

    let finalColor = vec4<f32>(mergedR / wSum, mergedG / wSum, mergedB / wSum, 1.0);
    textureStore(outTex, coords, finalColor);
}
