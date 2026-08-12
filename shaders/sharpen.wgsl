// Unsharp Mask Sharpening Compute Shader

struct SharpenParams {
    width : u32,
    height : u32,
    amount : f32,
};

@group(0) @binding(0) var inTex : texture_2d<f32>;
@group(0) @binding(1) var outTex : texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<uniform> params : SharpenParams;

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) global_id : vec3<u32>) {
    let coords = vec2<i32>(i32(global_id.x), i32(global_id.y));

    if (global_id.x >= params.width || global_id.y >= params.height) {
        return;
    }

    let center = textureLoad(inTex, coords, 0).rgb;

    if (params.amount < 0.05) {
        textureStore(outTex, coords, vec4<f32>(center, 1.0));
        return;
    }

    var avg = vec3<f32>(0.0);
    var count = 0.0;

    for (var dy = -1; dy <= 1; dy = dy + 1) {
        for (var dx = -1; dx <= 1; dx = dx + 1) {
            let nx = clamp(coords.x + dx, 0, i32(params.width) - 1);
            let ny = clamp(coords.y + dy, 0, i32(params.height) - 1);
            avg = avg + textureLoad(inTex, vec2<i32>(nx, ny), 0).rgb;
            count = count + 1.0;
        }
    }

    avg = avg / count;
    let diff = center - avg;
    let sharpened = center + diff * params.amount * 2.0;

    textureStore(outTex, coords, vec4<f32>(saturate(sharpened), 1.0));
}
