Pod::Spec.new do |s|
  s.name           = 'PianoPdfParser'
  s.version        = '1.0.0'
  s.summary        = 'Rescore on-device PDF slicing module'
  s.description    = 'Rasterizes PDF pages and slices piano systems into PNG strips.'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = {
    :ios => '16.4',
    :tvos => '16.4'
  }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = [
    '**/*.{h,m,mm,swift}',
    '../cpp/**/*.{h,cpp}'
  ]

  s.frameworks = 'PDFKit', 'UIKit', 'CoreGraphics', 'ImageIO'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'CLANG_CXX_LANGUAGE_STANDARD' => 'c++17',
    'SWIFT_OBJC_BRIDGING_HEADER' => '${PODS_TARGET_SRCROOT}/PianoPdfParser-Bridging-Header.h'
  }
end
