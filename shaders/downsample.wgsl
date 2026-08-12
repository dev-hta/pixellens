// Downsample Compute Shader (2x downsampling via box filter)

@group(0) @binding(0) var inputTex : texture_2d<f32>;
@group(0) @binding(1) var outputTex : texture_storage_2d<rgba8unorm, write>;

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) global_id : vec3<u32>) {
    let outSize = textureDimensions(outputTex);
    if (global_id.x >= outSize.x || global_id.y >= outSize.y) {
        return;
    }

    let srcX = global_id.x * 2u;
    let srcY = global_id.y * 2u;

    let c00 = textureLoad(inputTex, vec2<i32>(i32(srcX), i32(srcY)), 0);
    let c10 = textureLoad(inputTex, vec2<i32>(i32(srcX + 1u), i32(srcY)), 0);
    let c01 = textureLoad(inputTex, vec2<i32>(i32(srcX), i32(srcY + 1u)), 0);
    let c11 = textureLoad(inputTex, vec2<i32>(i32(srcX + 1u), i32(srcY + 1u)), 0);

    let avg = (c00 + c10 + c01 + c11) * 0.25;
    textureStore(outputTex, vec2<i32>(global_id.xy), avg);
}
