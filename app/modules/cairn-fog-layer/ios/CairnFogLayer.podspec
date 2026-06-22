Pod::Spec.new do |s|
  s.name           = 'CairnFogLayer'
  s.version        = '0.1.0'
  s.summary        = 'Native Mapbox CustomLayerHost SDF fog-of-war for Cairn.'
  s.description    = 'Renders a Metal-shader SDF fog overlay on top of a Mapbox @rnmapbox/maps MapView. Up to 256 unlock circles uploaded as a uniform array; alpha computed per-pixel with smoothstep soft edges. Designed for tens of thousands of unlocks via texture-packed alternative path (future).'
  s.author         = ''
  s.homepage       = 'https://github.com/yiiling/cairn'
  s.platforms      = { :ios => '15.1', :tvos => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  # MapboxMaps is supplied by @rnmapbox/maps (transitively); we declare the
  # dependency loosely so cocoapods picks the same version rnmapbox locked.
  # Forcing an exact version here would conflict with rnmapbox's Podfile.

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule',
    # We use the runtime metal compiler for our .metal file; this pod is
    # bundled with rnmapbox already so we don't need separate flags.
  }

  s.source_files = "ios/**/*.{h,m,mm,swift,metal}"
  s.resources    = "ios/**/*.metal"
end
