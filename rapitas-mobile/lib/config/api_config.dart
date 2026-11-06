/// デスクトップ版バックエンド（rapitas-backend）への接続設定。
///
/// バックエンドは既定で 127.0.0.1 にしか bind しない。スマホから繋ぐときは
/// デスクトップ側で `RAPITAS_BIND_HOST`（例: Tailscale の IP）と
/// `RAPITAS_API_TOKEN` を両方設定し、同じトークンをこのアプリに入れる。
class ApiConfig {
  static const String defaultBaseUrl = 'http://localhost:3001';
  static const Duration connectTimeout = Duration(seconds: 10);
  static const Duration receiveTimeout = Duration(seconds: 30);
  static const String sseStreamPath = '/events/stream';

  String _baseUrl;

  /// バックエンドの `RAPITAS_API_TOKEN`。未設定なら null（ループバック運用）
  final String? apiToken;

  ApiConfig({String? baseUrl, String? apiToken})
      : _baseUrl = normalizeBaseUrl(baseUrl ?? defaultBaseUrl),
        apiToken = (apiToken == null || apiToken.trim().isEmpty) ? null : apiToken.trim();

  String get baseUrl => _baseUrl;

  set baseUrl(String url) {
    _baseUrl = normalizeBaseUrl(url);
  }

  bool get hasToken => apiToken != null;

  /// REST 用の認証ヘッダー
  Map<String, String> get authHeaders =>
      hasToken ? {'Authorization': 'Bearer $apiToken'} : const {};

  /// SSE の URL。トークンは Authorization ヘッダーで送るので URL には含めない
  /// （バックエンドは `?token=` も受け付けるが、URL はプロキシ等のログに残りやすい）。
  String get sseUrl => '$_baseUrl$sseStreamPath';

  /// 末尾のスラッシュを落とし、スキームが無ければ http:// を補う
  static String normalizeBaseUrl(String url) {
    var value = url.trim();
    while (value.endsWith('/')) {
      value = value.substring(0, value.length - 1);
    }
    if (value.isNotEmpty && !value.contains('://')) {
      value = 'http://$value';
    }
    return value;
  }
}
