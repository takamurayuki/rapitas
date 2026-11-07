#!/bin/sh
# Xcode Cloud: clone 直後に実行される（このファイルの場所と名前は Xcode Cloud の決まり。
# ci_scripts は .xcworkspace と同じ階層に置く必要がある）。
#
# Xcode Cloud の Mac には Flutter も CocoaPods の依存も無いので、ここで用意する。
# - Flutter stable を取得し、Generated.xcconfig と Podfile を作る（--config-only）
# - ビルド番号は Xcode Cloud の通し番号を使う。pubspec の +1 のままだと
#   TestFlight が「同じビルド番号」として2回目以降を受け付けないため
#
# NOTE: 各ステップは失敗すると固有の終了コードで終わる（下の表）。Xcode Cloud の画面には
# 「Running ci_post_clone.sh script failed (exited with code N)」しか出ず、ログを見られない
# ことがあるため、N だけでどのステップで止まったか分かるようにしている。
#   11 CocoaPods のインストール   12 Flutter の取得       13 flutter precache
#   14 flutter pub get           15 flutter build ios --config-only
#   16 pod install               17 リポジトリ内のディレクトリ移動

# step <終了コード> <説明> <コマンド...>: コマンドが失敗したら、説明を出して固有のコードで終わる
step() {
  code="$1"
  label="$2"
  shift 2
  echo "==> [$code] $label"
  "$@" || {
    echo "error: ci_post_clone.sh: [$code] $label が失敗しました: $*" >&2
    exit "$code"
  }
}

echo "==> 環境: $(sw_vers -productVersion 2>/dev/null) $(uname -m) / $(xcodebuild -version 2>/dev/null | head -1)"

step 17 "rapitas-mobile へ移動" cd "$CI_PRIMARY_REPOSITORY_PATH/rapitas-mobile"

# NOTE: CocoaPods を先に入れる。flutter build ios --config-only は内部で pod install を実行するため、
# 後から入れると Xcode Cloud（CocoaPods なし）ではそこで失敗する
export HOMEBREW_NO_AUTO_UPDATE=1
if ! command -v pod >/dev/null 2>&1; then
  step 11 "CocoaPods のインストール" brew install cocoapods
fi

step 12 "Flutter の取得" git clone https://github.com/flutter/flutter.git --depth 1 -b stable "$HOME/flutter"
export PATH="$PATH:$HOME/flutter/bin"

step 13 "flutter precache" flutter precache --ios
step 14 "flutter pub get" flutter pub get
# NOTE: --no-codesign が必要。付けないと Flutter がキーチェーンから署名用の証明書を探し、
# 証明書のない Xcode Cloud の準備段階では「No valid code signing certificates were found」で止まる。
# ここでは設定ファイルを作るだけで、署名はこの後 Xcode Cloud が行う
step 15 "flutter build ios --config-only" flutter build ios --config-only --release --no-codesign --build-number="${CI_BUILD_NUMBER:-1}"

step 17 "ios へ移動" cd ios
step 16 "pod install" pod install

exit 0
