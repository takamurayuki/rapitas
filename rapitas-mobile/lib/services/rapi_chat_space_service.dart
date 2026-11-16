import 'package:dio/dio.dart';

import '../models/rapi_chat/saved_message.dart';
import 'api_client.dart';

// ラピの会話スペースの API（/rapi-chat/*。設計 nav39 4.2）。
//
// 失敗の分け方: サーバーが理由を付けて断った応答（404・409・422・400）は結果の値で返し、
// 通信の失敗・タイムアウト・5xx は例外（DioException など）のまま投げる。保存待ちの列は、
// 前者なら項目を外し、後者なら何も外さずに間隔を置いて送り直す（設計 4.4）。

/// 一覧に出すスペース1件
class RapiSpaceSummary {
  final int id;
  final String? title;
  final int messageCount;
  final DateTime? lastMessageAt;
  final DateTime? createdAt;

  const RapiSpaceSummary({
    required this.id,
    this.title,
    this.messageCount = 0,
    this.lastMessageAt,
    this.createdAt,
  });

  static RapiSpaceSummary? tryParse(Object? json) {
    if (json is! Map || json['id'] is! num) return null;
    DateTime? date(Object? v) => v is String ? DateTime.tryParse(v) : null;
    return RapiSpaceSummary(
      id: (json['id'] as num).toInt(),
      title: json['title'] is String ? json['title'] as String : null,
      messageCount: json['messageCount'] is num ? (json['messageCount'] as num).toInt() : 0,
      lastMessageAt: date(json['lastMessageAt']),
      createdAt: date(json['createdAt']),
    );
  }

  /// 一覧の並びと相対日時に使う日時（話していなければ作った日時）
  DateTime? get activityAt => lastMessageAt ?? createdAt;
}

/// POST の結果
sealed class RapiCreateResult {
  const RapiCreateResult();
}

class RapiCreated extends RapiCreateResult {
  final RapiSpaceSummary space;
  const RapiCreated(this.space);
}

/// 409 space_limit（スペースの数が上限）
class RapiSpaceLimit extends RapiCreateResult {
  const RapiSpaceLimit();
}

/// それ以外の 4xx（端末側の不具合。送り直しても同じ）
class RapiCreateRefused extends RapiCreateResult {
  const RapiCreateRefused();
}

/// PUT の結果
sealed class RapiPutResult {
  const RapiPutResult();
}

class RapiPutSaved extends RapiPutResult {
  final String? title;
  const RapiPutSaved({this.title});
}

/// 422 invalid_items：[rejected] の項目は送り直しても同じ
class RapiPutInvalid extends RapiPutResult {
  final List<String> rejected;
  const RapiPutInvalid(this.rejected);
}

/// 409 message_limit：新しく作れるのは [remaining] 件。[rejected] は新規の項目（送った順）
class RapiPutLimit extends RapiPutResult {
  final int remaining;
  final List<String> rejected;
  const RapiPutLimit(this.remaining, this.rejected);
}

/// 400：本文全体の形の誤り（項目を特定できない）
class RapiPutMalformed extends RapiPutResult {
  const RapiPutMalformed();
}

/// 404：スペースが無い（別の端末で消された）
class RapiPutGone extends RapiPutResult {
  const RapiPutGone();
}

/// GET messages の1ページ（古い順）
class RapiMessagePage {
  final List<SavedMessage> messages;
  final bool hasMore;
  final int? nextBefore;

  const RapiMessagePage({required this.messages, this.hasMore = false, this.nextBefore});
}

/// 読み込もうとしたスペースが無かった（404）
class RapiSpaceNotFound implements Exception {
  const RapiSpaceNotFound();
}

/// 会話スペースの API（テストでは偽物に差し替える）
class RapiChatSpaceService {
  final ApiClient _api;

  RapiChatSpaceService(this._api);

  static int? _status(DioException e) => e.response?.statusCode;

  static Map<String, dynamic> _body(Object? data) =>
      data is Map ? Map<String, dynamic>.from(data) : const {};

  static List<String> _ids(Object? v) => [
        if (v is List)
          for (final r in v)
            if (r is Map && r['clientId'] is String) r['clientId'] as String,
      ];

  /// スペースの一覧（新しい順）
  Future<List<RapiSpaceSummary>> listSpaces() async {
    final res = await _api.get<dynamic>('/rapi-chat/spaces');
    final spaces = _body(res.data)['spaces'];
    return [
      if (spaces is List)
        for (final s in spaces)
          if (RapiSpaceSummary.tryParse(s) case final summary?) summary,
    ];
  }

  /// スペースを作る。[clientKey] が同じなら、前に作れていたスペースが返る（設計 6.5）
  Future<RapiCreateResult> createSpace({required String clientKey}) async {
    try {
      final res = await _api.post<dynamic>('/rapi-chat/spaces', data: {'clientKey': clientKey});
      final space = RapiSpaceSummary.tryParse(_body(res.data)['space']);
      if (space == null) throw const FormatException('space');
      return RapiCreated(space);
    } on DioException catch (e) {
      final status = _status(e);
      if (status == 409) return const RapiSpaceLimit();
      if (status != null && status >= 400 && status < 500) return const RapiCreateRefused();
      rethrow;
    }
  }

  /// スペースを消す。無かった（404）ときも成功として扱う
  Future<void> deleteSpace(int id) async {
    try {
      await _api.delete<dynamic>('/rapi-chat/spaces/$id');
    } on DioException catch (e) {
      if (_status(e) == 404) return;
      rethrow;
    }
  }

  /// [before] より前の [limit] 件（無ければ最新のページ）
  ///
  /// @throws RapiSpaceNotFound スペースが無いとき
  Future<RapiMessagePage> loadMessages(int spaceId, {int? before, int limit = 50}) async {
    try {
      final res = await _api.get<dynamic>('/rapi-chat/spaces/$spaceId/messages', queryParameters: {
        if (before != null) 'before': before,
        'limit': limit,
      });
      final body = _body(res.data);
      final rows = body['messages'];
      return RapiMessagePage(
        messages: [
          if (rows is List)
            for (final r in rows)
              if (SavedMessage.tryParse(r) case final m?) m,
        ],
        hasMore: body['hasMore'] == true,
        nextBefore: body['nextBefore'] is num ? (body['nextBefore'] as num).toInt() : null,
      );
    } on DioException catch (e) {
      if (_status(e) == 404) throw const RapiSpaceNotFound();
      rethrow;
    }
  }

  /// [items] を1回分として保存する（全部保存されるか、1件も保存されない）
  Future<RapiPutResult> putMessages(int spaceId, List<SavedMessage> items) async {
    try {
      final res = await _api.put<dynamic>('/rapi-chat/spaces/$spaceId/messages',
          data: {'messages': [for (final i in items) i.toJson()]});
      final space = _body(_body(res.data)['space']);
      return RapiPutSaved(title: space['title'] is String ? space['title'] as String : null);
    } on DioException catch (e) {
      final body = _body(e.response?.data);
      switch (_status(e)) {
        case 400:
          return const RapiPutMalformed();
        case 404:
          return const RapiPutGone();
        case 409:
          return RapiPutLimit(
              body['remaining'] is num ? (body['remaining'] as num).toInt() : 0, _ids(body['rejected']));
        case 422:
          return RapiPutInvalid(_ids(body['rejected']));
      }
      rethrow;
    }
  }
}
