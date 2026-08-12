// GCam Tone Mapping Compute Shader
// Shadow Lift, Highlight Recovery, and S-Curve Contrast

struct ToneMapParams {
    width : u32,
    height : u32,
    shadowLift : f32,
    highlightCompress : f32,
    contrastSlope : f32,
    vibrance : f32,
};

@group(0) @binding(0) var inTex : texture_2d<f32>;
@group(0) @binding(1) var outTex : texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<uniform> params : ToneMapParams;

fn smoothstepCustom(e0 : f32, e1 : f32, x : f32) -> f32 {
    let t = clamp((x - e0) / (e1 - e0), 0.0, 1.0);
    return t * t * (3.0 - 2.0 * t);
}

fn sigmoidCustom(x : f32, midpoint : f32, slope : f32) -> f32 {
    return 1.0 / (1.0 + exp(-slope * 10.0 * (x - midpoint)));
}

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) global_id : vec3<u32>) {
    let coords = vec2<i32>(i32(global_id.x), i32(global_id.y));

    if (global_id.x >= params.width || global_id.y >= params.height) {
        return;
    }

    var color = textureLoad(inTex, coords, 0).rgb;
    let lum = 0.299 * color.r + 0.587 * color.g + 0.114 * color.b;

    // 1. Shadow lifting
    let shadowMask = smoothstepCustom(0.0, 0.3, 1.0 - lum);
    let shadowLift = shadowMask * params.shadowLift;
    color = color + vec3<f32>(shadowLift) * (vec3<f32>(1.0) - color);

    // 2. Highlight compression
    let highlightMask = smoothstepCustom(0.7, 1.0, lum);
    let highlightCompress = highlightMask * params.highlightCompress;
    color = color - vec3<f32>(highlightCompress) * color;

    // 3. S-curve contrast
    color.r = sigmoidCustom(color.r, 0.5, params.contrastSlope);
    color.g = sigmoidCustom(color.g, 0.5, params.contrastSlope);
    color.b = sigmoidCustom(color.b, 0.5, params.contrastSlope);

    // 4. Vibrance adjustment
    let newLum = 0.299 * color.r + 0.587 * color.g + 0.114 * color.b;
    let sat = max(max(color.r, color.g), color.b) - min(min(color.r, color.g), color.b);
    let boost = 1.0 + (params.vibrance - 1.0) * (1.0 - sat);
    color = mix(vec3<f32>(newLum), color, boost);

    textureStore(outTex, coords, vec4<f32>(saturate(color), 1.0));
}
