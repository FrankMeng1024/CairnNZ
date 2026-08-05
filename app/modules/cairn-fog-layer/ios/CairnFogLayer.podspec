Pod::Spec.new do |s|
  s.name           = 'CairnFogLayer'
  s.version        = '0.1.0'
  s.summary        = 'Native Mapbox CustomLayerHost SDF fog-of-war for Cairn.'
  s.description    = 'Renders a Metal-shader SDF fog overlay on top of a Mapbox @rnmapbox/maps MapView. Up to 256 unlock circles uploaded as a uniform array; alpha computed per-pixel with smoothstep soft edges. Designed for tens of thousands of unlocks via texture-packed alternative path (future).'
  s.author         = ''
  s.homepage       = 'https://github.com/yiiling/cairn'
  s.platforms = { :ios => '15.1' }
  s.source         = { git: '' }
  # v303 五轮 fix (真根因): 加回 static_framework。
  # 四轮删了之后 ExpoModulesProvider.swift `import CairnFogLayer` 编不过 —
  # "no such module 'CairnFogLayer'"。Swift import 一个 CocoaPod 需要 modulemap;
  # static_framework=true 时 CocoaPods 自动包成 .framework + 生成 modulemap,
  # 不加则只生成 static lib (.a) 没 modulemap → Swift 看不见这个 module。
  #
  # 四轮 subagent #1 担心"跟 rnmapbox dynamic MapboxMaps 冲突"是误判:
  # rnmapbox post_install 只动 MapboxMaps* pods,不动我们这个 pod;我们 depend
  # MapboxMaps 不重打包它。本 build log 已证 librnmapbox-maps.a + MapboxMaps.framework
  # 并存编译通过,没 duplicate symbol。
  #
  # R101 (2026-08-05): 删掉这行 static_framework=true —— 现在 Podfile 全局
  # 有 useFrameworks:static (R100 加的 expo-build-properties), 所有 pod 一起
  # 用 static framework。podspec 层再声明 static_framework=true 反而让 CocoaPods
  # 把 target 生成为"框架里嵌框架", source files 不放进 build phase, target
  # 空跑不编译, ExpoModulesProvider.swift 里 import 找不到 module。build
  # d932bfc2 fail 就是这个。
  # s.static_framework = true  # 删 - 由 Podfile 全局 useFrameworks:static 接管
  s.swift_version    = '5.0'

  s.dependency 'ExpoModulesCore'
  # v303 subagent fix: declare MapboxMaps explicitly so pod-install
  # order is deterministic (CairnFogLayer must compile AFTER MapboxMaps
  # since we import it). Version is unconstrained — cocoapods will pick
  # whatever @rnmapbox/maps locked (currently 11.20.1).
  s.dependency 'MapboxMaps'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule',
  }

  s.source_files = "ios/**/*.{h,m,mm,swift,metal}"
  # v303 subagent fix: do NOT also list .metal as resources — Xcode
  # auto-compiles .metal under source_files into the framework's
  # metallib. Listing it in resources additionally caused "multiple
  # commands produce" build error on Xcode 15+. The runtime shader
  # loader first tries the precompiled metallib (Bundle(for:Self.self)
  # / sub-bundle), and falls back to compiling from the embedded
  # source string if not found.
end
