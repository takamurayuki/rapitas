import 'dart:async';

import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/companion_digest.dart';
import '../services/companion_digest_service.dart';
import '../services/decision_service.dart';
import '../services/human_decision_client.dart';
import 'connection_provider.dart';
import 'service_providers.dart';

/// 伴走の要約の読み出し
final companionDigestServiceProvider = Provider<CompanionDigestService>((ref) {
  return CompanionDigestService(ref.watch(apiClientProvider));
});

/// 判断画面の API。判断の送信だけが X-Rapitas-Source: ui 付きの別の窓口を通る
final decisionServiceProvider = Provider<DecisionService>((ref) {
  return DecisionService(
    ref.watch(apiClientProvider),
    HumanDecisionClient.forConfig(ref.watch(apiConfigProvider)),
  );
});

/// 伴走の要約の状態。読み込み前・失敗は [digest] が null
class CompanionDigestState {
  final CompanionDigest? digest;
  final bool loading;
  final bool failed;

  const CompanionDigestState({this.digest, this.loading = false, this.failed = false});
}

/// 伴走の要約（ラピ伴走化 第2段階-1）。アプリを開いたとき・ラピタブを開いたときに読み直す（設計 Q5：プッシュはしない）。
///
/// 「前回」の位置はサーバーの TaskCompanion.lastDigestTransitionId。読むだけでは進まず、
/// ラピの画面が要約を見せたときに [markShown] で進める（ホームの小さな案内は既読にしない）
class CompanionDigestNotifier extends StateNotifier<CompanionDigestState> {
  final Ref _ref;
  Future<void>? _inFlight;

  /// 接続設定の読み込み前に頼まれた読み直し。読み込めたら1回だけ走らせる
  Completer<void>? _waiting;

  CompanionDigestNotifier(this._ref) : super(const CompanionDigestState()) {
    _ref.listen<bool>(connectionSettingsProvider.select((s) => s.loaded), (prev, loaded) {
      final waiting = _waiting;
      if (!loaded || waiting == null) return;
      _waiting = null;
      waiting.complete(load());
    });
  }

  /// 読み直す。接続設定の読み込み前は既定の localhost へ繋ぎに行かず、読めてから読む（SSE と同じ扱い）
  Future<void> load() {
    if (!_ref.read(connectionSettingsProvider).loaded) {
      return (_waiting ??= Completer<void>()).future;
    }
    return _inFlight ??= _fetch().whenComplete(() => _inFlight = null);
  }

  Future<void> _fetch() async {
    // NOTE: 最初の state 変更を1拍遅らせる。load() は app.dart の build 中（companionDigestLifecycleProvider
    // の生成時）や画面の initState からも呼ばれ、その場で state を変えると Riverpod が例外にする
    await Future<void>.value();
    if (!mounted) return;
    state = CompanionDigestState(digest: state.digest, loading: true);
    try {
      final digest = await _ref.read(companionDigestServiceProvider).getDigest();
      if (!mounted) return;
      state = CompanionDigestState(digest: digest);
    } catch (_) {
      if (!mounted) return;
      // 要約が読めなくても会話は使える。前回の表示は残し、失敗だけを知らせる
      state = CompanionDigestState(digest: state.digest, failed: true);
    }
  }

  /// ラピの画面で要約を見せた。見せた位置までをサーバーへ返す（失敗しても次回もう一度出るだけ）
  Future<void> markShown() async {
    final digest = state.digest;
    if (digest == null || digest.isEmpty) return;
    try {
      await _ref.read(companionDigestServiceProvider).markSeen(digest.items);
    } catch (_) {
      // 既読位置は表示用の値。送れなければ同じ動きがもう一度出るだけで、状態は壊れない
    }
  }
}

final companionDigestProvider =
    StateNotifierProvider<CompanionDigestNotifier, CompanionDigestState>((ref) {
  return CompanionDigestNotifier(ref);
});

/// アプリを開いたとき（起動したとき・裏から戻ったとき）に要約を読み直す。app.dart が保持する
final companionDigestLifecycleProvider = Provider<void>((ref) {
  void reload() => ref.read(companionDigestProvider.notifier).load();
  reload();
  final listener = AppLifecycleListener(onResume: reload);
  ref.onDispose(listener.dispose);
});
