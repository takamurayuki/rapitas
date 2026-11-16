// X-Rapitas-Source は判断画面からの呼び出しにだけ付く（ラピ伴走化 第2段階-4、設計 2章・8章）。
//
// ApiClient の全リクエストに付くと、ラピ経由の送信（/assistant/*・/copilot/chat）と人の判断を
// バックエンドが見分けられなくなる。ここでは「どこに付くか」を、実際の Dio の設定とソースの両方で確かめる。
import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rapitas_mobile/config/api_config.dart';
import 'package:rapitas_mobile/services/api_client.dart';
import 'package:rapitas_mobile/services/human_decision_client.dart';

final _header = RegExp('x-rapitas-source', caseSensitive: false);

List<File> _dartFiles(String dir) => Directory(dir)
    .listSync(recursive: true)
    .whereType<File>()
    .where((f) => f.path.endsWith('.dart'))
    .toList();

String _rel(File f) => f.path.substring(f.path.indexOf('lib/'));

/// コメント行を除いた本文（注意書きの言及は数えない）
String _code(File f) =>
    f.readAsLinesSync().where((l) => !l.trimLeft().startsWith('//')).join('\n');

void main() {
  test('the shared ApiClient never sends the human header by default', () {
    final dio = ApiClient.createDio(ApiConfig(baseUrl: 'http://desktop.local:3001', apiToken: 't'));
    expect(dio.options.headers.keys.where(_header.hasMatch), isEmpty);
    expect(dio.options.headers['Authorization'], 'Bearer t');
  });

  test('HumanDecisionClient adds the header to its own request only', () async {
    final seen = <Map<String, dynamic>>[];
    final dio = Dio(BaseOptions(baseUrl: 'http://desktop.local:3001'));
    dio.interceptors.add(InterceptorsWrapper(onRequest: (o, h) {
      seen.add(o.headers);
      h.resolve(Response(requestOptions: o, statusCode: 200));
    }));
    await HumanDecisionClient(dio).post('/workflow/tasks/1/approve-plan', data: {'approved': true});
    expect(seen.single['X-Rapitas-Source'], 'ui');
    // 同じ Dio の既定ヘッダには残らない（次の要求に漏れない）
    expect(dio.options.headers.keys.where(_header.hasMatch), isEmpty);
  });

  test('only the decision client writes the header in code', () {
    final hits = [
      for (final f in _dartFiles('lib'))
        if (_header.hasMatch(_code(f))) _rel(f),
    ];
    expect(hits, ['lib/services/human_decision_client.dart']);
  });

  test('ラピ’s screens and services never reach the decision client', () {
    final decisionUsers = [
      for (final f in _dartFiles('lib'))
        if (RegExp(r'human_decision_client\.dart|decision_service\.dart|decisionServiceProvider')
            .hasMatch(_code(f)))
          _rel(f),
    ]..sort();
    // 窓口を作る provider、判断画面の節、判断の API 自身だけ
    expect(decisionUsers, [
      'lib/providers/companion_provider.dart',
      'lib/screens/decision/decision_sections.dart',
      'lib/services/decision_service.dart',
    ]);
    // ラピ（会話・音声）はリンクだけ。判断の画面や窓口を直接持たない
    for (final f in [
      ..._dartFiles('lib/screens/rapi'),
      File('lib/providers/rapi_chat_provider.dart'),
      File('lib/services/assistant_service.dart'),
      File('lib/services/voice_command_flow.dart'),
    ]) {
      expect(_code(f), isNot(contains('decision_sections')), reason: _rel(f));
      expect(_code(f), isNot(contains('DecisionService')), reason: _rel(f));
      expect(_code(f), isNot(contains('HumanDecisionClient')), reason: _rel(f));
    }
  });
}
