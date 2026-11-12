// ラピの会話の処理のうち、問い合わせと見守り。
//
// NOTE: provider の分割（nav39 v1-0b）で rapi_chat_provider.dart から移した。挙動は変えていない。
// 同じライブラリの part なので、土台（_RapiChatBase）の private メンバーをそのまま使う。

part of '../rapi_chat_provider.dart';

mixin _RapiAskOps on _RapiChatBase {
  // ---- 問い合わせ ----

  @override
  Future<void> _runAsk(String text) async {
    final answer = await ref.read(assistantServiceProvider).ask(text);
    _add((id) => RapiMessage(id: id, role: RapiRole.assistant, answer: answer));
  }

  // ---- 見守り ----

  /// 見守りの読み込み。読み込み中に呼ばれたら進行中のものに合流する。
  /// [propagateError] が false（カードの再読み込みボタン）なら失敗はカード内表示だけ、
  /// true（送信経由）なら失敗を呼び出し元へ投げ直す。
  @override
  Future<void> loadSurvey({bool propagateError = false}) async {
    final inFlight = _surveyInFlight ??=
        _fetchSurvey().whenComplete(() => _surveyInFlight = null);
    if (propagateError) {
      await inFlight;
      return;
    }
    try {
      await inFlight;
    } catch (_) {
      // カード内の「見に行けませんでした。」で伝える
    }
  }

  Future<void> _fetchSurvey() async {
    state = state.copyWith(surveyLoading: true, surveyFailed: false);
    try {
      final survey = await ref.read(assistantServiceProvider).getSupervision();
      state = state.copyWith(survey: survey);
    } catch (_) {
      state = state.copyWith(surveyFailed: true);
      rethrow;
    } finally {
      state = state.copyWith(surveyLoading: false);
    }
  }
}
