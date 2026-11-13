Pod::Spec.new do |s|
  s.name           = 'ExpoVoicevox'
  s.version        = '0.1.0'
  s.summary        = 'voicevox-core based speech synthesis for Expo apps'
  s.description    = 'Expo module that wraps VOICEVOX CORE to synthesize Japanese speech on iOS.'
  s.author         = 'faiare'
  s.homepage       = 'https://github.com/faiare/expo-voicevox'
  # voicevox_core.xcframework の MinimumOSVersion は 16.2。iOS 以外のスライスは配布されていない。
  s.platforms      = {
    :ios => '16.4'
  }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  # 再帰 glob にすると Frameworks/ 配下の voicevox_core.h までコンパイル対象に入ってしまうため、
  # このディレクトリ直下のソースだけを対象にする。
  s.source_files = "*.{h,m,mm,swift}"

  # `npm run setup:voicevox` で配置される。どちらも dynamic framework なのでアプリへ Embed される。
  # voicevox_core は ONNX Runtime をロード時動的リンクするので、2 つセットで必要。
  s.vendored_frameworks = [
    "Frameworks/voicevox_core.xcframework",
    "Frameworks/voicevox_onnxruntime.xcframework",
  ]

  # ネイティブの単体テスト（シミュレータで XCTest として回す）。npm の tarball には入れないので、
  # 利用者の pod install では `:testspecs` を指定しない限り参照されない。example の Podfile は
  # example/plugins/withExpoVoicevoxTestSpecs.js が `:testspecs => ['Tests']` を足している。
  s.test_spec 'Tests' do |test_spec|
    test_spec.source_files = 'Tests/*.swift'
    test_spec.frameworks = 'XCTest', 'AVFoundation'
    # 依存（ExpoModulesCore → React）の静的ライブラリが C++ 標準ライブラリを要求する。
    test_spec.libraries = 'c++'
  end
end
