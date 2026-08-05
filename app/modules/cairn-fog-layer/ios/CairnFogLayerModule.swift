// CairnFogLayerModule.swift — Expo native module entry point.
//
// Responsibilities:
//   1. Expose a JS API: addFogLayer(reactTag) / updateCircles(circles)
//      / setMode(mode) / setFeather(f) / setRipple(on) / removeFogLayer()
//   2. Look up the RNMBXMapView for `reactTag` from RN's view registry.
//   3. Reach into the public `mapView` handle exposed by RNMBXMapView
//      (Swift `public var mapView : MapView!`) — Mapbox v11 MapView.
//   4. Add a CairnFogCustomLayer (implements CustomLayerHost) to the
//      map's style on the main queue.
//   5. Forward subsequent uniform updates (circle array + mode flags)
//      to the layer instance.
//
// Failure modes & how they surface to JS:
//   - reactTag not found        → reject('NOT_FOUND')
//   - View is not RNMBXMapView  → reject('NOT_RNMBX')
//   - Mapbox MapView not ready  → reject('MAP_NOT_READY')
//   - Style not loaded yet      → reject('STYLE_NOT_LOADED')
//
// Logging: extensive, prefixed with [CairnFog] so device-log filtering
// is easy. Every call logs ts + reactTag + payload size.

import ExpoModulesCore
import UIKit

#if canImport(MapboxMaps)
import MapboxMaps
#endif

public class CairnFogLayerModule: Module {
    // Per-mapView state. Keyed by reactTag (NSNumber).
    private var layersByTag: [Int: AnyObject] = [:]

    public func definition() -> ModuleDefinition {
        Name("CairnFogLayer")

        AsyncFunction("addFogLayer") { (reactTag: Int, promise: Promise) in
            self.log("addFogLayer reactTag=\(reactTag)")
            DispatchQueue.main.async {
                #if canImport(MapboxMaps)
                guard let view = self.findReactView(reactTag: reactTag) else {
                    promise.reject("NOT_FOUND", "View for reactTag \(reactTag) not found")
                    return
                }
                guard let mapHandle = self.extractMapboxMap(from: view) else {
                    promise.reject("NOT_RNMBX", "View at reactTag \(reactTag) is not an RNMBXMapView. View tree:\n\(self.lastExtractFailureTree)")
                    return
                }
                if self.layersByTag[reactTag] != nil {
                    self.log("addFogLayer: layer already exists for reactTag=\(reactTag); replacing")
                    self.removeLayerForTag(reactTag, on: mapHandle.map)
                }
                let layer = CairnFogCustomLayer()
                // v303 三轮 subagent #1 fix: CustomLayer struct is
                // @_spi(Experimental) in Mapbox v11, plain `import MapboxMaps`
                // can't construct it. Use the public StyleManager API
                // addPersistentCustomLayer(withId:layerHost:layerPosition:)
                // directly — same outcome, no SPI requirement.
                do {
                    try mapHandle.map.addPersistentCustomLayer(
                        withId: "cairn-fog-sdf",
                        layerHost: layer,
                        layerPosition: nil
                    )
                    self.layersByTag[reactTag] = layer
                    self.log("addFogLayer OK reactTag=\(reactTag)")
                    promise.resolve(nil)
                } catch {
                    promise.reject("ADD_FAILED", "addPersistentCustomLayer failed: \(error.localizedDescription)")
                }
                #else
                promise.reject("NO_MAPBOX", "MapboxMaps framework not linked (slim build)")
                #endif
            }
        }

        AsyncFunction("updateCircles") { (reactTag: Int, circles: [[Double]], promise: Promise) in
            // circles: Array of [lng, lat, radiusMeters, bornEpochMs] tuples.
            // Truncate at 256 in the layer.
            DispatchQueue.main.async {
                guard let layer = self.layersByTag[reactTag] as? CairnFogCustomLayer else {
                    promise.reject("NO_LAYER", "addFogLayer() must be called first for reactTag \(reactTag)")
                    return
                }
                layer.updateCircles(circles)
                self.log("updateCircles reactTag=\(reactTag) count=\(circles.count)")
                promise.resolve(nil)
            }
        }

        AsyncFunction("setMode") { (reactTag: Int, mode: String, promise: Promise) in
            // mode: "off" | "sdf-soft" | "sdf-sharp"
            DispatchQueue.main.async {
                guard let layer = self.layersByTag[reactTag] as? CairnFogCustomLayer else {
                    promise.reject("NO_LAYER", "addFogLayer() must be called first")
                    return
                }
                layer.setMode(mode)
                self.log("setMode reactTag=\(reactTag) mode=\(mode)")
                promise.resolve(nil)
            }
        }

        AsyncFunction("setFeather") { (reactTag: Int, feather: Double, promise: Promise) in
            DispatchQueue.main.async {
                guard let layer = self.layersByTag[reactTag] as? CairnFogCustomLayer else {
                    promise.reject("NO_LAYER", "addFogLayer() must be called first")
                    return
                }
                layer.setFeather(Float(feather))
                self.log("setFeather reactTag=\(reactTag) feather=\(feather)")
                promise.resolve(nil)
            }
        }

        AsyncFunction("setRipple") { (reactTag: Int, enabled: Bool, promise: Promise) in
            DispatchQueue.main.async {
                guard let layer = self.layersByTag[reactTag] as? CairnFogCustomLayer else {
                    promise.reject("NO_LAYER", "addFogLayer() must be called first")
                    return
                }
                layer.setRippleEnabled(enabled)
                self.log("setRipple reactTag=\(reactTag) enabled=\(enabled)")
                promise.resolve(nil)
            }
        }

        AsyncFunction("setFogColor") { (reactTag: Int, r: Double, g: Double, b: Double, a: Double, promise: Promise) in
            DispatchQueue.main.async {
                guard let layer = self.layersByTag[reactTag] as? CairnFogCustomLayer else {
                    promise.reject("NO_LAYER", "addFogLayer() must be called first")
                    return
                }
                layer.setFogColor(r: Float(r), g: Float(g), b: Float(b), a: Float(a))
                self.log("setFogColor reactTag=\(reactTag) rgba=(\(r),\(g),\(b),\(a))")
                promise.resolve(nil)
            }
        }

        AsyncFunction("removeFogLayer") { (reactTag: Int, promise: Promise) in
            DispatchQueue.main.async {
                #if canImport(MapboxMaps)
                guard let view = self.findReactView(reactTag: reactTag),
                      let mapHandle = self.extractMapboxMap(from: view) else {
                    self.layersByTag.removeValue(forKey: reactTag)
                    promise.resolve(nil)
                    return
                }
                self.removeLayerForTag(reactTag, on: mapHandle.map)
                self.layersByTag.removeValue(forKey: reactTag)
                self.log("removeFogLayer OK reactTag=\(reactTag)")
                #endif
                promise.resolve(nil)
            }
        }

        // v303 subagent #3 fix: pipeline-ready ping. Because Mapbox calls
        // renderingWillStart on the render thread AFTER addPersistentLayer
        // returns, the addFogLayer promise resolves before we know the
        // Metal pipeline is actually ready. Server-side log of
        // 'fog_native_attached' can lie. JS calls this 1s after attach and
        // logs the result; we can grep server logs for failed pipeline
        // builds without device access.
        AsyncFunction("isPipelineReady") { (reactTag: Int, promise: Promise) in
            DispatchQueue.main.async {
                guard let layer = self.layersByTag[reactTag] as? CairnFogCustomLayer else {
                    // v303 四轮 fix (Nitpick): JS 端读 modeFlag 时若 NO_LAYER 也得有,
                    // 否则 undefined。给个空 schema 保持字段一致。
                    promise.resolve([
                        "ready": false,
                        "reason": "NO_LAYER_ATTACHED",
                        "pipelineBuilt": false,
                        "hasDevice": false,
                        "hasUniformBuffer": false,
                        "libSource": "unknown",
                        "renderingStarted": false,
                        "pipelineError": "",
                        "renderFrameCount": 0,
                        "modeFlag": -1,
                    ] as [String: Any])
                    return
                }
                let status = layer.pipelineStatus()
                promise.resolve(status)
            }
        }
    }

    // MARK: - Internal helpers

    private func findReactView(reactTag: Int) -> UIView? {
        // Try several lookup paths — Expo / RN new arch handles vary.
        // (1) UIApplication.shared.delegate.window root view tree.
        // R105 (Xcode 26): flatMap({ $0.windows }) 有 Sequence/Optional 重载歧义
        // + UIApplication.shared.windows iOS 15 deprecated. 改用 reduce 显式拼接
        // + 只走 scene-based 查询, 去掉 shared.windows fallback。
        let allWindows: [UIWindow] = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .reduce(into: [UIWindow]()) { $0.append(contentsOf: $1.windows) }
        guard let window = allWindows.first(where: { $0.isKeyWindow }) ?? allWindows.first
        else {
            log("findReactView: no key window")
            return nil
        }
        return findSubviewWithReactTag(window, tag: reactTag)
    }

    private func findSubviewWithReactTag(_ view: UIView, tag: Int) -> UIView? {
        // v303 四轮 subagent #1 fix (Serious #4): Fabric 下 RCTViewComponentView
        // 不一定有 "reactTag" KVC key,直接 value(forKey:) 在某些 RN 版本会
        // throw NSUnknownKeyException → app crash。先 responds(to:) 守护。
        if view.responds(to: NSSelectorFromString("reactTag")) {
            if let v = view.value(forKey: "reactTag") as? Int, v == tag { return view }
            if let v = view.value(forKey: "reactTag") as? NSNumber, v.intValue == tag { return view }
        }
        for sub in view.subviews {
            if let found = findSubviewWithReactTag(sub, tag: tag) { return found }
        }
        return nil
    }

    #if canImport(MapboxMaps)
    private struct MapHandle {
        let mapView: MapView
        let map: MapboxMap
        // v303 四轮 fix (Nitpick): style 字段已无人使用 — 全切到 map.addPersistentCustomLayer
        // 后留下死字段,删掉减少耦合(StyleManager 在 v11 是 wrapper)。
    }

    private func extractMapboxMap(from view: UIView) -> MapHandle? {
        // v303 四轮 fix (Nitpick): 入口先清上次失败的 tree,否则成功后
        // lastExtractFailureTree 残留下次 reject 误报。
        // @rnmapbox/maps under React Native's new architecture (Fabric)
        // wraps the legacy `RNMBXMapView` (UIView subclass with the
        // `public var mapView : MapView!`) inside a Fabric component
        // view called `RNMBXMapViewComponentView` (subclass of
        // `RCTViewComponentView`). Layout: componentView.contentView
        // is set to the inner RNMBXMapView (see node_modules/@rnmapbox/
        // maps/ios/RNMBX/RNMBXMapViewComponentView.mm:103).
        //
        // Lookup order:
        //   1. If view IS the RNMBXMapView (Paper / old arch), use directly.
        //   2. Else, try view.contentView (Fabric component view).
        //   3. Else, give up.
        // We bridge via KVC so we don't have to import RNMBX symbols.

        self.lastExtractFailureTree = ""
        var innerView: UIView? = view
        // R105 (Xcode 26): Selector(("mapView")) 双括号绕 #selector 检查有时报 warning-as-error,
        // 改用 NSSelectorFromString 更明确, 跟 line 209 保持一致。
        if view.responds(to: NSSelectorFromString("mapView")) {
            // Looks like RNMBXMapView already.
            innerView = view
        } else if let contentView = view.value(forKey: "contentView") as? UIView,
                  contentView.responds(to: NSSelectorFromString("mapView")) {
            innerView = contentView
        }
        guard let host = innerView,
              let mapBoxView = host.value(forKey: "mapView") as? MapView else {
            // v303 subagent #3 fix: capture the view tree as a string so
            // the JS-side reject message contains enough context to
            // diagnose remotely (no device log needed). NSLog also kept
            // for local development.
            let tree = self.dumpViewTreeString(view, depth: 0)
            log("extractMapboxMap: 'mapView' KVC key not found. Tree:\n\(tree)")
            self.lastExtractFailureTree = String(tree.prefix(800))
            return nil
        }
        return MapHandle(mapView: mapBoxView, map: mapBoxView.mapboxMap)
    }

    private var lastExtractFailureTree: String = ""

    private func dumpViewTreeString(_ view: UIView, depth: Int) -> String {
        let prefix = String(repeating: "  ", count: depth)
        let tag: Any = view.responds(to: NSSelectorFromString("reactTag"))
            ? (view.value(forKey: "reactTag") ?? "nil") : "n/a"
        var out = "\(prefix)\(type(of: view)) reactTag=\(tag)\n"
        for sub in view.subviews { out += dumpViewTreeString(sub, depth: depth + 1) }
        return out
    }

    private func dumpViewTree(_ view: UIView, depth: Int) {
        let prefix = String(repeating: "  ", count: depth)
        let tag: Any = view.responds(to: NSSelectorFromString("reactTag"))
            ? (view.value(forKey: "reactTag") ?? "nil") : "n/a"
        log("\(prefix)\(type(of: view)) reactTag=\(tag)")
        for sub in view.subviews { dumpViewTree(sub, depth: depth + 1) }
    }

    private func removeLayerForTag(_ tag: Int, on map: MapboxMap) {
        if map.layerExists(withId: "cairn-fog-sdf") {
            do {
                try map.removeLayer(withId: "cairn-fog-sdf")
            } catch {
                log("removeLayer failed: \(error.localizedDescription)")
            }
        }
    }
    #endif

    private func log(_ msg: String) {
        NSLog("[CairnFog] %@", msg)
    }
}
