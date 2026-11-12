import 'api_client.dart';
import '../models/backlog.dart';

/// バックログ（アイデア／懸念／仮説）の API。
///
/// 一覧は先頭の1ページ（limit=100&offset=0）だけ取る（ページネーション UI は未実装）。
/// 作成 API は作成した実体ではなく {success, id} を返すので、作成後は一覧を取り直すこと。
class BacklogService {
  final ApiClient _client;

  BacklogService(this._client);

  static const Map<String, dynamic> _firstPage = {'limit': '100', 'offset': '0'};

  /// レスポンスから一覧部分を取り出す（{key: [...]} でも配列そのものでも受ける）
  static List<Map<String, dynamic>> _items(dynamic data, String key) {
    final dynamic list = data is List ? data : (data is Map ? data[key] : null);
    if (list is! List) return const [];
    return list.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList();
  }

  // ---- アイデア ----

  /// アイデア一覧（先頭100件）。絞り込みは指定されたもの（null・空文字でないもの）だけクエリに載せる。
  ///
  /// - [themeId]：テーマID（バックエンドは文字列で受けて int 化する）
  /// - [priority]：urgent / high / medium / low（medium は優先度タグなしのアイデアも含む）
  /// - [status]：open（未使用）/ used（使用済み）/ all。未指定はバックエンドで 'all' と同じ全件
  /// - [search]：キーワード（バックエンド側でタイトル・本文を検索）
  Future<List<Idea>> getIdeas({
    String? themeId,
    String? priority,
    String? status,
    String? search,
  }) async {
    final query = <String, dynamic>{..._firstPage};
    void put(String key, String? value) {
      if (value != null && value.isNotEmpty) query[key] = value;
    }

    put('themeId', themeId);
    put('priority', priority);
    put('status', status);
    put('search', search);
    final response = await _client.get('/idea-box', queryParameters: query);
    return _items(response.data, 'ideas').map(Idea.fromJson).toList();
  }

  Future<void> createIdea(Map<String, dynamic> data) async {
    await _client.post('/idea-box', data: data);
  }

  Future<void> deleteIdea(String id) async {
    await _client.delete('/idea-box/$id');
  }

  // ---- 懸念 ----

  /// NOTE: status を省くとバックエンドは 'open' だけを返す。行に状態ラベルを出すので全状態を取る。
  Future<List<Concern>> getConcerns() async {
    final response = await _client.get(
      '/concerns',
      queryParameters: {..._firstPage, 'status': 'all'},
    );
    return _items(response.data, 'concerns').map(Concern.fromJson).toList();
  }

  /// 懸念を登録する。新しく保存されたら true。
  ///
  /// バックエンドは重複・類似の懸念を新規保存せず既存に寄せることがあり、そのときは
  /// 200 で {stored: false, outcome: 'reused' | 'suppressed', ...} を返す。
  Future<bool> createConcern(Map<String, dynamic> data) async {
    final response = await _client.post('/concerns', data: data);
    final body = response.data;
    return !(body is Map && body['stored'] == false);
  }

  Future<void> deleteConcern(String id) async {
    await _client.delete('/concerns/$id');
  }

  // ---- 仮説 ----

  /// NOTE: status を省くとバックエンドは 'open' だけを返す。状態を変えた仮説が一覧から
  /// 消えないよう全状態を取る。
  Future<List<Hypothesis>> getHypotheses() async {
    final response = await _client.get(
      '/hypotheses',
      queryParameters: {..._firstPage, 'status': 'all'},
    );
    return _items(response.data, 'hypotheses').map(Hypothesis.fromJson).toList();
  }

  /// 状態の手動上書き。バックエンドは PUT /hypotheses/:id/status のみ（PATCH は無い）。
  Future<void> updateHypothesisStatus(String id, String status) async {
    await _client.put('/hypotheses/$id/status', data: {'status': status});
  }

  Future<void> deleteHypothesis(String id) async {
    await _client.delete('/hypotheses/$id');
  }
}

/// アイデア作成（POST /idea-box）のボディ。
///
/// 内容が空ならタイトルで代わりに埋める（バックエンドは内容必須）。テーマを選ばないので
/// scope は 'global' 固定で、themeId は送らない（POST は themeId=null を受け付けない）。
Map<String, dynamic> buildIdeaCreateBody({
  required String title,
  String? content,
  required String priority,
}) {
  final trimmedTitle = title.trim();
  final trimmedContent = content?.trim() ?? '';
  return {
    'title': trimmedTitle,
    'content': trimmedContent.isNotEmpty ? trimmedContent : trimmedTitle,
    'scope': 'global',
    'priority': priority,
  };
}

/// 懸念作成（POST /concerns）のボディ。場所は空ならキーごと省く。
Map<String, dynamic> buildConcernCreateBody({
  required String title,
  required String detail,
  required String type,
  required String severity,
  String? location,
}) {
  final trimmedLocation = location?.trim() ?? '';
  return {
    'title': title.trim(),
    'detail': detail.trim(),
    'type': type,
    'severity': severity,
    if (trimmedLocation.isNotEmpty) 'location': trimmedLocation,
  };
}
