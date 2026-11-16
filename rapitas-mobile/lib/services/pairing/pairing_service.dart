import 'package:dio/dio.dart';
import '../../config/api_config.dart';
import 'pairing_payload.dart';

/// ペアリングに成功したときに保存する内容
class PairingResult {
  final String baseUrl;
  final String token;
  final String desktopId;
  final String desktopName;

  const PairingResult({
    required this.baseUrl,
    required this.token,
    required this.desktopId,
    required this.desktopName,
  });
}

/// 利用者に見せる失敗理由
class PairingException implements Exception {
  final String message;
  const PairingException(this.message);

  @override
  String toString() => message;
}

/// QR のペアリングコードをデスクトップに渡し、この端末専用のトークンを受け取る。
///
/// QR に入っている LAN アドレスを順に試す。同じ Wi-Fi にいないと、どれにも届かない。
class PairingService {
  static const claimPath = '/mobile-link/claim';
  static const _perHostTimeout = Duration(seconds: 4);

  final Dio _dio;

  PairingService({Dio? dio})
      : _dio = dio ??
            Dio(BaseOptions(
              connectTimeout: _perHostTimeout,
              receiveTimeout: ApiConfig.receiveTimeout,
              // 4xx も例外にせず中身を読む（コード期限切れなどを利用者に伝えるため）
              validateStatus: (_) => true,
            ));

  /// ペアリングする。
  ///
  /// @param payload - QR の内容 / 読み取ったペアリング情報
  /// @param deviceName - デスクトップの一覧に出す名前 / 端末名
  /// @param now - 現在時刻（テスト用） / 現在時刻
  /// @returns 保存すべき接続情報 / 接続情報
  /// @throws {PairingException} どこにも届かない・コードが使えない場合 / 失敗時
  Future<PairingResult> pair(PairingPayload payload, {required String deviceName, DateTime? now}) async {
    if (payload.isExpired(now ?? DateTime.now())) {
      throw const PairingException('QRコードの有効期限が切れています。デスクトップで新しいQRコードを表示してください');
    }
    if (payload.hosts.isEmpty) {
      throw const PairingException('QRコードに接続先が入っていません。デスクトップのネットワーク接続を確認してください');
    }

    for (final baseUrl in payload.candidateBaseUrls) {
      final Response<dynamic> response;
      try {
        response = await _dio.post<dynamic>(
          '$baseUrl$claimPath',
          data: {'code': payload.code, 'deviceName': deviceName},
          options: Options(contentType: Headers.jsonContentType, responseType: ResponseType.json),
        );
      } on DioException {
        // このアドレスには届かなかった。次の候補へ
        continue;
      }
      final body = response.data;
      if (response.statusCode == 201 && body is Map && body['token'] is String) {
        return PairingResult(
          baseUrl: baseUrl,
          token: body['token'] as String,
          desktopId: body['desktopId'] is String ? body['desktopId'] as String : payload.desktopId,
          desktopName: body['desktopName'] is String ? body['desktopName'] as String : payload.desktopName,
        );
      }
      // 届いたうえで断られた場合は、他のアドレスを試しても結果は同じ
      final error = body is Map ? '${body['error'] ?? ''}' : '';
      if (error.contains('expired')) {
        throw const PairingException('QRコードの有効期限が切れています。デスクトップで新しいQRコードを表示してください');
      }
      if (response.statusCode == 503) {
        throw const PairingException('デスクトップでスマホ連携がオフになっています');
      }
      throw const PairingException('このQRコードは使えません（使用済みの可能性があります）。新しいQRコードを表示してください');
    }
    throw const PairingException('デスクトップに届きませんでした。スマホとパソコンが同じ Wi-Fi につながっているか確認してください');
  }
}
