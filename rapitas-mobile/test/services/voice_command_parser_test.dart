import 'package:flutter_test/flutter_test.dart';
import 'package:rapitas_mobile/services/voice_command_parser.dart';

void main() {
  final parser = VoiceCommandParser();
  VoiceCommand parse(String text, [VoiceScreen screen = VoiceScreen.home]) =>
      parser.parse(text, screen: screen);

  group('画面の判定', () {
    test('パスから画面を決める', () {
      expect(voiceScreenOf('/'), VoiceScreen.home);
      expect(voiceScreenOf('/tasks'), VoiceScreen.tasks);
      expect(voiceScreenOf('/tasks/new'), VoiceScreen.taskForm);
      expect(voiceScreenOf('/tasks/12'), VoiceScreen.taskDetail);
      expect(voiceScreenOf('/tasks/12/edit'), VoiceScreen.taskForm);
      expect(voiceScreenOf('/approvals'), VoiceScreen.approvals);
      expect(voiceScreenOf('/hypotheses'), VoiceScreen.hypotheses);
      // フォーム画面も画面種別に結び付く（「ヘルプ」でその画面向けの案内が出る）
      expect(voiceScreenOf('/themes/new'), VoiceScreen.themeForm);
      expect(voiceScreenOf('/themes/3/edit'), VoiceScreen.themeForm);
      expect(voiceScreenOf('/categories/new'), VoiceScreen.categoryForm);
      expect(voiceScreenOf('/categories/4/edit'), VoiceScreen.categoryForm);
      expect(voiceScreenOf('/ideas/new'), VoiceScreen.ideaForm);
      expect(voiceScreenOf('/concerns/new'), VoiceScreen.concernForm);
      expect(voiceScreenOf('/themes/3/other'), VoiceScreen.other);
      expect(voiceTaskIdOf('/tasks/12'), '12');
      expect(voiceTaskIdOf('/tasks/new'), isNull);
      expect(voiceTaskIdOf('/tasks'), isNull);
    });
  });

  group('フォーム画面', () {
    test('画面名とヘルプがフォーム向けになる', () {
      expect(voiceScreenLabel('/themes/new'), 'テーマの入力');
      expect(voiceScreenLabel('/categories/2/edit'), 'カテゴリの入力');
      expect(voiceScreenLabel('/ideas/new'), 'アイデアの入力');
      expect(voiceScreenLabel('/concerns/new'), '懸念の入力');
      for (final screen in [
        VoiceScreen.taskForm,
        VoiceScreen.themeForm,
        VoiceScreen.categoryForm,
        VoiceScreen.ideaForm,
        VoiceScreen.concernForm,
      ]) {
        expect(voiceHelpFor(screen).first, contains('入力欄'), reason: screen.name);
      }
    });
  });

  group('更新', () {
    test('「更新」「再読み込み」などはどの画面でも更新', () {
      for (final text in ['更新', '更新して', '画面を更新', '一覧を更新して', '再読み込み', '再読み込みして', 'リロード', 'リフレッシュ', '再試行', '最新にして', '読み込み直して']) {
        for (final screen in [VoiceScreen.home, VoiceScreen.tasks, VoiceScreen.settings, VoiceScreen.taskDetail]) {
          expect(parse(text, screen).type, VoiceCommandType.refresh, reason: '$text @ ${screen.name}');
        }
      }
    });

    test('「◯◯を更新」のように対象の付いた文は更新コマンドにしない', () {
      expect(parse('タイトルを更新').type, isNot(VoiceCommandType.refresh));
      expect(parse('更新日').type, isNot(VoiceCommandType.refresh));
      // ヘルプにも載せる
      expect(voiceHelpFor(VoiceScreen.home).join(), contains('「更新」'));
    });
  });

  group('移動', () {
    final cases = {
      'タスク': '/tasks',
      'タスクを開いて': '/tasks',
      'タスク一覧を見せて': '/tasks',
      'ホームへ': '/',
      'ホームに戻って': null, // 「戻って」は戻る（pop）
      '実行画面を開いて': '/executions',
      '承認を開いてください': '/approvals',
      'チャット': '/rapi',
      'ラピを開いて': '/rapi',
      'テーマを開いて': '/themes',
      'カテゴリー': '/categories',
      'アイデアを見せて': '/ideas',
      '懸念': '/concerns',
      '課題を開いて': '/concerns',
      '仮説を開く': '/hypotheses',
      'ダッシュボードに移動': '/dashboard',
      '通知を表示して': '/notifications',
      '設定を開いて。': '/settings',
    };
    cases.forEach((text, path) {
      test('「$text」', () {
        final cmd = parse(text);
        if (path == null) {
          expect(cmd.type, isNot(VoiceCommandType.navigate));
        } else {
          expect(cmd.type, VoiceCommandType.navigate);
          expect(cmd.path, path);
        }
      });
    });

    test('全角の空白や句読点があっても読める', () {
      final cmd = parse('タスク　を　開いて。');
      expect(cmd.type, VoiceCommandType.navigate);
      expect(cmd.path, '/tasks');
    });

    test('戻る・閉じる・スクロール', () {
      expect(parse('戻る').type, VoiceCommandType.back);
      expect(parse('前の画面に戻って').type, VoiceCommandType.back);
      expect(parse('閉じて').type, VoiceCommandType.close);
      expect(parse('下にスクロール').type, VoiceCommandType.scrollDown);
      expect(parse('スクロールして').type, VoiceCommandType.scrollDown);
      expect(parse('上にスクロールして').type, VoiceCommandType.scrollUp);
    });

    test('ヘルプ・キャンセル', () {
      expect(parse('ヘルプ').type, VoiceCommandType.help);
      expect(parse('何ができる？').type, VoiceCommandType.help);
      expect(parse('キャンセル').type, VoiceCommandType.cancel);
      expect(parse('やめる').type, VoiceCommandType.cancel);
    });
  });

  group('画面の文脈で意味が変わる', () {
    test('「承認」：承認画面では承認、他の画面では承認画面へ移動', () {
      final onApprovals = parse('承認', VoiceScreen.approvals);
      expect(onApprovals.type, VoiceCommandType.approveRequest);
      expect(onApprovals.target, isNull);

      final onHome = parse('承認', VoiceScreen.home);
      expect(onHome.type, VoiceCommandType.navigate);
      expect(onHome.path, '/approvals');

      // 「開いて」が付けば承認画面でも移動
      expect(parse('承認を開いて', VoiceScreen.approvals).type, VoiceCommandType.navigate);
    });

    test('「実行」：実行画面・タスク詳細では実行開始、他の画面では実行画面へ移動', () {
      expect(parse('実行', VoiceScreen.executions).type, VoiceCommandType.executeTask);
      expect(parse('実行', VoiceScreen.taskDetail).type, VoiceCommandType.executeTask);
      final onTasks = parse('実行', VoiceScreen.tasks);
      expect(onTasks.type, VoiceCommandType.navigate);
      expect(onTasks.path, '/executions');
    });

    test('「作成」だけ：画面で作るものが変わる', () {
      expect(parse('作成', VoiceScreen.tasks).type, VoiceCommandType.createTask);
      expect(parse('追加して', VoiceScreen.ideas).type, VoiceCommandType.createIdea);
      expect(parse('登録', VoiceScreen.concerns).type, VoiceCommandType.createConcern);
      // 何を作るか分からない画面では理解できない（勝手にタスクを作らない）
      final onApprovals = parse('作成', VoiceScreen.approvals);
      expect(onApprovals.type, VoiceCommandType.unknown);
      expect(onApprovals.hint, isNotNull);
    });

    test('「削除」：画面ごとに消すものが変わる。対象のない画面では使えない', () {
      expect(parse('削除', VoiceScreen.taskDetail).type, VoiceCommandType.deleteTask);
      expect(parse('2番目を削除', VoiceScreen.hypotheses).type, VoiceCommandType.deleteHypothesis);
      expect(parse('最後を消して', VoiceScreen.ideas).type, VoiceCommandType.deleteIdea);
      expect(parse('1番目を削除', VoiceScreen.concerns).type, VoiceCommandType.deleteConcern);
      final onHome = parse('削除', VoiceScreen.home);
      expect(onHome.type, VoiceCommandType.unknown);
      expect(onHome.hint, contains('タスク詳細'));
    });

    test('承認・却下は承認画面だけ。他の画面では案内つきの unknown', () {
      final cmd = parse('2番目を承認', VoiceScreen.tasks);
      expect(cmd.type, VoiceCommandType.unknown);
      expect(cmd.hint, contains('承認画面'));
    });

    test('「停止」「再開」は実行画面（停止はタスク詳細でも）', () {
      expect(parse('停止', VoiceScreen.executions).type, VoiceCommandType.stopExecution);
      expect(parse('停止', VoiceScreen.taskDetail).type, VoiceCommandType.stopExecution);
      expect(parse('停止', VoiceScreen.home).type, VoiceCommandType.unknown);
      expect(parse('再開', VoiceScreen.executions).type, VoiceCommandType.resumeExecution);
      expect(parse('再開', VoiceScreen.tasks).type, VoiceCommandType.unknown);
    });
  });

  group('対象の指定', () {
    test('番号（半角・全角・漢数字・〜つ目）', () {
      expect(parse('2番目を承認', VoiceScreen.approvals).target, const VoiceTarget.index(2));
      expect(parse('２番目を承認', VoiceScreen.approvals).target, const VoiceTarget.index(2));
      expect(parse('三番目を承認して', VoiceScreen.approvals).target, const VoiceTarget.index(3));
      expect(parse('十二番目を承認', VoiceScreen.approvals).target, const VoiceTarget.index(12));
      expect(parse('ふたつ目を承認', VoiceScreen.approvals).target, const VoiceTarget.index(2));
      expect(parse('最初のを承認', VoiceScreen.approvals).target, const VoiceTarget.index(1));
      expect(parse('最後を承認', VoiceScreen.approvals).target, const VoiceTarget.index(-1));
    });

    test('名前の一部', () {
      final cmd = parse('ログイン画面を承認', VoiceScreen.approvals);
      expect(cmd.type, VoiceCommandType.approveRequest);
      expect(cmd.target, const VoiceTarget.name('ログイン画面'));

      final exec = parse('API の調査を実行して', VoiceScreen.executions);
      expect(exec.type, VoiceCommandType.executeTask);
      expect(exec.target, const VoiceTarget.name('API の調査'));

      final stop = parse('ログインの実行を停止', VoiceScreen.executions);
      expect(stop.type, VoiceCommandType.stopExecution);
      expect(stop.target, const VoiceTarget.name('ログイン'));
    });

    test('「これ」「この」だけは指定なし（先頭を対象にする）', () {
      expect(parse('これ承認', VoiceScreen.approvals).target, isNull);
      expect(parse('承認して', VoiceScreen.approvals).target, isNull);
      expect(parse('実行開始', VoiceScreen.executions).target, isNull);
      expect(parse('再開して', VoiceScreen.executions).target, isNull);
    });

    test('名詞の後ろの「タスク」「仮説」は落とす', () {
      expect(parse('2番目の仮説を立証にする', VoiceScreen.hypotheses).target, const VoiceTarget.index(2));
      expect(parse('ログインのタスクを実行', VoiceScreen.executions).target, const VoiceTarget.name('ログイン'));
    });

    test('タスク一覧：「N番目を開いて」「◯◯を開いて」「2番目のタスクを開いて」', () {
      final byIndex = parse('2番目を開いて', VoiceScreen.tasks);
      expect(byIndex.type, VoiceCommandType.openTask);
      expect(byIndex.target, const VoiceTarget.index(2));

      final byName = parse('資料作成を開いて', VoiceScreen.tasks);
      expect(byName.type, VoiceCommandType.openTask);
      expect(byName.target, const VoiceTarget.name('資料作成'));

      final withNoun = parse('2番目のタスクを開いて', VoiceScreen.tasks);
      expect(withNoun.type, VoiceCommandType.openTask);
      expect(withNoun.target, const VoiceTarget.index(2));

      // 画面の名前を開くのは移動（タスク名より優先）
      expect(parse('テーマを開いて', VoiceScreen.tasks).type, VoiceCommandType.navigate);
      // タスク一覧の外では「N番目を開いて」は使えない
      expect(parse('2番目を開いて', VoiceScreen.home).type, VoiceCommandType.unknown);
    });

    test('編集：詳細では対象なし、一覧では番号で', () {
      expect(parse('編集', VoiceScreen.taskDetail).type, VoiceCommandType.editTask);
      final onList = parse('3番目を編集', VoiceScreen.tasks);
      expect(onList.type, VoiceCommandType.editTask);
      expect(onList.target, const VoiceTarget.index(3));
    });
  });

  group('承認・却下', () {
    test('却下の理由を発話から取る（空白は残す）', () {
      final cmd = parse('却下 理由は テストが 足りない', VoiceScreen.approvals);
      expect(cmd.type, VoiceCommandType.rejectRequest);
      expect(cmd.reason, 'テストが 足りない');
      expect(cmd.target, isNull);

      final withTarget = parse('2番目を却下して、仕様が古いため', VoiceScreen.approvals);
      expect(withTarget.target, const VoiceTarget.index(2));
      expect(withTarget.reason, '仕様が古いため');

      expect(parse('却下', VoiceScreen.approvals).reason, isNull);
    });

    test('確認が要る操作', () {
      expect(parse('承認', VoiceScreen.approvals).needsConfirmation, isTrue);
      expect(parse('却下', VoiceScreen.approvals).needsConfirmation, isTrue);
      expect(parse('実行', VoiceScreen.executions).needsConfirmation, isTrue);
      expect(parse('停止', VoiceScreen.executions).needsConfirmation, isTrue);
      expect(parse('削除', VoiceScreen.taskDetail).needsConfirmation, isTrue);
      expect(parse('タスク').needsConfirmation, isFalse);
      expect(parse('タスクを作成', VoiceScreen.tasks).needsConfirmation, isFalse);
      expect(parse('2番目を立証にする', VoiceScreen.hypotheses).needsConfirmation, isFalse);
    });
  });

  group('仮説', () {
    test('立証・反証・保留・検証待ち', () {
      expect(parse('2番目を立証にする', VoiceScreen.hypotheses).status, 'supported');
      expect(parse('1番目を反証にして', VoiceScreen.hypotheses).status, 'refuted');
      expect(parse('最後の仮説を保留', VoiceScreen.hypotheses).status, 'inconclusive');
      expect(parse('3番目を結論保留にする', VoiceScreen.hypotheses).status, 'inconclusive');
      expect(parse('2番目を検証待ちに戻す', VoiceScreen.hypotheses).status, 'open');
      expect(parse('2番目を立証にする', VoiceScreen.tasks).type, VoiceCommandType.unknown);
    });
  });

  group('作成', () {
    test('タスク：タイトルと優先度', () {
      final cmd = parse('タスクを作成して 明日の資料、優先度は高', VoiceScreen.tasks);
      expect(cmd.type, VoiceCommandType.createTask);
      expect(cmd.title, '明日の資料');
      expect(cmd.priority, 'high');

      final noTitle = parse('タスク作成');
      expect(noTitle.type, VoiceCommandType.createTask);
      expect(noTitle.title, isNull);

      final before = parse('React Native の調査というタスクを作って');
      expect(before.type, VoiceCommandType.createTask);
      expect(before.title, 'React Native の調査');

      final added = parse('牛乳を買うをタスクに追加');
      expect(added.title, '牛乳を買う');
    });

    test('アイデア・懸念はどの画面からでも名前で作れる', () {
      final idea = parse('アイデアを作成 音声で操作できるようにする', VoiceScreen.approvals);
      expect(idea.type, VoiceCommandType.createIdea);
      expect(idea.title, '音声で操作できるようにする');
      expect(parse('新しいアイデア').type, VoiceCommandType.createIdea);
      final concern = parse('懸念を登録', VoiceScreen.settings);
      expect(concern.type, VoiceCommandType.createConcern);
      expect(concern.title, isNull);
      expect(parse('課題を追加').type, VoiceCommandType.createConcern);
    });
  });

  group('検索・絞り込み・テーマ', () {
    test('検索の語句（前置き・後置き）', () {
      final head = parse('検索 ログイン画面');
      expect(head.type, VoiceCommandType.searchTasks);
      expect(head.query, 'ログイン画面');
      final tail = parse('API 設計を検索して');
      expect(tail.type, VoiceCommandType.searchTasks);
      expect(tail.query, 'API 設計');
    });

    test('絞り込み：状態・優先度・テーマ名', () {
      final status = parse('フィルタ 進行中');
      expect(status.type, VoiceCommandType.filterTasks);
      expect(status.status, 'in-progress');
      expect(parse('未着手で絞り込んで').status, 'todo');
      expect(parse('フィルターを完了にして').status, 'done');

      final priority = parse('フィルタ 優先度高');
      expect(priority.priority, 'high');
      expect(parse('フィルタ 緊急').priority, 'urgent');

      final theme = parse('フィルタ 英語学習');
      expect(theme.type, VoiceCommandType.filterTasks);
      expect(theme.themeName, '英語学習');
    });

    test('絞り込みの解除', () {
      expect(parse('フィルタを解除').type, VoiceCommandType.clearFilter);
      expect(parse('フィルターをクリアして').type, VoiceCommandType.clearFilter);
      expect(parse('絞り込みを解除').type, VoiceCommandType.clearFilter);
    });

    test('「＜テーマ名＞のタスク」', () {
      final cmd = parse('英語学習のタスク');
      expect(cmd.type, VoiceCommandType.themeTasks);
      expect(cmd.themeName, '英語学習');
      expect(parse('仕事のタスクを見せて').themeName, '仕事');
      // 状態の言葉なら絞り込み
      final status = parse('進行中のタスク');
      expect(status.type, VoiceCommandType.filterTasks);
      expect(status.status, 'in-progress');
    });
  });

  group('当たらない発話', () {
    test('勝手にタスク作成へ倒さない', () {
      for (final text in ['明日の会議の資料を作る', 'こんにちは', '今日はいい天気', 'あいうえお']) {
        final cmd = parse(text, VoiceScreen.tasks);
        expect(cmd.type, VoiceCommandType.unknown, reason: text);
        expect(cmd.rawText, text);
      }
    });

    test('空の発話は unknown', () {
      expect(parse('').type, VoiceCommandType.unknown);
      expect(parse('   ').type, VoiceCommandType.unknown);
    });

    test('文中の「承認」に引っ張られない（文末で判定）', () {
      // 以前は「承認」を含むだけで承認と解釈していた
      expect(parse('承認フローの確認', VoiceScreen.approvals).type, VoiceCommandType.unknown);
    });
  });

  group('答えの解釈', () {
    test('はい／いいえ', () {
      for (final yes in ['はい', 'うん', 'お願いします', 'OK', 'オッケー', '実行して', 'はい、お願いします']) {
        expect(VoiceCommandParser.parseYesNo(yes), isTrue, reason: yes);
      }
      for (final no in ['いいえ', 'いや', 'やめて', 'キャンセル', 'ちがう', 'しない']) {
        expect(VoiceCommandParser.parseYesNo(no), isFalse, reason: no);
      }
      expect(VoiceCommandParser.parseYesNo('明日の天気'), isNull);
    });

    test('否定の文は肯定にならない（前方一致で「はい」扱いしない）', () {
      for (final no in [
        '削除しないで',
        '承認しません',
        '実行しないで',
        'やめて',
        '違う',
        '違います',
        '却下しないでください',
        '停止しないで',
        '再開しない',
        '送らないで',
        'はい、やっぱりやめて',
        'いや、削除しないで',
        'だめです',
        'ノー',
        'no',
        'ちょっと待って',
      ]) {
        expect(VoiceCommandParser.parseYesNo(no), isFalse, reason: no);
      }
    });

    test('肯定の代表例', () {
      for (final yes in [
        'はい',
        'はい。',
        'うん',
        'ええ',
        'お願いします',
        'はい、お願いします',
        'はいお願いします',
        'OK',
        'ｏｋ',
        'オッケー',
        'いいよ',
        '大丈夫です',
        'どうぞ',
        '了解',
        '実行して',
        '承認して',
        '削除してください',
        '停止します',
        'うん、実行して',
      ]) {
        expect(VoiceCommandParser.parseYesNo(yes), isTrue, reason: yes);
      }
    });

    test('どちらとも取れない文は聞き直し（null）', () {
      for (final unclear in [
        '削除の件',
        '承認フロー',
        'はい明日',
        'はい、でも少し考えます',
        '実行するかな',
        'そうかも',
        'えーと',
        'いい',
        '',
        '。',
      ]) {
        expect(VoiceCommandParser.parseYesNo(unclear), isNull, reason: unclear);
      }
    });

    test('ラピへ送る指示は完結した形だけ（「送」「ラピ」を含むだけでは送らない）', () {
      for (final send in [
        'ラピに送って',
        'ラピへ送って',
        '送って',
        '送ってください',
        'ラピへ',
        'ラピに',
        'ラピに送信',
        '送信して',
        'ラピに送ってください。',
      ]) {
        expect(VoiceCommandParser.isSendToRapi(send), isTrue, reason: send);
      }
      for (final notSend in [
        '送信は不要です',
        '送るのはやめて',
        'ラピには送らないで',
        '送らないで',
        'ラピに送らなくていい',
        'ラピ',
        'ラピってなに',
        '送り先はどこ',
        '資料を送る準備',
        '',
      ]) {
        expect(VoiceCommandParser.isSendToRapi(notSend), isFalse, reason: notSend);
      }
    });

    test('番号の答え', () {
      expect(VoiceCommandParser.parseChoice('2'), 2);
      expect(VoiceCommandParser.parseChoice('２番'), 2);
      expect(VoiceCommandParser.parseChoice('三番目'), 3);
      expect(VoiceCommandParser.parseChoice('最後'), -1);
      expect(VoiceCommandParser.parseChoice('ログイン'), isNull);
    });

    test('なし・キャンセル・優先度', () {
      expect(VoiceCommandParser.isNone('なし'), isTrue);
      expect(VoiceCommandParser.isNone('特になし。'), isTrue);
      expect(VoiceCommandParser.isNone('なしのつぶて'), isFalse);
      expect(VoiceCommandParser.isCancel('やめる'), isTrue);
      expect(VoiceCommandParser.isCancel('キャンセルして'), isTrue);
      expect(VoiceCommandParser.isCancel('はい'), isFalse);
      expect(VoiceCommandParser.parsePriority('高'), 'high');
      expect(VoiceCommandParser.parsePriority('優先度は緊急'), 'urgent');
      expect(VoiceCommandParser.parsePriority('普通で'), 'medium');
      expect(VoiceCommandParser.parsePriority('あとで'), isNull);
    });
  });

  test('ヘルプは画面ごとのコマンドを先に出す', () {
    expect(voiceHelpFor(VoiceScreen.approvals).first, contains('承認'));
    expect(voiceHelpFor(VoiceScreen.executions).first, contains('実行'));
    expect(voiceHelpFor(VoiceScreen.home).first, contains('画面の移動'));
  });
}
