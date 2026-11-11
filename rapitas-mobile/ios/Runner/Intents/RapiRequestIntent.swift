//
// RapiRequestIntent.swift
//
// ショートカット「ラピに依頼」（App Intent）。アプリ本体（Runner）のターゲットに置く。
// ウィジェット拡張ではなくここに置くのは、Dart が保存した URL とトークンをそのまま読めるようにするため
// （トークンをアプリの外に出さない。design.md §0・§2.2）。
//
// iOS 16 以降、アプリ本体に定義した AppIntent は、アプリのプロセスが UI なしで起動されて実行される。
// 処理の流れは RapiRequestFlow.swift、判断と文面は RapiIntentLogic.swift、通信は RapiNativeClient.swift。
//

import AppIntents
import Foundation

extension RapiRequestFlow {
  /// 本物の預け先・キーチェーン・URLSession で依頼1件を処理する
  ///
  /// - Parameter text: 整えた依頼文 / rapiPrepareText の結果
  /// - Returns: その場の返事か、預けた旨の文面
  static func runLive(_ text: String) async -> RapiRequestOutcome {
    await run(
      text,
      store: RapiPendingStore(defaults: .standard),
      connection: { RapiConnectionStore.read(defaults: .standard) },
      makeClient: { RapiNativeClient(baseUrl: $0, token: $1) }
    )
  }
}

@available(iOS 16.0, *)
struct RapiRequestIntent: AppIntent {
  static var title: LocalizedStringResource = "ラピに依頼"
  static var description = IntentDescription("ラピに文章で頼みます。確認が要る依頼や送れなかった依頼は、アプリの入力欄に入れておきます。")
  // その場で返事を出すので、アプリは開かない（開くかどうかは結果を見て、iOS 17 以降の「開く」で選べる）
  static var openAppWhenRun = false

  // 実行時に空ならシステムの入力ダイアログが出る
  @Parameter(
    title: "依頼文",
    inputOptions: String.IntentInputOptions(multiline: true),
    requestValueDialog: IntentDialog("ラピに何を頼みますか？")
  )
  var text: String

  func perform() async throws -> some IntentResult & ProvidesDialog {
    guard let prepared = rapiPrepareText(text) else {
      throw $text.needsValueError(IntentDialog("ラピに何を頼みますか？"))
    }
    switch await RapiRequestFlow.runLive(prepared) {
    case .reply(let message):
      return .result(dialog: IntentDialog(stringLiteral: message))
    case .saved(let message):
      if #available(iOS 17.0, *) {
        // 「開く」を押すとアプリが前面に来て、預けた依頼を取り込む（Dart の homeScreenLifecycleProvider が resumed で拾う）
        throw needsToContinueInForegroundError(IntentDialog(stringLiteral: message))
      }
      return .result(dialog: IntentDialog(stringLiteral: message))
    }
  }
}

@available(iOS 17.0, *)
extension RapiRequestIntent: ForegroundContinuableIntent {}

@available(iOS 16.0, *)
struct RapiShortcuts: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    AppShortcut(
      intent: RapiRequestIntent(),
      phrases: [
        "\(.applicationName)でラピに依頼",
        "\(.applicationName)のラピに頼む",
      ],
      shortTitle: "ラピに依頼",
      systemImageName: "bubble.left"
    )
  }
}
