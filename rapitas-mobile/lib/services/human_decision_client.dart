import 'package:dio/dio.dart';
import '../config/api_config.dart';
import 'api_client.dart';

/// 判断画面からバックエンドの人間専用ルートへ直接送る窓口（ラピ伴走化 第2段階-4、設計 2章・8章）。
///
/// 計画承認・質問への回答・レビュー保留の accept/override・halt 解除・revise-plan は、
/// バックエンドが `X-Rapitas-Source: ui|operator` の無い呼び出しを拒否する。このヘッダは
/// 「人が画面のボタンを押した」という印なので、ここ（判断画面の送信）でだけ付ける。
///
/// NOTE: ApiClient とは別の Dio にしている。ApiClient の既定ヘッダに入れると、ラピ経由の送信
/// （/assistant/* や /copilot/chat）にも付いてしまい、バックエンドが人の判断と見分けられなくなる。
/// ラピの画面・サービスからこのクラスを使わないこと
class HumanDecisionClient {
  /// 人の操作であることを示すヘッダ（バックエンドは小文字で読む）
  static const sourceHeader = 'X-Rapitas-Source';
  static const sourceValue = 'ui';

  final Dio _dio;

  HumanDecisionClient(this._dio);

  /// 接続設定から作る（ApiClient と同じ既定ヘッダ・タイムアウト・認証）
  factory HumanDecisionClient.forConfig(ApiConfig config) =>
      HumanDecisionClient(ApiClient.createDio(config));

  /// 人間専用ルートへ POST する。ヘッダはこの要求にだけ付ける
  Future<Response<T>> post<T>(String path, {Object? data}) => _dio.post<T>(
        path,
        data: data,
        options: Options(headers: {sourceHeader: sourceValue}),
      );
}
