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
  # R101 (2026-08-05): 删掉 static_framework=true。
  # 之前诊断认为它跟 Podfile useFrameworks:static 互斥, 后 subagent 反驳:
  # static_framework=true 在 Podfile use_frameworks!:linkage=>:static 下
  # 实际是 no-op (兼容), 不是互斥。删除动作无害但也不是修复。
  #
  # R102 (2026-08-05): 真根因 —— source_files glob 从 podspec 所在目录
  # 解析。podspec 在 modules/cairn-fog-layer/ios/CairnFogLayer.podspec,
  # 原来写 "ios/**/*.{h,m,mm,swift,metal}" → 解析成 ios/ios/**/* → 匹配 0
  # 文件 → target 空跑不编译 → 没 modulemap → import CairnFogLayer 失败。
  # 对比 expo-apple-authentication podspec 也在 ios/ 目录, source_files
  # 写 "**/*.{h,m,swift}" (无 ios/ 前缀), 编译成功。
  # s.static_framework = true  # R101 删 - no-op 无害
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

  # R102 fix: podspec 在 ios/ 目录, glob 相对 podspec 目录解析。
  # 原来 "ios/**/*.{h,m,mm,swift,metal}" → 解析成 ios/ios/**/* 匹配 0 文件。
  # 改成 "**/*.{h,m,mm,swift,metal}" 匹配当前目录下所有源文件 (同 expo-apple-authentication)。
  s.source_files = "**/*.{h,m,mm,swift,metal}"
  # v303 subagent fix: do NOT also list .metal as resources — Xcode
  # auto-compiles .metal under source_files into the framework's
  # metallib. Listing it in resources additionally caused "multiple
  # commands produce" build error on Xcode 15+. The runtime shader
  # loader first tries the precompiled metallib (Bundle(for:Self.self)
  # / sub-bundle), and falls back to compiling from the embedded
  # source string if not found.
end
