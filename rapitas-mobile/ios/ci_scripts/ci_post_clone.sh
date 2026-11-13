#!/bin/sh
# Xcode Cloud: clone 直後に実行される（このファイルの場所と名前は Xcode Cloud の決まり。
# ci_scripts は .xcworkspace と同じ階層に置く必要がある）。
#
# Xcode Cloud の Mac には Flutter も CocoaPods の依存も無いので、ここで用意する。
# - rapitas-mobile/.flutter-version の版の Flutter を取得し、flutter pub get で Generated.xcconfig と Podfile を作る
# - ビルド番号は Xcode Cloud の通し番号を使う。pubspec の +1 のままだと
#   TestFlight が「同じビルド番号」として2回目以降を受け付けないため
#
# NOTE: ここでは xcodebuild を呼ぶコマンド（flutter build ios --config-only や、Flutter の
# Swift Package Manager 連携）を使わない。Xcode Cloud ではこの段階で xcodebuild を呼ぶと
# 失敗し（--config-only で exit code 15。rakudate でも Xcode Cloud で xcodebuild が
# 「PIF transfer session (operation in progress?)」で失敗した）、同じスクリプトが GitHub の
# macOS では通る。Flutter 公式の Xcode Cloud 向け手順（precache → pub get → pod install）に合わせる。
#
# NOTE: 各ステップは失敗すると固有の終了コードで終わる（下の表）。Xcode Cloud の画面には
# 「Running ci_post_clone.sh script failed (exited with code N)」しか出ず、ログを見られない
# ことがあるため、N だけでどのステップで止まったか分かるようにしている。
#   11 CocoaPods のインストール        12 Flutter の取得
#   13 flutter precache               14 flutter pub get
#   15 ビルド番号の設定                16 pod install
#   17 リポジトリ内のディレクトリ移動  18 Swift Package Manager 連携をオフにする

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

# set_build_number <番号>: Generated.xcconfig の FLUTTER_BUILD_NUMBER を書き換え、書き換わったことを確かめる
set_build_number() {
  sed -i '' "s/^FLUTTER_BUILD_NUMBER=.*/FLUTTER_BUILD_NUMBER=$1/" ios/Flutter/Generated.xcconfig &&
    grep -qx "FLUTTER_BUILD_NUMBER=$1" ios/Flutter/Generated.xcconfig
}

# NOTE: Xcode のバージョンは xcodebuild を呼ばずに Info.plist から読む（上の NOTE のとおり、この段階では xcodebuild を使わない）
echo "==> 環境: macOS $(sw_vers -productVersion 2>/dev/null) $(uname -m) / Xcode $(defaults read "$(xcode-select -p)/../Info" CFBundleShortVersionString 2>/dev/null)"

step 17 "rapitas-mobile へ移動" cd "$CI_PRIMARY_REPOSITORY_PATH/rapitas-mobile"

export HOMEBREW_NO_AUTO_UPDATE=1
if ! command -v pod >/dev/null 2>&1; then
  step 11 "CocoaPods のインストール" brew install cocoapods
fi

# NOTE: 版は rapitas-mobile/.flutter-version で固定する（GitHub Actions の mobile.yml と同じ値）。
# stable を取ると新しい安定版で付属パッケージの版が変わり、コミット済みの pubspec.lock と食い違う。
FLUTTER_VERSION="$(tr -d '[:space:]' < "$CI_PRIMARY_REPOSITORY_PATH/rapitas-mobile/.flutter-version")"
step 12 "Flutter の取得" git clone https://github.com/flutter/flutter.git --depth 1 -b "$FLUTTER_VERSION" "$HOME/flutter"
export PATH="$PATH:$HOME/flutter/bin"

# NOTE: Swift Package Manager 連携がオンだと、Flutter はプラグインを Swift パッケージとして
# プロジェクトに追加するために xcodebuild を呼ぶ。オフにしてすべて CocoaPods で入れる
# （リポジトリのプロジェクトも CocoaPods 前提）
step 18 "Swift Package Manager 連携をオフにする" flutter config --no-enable-swift-package-manager
step 13 "flutter precache" flutter precache --ios
step 14 "flutter pub get" flutter pub get
step 15 "ビルド番号の設定" set_build_number "${CI_BUILD_NUMBER:-1}"

step 17 "ios へ移動" cd ios
step 16 "pod install" pod install

exit 0
