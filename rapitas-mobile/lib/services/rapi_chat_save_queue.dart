import 'dart:async';
import 'dart:convert';

import '../models/rapi_chat/saved_message.dart';
import 'rapi_chat_save_store.dart';
import 'rapi_chat_space_service.dart';

// 会話スペースの保存待ちの列（設計 nav39 4.3・4.4・6.5）。
//
// 発言の追加・変化を積み、0.5秒ためてまとめて送る。送る前に SharedPreferences へ書き出し、
// 送れた分だけ消す（アプリが落ちても、書き出し済みの分は次の起動で送られる）。
// 宛先は2種類：サーバーにあるスペース（spaceId）と、まだ作っていない「新しい会話」（localKey）。
// 後者は POST（clientKey 付き）でスペースを作ってから PUT する。
// 断られたときは理由のある項目だけを外し、正常な項目は捨てない（4.4）。
// 接続先ごとに別の列を持つ（呼び出し側が接続先ごとに作る）。

/// 再送の間隔（設計 4.4：2秒 → 5秒 → 15秒 → 60秒、以降は60秒ごと）
const List<Duration> rapiSaveRetryDelays = [
  Duration(seconds: 2),
  Duration(seconds: 5),
  Duration(seconds: 15),
  Duration(seconds: 60),
];

/// まとめて送るまでの待ち
const Duration rapiSaveDebounce = Duration(milliseconds: 500);

/// 1回の PUT の件数と payload の合計の目安（設計 4.2・4.4）
const int rapiSaveBatchItems = 50;
const int rapiSaveBatchBytes = 1024 * 1024;

/// 保存待ちが残っていると案内を出すまでの時間（設計 4.4）
const Duration rapiSaveSlowAfter = Duration(seconds: 60);

/// 画面に1回だけ出す案内の種類
enum RapiSaveNotice {
  /// 一部の項目を保存できなかった（422・400 で外した）
  partial,

  /// この会話はいっぱい（409 message_limit で新規を外した）
  full,

  /// 会話の数が上限（POST が 409 space_limit）
  spaceLimit,

  /// この会話を保存できなかった（POST がそれ以外の 4xx）
  createRefused,

  /// 保存が遅れている（保存待ちが60秒を超えて残っている）
  slow,
}

/// 保存の宛先
class RapiSaveTarget {
  final int? spaceId;
  final String? localKey;

  const RapiSaveTarget.space(int this.spaceId) : localKey = null;
  const RapiSaveTarget.local(String this.localKey) : spaceId = null;

  @override
  bool operator ==(Object other) =>
      other is RapiSaveTarget && other.spaceId == spaceId && other.localKey == localKey;

  @override
  int get hashCode => Object.hash(spaceId, localKey);

  @override
  String toString() => spaceId != null ? 'space:$spaceId' : 'local:$localKey';
}

/// 列からの知らせ（スペースの状態を持つ provider が受ける）
abstract class RapiSaveListener {
  /// 未作成スペース [localKey] の作成が通り、[space] になった（保存待ちの宛先はもう書き換えてある）
  void onSpaceCreated(String localKey, RapiSpaceSummary space);

  /// [spaceId] への保存が通った。[title] はサーバーが決めたタイトル
  void onSaved(int spaceId, String? title);

  /// [spaceId] が別の端末で消されていた（その保存待ちは捨てた）
  void onSpaceGone(int spaceId);

  /// 案内を出す（[target] はその案内の対象）
  void onNotice(RapiSaveNotice notice, RapiSaveTarget target);
}

/// 予約した処理の取り消し
typedef RapiCancel = void Function();

/// [delay] 後に [run] を呼ぶ（テストでは手で進める）
typedef RapiScheduler = RapiCancel Function(Duration delay, void Function() run);

RapiCancel _timerScheduler(Duration delay, void Function() run) => Timer(delay, run).cancel;

class _Pending {
  SavedMessage msg;
  int version;
  _Pending(this.msg, this.version);
}

/// スペース1つ分の保存待ち
class RapiSaveBucket {
  int? spaceId;
  String? localKey;

  /// POST に付ける鍵（未作成スペースを作ったときに1回だけ振る）
  String? clientKey;

  /// 作成が通る前の localKey（保存待ちが空になるまで残す。設計 6.5 の 3）
  String? originLocalKey;

  /// 409 space_limit で、間隔での再送を止めている
  bool limitBlocked;
  final List<_Pending> _items;

  RapiSaveBucket._(
      {this.spaceId, this.localKey, this.clientKey, this.originLocalKey, this.limitBlocked = false})
      : _items = [];

  RapiSaveTarget get target =>
      spaceId != null ? RapiSaveTarget.space(spaceId!) : RapiSaveTarget.local(localKey!);

  /// 保存待ちの項目（積んだ順）
  List<SavedMessage> get items => [for (final p in _items) p.msg];

  Map<String, dynamic> toJson() => {
        if (spaceId != null) 'spaceId': spaceId,
        if (localKey != null) 'localKey': localKey,
        if (clientKey != null) 'clientKey': clientKey,
        if (originLocalKey != null) 'originLocalKey': originLocalKey,
        if (limitBlocked) 'limitBlocked': true,
        'items': [for (final p in _items) p.msg.toJson()],
      };

  static RapiSaveBucket? tryParse(Object? json) {
    if (json is! Map) return null;
    final spaceId = json['spaceId'];
    final localKey = json['localKey'];
    if (spaceId is! num && localKey is! String) return null;
    final b = RapiSaveBucket._(
      spaceId: spaceId is num ? spaceId.toInt() : null,
      localKey: spaceId is num ? null : localKey as String,
      clientKey: json['clientKey'] is String ? json['clientKey'] as String : null,
      originLocalKey: json['originLocalKey'] is String ? json['originLocalKey'] as String : null,
      limitBlocked: json['limitBlocked'] == true,
    );
    for (final i in json['items'] is List ? json['items'] as List : const []) {
      if (SavedMessage.tryParse(i) case final m?) b._items.add(_Pending(m, 0));
    }
    return b;
  }
}

/// 保存待ちの列
class RapiChatSaveQueue {
  final RapiChatSpaceService _service;
  final RapiSaveStore _store;
  final RapiScheduler _schedule;
  final DateTime Function() _now;
  final String Function() _newKey;
  RapiSaveListener? listener;

  final List<RapiSaveBucket> _buckets = [];
  int _version = 0;
  int _attempt = 0;
  RapiCancel? _debounce;
  RapiCancel? _retry;
  DateTime? _pendingSince;
  final Set<String> _shown = {};
  Future<void> _tail = Future.value();
  bool _closed = false;

  RapiChatSaveQueue({
    required RapiChatSpaceService service,
    required RapiSaveStore store,
    required String Function() newKey,
    RapiScheduler? schedule,
    DateTime Function()? now,
    this.listener,
  })  : _service = service,
        _store = store,
        _newKey = newKey,
        _schedule = schedule ?? _timerScheduler,
        _now = now ?? DateTime.now;

  /// いまの保存待ち（テストと起動時の解決に使う）
  List<RapiSaveBucket> get buckets => List.unmodifiable(_buckets);

  bool get isEmpty => _buckets.every((b) => b._items.isEmpty);

  /// 書き出してあった保存待ちを読む（起動時）
  Future<void> restore() async {
    final raw = await _store.read();
    if (raw == null) return;
    try {
      final decoded = jsonDecode(raw);
      _buckets
        ..clear()
        ..addAll([
          for (final b in decoded is List ? decoded : const [])
            if (RapiSaveBucket.tryParse(b) case final bucket?) bucket,
        ]);
    } on FormatException {
      _buckets.clear();
    }
    if (!isEmpty) _pendingSince ??= _now();
  }

  Future<void> _persist() =>
      _store.write(jsonEncode([for (final b in _buckets) if (b._items.isNotEmpty) b.toJson()]));

  RapiSaveBucket? bucketForSpace(int spaceId) {
    for (final b in _buckets) {
      if (b.spaceId == spaceId) return b;
    }
    return null;
  }

  RapiSaveBucket? bucketForLocal(String localKey) {
    for (final b in _buckets) {
      if (b.localKey == localKey) return b;
    }
    return null;
  }

  /// 作成前の [localKey] から作られたスペース（保存待ちが残っている間だけ分かる）
  int? spaceIdForOrigin(String localKey) {
    for (final b in _buckets) {
      if (b.originLocalKey == localKey && b.spaceId != null) return b.spaceId;
    }
    return null;
  }

  /// [m] を [target] へ保存する項目として積む。[immediate] ならまとめを待たずに送る
  void enqueue(RapiSaveTarget target, SavedMessage m, {bool immediate = false}) {
    if (m.clientId.isEmpty) return;
    var bucket = target.spaceId != null ? bucketForSpace(target.spaceId!) : null;
    if (target.localKey != null) {
      // 作成のあとで旧い宛先に積まれた項目は、作られたスペースへ読み替える（設計 6.5 の 3-1(a)）
      final created = spaceIdForOrigin(target.localKey!);
      bucket = created != null ? bucketForSpace(created) : bucketForLocal(target.localKey!);
    }
    if (bucket == null) {
      bucket = target.spaceId != null
          ? RapiSaveBucket._(spaceId: target.spaceId)
          : RapiSaveBucket._(localKey: target.localKey, clientKey: _newKey());
      _buckets.add(bucket);
    }
    final i = bucket._items.indexWhere((p) => p.msg.clientId == m.clientId);
    if (i >= 0) {
      bucket._items[i] = _Pending(m, ++_version);
    } else {
      bucket._items.add(_Pending(m, ++_version));
    }
    _pendingSince ??= _now();
    if (_closed) {
      // 閉じた列は送らない。書き出しだけして、この接続先へ戻したときに送る
      _tail = _tail.then((_) => _persist()).then((_) {}, onError: (_) {});
      return;
    }
    if (immediate) {
      unawaited(flush());
    } else {
      _debounce?.call();
      _debounce = _schedule(rapiSaveDebounce, () {
        _debounce = null;
        unawaited(flush());
      });
    }
  }

  /// [spaceId] の保存待ちを捨てる（そのスペースを消したとき。設計 8.4）
  Future<void> discardSpace(int spaceId) async {
    _buckets.removeWhere((b) => b.spaceId == spaceId);
    await _persist();
  }

  /// 409 space_limit で止めていた作成を、もう一度試す（スペースを消した・一覧を開いた・起動した）
  Future<void> retryBlocked() {
    for (final b in _buckets) {
      b.limitBlocked = false;
    }
    return flush();
  }

  /// 接続先を替えたときに、この列を閉じる（設計 6.5「接続先ごとの分離」）。
  /// 予約していたまとめ・再送を取り消し、知らせを止める。保存待ちはこの接続先のキーに書き出したまま
  /// 残し、戻したときの列が送る。送っている途中の1件は終わらせ、その結果も書き出す
  ///
  /// @returns 書き出しが終わったら完了する / 書き出しの完了
  Future<void> close() {
    _closed = true;
    listener = null;
    _debounce?.call();
    _debounce = null;
    _retry?.call();
    _retry = null;
    final done = _tail.then((_) => _persist());
    _tail = done.then((_) {}, onError: (_) {});
    return done;
  }

  /// いまある保存待ちを送る（1本に並べる）
  Future<void> flush() {
    if (_closed) return _tail;
    final result = _tail.then((_) => _flushOnce());
    _tail = result.then((_) {}, onError: (_) {});
    return result;
  }

  void _notice(RapiSaveNotice n, RapiSaveTarget t) {
    if (!_shown.add('${n.name}|$t')) return;
    listener?.onNotice(n, t);
  }

  Future<void> _flushOnce() async {
    _debounce?.call();
    _debounce = null;
    _retry?.call();
    _retry = null;
    await _persist();
    var transient = false;
    for (final bucket in [..._buckets]) {
      if (_closed) break;
      if (!_buckets.contains(bucket)) continue;
      if (bucket.localKey != null && !await _create(bucket)) {
        if (!bucket.limitBlocked && _buckets.contains(bucket)) transient = true;
        continue;
      }
      if (bucket.spaceId != null && !await _send(bucket)) transient = true;
    }
    _buckets.removeWhere((b) => b._items.isEmpty);
    await _persist();
    if (isEmpty) {
      _pendingSince = null;
      _shown.remove('${RapiSaveNotice.slow.name}|all');
      _attempt = 0;
      return;
    }
    if (!transient || _closed) {
      _attempt = 0;
      return;
    }
    final since = _pendingSince;
    if (since != null && _now().difference(since) >= rapiSaveSlowAfter) {
      if (_shown.add('${RapiSaveNotice.slow.name}|all')) {
        listener?.onNotice(RapiSaveNotice.slow, _buckets.first.target);
      }
    }
    final delay = rapiSaveRetryDelays[_attempt.clamp(0, rapiSaveRetryDelays.length - 1)];
    _attempt++;
    _retry = _schedule(delay, () {
      _retry = null;
      unawaited(flush());
    });
  }

  /// 未作成スペースを作る。作れたら宛先を書き換えて true（続けて PUT する）
  Future<bool> _create(RapiSaveBucket bucket) async {
    final localKey = bucket.localKey!;
    // 消す行しか無い（最初の発言が相談に移された等）なら、空のスペースは作らない（設計 6.5 の 8）
    if (bucket._items.every((p) => p.msg.deleted)) {
      _buckets.remove(bucket);
      return false;
    }
    if (bucket.limitBlocked) return false;
    final RapiCreateResult result;
    try {
      result = await _service.createSpace(clientKey: bucket.clientKey ??= _newKey());
    } on Object {
      return false;
    }
    switch (result) {
      case RapiCreated(:final space):
        bucket
          ..spaceId = space.id
          ..originLocalKey = localKey
          ..localKey = null;
        await _persist();
        listener?.onSpaceCreated(localKey, space);
        return true;
      case RapiSpaceLimit():
        bucket.limitBlocked = true;
        _notice(RapiSaveNotice.spaceLimit, bucket.target);
        return false;
      case RapiCreateRefused():
        _buckets.remove(bucket);
        _notice(RapiSaveNotice.createRefused, bucket.target);
        return false;
    }
  }

  /// 1回分（件数と大きさの上限まで）を取り出す。clientId の空の項目は送らずに外す
  List<_Pending> _batch(RapiSaveBucket bucket) {
    bucket._items.removeWhere((p) => p.msg.clientId.isEmpty);
    final out = <_Pending>[];
    var bytes = 0;
    for (final p in bucket._items) {
      final size = p.msg.payload == null ? 0 : utf8.encode(p.msg.payload!).length;
      if (out.isNotEmpty && (out.length >= rapiSaveBatchItems || bytes + size > rapiSaveBatchBytes)) {
        break;
      }
      out.add(p);
      bytes += size;
    }
    return out;
  }

  void _removeSent(RapiSaveBucket bucket, Iterable<_Pending> sent) {
    for (final p in sent) {
      // 送っている間に新しい版が積まれていたら、その版は残す
      bucket._items.removeWhere((q) => identical(q, p));
    }
  }

  void _removeIds(RapiSaveBucket bucket, Iterable<String> ids) {
    final set = ids.toSet();
    bucket._items.removeWhere((p) => set.contains(p.msg.clientId));
  }

  /// スペース宛ての保存待ちを送り切る。通信の失敗・5xx なら false（間隔を置いて送り直す）
  Future<bool> _send(RapiSaveBucket bucket) async {
    final spaceId = bucket.spaceId!;
    while (bucket._items.isNotEmpty && !_closed) {
      final batch = _batch(bucket);
      if (batch.isEmpty) break;
      final RapiPutResult result;
      try {
        result = await _service.putMessages(spaceId, [for (final p in batch) p.msg]);
      } on Object {
        return false;
      }
      switch (result) {
        case RapiPutSaved(:final title):
          _removeSent(bucket, batch);
          listener?.onSaved(spaceId, title);
        case RapiPutInvalid(:final rejected):
          if (rejected.isEmpty) return true;
          _removeIds(bucket, rejected);
          _notice(RapiSaveNotice.partial, bucket.target);
        case RapiPutLimit(:final remaining, :final rejected):
          final drop = rejected.skip(remaining).toList();
          if (drop.isEmpty) return true;
          _removeIds(bucket, drop);
          _notice(RapiSaveNotice.full, bucket.target);
        case RapiPutMalformed():
          final r = await _sendOneByOne(bucket, batch);
          if (r != null) return r;
        case RapiPutGone():
          _buckets.remove(bucket);
          listener?.onSpaceGone(spaceId);
          return true;
      }
      await _persist();
    }
    return true;
  }

  /// 400 のとき：1件ずつ送り、各項目をその1件の応答で終わらせる（設計 4.4 の 400）。
  /// 続けてよければ null、止めるなら送り直しの要否（false なら間隔を置いて送り直す）
  Future<bool?> _sendOneByOne(RapiSaveBucket bucket, List<_Pending> batch) async {
    var dropped = false;
    for (final p in batch) {
      final RapiPutResult r;
      try {
        r = await _service.putMessages(bucket.spaceId!, [p.msg]);
      } on Object {
        if (dropped) _notice(RapiSaveNotice.partial, bucket.target);
        return false;
      }
      switch (r) {
        case RapiPutSaved(:final title):
          listener?.onSaved(bucket.spaceId!, title);
        case RapiPutInvalid() || RapiPutLimit() || RapiPutMalformed():
          dropped = true;
        case RapiPutGone():
          _buckets.remove(bucket);
          listener?.onSpaceGone(bucket.spaceId!);
          return true;
      }
      _removeSent(bucket, [p]);
    }
    if (dropped) _notice(RapiSaveNotice.partial, bucket.target);
    return null;
  }
}
