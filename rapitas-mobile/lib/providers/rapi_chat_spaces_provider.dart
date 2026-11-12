import 'dart:async';
import 'dart:math';

import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/rapi_chat/rapi_snapshot_decode.dart';
import '../models/rapi_chat/rapi_snapshot_encode.dart';
import '../models/rapi_chat/saved_message.dart';
import '../services/rapi_chat_save_queue.dart';
import '../services/rapi_chat_save_store.dart';
import '../services/rapi_chat_space_loader.dart';
import '../services/rapi_chat_space_service.dart';
import 'connection_provider.dart';
import 'rapi_chat_provider.dart';
import 'rapi_chat_spaces_state.dart';
import 'service_providers.dart';

export 'rapi_chat_spaces_state.dart';

// ラピの会話スペース（設計 nav39 4.3〜6.5）。
//
// - 会話（rapiChatProvider）の変化を見張り、保存する行を保存待ちの列に積む（archived は積まない）
// - 起動時に最後に開いたスペースを開く（未作成の会話は保存待ちから引き当てる。6.5 の 7）
// - スペースを開く・新しい会話・削除・前の会話の読み込み
// 既存の /assistant/* と /copilot/chat には何も足さない（turns は今までどおり画面の発言から作る）。

/// 会話スペースの API（テストでは偽物に差し替える）
final rapiChatSpaceServiceProvider =
    Provider<RapiChatSpaceService>((ref) => RapiChatSpaceService(ref.watch(apiClientProvider)));

/// 端末の保存先（接続先ごとのキー。テストでは偽物に差し替えられる）
final rapiSaveStoreFactoryProvider = Provider<RapiSaveStore Function(String key)>(
  (ref) => (key) => PrefsRapiStore(key),
);

/// 保存待ちの列の時計（テストでは手で進める）
final rapiSaveSchedulerProvider = Provider<RapiScheduler?>((ref) => null);

final rapiChatSpacesProvider =
    NotifierProvider<RapiChatSpacesNotifier, RapiSpacesState>(RapiChatSpacesNotifier.new);

/// 端末で振る鍵（`local:<uuid>` と clientKey）
String rapiNewLocalKey() {
  final r = Random.secure();
  String hex(int n) => List.generate(n, (_) => r.nextInt(16).toRadixString(16)).join();
  return 'local:${hex(8)}-${hex(4)}-4${hex(3)}-${hex(4)}-${hex(12)}';
}

class RapiChatSpacesNotifier extends Notifier<RapiSpacesState> implements RapiSaveListener {
  RapiChatSaveQueue? _queue;

  /// 接続先を替えたときに閉じた列（接続先ごと）。戻したらその列を開き直して使う（FIX2-1）
  final Map<String, RapiChatSaveQueue> _closedQueues = {};
  RapiSaveStore? _last;
  String? _connection;

  /// 読み込みの世代。開く・新規・削除・接続先の変更で進め、古い読み込みの結果を捨てる
  int _session = 0;

  /// 接続先の世代。待っている間に接続先が替わった処理の続きを捨てる（設計 6.5「接続先ごとの分離」）
  int _epoch = 0;

  /// 応答待ち・処理中に接続先が替わった。終わったら始め直す
  bool _restartPending = false;

  /// 会話を入れ替えている間は、消えた行を削除として積まない（設計 4.3）
  bool _suspend = false;
  final Map<String, DateTime> _addedAt = {};

  /// 作成が通った未作成スペース（起動時の解決で、保存待ちが空になったあとも引けるように）
  final Map<String, int> _createdFromLocal = {};

  RapiChatSaveQueue? get queue => _queue;

  /// 応答待ち・処理中で、いまは切り替えられない
  bool get busy => _chat.busyForSwitch;

  RapiChatNotifier get _chat => ref.read(rapiChatProvider.notifier);

  @override
  RapiSpacesState build() {
    ref.listen(rapiChatProvider, _track);
    return const RapiSpacesState();
  }

  String _connectionKey() {
    final s = ref.read(connectionSettingsProvider);
    return s.desktopId ?? s.baseUrl;
  }

  RapiSaveTarget? get _target => state.spaceId != null
      ? RapiSaveTarget.space(state.spaceId!)
      : state.localKey != null
          ? RapiSaveTarget.local(state.localKey!)
          : null;

  // ---- 保存の対象を拾う（設計 4.3）----

  void _enqueueChanges(RapiChatState? prev, RapiChatState next) {
    final queue = _queue;
    final target = _target;
    if (_suspend || !state.started || queue == null || target == null) return;
    final before = <String, RapiMessage>{
      for (final m in prev?.messages ?? const <RapiMessage>[])
        if (!m.archived && rapiShouldSave(m)) _chat.clientIdOf(m): m,
    };
    final seen = <String>{};
    for (final m in next.messages) {
      if (m.archived) continue;
      final id = _chat.clientIdOf(m);
      if (!rapiShouldSave(m)) continue;
      seen.add(id);
      if (identical(before[id], m)) continue;
      final row = encodeRapiMessage(m, clientId: id, createdAt: _addedAt[id] ??= DateTime.now());
      if (row != null) queue.enqueue(target, row, immediate: rapiCardBusy(m));
    }
    // 画面から消えた行（カードの「やめる」・相談への付け替え）は削除として送る（設計 6.1）
    for (final id in before.keys) {
      if (!seen.contains(id)) queue.enqueue(target, SavedMessage.deletion(id));
    }
  }

  void _track(RapiChatState? prev, RapiChatState next) {
    _enqueueChanges(prev, next);
    // 保留していた接続先の切り替えを、応答・処理が終わったところで行う（最後の行を積んでから）
    if (_restartPending && !_chat.busyForSwitch) {
      scheduleMicrotask(() => unawaited(restartIfConnectionChanged()));
    }
  }

  void _replacing(void Function() body) {
    _suspend = true;
    try {
      body();
    } finally {
      _suspend = false;
    }
  }

  // ---- 起動（設計 6.4・6.5 の 7）----

  /// 接続設定を読んだあとで1回呼ぶ。最後に開いたスペースを開く
  Future<void> start() async {
    if (state.started) return;
    final connection = _connectionKey();
    _connection = connection;
    final storeOf = ref.read(rapiSaveStoreFactoryProvider);
    _last = storeOf('$rapiLastSpaceKey:$connection');
    // 同じ接続先の閉じた列が残っていれば、それを開き直す。新しい列が同じキーを読み直すと、
    // 閉じた列の遅れた書き出しが、戻ったあとで積んだ保存待ちを上書きし得るため（設計 6.5 の 9）
    final service = ref.read(rapiChatSpaceServiceProvider);
    final reused = _closedQueues.remove(connection)?..reopen(this, service);
    final queue = reused ??
        RapiChatSaveQueue(
          service: service,
          store: storeOf('$rapiPendingSavesKey:$connection'),
          newKey: rapiNewLocalKey,
          schedule: ref.read(rapiSaveSchedulerProvider),
          listener: this,
        );
    _queue = queue;
    if (reused == null) await queue.restore();
    // space_limit で止めていた作成は、どの開き方でも起動のたびに再送する（設計 6.5 の 4）
    unawaited(queue.retryBlocked());
    final last = await _last!.read();
    state = state.copyWith(started: true);

    if (last != null && last.startsWith('space:')) {
      final id = int.tryParse(last.substring(6));
      if (id != null) return _open(id, null, since: 0, startup: true);
    }
    if (last != null && last.startsWith('local:')) {
      if (queue.bucketForLocal(last) != null) {
        await queue.flush();
        if (queue.bucketForLocal(last) != null) {
          // (a) 作成が通らなかった：保存待ちから並べ、同じ未作成の会話として続ける
          state = state.copyWith(spaceId: null, localKey: last, title: null);
          _showRows(queue.bucketForLocal(last)!.items, since: 0);
          return;
        }
      }
      final created = _createdFromLocal[last] ?? queue.spaceIdForOrigin(last);
      if (created != null) {
        await _last!.write('space:$created');
        return _open(created, null, since: 0, startup: true);
      }
    }
    _openNew(since: 0);
  }

  void _showRows(List<SavedMessage> rows, {required int since}) {
    _replacing(() => _chat.applySpace(
        [for (final r in overlayPending(const [], rows)) decodeSavedMessage(r, id: 0)],
        since: since));
  }

  void _openNew({required int since}) {
    // 読み込み中・「前の会話を読み込む」の途中で移っても、遅れた結果を新しい会話に並べない
    _session++;
    final key = rapiNewLocalKey();
    state = state.copyWith(
        spaceId: null, localKey: key, title: null, loading: false, loadFailed: false,
        loadFailedKeepGoing: false, hasMore: false, nextBefore: null, loadingMore: false);
    unawaited(_last?.write(key));
    if (since > 0) _replacing(() => _chat.applySpace(const [], since: since));
  }

  /// 開く・新規の前の共通の手順（設計 6.2）。切り替えたら目印を返す
  int? _beginSwitch() {
    if (_chat.busyForSwitch) return null;
    unawaited(_queue?.flush());
    late int since;
    _replacing(() => since = _chat.beginSpace());
    return since;
  }

  bool get _leavingUnsaved {
    final key = state.localKey;
    return state.spaceId == null && key != null && _queue?.bucketForLocal(key) != null;
  }

  // ---- 切り替え（設計 6.2・8.2）----

  /// シートの行からスペースを開く
  Future<RapiSwitchOutcome> openSpace(RapiSpaceSummary space) async {
    if (space.id == state.spaceId && !state.loadFailed) return RapiSwitchOutcome.unchanged;
    final unsaved = _leavingUnsaved;
    final since = _beginSwitch();
    if (since == null) return RapiSwitchOutcome.busy;
    final epoch = _epoch;
    await _last?.write('space:${space.id}');
    if (epoch != _epoch) return RapiSwitchOutcome.unchanged;
    unawaited(_open(space.id, space.title, since: since));
    return unsaved ? RapiSwitchOutcome.switchedLeavingUnsaved : RapiSwitchOutcome.switched;
  }

  /// 「＋ 新しい会話」
  RapiSwitchOutcome newConversation() {
    // 何も話していない新しい会話からは、空のスペースを増やさない（設計 6.4）
    if (state.isNew && !_leavingUnsaved) return RapiSwitchOutcome.unchanged;
    final unsaved = _leavingUnsaved;
    final since = _beginSwitch();
    if (since == null) return RapiSwitchOutcome.busy;
    _openNew(since: since);
    return unsaved ? RapiSwitchOutcome.switchedLeavingUnsaved : RapiSwitchOutcome.switched;
  }

  /// スペースを消す。いま開いているスペースなら新しい会話へ移る（設計 6.4・8.4）
  Future<RapiSwitchOutcome> deleteSpace(int id) async {
    final current = id == state.spaceId;
    if (current && _chat.busyForSwitch) return RapiSwitchOutcome.busy;
    final epoch = _epoch;
    await ref.read(rapiChatSpaceServiceProvider).deleteSpace(id);
    // 待っている間に接続先が替わったら、同じ番号の別のスペースに触らない
    if (epoch != _epoch) return RapiSwitchOutcome.unchanged;
    await _queue?.discardSpace(id);
    if (current) {
      late int since;
      _replacing(() => since = _chat.beginSpace());
      _openNew(since: since);
    }
    unawaited(_queue?.retryBlocked());
    return current ? RapiSwitchOutcome.switched : RapiSwitchOutcome.unchanged;
  }

  /// シートの一覧（開くたびに読み直す。止めていた作成もここで再送する）
  Future<List<RapiSpaceSummary>> listSpaces() async {
    unawaited(_queue?.retryBlocked());
    return ref.read(rapiChatSpaceServiceProvider).listSpaces();
  }

  /// 読み込みの失敗から「もう一度」
  Future<void> retry() async {
    final id = state.spaceId;
    if (id == null || _chat.busyForSwitch) return;
    late int since;
    _replacing(() => since = _chat.beginSpace());
    await _open(id, state.title, since: since);
  }

  /// 「前の会話を読み込む」
  Future<void> loadMore() async {
    final id = state.spaceId;
    final before = state.nextBefore;
    if (id == null || before == null || !state.hasMore || state.loadingMore) return;
    final session = _session;
    state = state.copyWith(loadingMore: true);
    try {
      final page = await ref
          .read(rapiChatSpaceServiceProvider)
          .loadMessages(id, before: before, limit: rapiMorePageLimit);
      if (session != _session) return;
      final shown = {for (final m in ref.read(rapiChatProvider).messages) m.clientId};
      _replacing(() => _chat.prependArchived([
            for (final r in page.messages)
              if (!shown.contains(r.clientId)) decodeSavedMessage(r, id: 0),
          ]));
      state = state.copyWith(hasMore: page.hasMore, nextBefore: page.nextBefore, loadingMore: false);
    } on Object {
      if (session == _session) state = state.copyWith(loadingMore: false);
    }
  }

  Future<void> _open(int id, String? title, {required int since, bool startup = false}) async {
    final session = ++_session;
    state = state.copyWith(
        spaceId: id, localKey: null, title: title, loading: true, loadFailed: false,
        loadFailedKeepGoing: false, hasMore: false, nextBefore: null, loadingMore: false);
    final queue = _queue;
    // 読み込みと並べて送るので、GET が送る前の状態を読み、その応答より先に PUT が通って列から
    // 消えることがある。読み始めの保存待ちも控えておき、結果に重ねる（受け入れ1・6c）
    final pendingAtStart = queue?.bucketForSpace(id)?.items ?? const <SavedMessage>[];
    unawaited(queue?.flush());
    // 名前を知らずに開いた（起動時）ときは、一覧から名前を引く（読み込みと並べて走らせる）
    if (title == null) unawaited(_refreshTitle(id, session));
    try {
      final loaded = await loadSpaceRows(ref.read(rapiChatSpaceServiceProvider), id,
          countsAsTurn: (r) => rapiCountsAsTurn(decodeSavedMessage(r, id: 0)),
          turnTarget: rapiHistoryLimit);
      if (session != _session) return;
      final rows = overlayPending(overlayPending(loaded.rows, pendingAtStart),
          queue?.bucketForSpace(id)?.items ?? const []);
      _replacing(() => _chat.applySpace(
          [for (final r in rows) decodeSavedMessage(r, id: 0)], since: since));
      state = state.copyWith(
          loading: false, hasMore: loaded.hasMore, nextBefore: loaded.nextBefore);
    } on RapiSpaceNotFound {
      if (session != _session) return;
      _openNew(since: since);
      _chat.localNotice(startup ? '前回の会話は削除されていました' : 'この会話は削除されていました');
    } on Object {
      if (session != _session) return;
      final bucket = queue?.bucketForSpace(id);
      final keepGoing = bucket?.originLocalKey != null;
      // 作成だけが通ったスペースは、保存待ちだけを並べて続けられるようにする（設計 6.3 の例外）
      if (keepGoing) _showRows(bucket!.items, since: since);
      state = state.copyWith(loading: false, loadFailed: true, loadFailedKeepGoing: keepGoing);
    }
  }

  Future<void> _refreshTitle(int id, int session) async {
    try {
      final spaces = await ref.read(rapiChatSpaceServiceProvider).listSpaces();
      if (session != _session) return;
      for (final s in spaces) {
        if (s.id == id && s.title != null) state = state.copyWith(title: s.title);
      }
    } on Object {
      // タイトルが読めなくても会話は続けられる（「新しい会話」のまま出す）
    }
  }

  /// アプリが裏へ回った・前面に戻ったときに送る（設計 4.3・4.4）
  Future<void> flushNow() async => _queue?.flush();

  // ---- 保存待ちの列からの知らせ（RapiSaveListener）----

  @override
  void onSpaceCreated(String localKey, RapiSpaceSummary space) {
    _createdFromLocal[localKey] = space.id;
    // 最後に開いたスペースは、それがこの未作成の会話のときだけ書き換える（設計 6.5 の 3-2）
    final last = _last;
    if (last != null) {
      unawaited(last.read().then((v) async {
        if (v == localKey) await last.write('space:${space.id}');
      }));
    }
    if (state.localKey == localKey) {
      state = state.copyWith(spaceId: space.id, localKey: null, title: space.title ?? state.title);
    }
  }

  @override
  void onSaved(int spaceId, String? title) {
    if (state.spaceId == spaceId && title != null && title != state.title) {
      state = state.copyWith(title: title);
    }
  }

  @override
  void onSpaceGone(int spaceId) {
    if (state.spaceId != spaceId || _chat.busyForSwitch) return;
    late int since;
    _replacing(() => since = _chat.beginSpace());
    _openNew(since: since);
    _chat.localNotice('この会話は削除されていました');
  }

  @override
  void onNotice(RapiSaveNotice notice, RapiSaveTarget target) {
    // いま開いている会話の案内だけを出す（ほかの会話の案内をここに混ぜない）。遅れの案内は全体のもの
    if (notice != RapiSaveNotice.slow && target != _target) return;
    _chat.localNotice(switch (notice) {
      RapiSaveNotice.partial => 'この会話の一部を保存できませんでした',
      RapiSaveNotice.full => 'この会話はいっぱいです。新しい会話を始めてください',
      RapiSaveNotice.spaceLimit => '会話の数が上限です。古い会話を削除すると、この会話を保存します',
      RapiSaveNotice.createRefused => 'この会話を保存できませんでした',
      RapiSaveNotice.slow => '会話の保存が遅れています。接続が戻ると保存します',
    });
  }

  /// 接続先（テスト用の確認）
  String? get connection => _connection;

  /// 接続先が替わったら、その接続先の保存待ちと最後のスペースで始め直す（設計 4.4・6.5 の 9）。
  /// 前の接続先の保存待ちは、その接続先のキーに残る（戻したらそこで送られる）
  ///
  /// 応答待ち・処理中なら保留し、終わったところで始め直す。前の接続先の列は閉じ、その遅れた応答が
  /// 同じ番号を持つ新しい接続先のスペースに作用しないようにする
  Future<void> restartIfConnectionChanged() async {
    if (!state.started || _connectionKey() == _connection) {
      _restartPending = false;
      return;
    }
    if (_chat.busyForSwitch) {
      _restartPending = true;
      return;
    }
    _restartPending = false;
    _session++;
    _epoch++;
    final old = _queue;
    _queue = null;
    _createdFromLocal.clear();
    // 送っている途中の要求を待たずに新しい接続先で始める（閉じた列は書き出しだけを終える）。
    // 閉じた列は接続先ごとに残し、戻したときに開き直す
    if (old != null && _connection != null) _closedQueues[_connection!] = old;
    unawaited(old?.close());
    _replacing(() => _chat.beginSpace());
    state = const RapiSpacesState();
    await start();
  }
}

/// 会話スペースの常駐処理：接続設定を読んだら起動時の解決をし、裏へ回る・前面に戻るときに送る。
/// app.dart で watch する
final rapiChatSpacesBootProvider = Provider<void>((ref) {
  final loaded = ref.watch(connectionSettingsProvider.select((s) => s.loaded));
  if (!loaded) return;
  final spaces = ref.read(rapiChatSpacesProvider.notifier);
  unawaited(spaces.start());
  ref.listen(connectionSettingsProvider.select((s) => s.desktopId ?? s.baseUrl),
      (_, __) => unawaited(spaces.restartIfConnectionChanged()));
  final listener = AppLifecycleListener(onPause: spaces.flushNow, onResume: spaces.flushNow);
  ref.onDispose(listener.dispose);
});
