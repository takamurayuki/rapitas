import 'package:dio/dio.dart';
import '../models/theme_auto_run.dart';
import 'api_client.dart';

/// テーマ単位の自動実行の取得と操作（rapitas-backend/routes/workflow/theme-auto-run.ts）。
///
/// 開始できないテーマ（開発テーマでない・作業フォルダ未設定）は 400 と理由の error が返る。
/// その文面を画面にそのまま出すため、失敗は error（無ければ message）を本文にした
/// [ThemeAutoRunException] で投げる。
class ThemeAutoRunService {
  final ApiClient _client;

  ThemeAutoRunService(this._client);

  /// GET /themes/:id/auto-run
  ///
  /// NOTE: バックエンドは行が無いテーマには idle の行を作って返す（getOrCreateAutoRun）。
  Future<ThemeAutoRunSnapshot> getAutoRun(String themeId) async {
    final body = await _call(() => _client.get('/themes/$themeId/auto-run'), fallbackError: '自動実行の状態を取得できませんでした');
    return ThemeAutoRunSnapshot.fromJson(body, themeId: themeId);
  }

  /// 自動実行を開始（一時停止からの再開も同じ action）。[order] は priority | created
  Future<void> start(String themeId, {String order = 'priority'}) =>
      _post(themeId, {'action': 'start', 'order': order}, fallbackError: '自動実行を開始できませんでした');

  /// 次のタスクの選定だけを止める。走っているタスクは止まらない
  Future<void> pause(String themeId) =>
      _post(themeId, {'action': 'pause'}, fallbackError: '自動実行を一時停止できませんでした');

  /// 自動実行を止め、テーマ内の走っているエージェントも止める
  Future<void> stop(String themeId) =>
      _post(themeId, {'action': 'stop'}, fallbackError: '自動実行を停止できませんでした');

  Future<void> _post(String themeId, Map<String, dynamic> data, {required String fallbackError}) async {
    await _call(() => _client.post('/themes/$themeId/auto-run', data: data), fallbackError: fallbackError);
  }

  Future<Map<String, dynamic>> _call(
    Future<Response<dynamic>> Function() request, {
    required String fallbackError,
  }) async {
    final Map<String, dynamic> body;
    try {
      final response = await request();
      body = response.data is Map ? Map<String, dynamic>.from(response.data as Map) : <String, dynamic>{};
    } on DioException catch (e) {
      final message = _errorMessageOf(e.response?.data);
      if (message != null) throw ThemeAutoRunException(message);
      rethrow;
    }
    if (body['success'] != true) {
      throw ThemeAutoRunException(_errorMessageOf(body) ?? fallbackError);
    }
    return body;
  }

  static String? _errorMessageOf(dynamic data) {
    if (data is! Map) return null;
    for (final key in const ['error', 'message']) {
      final value = data[key];
      if (value is String && value.isNotEmpty) return value;
    }
    return null;
  }
}

/// 自動実行の取得・操作の失敗。toString はバックエンドの文面そのもの
class ThemeAutoRunException implements Exception {
  final String message;

  const ThemeAutoRunException(this.message);

  @override
  String toString() => message;
}
