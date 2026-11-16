//
// RapiRequestFlow.swift
//
// ショートカット「ラピに依頼」の処理の流れ（design.md §5.3）。Foundation だけで書き、通信と接続情報は
// 外から渡す（この VM の SwiftPM で、遅い相手・期限切れを差し込んで swift test を回せるように）。
// 本物の通信は RapiNativeClient.swift、接続情報は RapiConnectionStore.swift、AppIntent 本体は
// RapiRequestIntent.swift。
//
// 依頼を失わないための順序：
// 1. 通信を始める前に、依頼をアプリ内の置き場（RapiPendingStore）へ「時間切れ」として預ける。
//    途中で OS に実行を止められても、アプリを開けば下書きとして戻る
// 2. 通信全体に絶対の期限（totalBudget）を設け、超えたら通信を待たずに打ち切る
// 3. その場で返事を出せたときだけ、預けた依頼を消す。それ以外は理由を書き換えて残す
//

import Foundation

/// 依頼1件を処理した結果
enum RapiRequestOutcome: Equatable {
  /// その場で返事を出して終わり
  case reply(String)
  /// アプリに預けた。[message] を出し、iOS 17 以降は「開く」を出す
  case saved(message: String)
}

/// 接続情報の読み出しの結果
enum RapiConnectionResult {
  case ready(baseUrl: String, token: String?)
  case unpaired
  /// 端末がロック中でキーチェーンを読めない（kSecAttrAccessibleWhenUnlocked のため）
  case locked
}

enum RapiClientError: Error, Equatable {
  case unauthorized
  case offline
  case timeout
  /// 2xx 以外の応答、または本文が JSON でない
  case badResponse(Int)

  /// アプリに預けるときの理由
  var pendingReason: RapiPendingReason {
    switch self {
    case .unauthorized: return .unauthorized
    case .timeout: return .timeout
    case .offline, .badResponse: return .offline
    }
  }
}

/// ショートカットから呼ぶバックエンドの3つの API（本物は RapiNativeClient。テストでは差し替える）
protocol RapiAssistantCalls: Sendable {
  /// POST /assistant/route の応答
  func route(_ text: String, timeout: TimeInterval) async throws -> [String: Any]
  /// POST /copilot/chat の返事の本文
  func chat(_ text: String, timeout: TimeInterval) async throws -> String
  /// POST /assistant/ask の応答
  func ask(_ text: String, timeout: TimeInterval) async throws -> [String: Any]
}

enum RapiRequestFlow {
  /// App Intent は裏での実行時間に限りがある（目安で約30秒。公式に保証された値ではない）ので、
  /// 振り分けは10秒、全体は25秒で打ち切る。間に合わなければアプリに預ける
  static let routeTimeout: TimeInterval = 10
  static let totalBudget: TimeInterval = 25
  /// 返事の要求に最低限残す時間
  static let minimumReplyTimeout: TimeInterval = 3

  /// 通信の結果（期限の内側から外へ渡す値）
  enum Exchange: Sendable, Equatable {
    case reply(String)
    case needsApp(intent: String)
    case failed(RapiPendingReason)
  }

  /// 依頼1件を処理する
  ///
  /// - Parameters:
  ///   - text: 整えた依頼文 / rapiPrepareText の結果
  ///   - store: 預け先
  ///   - connection: 接続情報を読む / RapiConnectionStore.read
  ///   - makeClient: 接続先とトークンから通信の相手を作る
  ///   - budget: 通信全体の絶対期限（秒）。テストでは短くする
  ///   - now: 現在時刻
  /// - Returns: その場の返事か、預けた旨の文面
  static func run(
    _ text: String,
    store: RapiPendingStore,
    connection: () -> RapiConnectionResult,
    makeClient: (String, String?) -> RapiAssistantCalls,
    budget: TimeInterval = totalBudget,
    now: () -> Date = Date.init
  ) async -> RapiRequestOutcome {
    // 何より先に預ける。ここから先のどこで止められても、依頼文はアプリに残る
    var pending = RapiPendingRequest(text: text, createdAt: RapiDate.format(now()), reason: .timeout)
    store.upsert(pending)

    func saved(_ reason: RapiPendingReason, message: String) -> RapiRequestOutcome {
      if pending.reason != reason {
        pending.reason = reason
        store.upsert(pending)
      }
      return .saved(message: message)
    }

    let client: RapiAssistantCalls
    switch connection() {
    case .unpaired: return saved(.unpaired, message: RapiDialogText.failure(.unpaired))
    case .locked: return saved(.locked, message: RapiDialogText.failure(.locked))
    case .ready(let baseUrl, let token): client = makeClient(baseUrl, token)
    }

    let started = now()
    let exchange = await withDeadline(budget, onTimeout: .failed(.timeout)) {
      await converse(text, client: client, budget: budget, started: started)
    }

    switch exchange {
    case .reply(let message):
      store.remove(ids: [pending.id])
      return .reply(message)
    case .needsApp(let intent):
      return saved(.needsConfirmation, message: RapiDialogText.needsApp(intent: intent))
    case .failed(let reason):
      return saved(reason, message: RapiDialogText.failure(reason))
    }
  }

  /// 振り分けて、会話・問い合わせならその場の返事を取ってくる
  private static func converse(
    _ text: String,
    client: RapiAssistantCalls,
    budget: TimeInterval,
    started: Date
  ) async -> Exchange {
    do {
      let routed = try await client.route(text, timeout: min(routeTimeout, budget))
      guard let decision = RapiRouteDecision.decide(routed) else { return .failed(.offline) }
      let remaining = max(minimumReplyTimeout, budget - Date().timeIntervalSince(started))
      switch decision {
      case .chat:
        let content = try await client.chat(text, timeout: remaining)
        return .reply(RapiDialogText.chatReply(content))
      case .ask:
        let answer = try await client.ask(text, timeout: remaining)
        guard answer["success"] as? Bool == true else { return .failed(.offline) }
        return .reply(RapiDialogText.askReply(answer))
      case .needsApp(let intent):
        return .needsApp(intent: intent)
      }
    } catch let error as RapiClientError {
      return .failed(error.pendingReason)
    } catch {
      // 期限で取り消された（CancellationError・URLError.cancelled）ときもここに来るが、
      // その時点で withDeadline はもう onTimeout を返している
      return .failed(.offline)
    }
  }

  /// [operation] を [seconds] 秒の絶対期限つきで走らせる。期限が先に来たら [onTimeout] を返し、
  /// operation は取り消す。
  ///
  /// NOTE: TaskGroup で書くと、取り消しに応じない子タスクの終わりを group が待ってしまう
  /// （URLRequest.timeoutInterval は無通信時間の上限で、少しずつ届く応答では切れない）。
  /// ここでは continuation を先に来た方で1度だけ再開するので、operation が止まらなくても期限で戻る。
  static func withDeadline<T: Sendable>(
    _ seconds: TimeInterval,
    onTimeout: T,
    _ operation: @escaping @Sendable () async -> T
  ) async -> T {
    let gate = RapiFirstResult<T>()
    return await withCheckedContinuation { (continuation: CheckedContinuation<T, Never>) in
      gate.start(
        continuation,
        work: Task { gate.finish(await operation()) },
        timer: Task {
          try? await Task.sleep(nanoseconds: UInt64(max(0, seconds) * 1_000_000_000))
          gate.finish(onTimeout)
        }
      )
    }
  }
}

/// 2つのタスクのうち先に終わった方の値で、continuation を1度だけ再開する（withDeadline 用）
final class RapiFirstResult<T: Sendable>: @unchecked Sendable {
  // NOTE: @unchecked の根拠：可変の状態はすべて lock の内側でだけ触る
  private let lock = NSLock()
  private var continuation: CheckedContinuation<T, Never>?
  private var early: T?
  private var tasks: [Task<Void, Never>] = []
  private var done = false

  func start(_ continuation: CheckedContinuation<T, Never>, work: Task<Void, Never>, timer: Task<Void, Never>) {
    lock.lock()
    tasks = [work, timer]
    if let value = early {
      // start の前に片方が終わっていた（ごく短い期限・即座に返る相手）
      early = nil
      lock.unlock()
      work.cancel()
      timer.cancel()
      continuation.resume(returning: value)
      return
    }
    self.continuation = continuation
    lock.unlock()
  }

  func finish(_ value: T) {
    lock.lock()
    if done {
      lock.unlock()
      return
    }
    done = true
    guard let continuation else {
      early = value
      lock.unlock()
      return
    }
    self.continuation = nil
    let pending = tasks
    lock.unlock()
    for task in pending { task.cancel() }
    continuation.resume(returning: value)
  }
}
