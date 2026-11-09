// 音声コマンドの解釈（ローカルの決め打ち）。
//
// 発話の文と「いまの画面」から VoiceCommand を作る。同じ言葉でも画面で意味が変わる
// （例：承認画面の「承認」は承認する、他の画面の「承認」は承認画面へ移動）。
// どのパターンにも当たらなければ unknown を返す（以前のように勝手にタスク作成へ倒さない）。
// 対象の解決（N番目・名前の一致）や確認は呼び出し側（VoiceCommandFlow）が行う。

/// コマンドの文脈になる画面
enum VoiceScreen {
  home,
  tasks,
  taskDetail,
  taskForm,
  executions,
  approvals,
  rapi,
  themes,
  categories,
  ideas,
  concerns,
  hypotheses,
  dashboard,
  notifications,
  settings,
  other,
}

/// パス（go_router の uri.path）から画面を決める
VoiceScreen voiceScreenOf(String path) {
  final p = path.length > 1 && path.endsWith('/') ? path.substring(0, path.length - 1) : path;
  switch (p) {
    case '':
    case '/':
      return VoiceScreen.home;
    case '/tasks':
      return VoiceScreen.tasks;
    case '/tasks/new':
      return VoiceScreen.taskForm;
    case '/executions':
      return VoiceScreen.executions;
    case '/approvals':
      return VoiceScreen.approvals;
    case '/rapi':
      return VoiceScreen.rapi;
    case '/themes':
      return VoiceScreen.themes;
    case '/categories':
      return VoiceScreen.categories;
    case '/ideas':
      return VoiceScreen.ideas;
    case '/concerns':
      return VoiceScreen.concerns;
    case '/hypotheses':
      return VoiceScreen.hypotheses;
    case '/dashboard':
      return VoiceScreen.dashboard;
    case '/notifications':
      return VoiceScreen.notifications;
    case '/settings':
      return VoiceScreen.settings;
  }
  if (RegExp(r'^/tasks/[^/]+/edit$').hasMatch(p)) return VoiceScreen.taskForm;
  if (RegExp(r'^/tasks/[^/]+$').hasMatch(p)) return VoiceScreen.taskDetail;
  return VoiceScreen.other;
}

/// タスク詳細のパス（/tasks/:id）からタスクIDを取る。詳細でなければ null
String? voiceTaskIdOf(String path) {
  final m = RegExp(r'^/tasks/([^/]+)/?$').firstMatch(path);
  if (m == null || m.group(1) == 'new') return null;
  return m.group(1);
}

/// 下タブの画面か（go で切り替える。それ以外は push で開く）
bool isVoiceTabPath(String path) =>
    const {'/', '/tasks', '/executions', '/approvals', '/rapi'}.contains(path);

/// 画面の名前（表示用）
String voiceScreenLabel(String path) {
  switch (voiceScreenOf(path)) {
    case VoiceScreen.home:
      return 'ホーム';
    case VoiceScreen.tasks:
      return 'タスク';
    case VoiceScreen.taskDetail:
      return 'タスク詳細';
    case VoiceScreen.taskForm:
      return 'タスクの入力';
    case VoiceScreen.executions:
      return '実行';
    case VoiceScreen.approvals:
      return '承認';
    case VoiceScreen.rapi:
      return 'チャット';
    case VoiceScreen.themes:
      return 'テーマ';
    case VoiceScreen.categories:
      return 'カテゴリ';
    case VoiceScreen.ideas:
      return 'アイデア';
    case VoiceScreen.concerns:
      return '懸念';
    case VoiceScreen.hypotheses:
      return '仮説';
    case VoiceScreen.dashboard:
      return 'ダッシュボード';
    case VoiceScreen.notifications:
      return '通知';
    case VoiceScreen.settings:
      return '設定';
    case VoiceScreen.other:
      return 'この画面';
  }
}

/// 音声コマンドの種別
enum VoiceCommandType {
  // ---- 共通 ----
  navigate,
  back,
  close,
  scrollDown,
  scrollUp,
  help,
  cancel,
  // ---- 承認 ----
  approveRequest,
  rejectRequest,
  // ---- 実行 ----
  executeTask,
  stopExecution,
  resumeExecution,
  // ---- タスク ----
  createTask,
  searchTasks,
  filterTasks,
  clearFilter,
  themeTasks,
  openTask,
  editTask,
  deleteTask,
  // ---- バックログ ----
  createIdea,
  createConcern,
  setHypothesisStatus,
  deleteHypothesis,
  deleteIdea,
  deleteConcern,
  unknown,
}

/// 一覧の中の対象の指定（「2番目」「最後」「ログイン」など）
class VoiceTarget {
  /// 1 始まりの番号。-1 は最後
  final int? index;

  /// タイトル・名称の一部
  final String? name;

  const VoiceTarget.index(int this.index) : name = null;
  const VoiceTarget.name(String this.name) : index = null;

  String get label {
    if (index == -1) return '最後';
    if (index != null) return '$index番目';
    return '「$name」';
  }

  @override
  bool operator ==(Object other) =>
      other is VoiceTarget && other.index == index && other.name == name;

  @override
  int get hashCode => Object.hash(index, name);

  @override
  String toString() => 'VoiceTarget($label)';
}

/// 解析された音声コマンド
class VoiceCommand {
  final VoiceCommandType type;
  final String rawText;
  final Map<String, String> parameters;
  final VoiceTarget? target;

  const VoiceCommand({
    required this.type,
    required this.rawText,
    this.parameters = const {},
    this.target,
  });

  String? get title => parameters['title'];
  String? get priority => parameters['priority'];
  String? get reason => parameters['reason'];

  /// navigate の行き先パス
  String? get path => parameters['path'];

  /// searchTasks の語句
  String? get query => parameters['query'];

  /// filterTasks の状態（todo など）／setHypothesisStatus の状態（supported など）
  String? get status => parameters['status'];

  /// filterTasks・themeTasks のテーマ名
  String? get themeName => parameters['themeName'];

  /// unknown のときの案内（別の画面なら使える、など）
  String? get hint => parameters['hint'];

  bool get isUnknown => type == VoiceCommandType.unknown;

  /// 実行前に「はい／いいえ」の確認が要る操作か（破壊的・確定系）
  bool get needsConfirmation => const {
        VoiceCommandType.approveRequest,
        VoiceCommandType.rejectRequest,
        VoiceCommandType.executeTask,
        VoiceCommandType.stopExecution,
        VoiceCommandType.resumeExecution,
        VoiceCommandType.deleteTask,
        VoiceCommandType.deleteHypothesis,
        VoiceCommandType.deleteIdea,
        VoiceCommandType.deleteConcern,
      }.contains(type);

  String get typeLabel {
    switch (type) {
      case VoiceCommandType.navigate:
        return '画面の移動';
      case VoiceCommandType.back:
        return '戻る';
      case VoiceCommandType.close:
        return '閉じる';
      case VoiceCommandType.scrollDown:
        return '下にスクロール';
      case VoiceCommandType.scrollUp:
        return '上にスクロール';
      case VoiceCommandType.help:
        return 'ヘルプ';
      case VoiceCommandType.cancel:
        return 'キャンセル';
      case VoiceCommandType.approveRequest:
        return '承認';
      case VoiceCommandType.rejectRequest:
        return '却下';
      case VoiceCommandType.executeTask:
        return '実行開始';
      case VoiceCommandType.stopExecution:
        return '実行の停止';
      case VoiceCommandType.resumeExecution:
        return '実行の再開';
      case VoiceCommandType.createTask:
        return 'タスク作成';
      case VoiceCommandType.searchTasks:
        return 'タスク検索';
      case VoiceCommandType.filterTasks:
        return 'タスクの絞り込み';
      case VoiceCommandType.clearFilter:
        return '絞り込みの解除';
      case VoiceCommandType.themeTasks:
        return 'テーマのタスク';
      case VoiceCommandType.openTask:
        return 'タスクを開く';
      case VoiceCommandType.editTask:
        return 'タスクの編集';
      case VoiceCommandType.deleteTask:
        return 'タスクの削除';
      case VoiceCommandType.createIdea:
        return 'アイデア作成';
      case VoiceCommandType.createConcern:
        return '懸念の登録';
      case VoiceCommandType.setHypothesisStatus:
        return '仮説の状態変更';
      case VoiceCommandType.deleteHypothesis:
        return '仮説の削除';
      case VoiceCommandType.deleteIdea:
        return 'アイデアの削除';
      case VoiceCommandType.deleteConcern:
        return '懸念の削除';
      case VoiceCommandType.unknown:
        return '不明';
    }
  }

  /// シートに出す「解釈したコマンド」の1行（例：承認（2番目）、画面の移動：タスク）
  String get summary {
    String head;
    switch (type) {
      case VoiceCommandType.navigate:
        return '画面の移動：${voiceScreenLabel(path ?? '')}';
      case VoiceCommandType.searchTasks:
        return 'タスク検索：「$query」';
      case VoiceCommandType.filterTasks:
        final s = status;
        final p = priority;
        final label = s != null
            ? (VoiceCommandParser.statusLabels[s] ?? s)
            : p != null
                ? '優先度 ${VoiceCommandParser.priorityLabels[p] ?? p}'
                : 'テーマ「$themeName」';
        return 'タスクの絞り込み：$label';
      case VoiceCommandType.themeTasks:
        return 'テーマ「$themeName」のタスク';
      case VoiceCommandType.setHypothesisStatus:
        head = '仮説を「${VoiceCommandParser.hypothesisStatusLabels[status] ?? status}」にする';
      default:
        head = typeLabel;
    }
    final p = priority;
    final details = <String>[
      if (target != null) target!.label,
      if (title != null) 'タイトル「$title」',
      if (p != null) '優先度 ${VoiceCommandParser.priorityLabels[p] ?? p}',
      if (reason != null) '理由「$reason」',
    ];
    if (details.isEmpty) return head;
    return '$head（${details.join('・')}）';
  }
}

/// 空白を落とした文（パターンを当てる用）と、空白を残した元の文（自由文を取り出す用）
class _Text {
  /// 空白を1つに詰めた元の文
  final String spaced;

  /// 空白なしの文（末尾の句読点・「ください」などは落としてある）
  final String bare;

  /// bare の i 文字目が spaced の何文字目か
  final List<int> _map;

  _Text._(this.spaced, this.bare, this._map);

  factory _Text(String input) {
    var s = input.trim();
    // 全角英数字は半角へ
    s = s.replaceAllMapped(
      RegExp('[０-９Ａ-Ｚａ-ｚ]'),
      (m) => String.fromCharCode(m[0]!.codeUnitAt(0) - 0xFEE0),
    );
    s = s.replaceAll(RegExp(r'[\s　]+'), ' ');
    final buf = StringBuffer();
    final map = <int>[];
    for (var i = 0; i < s.length; i++) {
      if (s[i] == ' ') continue;
      buf.write(s[i]);
      map.add(i);
    }
    var bare = buf.toString();
    // 末尾の句読点・依頼の言い回しを落とす（「開いてください。」は2段階）
    for (var i = 0; i < 2; i++) {
      bare = bare.replaceFirst(RegExp(r'[。、．，,.!！?？]+$'), '');
      bare = bare.replaceFirst(
        RegExp(r'(?:ください|下さい|ちょうだい|お願いします|おねがいします|お願い|おねがい)$'),
        '',
      );
    }
    return _Text._(s, bare, map.sublist(0, bare.length));
  }

  /// bare の [start, end) に当たる元の文（空白を残す）
  String _slice(int start, int end) {
    if (start >= end) return '';
    return spaced.substring(_map[start], _map[end - 1] + 1).trim();
  }

  /// 文頭から始まるグループ（^(.+?)…）の元の文
  String prefix(RegExpMatch m, int index) {
    final g = m.group(index) ?? '';
    return _slice(0, g.length);
  }

  /// 文末で終わるグループ（…(.*)$）の元の文
  String suffix(RegExpMatch m, int index) {
    final g = m.group(index) ?? '';
    return _slice(bare.length - g.length, bare.length);
  }
}

/// 音声入力テキストをコマンドに解析するパーサー
class VoiceCommandParser {
  static const Map<String, String> statusLabels = {
    'todo': '未着手',
    'in-progress': '進行中',
    'done': '完了',
  };

  static const Map<String, String> priorityLabels = {
    'urgent': '緊急',
    'high': '高',
    'medium': '中',
    'low': '低',
  };

  static const Map<String, String> hypothesisStatusLabels = {
    'open': '検証待ち',
    'supported': '立証済み',
    'refuted': '反証済み',
    'inconclusive': '結論保留',
  };

  // 優先度の言葉（長いものから当てる）
  static const List<MapEntry<String, String>> _priorityWords = [
    MapEntry('緊急', 'urgent'),
    MapEntry('至急', 'urgent'),
    MapEntry('高い', 'high'),
    MapEntry('高め', 'high'),
    MapEntry('高', 'high'),
    MapEntry('普通', 'medium'),
    MapEntry('中くらい', 'medium'),
    MapEntry('中', 'medium'),
    MapEntry('低い', 'low'),
    MapEntry('低め', 'low'),
    MapEntry('低', 'low'),
  ];

  static const List<MapEntry<String, String>> _statusWords = [
    MapEntry('未着手', 'todo'),
    MapEntry('やること', 'todo'),
    MapEntry('進行中', 'in-progress'),
    MapEntry('作業中', 'in-progress'),
    MapEntry('対応中', 'in-progress'),
    MapEntry('完了', 'done'),
    MapEntry('完了済み', 'done'),
    MapEntry('終わった', 'done'),
  ];

  // 移動先の言葉 → パス（長いものから当てる）
  static const List<MapEntry<String, String>> _screenWords = [
    MapEntry('承認リクエスト', '/approvals'),
    MapEntry('承認一覧', '/approvals'),
    MapEntry('承認', '/approvals'),
    MapEntry('エージェント実行', '/executions'),
    MapEntry('実行一覧', '/executions'),
    MapEntry('実行', '/executions'),
    MapEntry('タスク一覧', '/tasks'),
    MapEntry('タスク', '/tasks'),
    MapEntry('チャット', '/rapi'),
    MapEntry('ラピ', '/rapi'),
    MapEntry('ホーム', '/'),
    MapEntry('トップ', '/'),
    MapEntry('テーマ一覧', '/themes'),
    MapEntry('テーマ', '/themes'),
    MapEntry('カテゴリー', '/categories'),
    MapEntry('カテゴリ', '/categories'),
    MapEntry('アイデア', '/ideas'),
    MapEntry('アイディア', '/ideas'),
    MapEntry('懸念', '/concerns'),
    MapEntry('課題', '/concerns'),
    MapEntry('仮説', '/hypotheses'),
    MapEntry('ダッシュボード', '/dashboard'),
    MapEntry('通知', '/notifications'),
    MapEntry('設定', '/settings'),
  ];

  static final RegExp _navigatePattern = RegExp(
    '^(${_screenWords.map((e) => e.key).join('|')})'
    r'(画面|一覧|ページ|タブ|リスト)?(を|に|へ)?'
    r'(開いて|開く|ひらいて|見せて|みせて|見る|表示して|表示|出して|移動して|移動|行って|いって|行く|切り替えて|切り替え)?$',
  );

  static const String _verbDo = r'(?:して|する|します|しよう)?';

  /// テキストを解析して VoiceCommand を返す。[screen] は話したときの画面
  VoiceCommand parse(String text, {VoiceScreen screen = VoiceScreen.other}) {
    final t = _Text(text);
    final s = t.bare;
    VoiceCommand cmd(VoiceCommandType type,
            {Map<String, String> params = const {}, VoiceTarget? target}) =>
        VoiceCommand(type: type, rawText: text, parameters: params, target: target);
    VoiceCommand onlyOn(String where) =>
        cmd(VoiceCommandType.unknown, params: {'hint': 'このコマンドは$whereで使えます'});

    if (s.isEmpty) return cmd(VoiceCommandType.unknown);

    // ---- 共通（どの画面でも同じ意味） ----
    if (isCancel(s)) return cmd(VoiceCommandType.cancel);
    if (RegExp(r'(?:ヘルプ|何ができる|なにができる|何が出来る|使い方|できること|コマンド一覧|何て言えばいい)').hasMatch(s)) {
      return cmd(VoiceCommandType.help);
    }
    if (RegExp(r'^(?:前の画面(?:に|へ)?)?(?:戻る|戻って|もどる|もどって|バック)$').hasMatch(s) || s == '前の画面') {
      return cmd(VoiceCommandType.back);
    }
    if (RegExp(r'^(?:シートを|ダイアログを|これを)?(?:閉じる|閉じて|とじる|とじて)$').hasMatch(s)) {
      return cmd(VoiceCommandType.close);
    }
    if (RegExp(r'^(?:下|した)(?:に|へ)?(?:スクロール|スクロールして|送って)$|^スクロール(?:ダウン|して)?$').hasMatch(s)) {
      return cmd(VoiceCommandType.scrollDown);
    }
    if (RegExp(r'^(?:上|うえ)(?:に|へ)?(?:スクロール|スクロールして)$|^スクロールアップ$').hasMatch(s)) {
      return cmd(VoiceCommandType.scrollUp);
    }

    // ---- 絞り込み・検索（タスク一覧へ移って適用する） ----
    if (RegExp(r'^(?:フィルター?|絞り込み)(?:を)?(?:解除|クリア|リセット|外して|外す|なし|消して|やめて)(?:して)?$')
        .hasMatch(s)) {
      return cmd(VoiceCommandType.clearFilter);
    }
    final filter = RegExp(r'^フィルター?(?:を)?[:：]?(.+?)(?:に|で)?(?:して|する|かけて)?$').firstMatch(s) ??
        RegExp(r'^(.+?)で(?:絞り込み|絞り込んで|絞り込む|絞って|フィルター?)(?:して)?$').firstMatch(s);
    if (filter != null) return _filterCommand(text, filter.group(1)!);
    final searchHead = RegExp(r'^(?:検索|サーチ)(?:して)?[:：]?(.+)$').firstMatch(s);
    final searchTail = RegExp('^(.+?)(?:を|で)?(?:検索|探して|探す|サーチ)$_verbDo\$').firstMatch(s);
    final query = searchHead != null
        ? _clean(t.suffix(searchHead, 1))
        : searchTail != null
            ? _clean(t.prefix(searchTail, 1))
            : '';
    if (query.isNotEmpty) return cmd(VoiceCommandType.searchTasks, params: {'query': query});

    // ---- 作成 ----
    final create = _parseCreate(text, t, screen);
    if (create != null) return create;

    // ---- 移動（画面の名前だけ、または＋「開いて」など） ----
    final nav = _navigatePattern.firstMatch(s);
    if (nav != null) {
      final word = nav.group(1)!;
      final onlyName = nav.group(2) == null && nav.group(3) == null && nav.group(4) == null;
      final path = _screenWords.firstWhere((e) => e.key == word).value;
      // 画面の名前だけのときは、その画面での操作として読む（同じ言葉でも画面で意味が変わる）
      if (onlyName && path == '/approvals' && screen == VoiceScreen.approvals) {
        return cmd(VoiceCommandType.approveRequest);
      }
      if (onlyName &&
          path == '/executions' &&
          (screen == VoiceScreen.executions || screen == VoiceScreen.taskDetail)) {
        return cmd(VoiceCommandType.executeTask);
      }
      return cmd(VoiceCommandType.navigate, params: {'path': path});
    }

    // ---- 「＜テーマ名＞のタスク」「2番目のタスクを開いて」 ----
    final themeTasks = RegExp(r'^(.+?)のタスク(?:一覧)?(?:を|に)?(?:見せて|みせて|開いて|表示して|表示|出して|見る|開く)?$')
        .firstMatch(s);
    if (themeTasks != null) {
      final name = themeTasks.group(1)!;
      final target = parseTarget(name);
      if (target?.index != null) {
        if (screen == VoiceScreen.tasks) return cmd(VoiceCommandType.openTask, target: target);
        return onlyOn('タスク画面');
      }
      final f = _filterCommand(text, name);
      if (f.type == VoiceCommandType.filterTasks && f.themeName == null) return f;
      return cmd(VoiceCommandType.themeTasks, params: {'themeName': _clean(t.prefix(themeTasks, 1))});
    }

    // ---- 承認画面 ----
    final reject = RegExp(r'^(.*?)(?:を)?(?:却下|拒否|リジェクト)(?:して|する|します)?'
            r'(?:[、,]?(?:理由(?:は|が|として)?)?[、,:：]?(.*))?$')
        .firstMatch(s);
    if (reject != null) {
      if (screen != VoiceScreen.approvals) return onlyOn('承認画面');
      final reason = _clean(t.suffix(reject, 2));
      return cmd(
        VoiceCommandType.rejectRequest,
        params: {if (reason.isNotEmpty) 'reason': reason},
        target: parseTarget(t.prefix(reject, 1)),
      );
    }
    final approve = RegExp('^(.*?)(?:を)?(?:承認|許可|オッケー|おっけー|OK|ok)$_verbDo\$').firstMatch(s);
    if (approve != null) {
      if (screen != VoiceScreen.approvals) return onlyOn('承認画面');
      return cmd(VoiceCommandType.approveRequest, target: parseTarget(t.prefix(approve, 1)));
    }

    // ---- 実行画面 ----
    final stop =
        RegExp('^(.*?)(?:の実行)?(?:を|の)?(?:停止|止めて|止める|とめて|ストップ|中断)$_verbDo\$').firstMatch(s);
    if (stop != null) {
      if (screen != VoiceScreen.executions && screen != VoiceScreen.taskDetail) {
        return onlyOn('実行画面・タスク詳細');
      }
      return cmd(VoiceCommandType.stopExecution,
          target: screen == VoiceScreen.taskDetail ? null : parseTarget(t.prefix(stop, 1)));
    }
    final resume = RegExp('^(.*?)(?:の実行)?(?:を)?(?:再開|リジューム)$_verbDo\$').firstMatch(s);
    if (resume != null) {
      if (screen != VoiceScreen.executions) return onlyOn('実行画面');
      return cmd(VoiceCommandType.resumeExecution, target: parseTarget(t.prefix(resume, 1)));
    }
    final execute = RegExp(r'^(.*?)(?:を|の)?(?:自動実行|エージェント実行|AI実行|エーアイ実行|実行)(?:を)?'
            r'(?:して|する|します|開始|スタート|始めて)?(?:して)?$')
        .firstMatch(s);
    if (execute != null) {
      if (screen != VoiceScreen.executions &&
          screen != VoiceScreen.taskDetail &&
          screen != VoiceScreen.tasks) {
        return onlyOn('実行画面・タスク画面・タスク詳細');
      }
      return cmd(VoiceCommandType.executeTask,
          target: screen == VoiceScreen.taskDetail ? null : parseTarget(t.prefix(execute, 1)));
    }

    // ---- 仮説 ----
    final hypothesis = RegExp(r'^(.*?)(?:を)?(立証|反証|結論保留|保留|検証待ち)(?:済み)?(?:に)?'
            r'(?:する|して|します|戻す|戻して|変更|変更して|変えて)?$')
        .firstMatch(s);
    if (hypothesis != null) {
      if (screen != VoiceScreen.hypotheses) return onlyOn('仮説画面');
      const statusOf = {
        '立証': 'supported',
        '反証': 'refuted',
        '結論保留': 'inconclusive',
        '保留': 'inconclusive',
        '検証待ち': 'open',
      };
      return cmd(
        VoiceCommandType.setHypothesisStatus,
        params: {'status': statusOf[hypothesis.group(2)]!},
        target: parseTarget(t.prefix(hypothesis, 1)),
      );
    }

    // ---- 削除・編集・開く ----
    final delete = RegExp('^(.*?)(?:を)?(?:削除|消して|消す|消去)$_verbDo\$').firstMatch(s);
    if (delete != null) {
      final target = parseTarget(t.prefix(delete, 1));
      switch (screen) {
        case VoiceScreen.taskDetail:
          return cmd(VoiceCommandType.deleteTask);
        case VoiceScreen.hypotheses:
          return cmd(VoiceCommandType.deleteHypothesis, target: target);
        case VoiceScreen.ideas:
          return cmd(VoiceCommandType.deleteIdea, target: target);
        case VoiceScreen.concerns:
          return cmd(VoiceCommandType.deleteConcern, target: target);
        default:
          return onlyOn('タスク詳細・アイデア・懸念・仮説の画面');
      }
    }
    final edit = RegExp(r'^(.*?)(?:を)?(?:編集|へんしゅう)(?:して|する|します|画面を?開いて)?$').firstMatch(s);
    if (edit != null) {
      if (screen == VoiceScreen.taskDetail) return cmd(VoiceCommandType.editTask);
      final target = parseTarget(t.prefix(edit, 1));
      if (screen == VoiceScreen.tasks && target != null) {
        return cmd(VoiceCommandType.editTask, target: target);
      }
      return onlyOn('タスク画面・タスク詳細');
    }
    final open = RegExp(r'^(.+?)(?:を|の)?(?:開いて|開く|ひらいて|見せて|みせて|見る|表示して|詳細(?:を)?(?:見せて|開いて|表示して)?)$')
        .firstMatch(s);
    if (open != null) {
      final target = parseTarget(t.prefix(open, 1));
      if (target != null) {
        if (screen == VoiceScreen.tasks) return cmd(VoiceCommandType.openTask, target: target);
        return onlyOn('タスク画面');
      }
    }

    return cmd(VoiceCommandType.unknown);
  }

  /// 作成系（タスク・アイデア・懸念）。当たらなければ null
  VoiceCommand? _parseCreate(String raw, _Text t, VoiceScreen screen) {
    final s = t.bare;
    const verbs = r'(?:作成|追加|登録|作る|作って|つくって|新規作成)';
    VoiceCommand make(VoiceCommandType type, String body) {
      final content = _clean(body);
      final params = <String, String>{};
      if (type == VoiceCommandType.createTask && content.isNotEmpty) {
        params.addAll(_parseTaskContent(content));
      } else if (content.isNotEmpty) {
        params['title'] = content;
      }
      return VoiceCommand(type: type, rawText: raw, parameters: params);
    }

    RegExpMatch? m;
    // 「タスクを作成 ◯◯」「新しいタスク ◯◯」（本文は後ろ）
    m = RegExp('^(?:新しい)?タスク(?:を)?$verbs(?:して)?[、,:：]?(.*)\$').firstMatch(s) ??
        RegExp(r'^新しいタスク[、,:：]?(.*)$').firstMatch(s);
    if (m != null) return make(VoiceCommandType.createTask, t.suffix(m, 1));
    // 「◯◯というタスクを作成」「◯◯をタスクに追加」（本文は前）
    m = RegExp('^(.+?)(?:という|って)タスク(?:を)?$verbs(?:して)?\$').firstMatch(s) ??
        RegExp('^(.+?)をタスク(?:に|として)$verbs(?:して)?\$').firstMatch(s);
    if (m != null) return make(VoiceCommandType.createTask, t.prefix(m, 1));

    m = RegExp('^(?:新しい)?(?:アイデア|アイディア)(?:を)?(?:$verbs|メモ)(?:して)?[、,:：]?(.*)\$').firstMatch(s) ??
        RegExp(r'^新しい(?:アイデア|アイディア)[、,:：]?(.*)$').firstMatch(s);
    if (m != null) return make(VoiceCommandType.createIdea, t.suffix(m, 1));
    m = RegExp('^(.+?)(?:という|って)(?:アイデア|アイディア)(?:を)?$verbs(?:して)?\$').firstMatch(s);
    if (m != null) return make(VoiceCommandType.createIdea, t.prefix(m, 1));

    m = RegExp('^(?:新しい)?(?:懸念|課題)(?:を)?$verbs(?:して)?[、,:：]?(.*)\$').firstMatch(s) ??
        RegExp(r'^新しい(?:懸念|課題)[、,:：]?(.*)$').firstMatch(s);
    if (m != null) return make(VoiceCommandType.createConcern, t.suffix(m, 1));
    m = RegExp('^(.+?)(?:という|って)(?:懸念|課題)(?:を)?$verbs(?:して)?\$').firstMatch(s);
    if (m != null) return make(VoiceCommandType.createConcern, t.prefix(m, 1));

    // 「作成」「追加して ◯◯」だけ：画面で作るものが変わる
    m = RegExp('^$verbs(?:して)?[、,:：]?(.*)\$').firstMatch(s);
    if (m != null) {
      switch (screen) {
        case VoiceScreen.ideas:
          return make(VoiceCommandType.createIdea, t.suffix(m, 1));
        case VoiceScreen.concerns:
          return make(VoiceCommandType.createConcern, t.suffix(m, 1));
        case VoiceScreen.tasks:
        case VoiceScreen.taskDetail:
        case VoiceScreen.home:
          return make(VoiceCommandType.createTask, t.suffix(m, 1));
        default:
          return VoiceCommand(
            type: VoiceCommandType.unknown,
            rawText: raw,
            parameters: const {'hint': '何を作るかも言ってください（例：「タスクを作成」「アイデアを作成」）'},
          );
      }
    }
    return null;
  }

  /// 絞り込みの値（状態・優先度・それ以外はテーマ名）からコマンドを作る
  VoiceCommand _filterCommand(String raw, String value) {
    final v = _clean(value).replaceAll(' ', '');
    final status = _lookup(_statusWords, v.replaceFirst(RegExp(r'^(?:状態|ステータス)(?:が|は|を)?'), ''));
    if (status != null) {
      return VoiceCommand(type: VoiceCommandType.filterTasks, rawText: raw, parameters: {'status': status});
    }
    final hasPriorityWord = RegExp(r'^(?:優先度|優先)|優先度$').hasMatch(v);
    final priority = _lookup(
      _priorityWords,
      v.replaceFirst(RegExp(r'^(?:優先度|優先)(?:が|は|を)?'), '').replaceFirst(RegExp(r'の?優先度$'), ''),
    );
    if (priority != null && (hasPriorityWord || v.length <= 2)) {
      return VoiceCommand(type: VoiceCommandType.filterTasks, rawText: raw, parameters: {'priority': priority});
    }
    final name = _clean(v.replaceFirst(RegExp(r'^テーマ(?:が|は|を)?'), '').replaceFirst(RegExp(r'の?テーマ$'), ''));
    if (name.isEmpty) {
      return VoiceCommand(
        type: VoiceCommandType.unknown,
        rawText: raw,
        parameters: const {'hint': '絞り込む条件（状態・優先度・テーマ名）も言ってください'},
      );
    }
    return VoiceCommand(type: VoiceCommandType.filterTasks, rawText: raw, parameters: {'themeName': name});
  }

  static String? _lookup(List<MapEntry<String, String>> words, String v) {
    for (final e in words) {
      if (v == e.key) return e.value;
    }
    return null;
  }

  /// タスクの本文から優先度とタイトルを取り出す（「優先度は高」など）
  Map<String, String> _parseTaskContent(String content) {
    final params = <String, String>{};
    var title = content;
    for (final entry in _priorityWords) {
      final pattern = RegExp('[、,]?\\s*(?:優先度|優先)\\s*[はがを]?\\s*${entry.key}(?:で)?');
      if (pattern.hasMatch(title)) {
        params['priority'] = entry.value;
        title = title.replaceFirst(pattern, '').trim();
        break;
      }
    }
    title = _clean(title);
    if (title.isNotEmpty) params['title'] = title;
    return params;
  }

  // ---- 複数ターンの流れの中の答えの解釈 ----

  /// 「キャンセル」「やめる」など、流れを止める言葉か
  static bool isCancel(String text) {
    final s = _Text(text).bare;
    return RegExp(r'^(?:キャンセル|キャンセルして|やめる|やめて|やめ|やめます|やめとく|中止|中止して|もういい|もういいです)$')
        .hasMatch(s);
  }

  /// 「なし」（任意の項目を飛ばす）か
  static bool isNone(String text) {
    final s = _Text(text).bare;
    return RegExp(r'^(?:なし|無し|ない|無い|特になし|とくになし|いらない|要らない|不要|スキップ|飛ばして|なしで|指定なし|ありません)$')
        .hasMatch(s);
  }

  // 否定の言い回し（文のどこにあっても否定とみなす。「削除しないで」「承認しません」など）
  static final RegExp _negative = RegExp(
    r'いいえ|^いや|^いえ|ノー|^no$|だめ|ダメ|駄目|違う|ちがう|違います|ちがいます'
    r'|ないで|なくて|しない|ません|ない$|じゃない|ではない'
    r'|やめ|キャンセル|中止|待って|まって',
  );

  // 肯定とみなす1区切り（区切り全体が一致したときだけ）
  static final RegExp _affirmative = RegExp(
    r'^(?:'
    r'(?:はい|はーい|うん|ええ|イエス|yes|ok|okay|オッケー|おっけー|オーケー|そう|そうです|それで|それでいい|それでいいです'
    r'|いいよ|いいです|大丈夫|大丈夫です|どうぞ|了解|了解です|お願い|おねがい|お願いします|おねがいします'
    r'|よろしく|よろしくお願いします|進めて|送って)'
    r'|(?:実行|承認|却下|削除|停止|再開|開始|送信)(?:して|する|します|で)?'
    r')(?:ください|下さい|お願いします|おねがいします|お願い|おねがい)?$',
  );

  /// はい → true、いいえ → false、どちらでもない（聞き直す）→ null。
  ///
  /// 肯定は、句読点・空白で区切った各区切りがすべて明確な肯定表現のときだけ。
  /// 否定の言い回しが1つでもあれば false（確認で否定を言ったのに操作が進むのを防ぐ）。
  static bool? parseYesNo(String text) {
    // NOTE: 「お願いします」だけの答えも「はい」なので、依頼の言い回しを落とさない文で見る
    final spaced = _Text(text).spaced.toLowerCase();
    final compact = spaced.replaceAll(RegExp(r'[\s。、．，,.!！?？]'), '');
    if (compact.isEmpty) return null;
    if (_negative.hasMatch(compact)) return false;
    final parts = spaced.split(RegExp(r'[\s。、．，,.!！?？]+')).where((p) => p.isNotEmpty).toList();
    if (parts.every(_affirmative.hasMatch)) return true;
    return null;
  }

  // ラピへ送る指示として完結している形（「ラピに送って」「送って」「ラピへ」など）
  static final RegExp _sendToRapi = RegExp(
    r'^(?:'
    r'(?:ラピ(?:に|へ|まで)?)?(?:送って|送る|送ります|送信|送信して|送信する|送信します)'
    r'|ラピ(?:に|へ)'
    r')(?:ください|下さい|お願いします|おねがいします|お願い|おねがい)?$',
  );

  /// 「ラピに送るか」への答えが、送る指示として完結しているか。
  ///
  /// 「送」「ラピ」を含むだけの文（「送信は不要です」など）は当てはまらない。否定が入れば false
  static bool isSendToRapi(String text) {
    if (parseYesNo(text) == false) return false;
    final s = _Text(text).spaced.replaceAll(RegExp(r'[\s。、．，,.!！?？]'), '');
    return _sendToRapi.hasMatch(s);
  }

  /// 候補の番号の答え（「2」「2番」「二番目」「最後」）。番号でなければ null
  static int? parseChoice(String text) {
    final s = _Text(text).bare;
    final n = _number(s);
    if (n != null) return n;
    final target = parseTarget(s);
    return target?.index;
  }

  /// 優先度の答え（「高」「優先度は緊急」）。当たらなければ null
  static String? parsePriority(String text) {
    final s = _Text(text)
        .bare
        .replaceFirst(RegExp(r'^(?:優先度|優先)(?:は|が|を)?'), '')
        .replaceFirst(RegExp(r'(?:で|です|にして)$'), '');
    return _lookup(_priorityWords, s);
  }

  /// 対象の指定（「2番目」「最後」「ログインの」）。指定が無ければ null
  static VoiceTarget? parseTarget(String text) {
    var s = text.replaceAll(RegExp(r'[\s　]+'), ' ').trim();
    String strip(String v) => v
        .replaceFirst(RegExp(r'^(?:これ|それ|あれ|この|その|今の)\s*(?:を|の)?\s*'), '')
        .replaceFirst(RegExp(r'\s*(?:を|の|は|が|に)$'), '')
        .replaceFirst(RegExp(r'\s*(?:承認リクエスト|リクエスト|タスク|仮説|アイデア|アイディア|懸念|課題|実行)$'), '')
        .replaceFirst(RegExp(r'\s*(?:を|の|は|が|に)$'), '')
        .trim();
    s = strip(strip(s));
    if (s.isEmpty) return null;
    final bare = s.replaceAll(' ', '');
    if (RegExp(r'^(?:最初|先頭|一番上|1番上|いちばん上|トップ|いちばんめ)$').hasMatch(bare)) {
      return const VoiceTarget.index(1);
    }
    if (RegExp(r'^(?:最後|一番下|1番下|いちばん下|ラスト|末尾)$').hasMatch(bare)) {
      return const VoiceTarget.index(-1);
    }
    final ordinal = RegExp(r'^(.+?)(?:番目|番|つ目|個目|件目|こめ|行目)$').firstMatch(bare);
    if (ordinal != null) {
      final n = _number(ordinal.group(1)!);
      if (n != null && n > 0) return VoiceTarget.index(n);
    }
    return VoiceTarget.name(s);
  }

  /// 数（半角数字・漢数字・ひとつ〜いつつ）を int にする。数でなければ null
  static int? _number(String text) {
    final s = text.trim();
    if (RegExp(r'^\d+$').hasMatch(s)) return int.parse(s);
    const words = {
      'ひと': 1, 'ひとつ': 1, 'いち': 1, 'ふた': 2, 'ふたつ': 2, 'みっ': 3, 'みっつ': 3, 'さん': 3, //
      'よっ': 4, 'よっつ': 4, 'よん': 4, 'いつ': 5, 'いつつ': 5,
    };
    final word = words[s];
    if (word != null) return word;
    const digits = {'一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9};
    if (!RegExp(r'^[一二三四五六七八九十]+$').hasMatch(s)) return null;
    // 十の位と一の位だけ扱う（99 まで）
    final ten = s.indexOf('十');
    if (ten < 0) return s.length == 1 ? digits[s] : null;
    final tens = ten == 0 ? 1 : (ten == 1 ? digits[s[0]] : null);
    if (tens == null) return null;
    final rest = s.substring(ten + 1);
    if (rest.isEmpty) return tens * 10;
    final ones = rest.length == 1 ? digits[rest] : null;
    return ones == null ? null : tens * 10 + ones;
  }

  /// 自由文の前後の句読点・空白を落とす
  static String _clean(String text) => text
      .trim()
      .replaceFirst(RegExp(r'^[、。,.:：\s]+'), '')
      .replaceFirst(RegExp(r'[、。,.\s]+$'), '')
      .trim();
}

/// 画面ごとに使えるコマンド（「ヘルプ」で出す）。先頭はその画面だけのもの
List<String> voiceHelpFor(VoiceScreen screen) {
  const common = [
    '「タスク」「承認」「ホーム」など画面の名前（＋「を開いて」）：画面の移動',
    '「テーマ」「カテゴリ」「アイデア」「懸念」「仮説」「ダッシュボード」「通知」「設定」も開けます',
    '「戻る」「閉じる」「下にスクロール」「上にスクロール」',
    '「タスクを作成」「アイデアを作成」「懸念を作成」',
    '「検索 ◯◯」「フィルタ 進行中」「フィルタを解除」「◯◯（テーマ名）のタスク」',
    '途中で「キャンセル」「やめる」：その流れを止める',
  ];
  final List<String> here;
  switch (screen) {
    case VoiceScreen.tasks:
      here = const ['「2番目を開いて」「◯◯を開いて」：タスクの詳細へ', '「2番目を編集」：編集画面へ', '「◯◯を実行」：エージェントで実行（確認あり）'];
    case VoiceScreen.taskDetail:
      here = const ['「編集」：編集画面を開く', '「削除」：このタスクを削除（確認あり）', '「実行」：エージェントで実行（確認あり）', '「停止」：実行中なら止める（確認あり）'];
    case VoiceScreen.approvals:
      here = const ['「承認」「2番目を承認」「◯◯を承認」（確認あり）', '「却下 理由は◯◯」「2番目を却下」（確認あり）'];
    case VoiceScreen.executions:
      here = const ['「実行」「◯◯を実行」「2番目を実行」：実行開始（確認あり）', '「停止」「2番目を停止」：実行中を止める（確認あり）', '「再開」「2番目を再開」：中断した実行を再開（確認あり）'];
    case VoiceScreen.ideas:
      here = const ['「作成」：アイデアを作る', '「2番目を削除」（確認あり）'];
    case VoiceScreen.concerns:
      here = const ['「作成」：懸念を登録する', '「2番目を削除」（確認あり）'];
    case VoiceScreen.hypotheses:
      here = const ['「2番目を立証にする」「反証にする」「保留にする」「検証待ちに戻す」', '「2番目を削除」（確認あり）'];
    case VoiceScreen.rapi:
      here = const ['ラピへの発話は入力欄のマイクを使ってください（このボタンはアプリの操作用です）'];
    default:
      here = const [];
  }
  return [...here, ...common];
}
