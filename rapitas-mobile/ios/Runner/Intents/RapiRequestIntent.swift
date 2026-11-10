//
// RapiRequestIntent.swift
//
// ショートカット「ラピに依頼」（App Intent）。アプリ本体（Runner）のターゲットに置く。
// ウィジェット拡張ではなくここに置くのは、Dart が保存した URL とトークンをそのまま読めるようにするため
// （トークンをアプリの外に出さない。design.md §0・§2.2）。
//
// iOS 16 以降、アプリ本体に定義した AppIntent は、アプリのプロセスが UI なしで起動されて実行される。
// 判断と文面は RapiIntentLogic.swift、通信は RapiNativeClient.swift。
//

import AppIntents
import Foundation

/// 依頼1件を処理した結果
enum RapiRequestOutcome {
  /// その場で返事を出して終わり
  case reply(String)
  /// アプリに預けた。[message] を出し、iOS 17 以降は「開く」を出す
  case saved(message: String)
}

/// 「ラピに依頼」の処理の流れ（design.md §5.3）
enum RapiRequestFlow {
  /// App Intent は裏での実行時間に限りがある（目安で約30秒。公式に保証された値ではない）ので、
  /// 振り分けは10秒、全体は25秒で打ち切る。間に合わなければアプリに預ける
  static let routeTimeout: TimeInterval = 10
  static let totalBudget: TimeInterval = 25
  /// 返事の要求に最低限残す時間
  static let minimumReplyTimeout: TimeInterval = 3

  static func run(
    _ text: String,
    defaults: UserDefaults = .standard,
    now: () -> Date = Date.init
  ) async -> RapiRequestOutcome {
    let started = now()
    let store = RapiPendingStore(defaults: defaults)

    func save(_ reason: RapiPendingReason, message: String) -> RapiRequestOutcome {
      store.append(RapiPendingRequest(text: text, createdAt: RapiDate.format(now()), reason: reason))
      return .saved(message: message)
    }

    let client: RapiNativeClient
    switch RapiConnectionStore.read(defaults: defaults) {
    case .unpaired: return save(.unpaired, message: RapiDialogText.failure(.unpaired))
    case .locked: return save(.locked, message: RapiDialogText.failure(.locked))
    case .ready(let baseUrl, let token): client = RapiNativeClient(baseUrl: baseUrl, token: token)
    }

    do {
      let routed = try await client.route(text, timeout: routeTimeout)
      guard let decision = RapiRouteDecision.decide(routed) else {
        return save(.offline, message: RapiDialogText.failure(.offline))
      }
      let remaining = max(minimumReplyTimeout, totalBudget - now().timeIntervalSince(started))
      switch decision {
      case .chat:
        let content = try await client.chat(text, timeout: remaining)
        return .reply(RapiDialogText.chatReply(content))
      case .ask:
        let answer = try await client.ask(text, timeout: remaining)
        guard answer["success"] as? Bool == true else {
          return save(.offline, message: RapiDialogText.failure(.offline))
        }
        return .reply(RapiDialogText.askReply(answer))
      case .needsApp(let intent):
        return save(.needsConfirmation, message: RapiDialogText.needsApp(intent: intent))
      }
    } catch let error as RapiClientError {
      return save(error.pendingReason, message: RapiDialogText.failure(error.pendingReason))
    } catch {
      return save(.offline, message: RapiDialogText.failure(.offline))
    }
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
    switch await RapiRequestFlow.run(prepared) {
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
