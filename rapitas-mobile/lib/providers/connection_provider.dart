import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../config/api_config.dart';
import '../services/pairing/pairing_service.dart';

/// デスクトップ版バックエンドへの接続設定（URL・トークン・ペアリングした相手）。
class ConnectionSettings {
  final String baseUrl;

  /// QR ペアリングで受け取った端末専用トークン、または手入力した RAPITAS_API_TOKEN
  final String? apiToken;

  /// QR でペアリングしたデスクトップのID。IP が変わったときに mDNS で探し直すのに使う
  final String? desktopId;
  final String? desktopName;

  /// 保存済みの設定を読み込み終えたか。読み込み前に localhost へ繋ぎに行かないために使う
  final bool loaded;

  const ConnectionSettings({
    required this.baseUrl,
    this.apiToken,
    this.desktopId,
    this.desktopName,
    this.loaded = false,
  });

  bool get hasToken => apiToken != null && apiToken!.isNotEmpty;
  bool get isPaired => desktopId != null && desktopId!.isNotEmpty;

  ConnectionSettings copyWith({
    String? baseUrl,
    String? apiToken,
    bool clearToken = false,
    String? desktopId,
    String? desktopName,
    bool clearDesktop = false,
    bool? loaded,
  }) {
    return ConnectionSettings(
      baseUrl: baseUrl ?? this.baseUrl,
      apiToken: clearToken ? null : (apiToken ?? this.apiToken),
      desktopId: clearDesktop ? null : (desktopId ?? this.desktopId),
      desktopName: clearDesktop ? null : (desktopName ?? this.desktopName),
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
/// URL とデスクトップIDは shared_preferences（URL は旧 `backendUrl` キーをそのまま使い、既存の設定を引き継ぐ）、
/// トークンはエージェント実行まで操作できる強い権限なので flutter_secure_storage に置く。
class ConnectionSettingsNotifier extends StateNotifier<ConnectionSettings> {
  static const _urlKey = 'backendUrl';
  static const _tokenKey = 'rapitasApiToken';
  static const _desktopIdKey = 'pairedDesktopId';
  static const _desktopNameKey = 'pairedDesktopName';

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
      desktopId: prefs.getString(_desktopIdKey),
      desktopName: prefs.getString(_desktopNameKey),
      loaded: true,
    );
  }

  /// 接続先を手入力で保存する。トークンは空文字なら削除、null なら変更しない。
  /// 手入力した接続先は QR ペアリングの相手とは限らないので、ペアリング情報は消す。
  ///
  /// @param baseUrl - バックエンドの URL / 例: http://192.168.1.5:3001
  /// @param apiToken - バックエンドの RAPITAS_API_TOKEN / 空文字で削除
  Future<void> save({required String baseUrl, String? apiToken}) async {
    final normalized = ApiConfig.normalizeBaseUrl(baseUrl);
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_urlKey, normalized);
    await prefs.remove(_desktopIdKey);
    await prefs.remove(_desktopNameKey);

    var next = state.copyWith(baseUrl: normalized, loaded: true, clearDesktop: true);
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

  /// QR ペアリングの結果を保存する。
  ///
  /// @param result - デスクトップから受け取った接続情報 / ペアリング結果
  Future<void> savePairing(PairingResult result) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_urlKey, result.baseUrl);
    await prefs.setString(_desktopIdKey, result.desktopId);
    await prefs.setString(_desktopNameKey, result.desktopName);
    await _secureStorage.write(key: _tokenKey, value: result.token);
    state = state.copyWith(
      baseUrl: result.baseUrl,
      apiToken: result.token,
      desktopId: result.desktopId,
      desktopName: result.desktopName,
      loaded: true,
    );
  }

  /// mDNS で見つけ直した新しい接続先に切り替える（トークンとペアリング相手はそのまま）。
  ///
  /// @param baseUrl - 見つけた接続先 / 新しい接続先
  Future<void> updateDiscoveredUrl(String baseUrl) async {
    if (baseUrl == state.baseUrl) return;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_urlKey, baseUrl);
    state = state.copyWith(baseUrl: baseUrl);
  }
}
