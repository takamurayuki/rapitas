// 声で開いた画面の目印。
//
// 入力欄に autofocus する画面（作成フォーム）は、声で開かれたときはフォーカスしない。
// フォーカスやキーボードが出ると常時聞き取りが止まり、開いた直後の「戻る」すら効かなくなるため。
// 音声コマンドが画面を開く直前に [markOpened] し、開いた画面が最初の build 前に [consume] で受け取る。
// タップで開いたときは目印が無いので、従来どおりフォーカスする。

class VoiceOpenedScreens {
  VoiceOpenedScreens._();

  /// 目印の有効時間（開くのに失敗した目印が、あとでタップで開いた画面に効かないように）
  static const Duration ttl = Duration(seconds: 3);

  static String? _path;
  static DateTime? _at;

  /// 時刻の取り方（テストで差し替える）
  static DateTime Function() now = DateTime.now;

  /// 音声コマンドが [path] の画面をこれから開く
  static void markOpened(String path) {
    _path = path;
    _at = now();
  }

  /// [path] の画面が声で開かれたかを受け取る（1回だけ true。受け取ったら目印を消す）
  ///
  /// @param path - 画面のパス（AppRoutes と同じ値） / 画面のパス
  /// @returns 声で開かれていれば true / 声で開かれたなら true
  static bool consume(String path) {
    final at = _at;
    final hit = _path == path && at != null && now().difference(at) <= ttl;
    if (_path == path) {
      _path = null;
      _at = null;
    }
    return hit;
  }

  /// 目印を消す（テスト用）
  static void reset() {
    _path = null;
    _at = null;
  }
}
