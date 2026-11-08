import 'package:dio/dio.dart';
import 'api_client.dart';

/// GET /deploy/status の結果（再起動できるかの事前確認。何も変更しない）
class DeployStatus {
  final bool ready;
  final String reason;

  /// 未反映の更新件数。バックエンドが返さないときは null
  final int? aheadCount;

  const DeployStatus({required this.ready, required this.reason, this.aheadCount});

  factory DeployStatus.fromJson(Map<String, dynamic> json) => DeployStatus(
        ready: json['ready'] == true,
        reason: json['reason']?.toString() ?? 'unknown',
        aheadCount: _intOrNull(json['aheadCount']),
      );
}

/// POST /deploy/now が 200 で返した結果
class DeployResult {
  final bool deployed;
  final String reason;
  final int? aheadCount;

  const DeployResult({required this.deployed, required this.reason, this.aheadCount});

  factory DeployResult.fromJson(Map<String, dynamic> json) => DeployResult(
        deployed: json['deployed'] == true,
        reason: json['reason']?.toString() ?? 'unknown',
        aheadCount: _intOrNull(json['aheadCount']),
      );
}

/// 再起動が拒否された（409）か、デスクトップに届かなかったときの例外。
/// [reason] はバックエンドの理由コード。届かなかったときは 'network'。
class DeployException implements Exception {
  final String reason;

  const DeployException(this.reason);

  @override
  String toString() => 'DeployException($reason)';
}

/// スマホからデスクトップのバックエンドを再起動する（既存の /deploy API を使う）。
///
/// POST /deploy/now が通ると、バックエンドはマージ済みコードを取り込んで
/// 終了コード 75 で落ち、起動側（dev.js / Tauri）が起動し直す。
class DeployService {
  final ApiClient _client;

  DeployService(this._client);

  /// GET /deploy/status
  Future<DeployStatus> getStatus() async {
    try {
      final response = await _client.get('/deploy/status');
      return DeployStatus.fromJson(_asMap(response.data));
    } on DioException catch (e) {
      throw _toDeployException(e);
    }
  }

  /// POST /deploy/now。拒否（409）は本文の reason を持つ [DeployException] になる。
  Future<DeployResult> deployNow() async {
    try {
      final response = await _client.post('/deploy/now', data: <String, dynamic>{});
      return DeployResult.fromJson(_asMap(response.data));
    } on DioException catch (e) {
      throw _toDeployException(e);
    }
  }

  static DeployException _toDeployException(DioException e) {
    final response = e.response;
    if (response == null) return const DeployException('network');
    final data = response.data;
    if (data is Map) {
      final reason = data['reason'];
      if (reason is String && reason.isNotEmpty) return DeployException(reason);
    }
    return DeployException('http-${response.statusCode}');
  }

  static Map<String, dynamic> _asMap(dynamic data) =>
      data is Map ? Map<String, dynamic>.from(data) : <String, dynamic>{};
}

int? _intOrNull(dynamic value) => value is num ? value.toInt() : null;

/// 理由コードを利用者向けの日本語にする。
///
/// @param reason - /deploy/status・/deploy/now の理由コード / reason code
/// @returns 表示用メッセージ / message
String deployReasonMessage(String reason) {
  switch (reason) {
    case 'nothing-to-activate':
      return 'すでに最新の状態です。再起動は不要でした';
    case 'no-startup-commit':
      return 'この起動方法では、スマホからの再起動は使えません';
    case 'active-executions':
    case 'running-executions':
      return '実行中のタスクがあるため、今は再起動できません';
    case 'queue-not-empty':
      return '実行待ちのタスクがあるため、今は再起動できません';
    case 'merge-in-flight':
      return 'マージ処理中のため、今は再起動できません';
    case 'working-tree-dirty':
      return 'デスクトップ側に未保存の変更があるため、再起動できません';
    case 'fast-forward-failed':
      return '更新の取り込みに失敗しました';
    case 'ahead-unknown':
      return 'デスクトップ側の状態を確認できませんでした';
    case 'shutting-down':
      return 'デスクトップは終了処理中です';
    case 'snapshot-degraded':
      return 'デスクトップ側の状態が取得できなかったため、再起動できません';
    case 'aux-children':
      return 'デスクトップ側で関連プロセスが動作中のため、今は再起動できません';
    case 'dependency-toolchain-mismatch':
      return 'デスクトップ側の環境の問題で再起動できません';
    case 'deployed':
      return '再起動します';
    case 'network':
      return 'デスクトップに届きませんでした。接続を確認してください';
    default:
      return '再起動できませんでした（$reason）';
  }
}
