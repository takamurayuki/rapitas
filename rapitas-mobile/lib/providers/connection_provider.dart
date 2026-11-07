import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../config/api_config.dart';

/// デスクトップ版バックエンドへの接続設定（URL とトークン）。
class ConnectionSettings {
  final String baseUrl;
  final String? apiToken;

  /// 保存済みの設定を読み込み終えたか。読み込み前に localhost へ繋ぎに行かないために使う
  final bool loaded;

  const ConnectionSettings({
    required this.baseUrl,
    this.apiToken,
    this.loaded = false,
  });

  bool get hasToken => apiToken != null && apiToken!.isNotEmpty;

  ConnectionSettings copyWith({String? baseUrl, String? apiToken, bool clearToken = false, bool? loaded}) {
    return ConnectionSettings(
      baseUrl: baseUrl ?? this.baseUrl,
      apiToken: clearToken ? null : (apiToken ?? this.apiToken),
      loaded: loaded ?? this.loaded,
    );
  }
}

final connectionSettingsProvider =
    StateNotifierProvider<ConnectionSettingsNotifier, ConnectionSettings>((ref) {
  return ConnectionSettingsNotifier();
});

/// 接続設定の保存と読み込み。
///
/// URL は shared_preferences（旧 `backendUrl` キーをそのまま使い、既存の設定を引き継ぐ）、
/// トークンはエージェント実行まで操作できる強い権限なので flutter_secure_storage に置く。
class ConnectionSettingsNotifier extends StateNotifier<ConnectionSettings> {
  static const _urlKey = 'backendUrl';
  static const _tokenKey = 'rapitasApiToken';

  final FlutterSecureStorage _secureStorage;

  ConnectionSettingsNotifier({FlutterSecureStorage? secureStorage})
      : _secureStorage = secureStorage ?? const FlutterSecureStorage(),
        super(const ConnectionSettings(baseUrl: ApiConfig.defaultBaseUrl)) {
    _load();
  }

  Future<void> _load() async {
    final prefs = await SharedPreferences.getInstance();
    final url = prefs.getString(_urlKey);
    String? token;
    try {
      token = await _secureStorage.read(key: _tokenKey);
    } catch (_) {
      // NOTE: キーチェーンが読めない端末（初回起動直後のロック中など）でも、URL だけで繋ぎに行けるようにする。
      token = null;
    }
    if (!mounted) return;
    state = ConnectionSettings(
      baseUrl: url == null ? ApiConfig.defaultBaseUrl : ApiConfig.normalizeBaseUrl(url),
      apiToken: token,
      loaded: true,
    );
  }

  /// 接続先を保存する。トークンは空文字なら削除、null なら変更しない。
  ///
  /// @param baseUrl - バックエンドの URL / 例: http://100.64.0.1:3001
  /// @param apiToken - バックエンドの RAPITAS_API_TOKEN / 空文字で削除
  Future<void> save({required String baseUrl, String? apiToken}) async {
    final normalized = ApiConfig.normalizeBaseUrl(baseUrl);
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_urlKey, normalized);

    var next = state.copyWith(baseUrl: normalized, loaded: true);
    if (apiToken != null) {
      final trimmed = apiToken.trim();
      if (trimmed.isEmpty) {
        await _secureStorage.delete(key: _tokenKey);
        next = next.copyWith(clearToken: true);
      } else {
        await _secureStorage.write(key: _tokenKey, value: trimmed);
        next = next.copyWith(apiToken: trimmed);
      }
    }
    state = next;
  }
}
