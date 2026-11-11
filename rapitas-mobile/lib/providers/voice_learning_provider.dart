/// VoiceLearningProvider
///
/// Riverpod providers for the voice correction dictionary: the on/off switch
/// (`voiceLearningEnabled`) and the stored corrections, plus the per-command
/// bookkeeping ([VoiceLearningTurn]) the command flow uses to record only on success.
/// Nothing here talks to the backend; learning data stays on the device.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../services/voice_learning_store.dart';

/// 聞き間違いの学習のオン／オフ。既定はオン（設計 §9、本人承認済み）。
/// 音声操作モードと同じく SharedPreferences に保存する
final voiceLearningEnabledProvider = StateNotifierProvider<VoiceLearningEnabledNotifier, bool>((ref) {
  return VoiceLearningEnabledNotifier();
});

class VoiceLearningEnabledNotifier extends StateNotifier<bool> {
  VoiceLearningEnabledNotifier() : super(true) {
    ready = _load();
  }

  static const String prefsKey = 'voiceLearningEnabled';

  /// Completes when the saved value has been read (or reading failed).
  late final Future<void> ready;

  /// 読み込みより先に切り替えられたら、読み込んだ値で上書きしない
  bool _changed = false;

  Future<void> _load() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final saved = prefs.getBool(prefsKey) ?? true;
      if (!_changed && mounted) state = saved;
    } catch (_) {
      // 保存先が使えなければ既定（オン）のまま
    }
  }

  /// Turns learning on or off and saves it. Turning off keeps the stored data.
  ///
  /// @param enabled - new value / 新しい値
  Future<void> setEnabled(bool enabled) async {
    _changed = true;
    if (mounted) state = enabled;
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setBool(prefsKey, enabled);
    } catch (_) {
      // 保存できなくても、この起動中は切り替えた値で動く
    }
  }
}

/// 学習した読み替えの一覧（最後に使った新しい順）。設定画面と音声コマンドの流れが使う
final voiceLearningProvider = StateNotifierProvider<VoiceLearningNotifier, List<VoiceCorrection>>((ref) {
  return VoiceLearningNotifier(VoiceLearningStore());
});

class VoiceLearningNotifier extends StateNotifier<List<VoiceCorrection>> {
  VoiceLearningNotifier(this.store) : super(const []) {
    ready = _load();
  }

  final VoiceLearningStore store;

  /// Completes when the stored data has been loaded (or loading failed).
  late final Future<void> ready;

  Future<void> _load() async {
    await store.load();
    _sync();
  }

  void _sync() {
    if (mounted) state = store.corrections;
  }

  /// See [VoiceLearningStore.lookup].
  ///
  /// @param kind - target kind / 対象の種別
  /// @param heardText - spoken fragment / 聞き取った断片
  /// @returns the correction or null / 学習した対応か null
  Future<VoiceCorrection?> lookup(VoiceTargetKind kind, String heardText) async {
    await ready;
    return store.lookup(kind, heardText);
  }

  /// See [VoiceLearningStore.record].
  Future<void> record({
    required VoiceTargetKind kind,
    required String heardText,
    required String targetId,
    required String label,
  }) async {
    await ready;
    await store.record(kind: kind, heardText: heardText, targetId: targetId, label: label);
    _sync();
  }

  /// See [VoiceLearningStore.markUsed].
  Future<void> markUsed(VoiceCorrection correction, {required String label}) async {
    await ready;
    await store.markUsed(correction, label: label);
    _sync();
  }

  /// Removes one entry (settings list, or a "no" to a corrected target).
  ///
  /// @param correction - entry to remove / 消す1件
  Future<void> remove(VoiceCorrection correction) async {
    await ready;
    await store.remove(correction.kind, correction.heard);
    _sync();
  }

  /// See [VoiceLearningStore.removeTarget].
  Future<void> removeTarget(VoiceTargetKind kind, String targetId) async {
    await ready;
    await store.removeTarget(kind, targetId);
    _sync();
  }

  /// See [VoiceLearningStore.restore].
  Future<void> restore(VoiceCorrection correction) async {
    await ready;
    await store.restore(correction);
    _sync();
  }

  /// Deletes all learning data.
  Future<void> clear() async {
    await ready;
    await store.clear();
    _sync();
  }
}

/// 1回のコマンドの間の学習の記帳（設計 §2.1・§2.2）。
/// 流れの途中では「記録の候補」と「適用した補正」を持つだけにし、成功の地点（[commit]）で確定する。
/// こうすると、確認で「いいえ」・キャンセル・失敗・途中で閉じた、のどれでも記録されない
class VoiceLearningTurn {
  VoiceLearningTurn(this._container);

  final ProviderContainer _container;
  final List<_Pending> _pending = [];
  final List<(VoiceCorrection, String)> _applied = [];

  /// A learned correction decided a target in this command.
  bool get corrected => _applied.isNotEmpty;

  VoiceLearningNotifier get _notifier => _container.read(voiceLearningProvider.notifier);

  /// Whether learning is on (waits for the saved switch value).
  Future<bool> enabled() async {
    final notifier = _container.read(voiceLearningEnabledProvider.notifier);
    await notifier.ready;
    return _container.read(voiceLearningEnabledProvider);
  }

  /// Looks up a learned correction when learning is on.
  ///
  /// @param kind - target kind / 対象の種別
  /// @param heardText - fragment that matched nothing / どれにも当たらなかった断片
  /// @returns the correction or null / 学習した対応か null
  Future<VoiceCorrection?> lookup(VoiceTargetKind kind, String heardText) async {
    if (!await enabled()) return null;
    return _notifier.lookup(kind, heardText);
  }

  /// Notes that [correction] decided the target (now labelled [label]).
  void applied(VoiceCorrection correction, String label) => _applied.add((correction, label));

  /// Keeps a correction pick as a candidate until the command succeeds.
  void candidate(VoiceTargetKind kind, String heardText, String? targetId, String label) {
    // ID の無い対象（タスクの外れた再開できる実行）は覚えない
    if (targetId == null || !VoiceLearningStore.isRecordable(heardText)) return;
    _pending.add(_Pending(kind, heardText, targetId, label));
  }

  /// The user said "no" to a target decided by a learned correction: forget it (§2.2).
  Future<void> rejected() async {
    final applied = [..._applied];
    _applied.clear();
    _pending.clear();
    for (final (c, _) in applied) {
      await _notifier.remove(c);
    }
  }

  /// The command succeeded: record candidates and count applied corrections.
  Future<void> commit() async {
    final pending = [..._pending];
    final applied = [..._applied];
    reset();
    if (pending.isEmpty && applied.isEmpty) return;
    if (!await enabled()) return;
    for (final p in pending) {
      await _notifier.record(kind: p.kind, heardText: p.heardText, targetId: p.targetId, label: p.label);
    }
    for (final (c, label) in applied) {
      await _notifier.markUsed(c, label: label);
    }
  }

  /// A voice delete succeeded: drop mappings to the deleted target (§2.2).
  Future<void> deleted(VoiceTargetKind kind, String targetId) {
    // NOTE: 近い候補で選んで削除した場合、このあとの commit で消えた ID を覚えないよう、記録の候補からも外す
    _pending.removeWhere((p) => p.kind == kind && p.targetId == targetId);
    _applied.removeWhere((a) => a.$1.kind == kind && a.$1.targetId == targetId);
    return _notifier.removeTarget(kind, targetId);
  }

  /// Forgets everything kept for the current command.
  void reset() {
    _pending.clear();
    _applied.clear();
  }
}

class _Pending {
  final VoiceTargetKind kind;
  final String heardText;
  final String targetId;
  final String label;
  _Pending(this.kind, this.heardText, this.targetId, this.label);
}
