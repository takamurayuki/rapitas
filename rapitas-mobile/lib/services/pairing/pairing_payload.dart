import 'dart:convert';

/// ペアリング用 QR コードの中身。
///
/// デスクトップ側の `rapitas-backend/services/mobile-link/pairing-payload.ts` と同じ形。
/// 片方を変えたらもう片方も変え、互換性のない変更なら `v` を上げる。
class PairingPayload {
  static const uriPrefix = 'rapitas://pair?d=';
  static const supportedVersion = 1;

  /// デスクトップの固定ID（IP が変わっても mDNS で探し直すのに使う）
  final String desktopId;
  final String desktopName;
  final int port;

  /// 試す順に並んだ LAN アドレス
  final List<String> hosts;
  final String code;
  final DateTime expiresAt;

  const PairingPayload({
    required this.desktopId,
    required this.desktopName,
    required this.port,
    required this.hosts,
    required this.code,
    required this.expiresAt,
  });

  /// QR から読んだ文字列を解釈する。Rapitas の QR でなければ [FormatException]。
  ///
  /// @param raw - 読み取った文字列 / QR の内容
  /// @returns 解釈したペアリング情報 / ペアリング情報
  static PairingPayload parse(String raw) {
    final text = raw.trim();
    if (!text.startsWith(uriPrefix)) {
      throw const FormatException('Rapitas のペアリング用QRコードではありません');
    }
    final Map<String, dynamic> json;
    try {
      final encoded = text.substring(uriPrefix.length);
      json = jsonDecode(utf8.decode(base64Url.decode(base64Url.normalize(encoded)))) as Map<String, dynamic>;
    } catch (_) {
      throw const FormatException('QRコードを読み取れませんでした');
    }
    if (json['v'] != supportedVersion) {
      throw const FormatException('このQRコードには対応していません。アプリを更新してください');
    }
    final id = json['id'], name = json['name'], port = json['port'], hosts = json['hosts'];
    final code = json['code'], exp = json['exp'];
    if (id is! String || port is! int || hosts is! List || code is! String || exp is! int) {
      throw const FormatException('QRコードの内容が正しくありません');
    }
    return PairingPayload(
      desktopId: id,
      desktopName: name is String && name.isNotEmpty ? name : 'デスクトップ',
      port: port,
      hosts: hosts.whereType<String>().toList(),
      code: code,
      expiresAt: DateTime.fromMillisecondsSinceEpoch(exp),
    );
  }

  bool isExpired(DateTime now) => now.isAfter(expiresAt);

  /// 試す接続先 URL（QR に入っていた順）
  List<String> get candidateBaseUrls => [for (final host in hosts) 'http://${formatHost(host)}:$port'];

  /// URL に入れられる形のホスト名（IPv6 は角括弧で囲む）
  static String formatHost(String host) => host.contains(':') && !host.startsWith('[') ? '[$host]' : host;
}
