Pod::Spec.new do |s|
  s.name           = 'CairnFogLayer'
  s.version        = '0.1.0'
  s.summary        = 'Native Mapbox CustomLayerHost SDF fog-of-war for Cairn.'
  s.description    = 'Renders a Metal-shader SDF fog overlay on top of a Mapbox @rnmapbox/maps MapView. Up to 256 unlock circles uploaded as a uniform array; alpha computed per-pixel with smoothstep soft edges. Designed for tens of thousands of unlocks via texture-packed alternative path (future).'
  s.author         = ''
  s.homepage       = 'https://github.com/yiiling/cairn'
  s.platforms = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

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
