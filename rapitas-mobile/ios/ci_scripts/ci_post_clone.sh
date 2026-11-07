#!/bin/sh
# Xcode Cloud: clone 直後に実行される（このファイルの場所と名前は Xcode Cloud の決まり。
# ci_scripts は .xcworkspace と同じ階層に置く必要がある）。
#
# Xcode Cloud の Mac には Flutter も CocoaPods の依存も無いので、ここで用意する。
# - Flutter stable を取得し、Generated.xcconfig と Podfile を作る（--config-only）
# - ビルド番号は Xcode Cloud の通し番号を使う。pubspec の +1 のままだと
#   TestFlight が「同じビルド番号」として2回目以降を受け付けないため
set -e

cd "$CI_PRIMARY_REPOSITORY_PATH/rapitas-mobile"

# NOTE: CocoaPods を先に入れる。flutter build ios --config-only は内部で pod install を実行するため、
# 後から入れると Xcode Cloud（CocoaPods なし）ではここで失敗する（exit code 1）
export HOMEBREW_NO_AUTO_UPDATE=1
command -v pod >/dev/null 2>&1 || brew install cocoapods

git clone https://github.com/flutter/flutter.git --depth 1 -b stable "$HOME/flutter"
export PATH="$PATH:$HOME/flutter/bin"

flutter precache --ios
flutter pub get
# NOTE: --no-codesign が必要。付けないと Flutter がキーチェーンから署名用の証明書を探し、
# 証明書のない Xcode Cloud の準備段階では「No valid code signing certificates were found」で止まる（exit code 1）。
# ここでは設定ファイルを作るだけで、署名はこの後 Xcode Cloud が行う
flutter build ios --config-only --release --no-codesign --build-number="${CI_BUILD_NUMBER:-1}"

cd ios
pod install

exit 0
