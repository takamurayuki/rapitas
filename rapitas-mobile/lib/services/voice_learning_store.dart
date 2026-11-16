/// VoiceLearningStore
///
/// On-device storage of the voice correction dictionary (`voiceLearning.v1` in
/// SharedPreferences): load, record, apply, delete, caps and expiry.
/// It never sends anything off the device, and it does not decide *when* a
/// correction is learned (the command flow does, see learning-design §2).
library;

import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import 'voice_target_resolver.dart';

/// 学習した対応の対象の種別（設計 §4.2）
enum VoiceTargetKind { task, approval, hypothesis, idea, concern, executingTask, resumable, theme }

/// 聞き違いの補正1件：(種別, 正規化した断片) → 選んだ対象
class VoiceCorrection {
  final VoiceTargetKind kind;

  /// 検索に使う正規化した断片（一意のキーの片方）
  final String heard;

  /// 表示用の、聞き取ったままの断片
  final String heardText;
  final String targetId;

  /// 最後に確かめたときの対象の表示名
  final String label;

  /// 明示的に選ばれた回数と、適用されて成功した回数の合計
  final int count;
  final DateTime createdAt;
  final DateTime lastUsedAt;

  const VoiceCorrection({
    required this.kind,
    required this.heard,
    required this.heardText,
    required this.targetId,
    required this.label,
    required this.count,
    required this.createdAt,
    required this.lastUsedAt,
  });

  VoiceCorrection copyWith({String? label, int? count, DateTime? lastUsedAt}) => VoiceCorrection(
        kind: kind,
        heard: heard,
        heardText: heardText,
        targetId: targetId,
        label: label ?? this.label,
        count: count ?? this.count,
        createdAt: createdAt,
        lastUsedAt: lastUsedAt ?? this.lastUsedAt,
      );

  Map<String, dynamic> toJson() => {
        'kind': kind.name,
        'heard': heard,
        'heardText': heardText,
        'targetId': targetId,
        'label': label,
        'count': count,
        'createdAt': createdAt.toIso8601String(),
        'lastUsedAt': lastUsedAt.toIso8601String(),
      };

  /// Parses one stored entry; returns null when any field is missing or invalid.
  ///
  /// @param json - one element of `corrections` / 保存された1件
  /// @returns the entry or null / 読めた1件か null
  static VoiceCorrection? fromJson(Object? json) {
    if (json is! Map) return null;
    final kind = VoiceTargetKind.values.where((k) => k.name == json['kind']).firstOrNull;
    final heard = json['heard'];
    final heardText = json['heardText'];
    final targetId = json['targetId'];
    final label = json['label'];
    final count = json['count'];
    final createdAt = DateTime.tryParse('${json['createdAt']}');
    final lastUsedAt = DateTime.tryParse('${json['lastUsedAt']}');
    if (kind == null ||
        heard is! String ||
        heardText is! String ||
        targetId is! String ||
        label is! String ||
        count is! int ||
        createdAt == null ||
        lastUsedAt == null) {
      return null;
    }
    return VoiceCorrection(
      kind: kind,
      heard: heard,
      heardText: heardText,
      targetId: targetId,
      label: label,
      count: count,
      createdAt: createdAt,
      lastUsedAt: lastUsedAt,
    );
  }
}

/// 端末内の学習データ（補正辞書と、第2弾・第3弾の頻度の入れ物）
class VoiceLearningStore {
  VoiceLearningStore({DateTime Function()? now}) : _now = now ?? DateTime.now;

  static const String prefsKey = 'voiceLearning.v1';
  static const int version = 1;

  /// 補正の上限（超えたら最後に使われたのが古いものから消す）
  static const int maxCorrections = 200;

  /// これより長く使われなかった補正は読み込みで消す
  static const Duration expiry = Duration(days: 180);

  /// 正規化後の断片の長さの範囲（短いと誤爆の範囲が広く、長いと文全体の取り違えが多い：§2.3）
  static const int minHeardLength = 2;
  static const int maxHeardLength = 40;

  final DateTime Function() _now;
  final List<VoiceCorrection> _corrections = [];

  // NOTE: 第2弾（targetUsage）・第3弾（commandUsage）の入れ物。第1弾では記録しないので空のまま書く（§6・§9）。
  // 読み込んだ中身はそのまま保ち、知らない版で上書きして消さないようにする。
  List<Object?> _targetUsage = const [];
  List<Object?> _commandUsage = const [];

  /// Corrections, most recently used first.
  List<VoiceCorrection> get corrections {
    final list = [..._corrections];
    list.sort((a, b) => b.lastUsedAt.compareTo(a.lastUsedAt));
    return list;
  }

  /// Frequency data reserved for later stages (always empty in stage 1).
  List<Object?> get targetUsage => List.unmodifiable(_targetUsage);
  List<Object?> get commandUsage => List.unmodifiable(_commandUsage);

  /// Whether [heardText] is in the length range that may be learned.
  ///
  /// @param heardText - the spoken fragment / 聞き取った断片
  /// @returns true if recordable / 記録してよい長さなら true
  static bool isRecordable(String heardText) {
    final n = VoiceTargetResolver.norm(heardText).length;
    return n >= minHeardLength && n <= maxHeardLength;
  }

  /// Loads from SharedPreferences, dropping broken or expired entries.
  /// Never throws: an unreadable store is treated as empty.
  Future<void> load() async {
    _corrections.clear();
    _targetUsage = const [];
    _commandUsage = const [];
    String? raw;
    try {
      final prefs = await SharedPreferences.getInstance();
      raw = prefs.getString(prefsKey);
    } catch (_) {
      return; // 保存先が使えなければ空のまま動く
    }
    if (raw == null) return;
    try {
      final json = jsonDecode(raw);
      if (json is! Map || json['version'] != version) return; // 読めない版は空として扱う
      final list = json['corrections'];
      if (list is List) {
        for (final item in list) {
          final c = VoiceCorrection.fromJson(item);
          if (c != null) _upsert(c);
        }
      }
      if (json['targetUsage'] is List) _targetUsage = List.of(json['targetUsage'] as List);
      if (json['commandUsage'] is List) _commandUsage = List.of(json['commandUsage'] as List);
    } catch (_) {
      _corrections.clear(); // 壊れた JSON は空として扱い、次の保存で上書きする
      return;
    }
    final before = _corrections.length;
    final cutoff = _now().subtract(expiry);
    _corrections.removeWhere((c) => c.lastUsedAt.isBefore(cutoff));
    if (_corrections.length != before) await _save();
  }

  /// The learned correction for ([kind], fragment), if any.
  ///
  /// @param kind - target kind / 対象の種別
  /// @param heardText - spoken fragment (normalised here) / 聞き取った断片
  /// @returns the correction or null / 学習した対応か null
  VoiceCorrection? lookup(VoiceTargetKind kind, String heardText) {
    final heard = VoiceTargetResolver.norm(heardText);
    return _corrections.where((c) => c.kind == kind && c.heard == heard).firstOrNull;
  }

  /// Records an explicit correction pick. Same target → count+1; a different
  /// target replaces the entry and restarts the count at 1 (latest pick wins).
  ///
  /// @param kind - target kind / 対象の種別
  /// @param heardText - fragment that matched nothing / どれにも当たらなかった断片
  /// @param targetId - id of the picked target / 選んだ対象の ID
  /// @param label - display name of the picked target / 選んだ対象の表示名
  /// @returns false when the fragment is too short/long and nothing was recorded / 記録しなかったら false
  Future<bool> record({
    required VoiceTargetKind kind,
    required String heardText,
    required String targetId,
    required String label,
  }) async {
    if (!isRecordable(heardText)) return false;
    final heard = VoiceTargetResolver.norm(heardText);
    final now = _now();
    final old = lookup(kind, heardText);
    if (old != null && old.targetId == targetId) {
      _upsert(old.copyWith(label: label, count: old.count + 1, lastUsedAt: now));
    } else {
      _upsert(VoiceCorrection(
        kind: kind,
        heard: heard,
        heardText: heardText.trim(),
        targetId: targetId,
        label: label,
        count: 1,
        createdAt: now,
        lastUsedAt: now,
      ));
    }
    _enforceCap();
    await _save();
    return true;
  }

  /// Marks an applied correction as used successfully (count+1, label refreshed).
  ///
  /// @param correction - the applied entry / 適用した対応
  /// @param label - the target's current display name / 対象のいまの名前
  Future<void> markUsed(VoiceCorrection correction, {required String label}) async {
    final current = lookup(correction.kind, correction.heard);
    if (current == null || current.targetId != correction.targetId) return;
    _upsert(current.copyWith(label: label, count: current.count + 1, lastUsedAt: _now()));
    await _save();
  }

  /// Removes the entry for ([kind], [heard]).
  ///
  /// @param kind - target kind / 対象の種別
  /// @param heard - normalised fragment / 正規化した断片
  Future<void> remove(VoiceTargetKind kind, String heard) async {
    final before = _corrections.length;
    _corrections.removeWhere((c) => c.kind == kind && c.heard == heard);
    if (_corrections.length != before) await _save();
  }

  /// Removes every entry pointing at [targetId] of [kind] (the target was deleted).
  ///
  /// @param kind - target kind / 対象の種別
  /// @param targetId - deleted target id / 削除した対象の ID
  Future<void> removeTarget(VoiceTargetKind kind, String targetId) async {
    final before = _corrections.length;
    _corrections.removeWhere((c) => c.kind == kind && c.targetId == targetId);
    if (_corrections.length != before) await _save();
  }

  /// Puts back an entry removed from the settings list (undo).
  ///
  /// @param correction - the removed entry / 消した1件
  Future<void> restore(VoiceCorrection correction) async {
    _upsert(correction);
    _enforceCap();
    await _save();
  }

  /// Deletes all learning data, including the reserved frequency arrays.
  Future<void> clear() async {
    _corrections.clear();
    _targetUsage = const [];
    _commandUsage = const [];
    await _save();
  }

  void _upsert(VoiceCorrection c) {
    _corrections.removeWhere((e) => e.kind == c.kind && e.heard == c.heard);
    _corrections.add(c);
  }

  void _enforceCap() {
    if (_corrections.length <= maxCorrections) return;
    _corrections.sort((a, b) => a.lastUsedAt.compareTo(b.lastUsedAt));
    _corrections.removeRange(0, _corrections.length - maxCorrections);
  }

  Future<void> _save() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(
        prefsKey,
        jsonEncode({
          'version': version,
          'corrections': [for (final c in _corrections) c.toJson()],
          'targetUsage': _targetUsage,
          'commandUsage': _commandUsage,
        }),
      );
    } catch (_) {
      // 保存できなくても、この起動中は覚えた内容で動く
    }
  }
}
