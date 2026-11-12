// ラピの会話スペースの画面向けの状態（いま開いているスペース・読み込みの状況。設計 nav39 6章・8章）。

/// 「新しい会話」（まだサーバーに無いスペース）の表示名
const String rapiNewSpaceTitle = '新しい会話';

const Object _keep = Object();

class RapiSpacesState {
  /// 起動時の解決を終えたか（それまでは保存も読み込みもしない）
  final bool started;

  /// いま開いているスペース（サーバーにある）。null なら [localKey] の「新しい会話」
  final int? spaceId;

  /// いま開いている「新しい会話」の端末側の鍵（`local:<uuid>`）
  final String? localKey;

  /// タイトル（無ければ「新しい会話」と出す）
  final String? title;

  /// 記録を読み込み中（送信ボタンは押せない。設計 6.3）
  final bool loading;

  /// 読み込みに失敗した
  final bool loadFailed;

  /// 読み込みに失敗したが、作成だけが通ったスペースなので保存待ちから並べて続ける（設計 6.3 の例外）。
  /// このときは「新しい会話を始める」を出さず、送信もできる
  final bool loadFailedKeepGoing;

  /// 前の記録がまだある（「前の会話を読み込む」を出す）
  final bool hasMore;
  final int? nextBefore;
  final bool loadingMore;

  const RapiSpacesState({
    this.started = false,
    this.spaceId,
    this.localKey,
    this.title,
    this.loading = false,
    this.loadFailed = false,
    this.loadFailedKeepGoing = false,
    this.hasMore = false,
    this.nextBefore,
    this.loadingMore = false,
  });

  /// 画面に出すタイトル
  String get displayTitle {
    final t = title?.trim();
    return t == null || t.isEmpty ? rapiNewSpaceTitle : t;
  }

  /// いま「新しい会話」（サーバーに無い）を開いているか
  bool get isNew => spaceId == null;

  /// 送信を止めるか（読み込み中、または例外でない読み込みの失敗）
  bool get blocksSend => loading || (loadFailed && !loadFailedKeepGoing);

  RapiSpacesState copyWith({
    bool? started,
    Object? spaceId = _keep,
    Object? localKey = _keep,
    Object? title = _keep,
    bool? loading,
    bool? loadFailed,
    bool? loadFailedKeepGoing,
    bool? hasMore,
    Object? nextBefore = _keep,
    bool? loadingMore,
  }) =>
      RapiSpacesState(
        started: started ?? this.started,
        spaceId: identical(spaceId, _keep) ? this.spaceId : spaceId as int?,
        localKey: identical(localKey, _keep) ? this.localKey : localKey as String?,
        title: identical(title, _keep) ? this.title : title as String?,
        loading: loading ?? this.loading,
        loadFailed: loadFailed ?? this.loadFailed,
        loadFailedKeepGoing: loadFailedKeepGoing ?? this.loadFailedKeepGoing,
        hasMore: hasMore ?? this.hasMore,
        nextBefore: identical(nextBefore, _keep) ? this.nextBefore : nextBefore as int?,
        loadingMore: loadingMore ?? this.loadingMore,
      );
}

/// 切り替えを頼んだ結果（画面が SnackBar などを出し分ける）
enum RapiSwitchOutcome {
  /// 切り替えた
  switched,

  /// 応答待ち・処理中なので切り替えなかった（「ラピの応答を待っています」）
  busy,

  /// 何もしなかった（新しい会話で「＋ 新しい会話」を押した等）
  unchanged,

  /// 切り替えた。前の会話はまだ作成できておらず、接続が戻ると保存される（1回だけ案内する）
  switchedLeavingUnsaved,
}
