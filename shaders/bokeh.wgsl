// Depth-Dependent Lens Bokeh Compute Shader
// Applies realistic optical disk blur with specular highlights based on subject depth map

struct BokehParams {
    width : u32,
    height : u32,
    maxRadius : f32,
    focalDepth : f32,
    apertureSize : f32,
};

@group(0) @binding(0) var colorTex : texture_2d<f32>;
@group(0) @binding(1) var depthTex : texture_2d<f32>;
@group(0) @binding(2) var outTex : texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(3) var<uniform> params : BokehParams;

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) global_id : vec3<u32>) {
    let coords = vec2<i32>(i32(global_id.x), i32(global_id.y));

    if (global_id.x >= params.width || global_id.y >= params.height) {
        return;
    }

    let centerColor = textureLoad(colorTex, coords, 0).rgb;
    let depthVal = textureLoad(depthTex, coords, 0).r;

    // Calculate CoC (Circle of Confusion) radius based on distance from focal depth
    let coc = abs(depthVal - params.focalDepth) * params.apertureSize;
    let radius = i32(clamp(coc * params.maxRadius, 0.0, params.maxRadius));

    if (radius <= 1) {
        textureStore(outTex, coords, vec4<f32>(centerColor, 1.0));
        return;
    }

    var accumColor = vec3<f32>(0.0);
    var accumWeight = 0.0;

    // Disk bokeh sampling
    for (var dy = -radius; dy <= radius; dy = dy + 1) {
        for (var dx = -radius; dx <= radius; dx = dx + 1) {
            let distSq = f32(dx * dx + dy * dy);
            let radSq = f32(radius * radius);

            if (distSq <= radSq) {
                let nx = clamp(coords.x + dx, 0, i32(params.width) - 1);
                let ny = clamp(coords.y + dy, 0, i32(params.height) - 1);
                let sampleCol = textureLoad(colorTex, vec2<i32>(nx, ny), 0).rgb;

                // Specular highlight boost for bokeh circles
                let brightness = max(max(sampleCol.r, sampleCol.g), sampleCol.b);
                let weight = 1.0 + pow(brightness, 4.0) * 2.0;

                accumColor = accumColor + sampleCol * weight;
                accumWeight = accumWeight + weight;
            }
        }
    }

    let finalBokeh = accumColor / max(accumWeight, 0.001);
    textureStore(outTex, coords, vec4<f32>(saturate(finalBokeh), 1.0));
}
