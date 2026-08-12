// Alignment & Warp Compute Shader
// Calculates block-based motion vectors and warps alternate frame onto reference.

struct AlignParams {
    width : u32,
    height : u32,
    tileSize : u32,
    searchRadius : i32,
};

@group(0) @binding(0) var refTex : texture_2d<f32>;
@group(0) @binding(1) var altTex : texture_2d<f32>;
@group(0) @binding(2) var outTex : texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(3) var<uniform> params : AlignParams;

fn rgbToLum(c : vec4<f32>) -> f32 {
    return 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
}

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) global_id : vec3<u32>) {
    let x = global_id.x;
    let y = global_id.y;

    if (x >= params.width || y >= params.height) {
        return;
    }

    let tileSize = i32(params.tileSize);
    let radius = params.searchRadius;

    let tileX = i32(x) / tileSize * tileSize;
    let tileY = i32(y) / tileSize * tileSize;

    var bestDx = 0;
    var bestDy = 0;
    var minSAD = 1e9;

    for (var dy = -radius; dy <= radius; dy = dy + 1) {
        for (var dx = -radius; dx <= radius; dx = dx + 1) {
            var sad = 0.0;
            var count = 0.0;

            for (var py = 0; py < tileSize; py = py + 4) {
                for (var px = 0; px < tileSize; px = px + 4) {
                    let rx = tileX + px;
                    let ry = tileY + py;
                    let ax = rx + dx;
                    let ay = ry + dy;

                    if (ax >= 0 && ax < i32(params.width) && ay >= 0 && ay < i32(params.height)) {
                        let rColor = textureLoad(refTex, vec2<i32>(rx, ry), 0);
                        let aColor = textureLoad(altTex, vec2<i32>(ax, ay), 0);
                        sad = sad + abs(rgbToLum(rColor) - rgbToLum(aColor));
                        count = count + 1.0;
                    }
                }
            }

            if (count > 0.0) {
                sad = sad / count;
                if (sad < minSAD) {
                    minSAD = sad;
                    bestDx = dx;
                    bestDy = dy;
                }
            }
        }
    }

    let targetX = i32(x) + bestDx;
    let targetY = i32(y) + bestDy;

    var finalColor : vec4<f32>;
    if (targetX >= 0 && targetX < i32(params.width) && targetY >= 0 && targetY < i32(params.height)) {
        finalColor = textureLoad(altTex, vec2<i32>(targetX, targetY), 0);
    } else {
        finalColor = textureLoad(refTex, vec2<i32>(i32(x), i32(y)), 0);
    }

    textureStore(outTex, vec2<i32>(i32(x), i32(y)), finalColor);
}
