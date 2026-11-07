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
# ステップ 15 が失敗したときは、出力の内容から原因の種類も判別して次のコードで終わる:
#   151 Xcode の内部エラー（PIF transfer session）  152 CocoaPods
#   153 コード署名                                  154 Xcode のバージョン
#   155 Swift Package Manager                       156 iOS プラットフォームが未インストール
#   157 ファイル・コマンドが見つからない            150 上のどれでもない

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

# classify_config_only <ログ>: ステップ 15 の出力から原因の種類を判別して終了コードを返す（上の表）
classify_config_only() {
  # NOTE: 成功時にも出る無害な警告（プラグインの SwiftPM 未対応、CocoaPods の推奨バージョン）は判定に使わない
  f="$1.filtered"
  grep -viE "Package Manager adoption|recommended version" "$1" > "$f"
  if grep -qi "PIF transfer" "$f"; then return 151; fi
  if grep -qi "cocoapods" "$f"; then return 152; fi
  if grep -qiE "code ?sign|signing|certificate|provisioning" "$f"; then return 153; fi
  if grep -qiE "requires xcode|xcode .*(not supported|too old|or newer|or higher)|unsupported xcode" "$f"; then return 154; fi
  if grep -qiE "swift package|swiftpm|resolvePackageDependencies|Package\.resolved" "$f"; then return 155; fi
  if grep -qiE "is not installed|download and install the platform" "$f"; then return 156; fi
  if grep -qiE "not found|no such file|unable to find" "$f"; then return 157; fi
  return 150
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
echo "==> [15] flutter build ios --config-only"
CONFIG_LOG="${TMPDIR:-/tmp}/flutter-config-only.log"
if ! flutter build ios --config-only --release --no-codesign --build-number="${CI_BUILD_NUMBER:-1}" > "$CONFIG_LOG" 2>&1; then
  cat "$CONFIG_LOG"
  classify_config_only "$CONFIG_LOG"
  code=$?
  echo "error: ci_post_clone.sh: [15] flutter build ios --config-only が失敗しました（種類: $code）" >&2
  exit "$code"
fi
cat "$CONFIG_LOG"

step 17 "ios へ移動" cd ios
step 16 "pod install" pod install

exit 0
