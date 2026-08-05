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
    // v303 四轮 subagent #1 fix (Critical #3): single uniform buffer
    // 在 60Hz/120Hz 下会撕裂(CPU memcpy 覆盖时 GPU 可能还在读上一帧)。
    // 改 triple-buffered ring:3 个 buffer,每帧轮换;semaphore.wait()
    // 保证 in-flight 帧 <= 3;commandBuffer.addCompletedHandler 里 signal。
    // 标准 Metal best practice (Apple sample MetalNBuffering)。
    private static let kInFlightBuffers = 3
    private var uniformBuffers: [MTLBuffer] = []
    private var uniformBufferIndex: Int = 0
    private let inFlightSemaphore = DispatchSemaphore(value: Self.kInFlightBuffers)
    private var startTimestamp: TimeInterval = Date().timeIntervalSince1970
    // v303 subagent #3 fix: expose pipeline build status to JS for
    // remote debug via isPipelineReady ping.
    private var libSource: String = "unknown"     // "precompiled" | "embedded" | "failed"
    private var renderingStarted: Bool = false
    private var pipelineError: String? = nil
    private var renderFrameCount: Int = 0          // bumped each render(); JS can read once
    // v303 四轮 subagent #1 fix (Serious #3): sampleCount 不能在
    // renderingWillStart 时就定,因为 CustomLayerRenderParameters 没暴露
    // sampleCount。改 lazy:把建 pipeline 用到的参数存下来,第一次 render
    // 拿到 mtlRenderPassDescriptor 后,按真实 sampleCount 重新 build。
    private var pendingPipelineBuild: PipelineBuildConfig? = nil
    private var lastSampleCount: Int = 0
    private struct PipelineBuildConfig {
        let vertexFn: MTLFunction
        let fragmentFn: MTLFunction
        let colorFmt: MTLPixelFormat
        let depthFmt: MTLPixelFormat
        let stencilFmt: MTLPixelFormat
    }

    public func pipelineStatus() -> [String: Any] {
        // v303 三轮 subagent #2 fix: 单看 pipelineState != nil 会假阳 —
        // pipeline 建好了但 Mapbox 因 z-order/style/visibility 从没调
        // 我们的 render() 也会显示 ready=true → JS 看 ready 不 fallback
        // → 用户屏幕上没 fog。renderFrameCount 是真实跑过帧的证据。
        let pipelineOK = pipelineState != nil
        let hasRendered = renderFrameCount > 0
        return [
            "ready": pipelineOK && hasRendered,
            "pipelineBuilt": pipelineOK,
            "hasDevice": device != nil,
            "hasUniformBuffer": !uniformBuffers.isEmpty,
            "libSource": libSource,
            "renderingStarted": renderingStarted,
            "pipelineError": pipelineError ?? "",
            "renderFrameCount": renderFrameCount,
            "modeFlag": Int(modeFlag),
        ]
    }

    // MARK: - Uniform layout
    //
    // The uniform buffer is packed manually (not via a Swift struct) because
    // Metal's struct field alignment rules differ subtly from Swift's, and
    // we want bit-perfect agreement with the shader's `FogUniforms` (defined
    // both in CairnFogShader.metal and the embedded shader source string
    // below). Packing order matches the shader exactly:
    //
    //   [proj 4x4 float = 64 bytes]
    //   [inv  4x4 float = 64 bytes]
    //   [circles 256 × float4 = 4096 bytes]
    //   [circleCount uint = 4]
    //   [feather float = 4]
    //   [time float = 4]
    //   [rippleEnabled uint = 4]
    //   [fogColor float4 = 16] (16-byte aligned — naturally aligned here)
    //
    // Total = 4256 bytes (verified: 128 + 4096 + 4*4 + 16 = 4256).

    // Real on-the-wire uniform packing:
    // [proj 64 bytes][inv 64 bytes][circles 256×16=4096 bytes][circleCount 4][feather 4][time 4][rippleEnabled 4][fogColor 16]
    // Subtotal: 64 + 64 + 4096 + 4 + 4 + 4 + 4 + 16 = 4256 bytes.
    // Note: Swift will evaluate the expression below correctly to 4256.
    // (An earlier comment incorrectly arithmetic'd this to 4252 — that
    // was a documentation bug; the expression itself is right.)
    private let uniformByteSize = 64 + 64 + (256 * 16) + 4 + 4 + 4 + 4 + 16

    // MARK: - Public mutators (called from main thread in module)

    public func updateCircles(_ rawCircles: [[Double]]) {
        // rawCircles entries are [lng, lat, radiusMeters, bornEpochMs].
        // Convert lng/lat → Mapbox mercator (0..1 normalized); radius
        // converted at render time using meterInMercatorCoordinateUnits
        // because that depends on latitude.
        circleLock.lock()
        defer { circleLock.unlock() }
        let n = min(rawCircles.count, maxCircles)
        var written = 0
        for i in 0..<n {
            let row = rawCircles[i]
            guard row.count >= 3 else { continue }
            let lng = row[0]
            let lat = row[1]
            let rM  = row[2]
            let born = row.count > 3 ? row[3] : 0.0
            // v303 四轮 subagent #1 fix (Serious #6): NaN/Inf 防御。
            // shader length(p-c.xy) 算 NaN 会让 min() 行为依平台不同,
            // 整屏 fog 可能消失或全 black。JS bridge 偶尔会传 NaN
            // (新 unlock 还没 sync 时 lat/lng 暂时 undefined → NaN)。
            guard lng.isFinite, lat.isFinite, rM.isFinite, rM > 0 else { continue }
            // lat clamp 在 ±85 mercator 安全范围
            guard lat >= -85.051 && lat <= 85.051 else { continue }
            // Web mercator projection — same math Mapbox uses internally.
            // y is flipped vs lat (north +y in mercator, north +lat).
            let merc = Self.mercatorXY(lng: lng, lat: lat)
            // radius in mercator units = rM * meterInMercatorCoordinateUnits(lat)
            // meterInMercatorCoordinateUnits = 1 / (cos(lat) * earthCircumferenceM)
            let earthCircM = 40_075_017.0
            let metersPerMerc = cos(lat * .pi / 180.0) * earthCircM
            guard metersPerMerc > 0 else { continue }
            let rMerc = rM / metersPerMerc
            circleBufferData[written] = SIMD4<Float>(
                Float(merc.x),
                Float(merc.y),
                Float(rMerc),
                Float(born / 1000.0)
            )
            written += 1
        }
        // Zero unused slots so the shader's circleCount gate is the only check.
        if written < maxCircles {
            for i in written..<maxCircles {
                circleBufferData[i] = SIMD4<Float>(0,0,0,0)
            }
        }
        circleCount = written
    }

    public func setMode(_ mode: String) {
        // v303 四轮 subagent #1 fix (Serious #5): setMode 不再副作用 feather。
        // 之前 sharp 写 0.02、其他写 0.30,会覆盖 JS 显式 setFeather 调用。
        // feather 完全由 setFeather 控制;mode 只决定渲染分支。
        switch mode {
        case "off":       modeFlag = 0
        case "sdf-sharp": modeFlag = 2
        default:          modeFlag = 1
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
        // v303 二轮 subagent #1 fix: Mapbox v11 CustomLayerHost protocol
        // declares colorPixelFormat / depthStencilPixelFormat as UInt
        // (NOT MTLPixelFormat). Reference: mapbox-maps-ios
        // EmptyCustomRenderer.swift + CustomLayerExample.swift. Protocol
        // conformance is type-exact in Swift, so any mismatch would
        // refuse to compile.
        NSLog("[CairnFog] renderingWillStart pixelFormat=\(colorPixelFormat)")
        // v303 四轮 subagent #1 fix (Serious #2): 重入时显式释放上一轮资源,
        // 别靠 ARC 不可预测的时机。Mapbox style reload 会再次调这个方法,
        // 旧 pipeline/buffer 还在 GPU 队列里被引用时 ARC 不立刻 free。
        self.pipelineState = nil
        self.uniformBuffers.removeAll()
        self.pipelineError = nil
        self.libSource = "unknown"
        // 不重置 startTimestamp 如果之前已经 started 过(ripple 动画连续性)
        if !self.renderingStarted {
            self.startTimestamp = Date().timeIntervalSince1970
        }
        self.device = metalDevice
        self.renderingStarted = true

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
                self.libSource = "precompiled-default"
                break
            }
            // Try a sub-bundle named after our pod (cocoapods resource bundle convention).
            if let subUrl = bundle.url(forResource: "CairnFogLayer", withExtension: "bundle"),
               let subBundle = Bundle(url: subUrl),
               let lib = try? metalDevice.makeDefaultLibrary(bundle: subBundle) {
                NSLog("[CairnFog] loaded metallib from sub-bundle \(subUrl.path)")
                library = lib
                self.libSource = "precompiled-subbundle"
                break
            }
        }
        // Last-resort fallback: compile the shader from the source string
        // embedded below. Slightly slower at startup but guarantees the
        // pipeline isn't silently broken by a bundle lookup miss.
        if library == nil {
            NSLog("[CairnFog] WARN: no precompiled metallib found, compiling shader from source")
            do {
                library = try metalDevice.makeLibrary(source: Self.embeddedShaderSource, options: nil)
                self.libSource = "embedded"
            } catch {
                self.libSource = "failed"
                self.pipelineError = "embedded compile failed: \(error.localizedDescription)"
                NSLog("[CairnFog] FATAL: embedded shader compile failed: \(error.localizedDescription)")
            }
        }
        guard let library = library else {
            // v303 二轮 subagent #2 fix: must set pipelineError so the
            // remote ping can distinguish "library failed to load" from
            // "still building".
            if self.pipelineError == nil {
                self.pipelineError = "shader library load failed (no precompiled metallib found, embedded source compile not attempted or failed)"
            }
            self.libSource = "failed"
            NSLog("[CairnFog] FATAL: \(self.pipelineError ?? "library load failed")")
            return
        }
        guard let vertexFn = library.makeFunction(name: "fogVertex"),
              let fragmentFn = library.makeFunction(name: "fogFragment") else {
            pipelineError = "fogVertex/fogFragment not found in library (libSource=\(libSource))"
            NSLog("[CairnFog] FATAL: shader functions not found in library")
            return
        }

        // v303 四轮 subagent #1 fix (Serious #3): depth/stencil + color
        // pixel format 解析,但 pipeline build 推迟到第一次 render()
        // (那时才能拿到 mtlRenderPassDescriptor 的 sampleCount)。
        let stencilFmt: MTLPixelFormat
        let depthFmt: MTLPixelFormat
        if let dfmt = MTLPixelFormat(rawValue: depthStencilPixelFormat) {
            depthFmt = dfmt
            switch dfmt {
            case .depth32Float_stencil8, .depth24Unorm_stencil8, .x32_stencil8, .x24_stencil8:
                stencilFmt = dfmt
            default:
                stencilFmt = .invalid
            }
        } else {
            self.pipelineError = "unknown depthStencilPixelFormat raw=\(depthStencilPixelFormat)"
            NSLog("[CairnFog] FATAL: \(self.pipelineError ?? "")")
            return
        }
        guard let colorFmt = MTLPixelFormat(rawValue: colorPixelFormat) else {
            self.pipelineError = "unknown colorPixelFormat raw=\(colorPixelFormat)"
            NSLog("[CairnFog] FATAL: \(self.pipelineError ?? "")")
            return
        }
        // 存配置,等 render() 第一次拿到 sampleCount 再 build
        self.pendingPipelineBuild = PipelineBuildConfig(
            vertexFn: vertexFn,
            fragmentFn: fragmentFn,
            colorFmt: colorFmt,
            depthFmt: depthFmt,
            stencilFmt: stencilFmt
        )
        self.lastSampleCount = 0  // 未知,等 render

        self.uniformBuffers.removeAll(keepingCapacity: true)
        for i in 0..<Self.kInFlightBuffers {
            guard let buf = metalDevice.makeBuffer(length: uniformByteSize, options: .storageModeShared) else {
                self.pipelineError = "uniform buffer #\(i) allocation failed (size=\(uniformByteSize))"
                NSLog("[CairnFog] FATAL: \(self.pipelineError ?? "")")
                return
            }
            self.uniformBuffers.append(buf)
        }
        self.uniformBufferIndex = 0
        NSLog("[CairnFog] renderingWillStart OK uniformBuffers=\(self.uniformBuffers.count)")
    }

    public func render(_ parameters: CustomLayerRenderParameters,
                       mtlCommandBuffer: MTLCommandBuffer,
                       mtlRenderPassDescriptor: MTLRenderPassDescriptor)
    {
        guard modeFlag != 0 else { return } // mode=off: render nothing
        guard !uniformBuffers.isEmpty else { return }
        // v303 四轮 subagent #1 fix (Serious #3): lazy build pipeline 用真
        // 实 sampleCount。每次 render 先确认 pipeline 跟 attachment 的
        // sampleCount 一致,不一致就用新 sampleCount 重建。常见 sampleCount
        // = 1(无 MSAA) 或 4(MSAA 4x)。
        let actualSampleCount = mtlRenderPassDescriptor.colorAttachments[0].texture?.sampleCount ?? 1
        if pipelineState == nil || actualSampleCount != lastSampleCount {
            guard let cfg = pendingPipelineBuild, let dev = device else { return }
            let desc = MTLRenderPipelineDescriptor()
            desc.vertexFunction = cfg.vertexFn
            desc.fragmentFunction = cfg.fragmentFn
            desc.depthAttachmentPixelFormat = cfg.depthFmt
            desc.stencilAttachmentPixelFormat = cfg.stencilFmt
            desc.rasterSampleCount = actualSampleCount
            // R105 (Xcode 26): colorAttachments[0] 返回 non-optional MTLRenderPipeline...Descriptor,
            // 原来 `!` force-unwrap 会有 "unnecessary force-unwrap" warning-as-error 风险. 删.
            let ca = desc.colorAttachments[0]
            ca.pixelFormat = cfg.colorFmt
            ca.isBlendingEnabled = true
            ca.rgbBlendOperation = .add
            ca.alphaBlendOperation = .add
            ca.sourceRGBBlendFactor = .sourceAlpha
            ca.destinationRGBBlendFactor = .oneMinusSourceAlpha
            ca.sourceAlphaBlendFactor = .one
            ca.destinationAlphaBlendFactor = .oneMinusSourceAlpha
            do {
                self.pipelineState = try dev.makeRenderPipelineState(descriptor: desc)
                self.lastSampleCount = actualSampleCount
                self.pipelineError = nil
                NSLog("[CairnFog] pipeline built sampleCount=\(actualSampleCount)")
            } catch {
                self.pipelineError = "makeRenderPipelineState(sampleCount=\(actualSampleCount)) failed: \(error.localizedDescription)"
                NSLog("[CairnFog] FATAL: \(self.pipelineError ?? "")")
                return
            }
        }
        guard let pipeline = pipelineState else { return }

        // v303 四轮 subagent #1 fix (Critical #3): triple-buffer ring +
        // semaphore 防 CPU/GPU 共享内存撕裂。等到至少 1 个 in-flight slot
        // 空出来才继续(timeout=DISPATCH_TIME_FOREVER 是 Metal 标准做法,
        // GPU 最多卡 3 帧后必定 signal,实际通常 < 16ms)。
        _ = inFlightSemaphore.wait(timeout: .distantFuture)
        let bufIdx = uniformBufferIndex
        uniformBufferIndex = (uniformBufferIndex + 1) % Self.kInFlightBuffers
        let uBuffer = uniformBuffers[bufIdx]
        // 帧完成后 signal,允许下一个 slot 被 wait 拿走
        mtlCommandBuffer.addCompletedHandler { [weak self] _ in
            self?.inFlightSemaphore.signal()
        }
        renderFrameCount += 1

        // Snapshot uniforms under lock.
        circleLock.lock()
        let count = circleCount
        let circlesCopy = circleBufferData
        circleLock.unlock()

        // v303 四轮 subagent #1 fix (Critical #1): projectionMatrix
        // 实际类型是 [NSNumber] 16 个数, column-major 顺序 (源:Mapbox
        // CustomLayerExample.swift v11.20.1 line 376-383)。
        //   col0 = pm[0..3], col1 = pm[4..7], col2 = pm[8..11], col3 = pm[12..15]
        // 之前当 [[Double]] 2D array (pm[i][j]) 是错的 — Swift bridge 偶
        // 然能跑但 Mapbox 内部声明就是扁平 NSArray of NSNumber。直接照
        // example 的 .simdFloat4x4 写法。
        let pm = parameters.projectionMatrix
        let proj: float4x4
        // R105 (2026-08-05): 删过度防御的 [[NSNumber]] 兼容分支。
        // 原代码 `let nums = pm.flatMap { $0 as? [NSNumber] }` +
        // `let flat: [NSNumber] = nums.isEmpty ? (pm as? [NSNumber] ?? []) : nums`
        // Swift 编译器 Xcode 26 严格类型推断: flatMap 结果被推为 [[NSNumber]],
        // ternary 两侧类型 [NSNumber] vs [[NSNumber]] 不匹配 → build fail.
        // 注释 391 行本身就说 "Mapbox 内部声明就是扁平 NSArray of NSNumber",
        // 兼容分支永远不执行, 删掉不影响运行时。
        if pm.count >= 16 {
            // Swift bridge: pm 是 [NSNumber]. `pm[i]` 返回 NSNumber,
            // .floatValue 转 Float. column-major 16 个数 → simd_float4x4(cols)。
            proj = float4x4(
                SIMD4<Float>(pm[0].floatValue, pm[1].floatValue, pm[2].floatValue, pm[3].floatValue),
                SIMD4<Float>(pm[4].floatValue, pm[5].floatValue, pm[6].floatValue, pm[7].floatValue),
                SIMD4<Float>(pm[8].floatValue, pm[9].floatValue, pm[10].floatValue, pm[11].floatValue),
                SIMD4<Float>(pm[12].floatValue, pm[13].floatValue, pm[14].floatValue, pm[15].floatValue)
            )
        } else {
            proj = matrix_identity_float4x4
            if renderFrameCount < 5 { NSLog("[CairnFog] WARN projectionMatrix count=%d", pm.count) }
        }
        let inv = proj.inverse

        let now = Float(Date().timeIntervalSince1970 - self.startTimestamp)
        let rippleU: UInt32 = rippleEnabled ? 1 : 0

        // Pack uniform buffer manually. Layout must match shader exactly.
        var offset = 0
        let contents = uBuffer.contents()

        // 1. projectionMatrix (64 bytes)
        // R105+ (Xcode 26): [proj] 隐式 array-to-pointer 在严格 mode 报 warning-as-error
        // 风险 (SWIFT_TREAT_WARNINGS_AS_ERRORS=YES 时). 改 withUnsafeBytes 显式取指针.
        withUnsafeBytes(of: proj) { buf in
            memcpy(contents.advanced(by: offset), buf.baseAddress, 64)
        }
        offset += 64
        // 2. inverseProjection (64 bytes)
        withUnsafeBytes(of: inv) { buf in
            memcpy(contents.advanced(by: offset), buf.baseAddress, 64)
        }
        offset += 64
        // 3. circles (256 × 16 = 4096 bytes)
        // R105 (Xcode 26): 显式丢弃 withUnsafeBufferPointer 返回值防止 warning-as-error
        _ = circlesCopy.withUnsafeBufferPointer { ptr in
            memcpy(contents.advanced(by: offset), ptr.baseAddress, 256 * 16)
        }
        offset += 256 * 16
        // 4. circleCount (4)
        var n32 = UInt32(count)
        memcpy(contents.advanced(by: offset), &n32, 4); offset += 4
        // 5. feather (4)
        // v303 四轮 fix (Serious #5): modeFlag=2 (sharp) 时 effective feather
        // = min(feather, 0.02),保留 sharp 视觉但不再覆盖用户 setFeather。
        // R105 (Xcode 26): 0.02 literal 明确 Float, 避免类型推断歧义。
        var f: Float = (modeFlag == 2) ? min(feather, Float(0.02)) : feather
        memcpy(contents.advanced(by: offset), &f, 4); offset += 4
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
        // v303 四轮 subagent #1 fix (Serious #1+#2): 把 lifecycle 字段都清,
        // 否则 Mapbox 重 attach(style reload 等)时 isPipelineReady 假阳:
        //   - renderFrameCount 残留 → ready=true 但新 pipeline 还没跑过帧
        //   - pipelineError 残留 → 新建成功但 status 仍报上次错
        //   - libSource/renderingStarted 残留 → 误诊
        self.pipelineState = nil
        self.uniformBuffers.removeAll()
        self.device = nil
        self.renderFrameCount = 0
        self.renderingStarted = false
        self.libSource = "unknown"
        self.pipelineError = nil
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
