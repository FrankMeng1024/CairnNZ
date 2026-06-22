// CairnFogCustomLayer.swift — Mapbox CustomLayerHost implementation.
//
// Lifecycle (Mapbox v11 CustomLayerHost protocol):
//   - renderingWillStart: set up Metal pipeline, vertex buffer, uniform buffer
//   - render: invoked every frame the layer is visible. Apply uniforms +
//     issue a draw call (single full-screen triangle, fragment shader does
//     all the work)
//   - renderingWillEnd: release Metal resources
//
// Threading: Mapbox calls these on the render thread. We must NOT touch
// `self.circles` directly during render — that's mutated from the main
// thread (CairnFogLayerModule.updateCircles). Use a serial queue +
// snapshot the uniform-bytes array on update; render reads it lock-free.

import Foundation
import Metal
import simd

#if canImport(MapboxMaps)
import MapboxMaps
#endif

#if canImport(MapboxMaps)

public class CairnFogCustomLayer: NSObject, CustomLayerHost {

    // MARK: - Tunable knobs (updated from JS via setters)

    private let maxCircles = 256
    private var feather: Float = 0.30      // 0 = hard cut; 0.30 = soft edge
    private var rippleEnabled: Bool = false
    private var fogColor: SIMD4<Float> = SIMD4(0.196, 0.137, 0.078, 0.62)
    // mode: "off" — return alpha=0 globally (clear);
    //       "sdf-soft" — full SDF + feather
    //       "sdf-sharp" — feather=0 (hard edge)
    private var modeFlag: Int32 = 1  // 0=off, 1=soft, 2=sharp

    // MARK: - Circle storage (256 × vec4)

    private let circleLock = NSLock()
    private var circleBufferData = [SIMD4<Float>](repeating: SIMD4<Float>(0,0,0,0), count: 256)
    private var circleCount: Int = 0

    // MARK: - Metal resources

    private var device: MTLDevice?
    private var pipelineState: MTLRenderPipelineState?
    private var uniformBuffer: MTLBuffer?
    private var startTimestamp: TimeInterval = Date().timeIntervalSince1970

    // MARK: - Uniform layout (must match shader)

    private struct FogUniforms {
        var projectionMatrix: float4x4
        var inverseProjection: float4x4
        var circles: (SIMD4<Float>, SIMD4<Float>) // placeholder; we send the real 256-array below
        var circleCount: UInt32 = 0
        var feather: Float = 0.30
        var time: Float = 0.0
        var rippleEnabled: UInt32 = 0
        var fogColor: SIMD4<Float> = SIMD4(0,0,0,0)
    }

    // Real on-the-wire uniform packing:
    // [proj 64 bytes][inv 64 bytes][circles 256×16=4096 bytes][circleCount 4][feather 4][time 4][rippleEnabled 4][fogColor 16]
    private let uniformByteSize = 64 + 64 + (256 * 16) + 4 + 4 + 4 + 4 + 16
    // = 128 + 4096 + 28 = 4252 bytes. Round to next 256 for Metal alignment.

    // MARK: - Public mutators (called from main thread in module)

    public func updateCircles(_ rawCircles: [[Double]]) {
        // rawCircles entries are [lng, lat, radiusMeters, bornEpochMs].
        // Convert lng/lat → Mapbox mercator (0..1 normalized); radius
        // converted at render time using meterInMercatorCoordinateUnits
        // because that depends on latitude.
        circleLock.lock()
        defer { circleLock.unlock() }
        let n = min(rawCircles.count, maxCircles)
        for i in 0..<n {
            let row = rawCircles[i]
            guard row.count >= 3 else { continue }
            let lng = row[0]
            let lat = row[1]
            let rM  = row[2]
            let born = row.count > 3 ? row[3] : 0.0
            // Web mercator projection — same math Mapbox uses internally.
            // y is flipped vs lat (north +y in mercator, north +lat).
            let merc = Self.mercatorXY(lng: lng, lat: lat)
            // radius in mercator units = rM * meterInMercatorCoordinateUnits(lat)
            // meterInMercatorCoordinateUnits = 1 / (cos(lat) * earthCircumferenceM)
            let earthCircM = 40_075_017.0
            let metersPerMerc = cos(lat * .pi / 180.0) * earthCircM
            let rMerc = rM / metersPerMerc
            circleBufferData[i] = SIMD4<Float>(
                Float(merc.x),
                Float(merc.y),
                Float(rMerc),
                Float(born / 1000.0)
            )
        }
        // Zero unused slots so the shader's circleCount gate is the only check.
        if n < maxCircles {
            for i in n..<maxCircles {
                circleBufferData[i] = SIMD4<Float>(0,0,0,0)
            }
        }
        circleCount = n
    }

    public func setMode(_ mode: String) {
        switch mode {
        case "off":       modeFlag = 0
        case "sdf-sharp": modeFlag = 2; feather = 0.02
        default:          modeFlag = 1; feather = 0.30
        }
    }
    public func setFeather(_ f: Float) { feather = max(0.0, min(1.0, f)) }
    public func setRippleEnabled(_ b: Bool) { rippleEnabled = b }
    public func setFogColor(r: Float, g: Float, b: Float, a: Float) {
        fogColor = SIMD4<Float>(r, g, b, a)
    }

    // MARK: - CustomLayerHost protocol

    public func renderingWillStart(_ metalDevice: MTLDevice,
                                   colorPixelFormat: UInt,
                                   depthStencilPixelFormat: UInt)
    {
        NSLog("[CairnFog] renderingWillStart")
        self.device = metalDevice
        self.startTimestamp = Date().timeIntervalSince1970

        // v303 subagent #1 fix A1: the .metal file is compiled into our
        // POD's resource bundle, NOT Bundle.main. With static_framework=true
        // the metallib also could be in main bundle but only by coincidence
        // — Mapbox's own metallib may overwrite ours. The robust path is to
        // load from the bundle that hosts this Swift class.
        var library: MTLLibrary? = nil
        let candidates: [Bundle] = [
            Bundle(for: CairnFogCustomLayer.self),
            Bundle.main,
        ]
        for bundle in candidates {
            // Try the bundle directly.
            if let lib = try? metalDevice.makeDefaultLibrary(bundle: bundle) {
                NSLog("[CairnFog] loaded metallib from \(bundle.bundlePath)")
                library = lib
                break
            }
            // Try a sub-bundle named after our pod (cocoapods resource bundle convention).
            if let subUrl = bundle.url(forResource: "CairnFogLayer", withExtension: "bundle"),
               let subBundle = Bundle(url: subUrl),
               let lib = try? metalDevice.makeDefaultLibrary(bundle: subBundle) {
                NSLog("[CairnFog] loaded metallib from sub-bundle \(subUrl.path)")
                library = lib
                break
            }
        }
        // Last-resort fallback: compile the shader from the source string
        // embedded below. Slightly slower at startup but guarantees the
        // pipeline isn't silently broken by a bundle lookup miss.
        if library == nil {
            NSLog("[CairnFog] WARN: no precompiled metallib found, compiling shader from source")
            library = try? metalDevice.makeLibrary(source: Self.embeddedShaderSource, options: nil)
        }
        guard let library = library else {
            NSLog("[CairnFog] FATAL: shader library load failed (both bundle and source compile failed)")
            return
        }
        guard let vertexFn = library.makeFunction(name: "fogVertex"),
              let fragmentFn = library.makeFunction(name: "fogFragment") else {
            NSLog("[CairnFog] FATAL: shader functions not found in library")
            return
        }

        let pipelineDesc = MTLRenderPipelineDescriptor()
        pipelineDesc.vertexFunction = vertexFn
        pipelineDesc.fragmentFunction = fragmentFn
        let colorAttachment = pipelineDesc.colorAttachments[0]!
        colorAttachment.pixelFormat = MTLPixelFormat(rawValue: colorPixelFormat) ?? .bgra8Unorm
        colorAttachment.isBlendingEnabled = true
        colorAttachment.rgbBlendOperation = .add
        colorAttachment.alphaBlendOperation = .add
        colorAttachment.sourceRGBBlendFactor = .sourceAlpha
        colorAttachment.destinationRGBBlendFactor = .oneMinusSourceAlpha
        colorAttachment.sourceAlphaBlendFactor = .one
        colorAttachment.destinationAlphaBlendFactor = .oneMinusSourceAlpha

        do {
            self.pipelineState = try metalDevice.makeRenderPipelineState(descriptor: pipelineDesc)
        } catch {
            NSLog("[CairnFog] FATAL: pipeline state error: \(error.localizedDescription)")
            return
        }

        self.uniformBuffer = metalDevice.makeBuffer(length: uniformByteSize, options: .storageModeShared)
        NSLog("[CairnFog] renderingWillStart OK")
    }

    public func render(_ parameters: CustomLayerRenderParameters,
                       mtlCommandBuffer: MTLCommandBuffer,
                       mtlRenderPassDescriptor: MTLRenderPassDescriptor)
    {
        guard let pipeline = pipelineState, let uBuffer = uniformBuffer else { return }
        guard modeFlag != 0 else { return } // mode=off: render nothing

        // Snapshot uniforms under lock.
        circleLock.lock()
        let count = circleCount
        let circlesCopy = circleBufferData
        circleLock.unlock()

        // Build projection matrix from parameters. v11 passes 4x4
        // doubles in `projectionMatrix` — flatten to float4x4.
        let pm = parameters.projectionMatrix
        let proj = float4x4(
            SIMD4<Float>(Float(pm[0][0]), Float(pm[0][1]), Float(pm[0][2]), Float(pm[0][3])),
            SIMD4<Float>(Float(pm[1][0]), Float(pm[1][1]), Float(pm[1][2]), Float(pm[1][3])),
            SIMD4<Float>(Float(pm[2][0]), Float(pm[2][1]), Float(pm[2][2]), Float(pm[2][3])),
            SIMD4<Float>(Float(pm[3][0]), Float(pm[3][1]), Float(pm[3][2]), Float(pm[3][3]))
        )
        let inv = proj.inverse

        let now = Float(Date().timeIntervalSince1970 - self.startTimestamp)
        let rippleU: UInt32 = rippleEnabled ? 1 : 0

        // Pack uniform buffer manually. Layout must match shader exactly.
        var offset = 0
        let contents = uBuffer.contents()

        // 1. projectionMatrix (64 bytes)
        memcpy(contents.advanced(by: offset), [proj], 64); offset += 64
        // 2. inverseProjection (64 bytes)
        memcpy(contents.advanced(by: offset), [inv], 64);  offset += 64
        // 3. circles (256 × 16 = 4096 bytes)
        circlesCopy.withUnsafeBufferPointer { ptr in
            memcpy(contents.advanced(by: offset), ptr.baseAddress, 256 * 16)
        }
        offset += 256 * 16
        // 4. circleCount (4)
        var n32 = UInt32(count)
        memcpy(contents.advanced(by: offset), &n32, 4); offset += 4
        // 5. feather (4)
        var f = feather; memcpy(contents.advanced(by: offset), &f, 4); offset += 4
        // 6. time (4)
        var t = now; memcpy(contents.advanced(by: offset), &t, 4); offset += 4
        // 7. rippleEnabled (4)
        var r = rippleU; memcpy(contents.advanced(by: offset), &r, 4); offset += 4
        // 8. fogColor (16)
        var col = fogColor; memcpy(contents.advanced(by: offset), &col, 16); offset += 16

        guard let encoder = mtlCommandBuffer.makeRenderCommandEncoder(descriptor: mtlRenderPassDescriptor) else { return }
        encoder.setRenderPipelineState(pipeline)
        encoder.setFragmentBuffer(uBuffer, offset: 0, index: 0)
        encoder.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 3)
        encoder.endEncoding()
    }

    public func renderingWillEnd() {
        NSLog("[CairnFog] renderingWillEnd")
        self.pipelineState = nil
        self.uniformBuffer = nil
        self.device = nil
    }

    // MARK: - Mercator helper

    private static func mercatorXY(lng: Double, lat: Double) -> (x: Double, y: Double) {
        let safeLat = max(-85.051, min(85.051, lat))
        let x = (lng + 180.0) / 360.0
        let sinLat = sin(safeLat * .pi / 180.0)
        let y = 0.5 - log((1 + sinLat) / (1 - sinLat)) / (4 * .pi)
        return (x, y)
    }

    // MARK: - Embedded shader source (fallback if .metallib lookup fails)

    private static let embeddedShaderSource: String = """
    #include <metal_stdlib>
    using namespace metal;
    constant int kMaxCircles = 256;
    struct FogVertexOut { float4 position [[position]]; float2 clipUV; };
    struct FogUniforms {
        float4x4 projectionMatrix;
        float4x4 inverseProjection;
        float4   circles[256];
        uint     circleCount;
        float    feather;
        float    time;
        uint     rippleEnabled;
        float4   fogColor;
    };
    vertex FogVertexOut fogVertex(uint vid [[vertex_id]]) {
        FogVertexOut out;
        float2 verts[3] = { float2(-1, -1), float2(3, -1), float2(-1, 3) };
        float2 v = verts[vid];
        out.position = float4(v, 0.0, 1.0);
        out.clipUV = v;
        return out;
    }
    fragment float4 fogFragment(FogVertexOut in [[stage_in]],
                                constant FogUniforms& u [[buffer(0)]])
    {
        float4 m = u.inverseProjection * float4(in.clipUV, 0.0, 1.0);
        float2 p = m.xy / m.w;
        float minSigned = 1.0e10;
        uint n = min(u.circleCount, (uint)kMaxCircles);
        for (uint i = 0; i < n; i++) {
            float4 c = u.circles[i];
            float dist = length(p - c.xy);
            float radius = max(c.z, 1.0e-9);
            float sn = (dist - radius) / radius;
            minSigned = min(minSigned, sn);
        }
        float feather = max(u.feather, 1.0e-6);
        float alpha = smoothstep(-feather, 0.0, minSigned);
        if (u.rippleEnabled != 0u) {
            float ringDist = abs(minSigned);
            float ringMask = smoothstep(0.12, 0.0, ringDist);
            float wave = 0.5 + 0.5 * sin(u.time * 2.8);
            alpha = alpha * (1.0 - 0.25 * ringMask * wave);
        }
        return float4(u.fogColor.rgb, u.fogColor.a * alpha);
    }
    """
}

#else
// MapboxMaps not available — provide a stub so the module still compiles
// (e.g. for simulator builds where rnmapbox's MapboxMaps pod is excluded).
public class CairnFogCustomLayer: NSObject {
    public func updateCircles(_ rawCircles: [[Double]]) {}
    public func setMode(_ mode: String) {}
    public func setFeather(_ f: Float) {}
    public func setRippleEnabled(_ b: Bool) {}
    public func setFogColor(r: Float, g: Float, b: Float, a: Float) {}
}
#endif
