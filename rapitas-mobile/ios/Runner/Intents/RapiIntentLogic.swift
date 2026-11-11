//
// RapiIntentLogic.swift
//
// ショートカット「ラピに依頼」の判断と文面（Foundation だけ。この VM の SwiftPM で swift test を回す）。
// 通信は RapiNativeClient.swift、キーチェーンは RapiConnectionStore.swift、AppIntent 本体は
// RapiRequestIntent.swift。
//
// 流れ（design.md §5）：/assistant/route で振り分け先を決め、
// - 会話（chat・振り分けなし）→ /copilot/chat の返事をその場で出す
// - 問い合わせ（ask）→ /assistant/ask の結果をその場で出す
// - それ以外（作成・変更・計画・片付け・相談・見守り）→ バックエンドの設計上アプリでの確認が要るので、
//   アプリに預けて下書きにする
// 送れなかったとき（未接続・401・タイムアウト・ロック中）も預けて下書きにする。
//

import Foundation

/// バックエンドの文字数上限（rapitas-backend assistant-intake.routes.ts の MAX_TEXT_LENGTH。アプリの入力欄と同じ）
let rapiMaxTextLength = 2000

/// その場の返事に出す最大文字数（長い返事はショートカットの画面に収まらないので、続きはアプリで）
let rapiMaxDialogLength = 300

/// 問い合わせの返事に並べるタスク名の数
let rapiAskTitleLimit = 3

/// 振り分けの結果、ショートカットでどう扱うか
enum RapiRouteDecision: Equatable {
  /// /copilot/chat で返事をその場で出す
  case chat
  /// /assistant/ask の結果をその場で出す
  case ask
  /// アプリでの確認が要る。intent は振り分け先（create / change など）
  case needsApp(intent: String)

  /// POST /assistant/route の応答から扱いを決める。
  /// {success, routed: true, intent, reason} または {success, routed: false}
  /// （routes/ai/assistant-query.routes.ts）
  ///
  /// - Parameter json: 応答の本文 / 解析済みの JSON
  /// - Returns: 扱い。success が true でなければ nil（失敗として預ける）
  static func decide(_ json: [String: Any]) -> RapiRouteDecision? {
    guard json["success"] as? Bool == true else { return nil }
    guard json["routed"] as? Bool == true, let intent = json["intent"] as? String else {
      return .chat
    }
    switch intent {
    case "ask": return .ask
    case "chat": return .chat
    default: return .needsApp(intent: intent)
    }
  }
}

/// 送れなかった・アプリでの確認が要る理由（Dart の PendingRapiRequest.reason と同じ文字列）
enum RapiPendingReason: String, Codable {
  case needsConfirmation = "needs_confirmation"
  case offline
  case unauthorized
  case timeout
  case locked
  case unpaired
}

/// アプリに預ける依頼1件。アプリ本体の UserDefaults.standard に JSON 配列で置く
struct RapiPendingRequest: Codable, Equatable {
  /// 取り出し（peek）と消去（ack）を突き合わせる番号。Dart 側の重複除けにも使う
  var id: String
  var text: String
  var createdAt: String
  var reason: RapiPendingReason

  init(id: String = UUID().uuidString, text: String, createdAt: String, reason: RapiPendingReason) {
    self.id = id
    self.text = text
    self.createdAt = createdAt
    self.reason = reason
  }

  private enum CodingKeys: String, CodingKey { case id, text, createdAt, reason }

  // NOTE: id のない旧形式（PR #1473 の最初のコミット）も読む。番号は load() で振って書き戻す
  init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    id = try c.decodeIfPresent(String.self, forKey: .id) ?? ""
    text = try c.decode(String.self, forKey: .text)
    createdAt = try c.decode(String.self, forKey: .createdAt)
    reason = try c.decodeIfPresent(RapiPendingReason.self, forKey: .reason) ?? .needsConfirmation
  }

  /// MethodChannel で Dart に渡す形
  var channelValue: [String: String] {
    ["id": id, "text": text, "createdAt": createdAt, "reason": reason.rawValue]
  }
}

/// 預けた依頼の置き場。拡張は使わないので App Group ではなくアプリ内に置く（design.md §5.4）
///
/// 取り出しは2段階：peekAll() で読むだけ読み、Dart が自分の保存先に書けたら remove(ids:) で消す。
/// 読んだ直後に消すと、Dart に渡ってから保存されるまでの間にアプリが終わったとき依頼が失われる。
///
/// NOTE: 読み取り→変更→書き戻しは、プロセス内で共通の [lock] で直列にする。App Intent の実行と
/// MethodChannel の呼び出しは同じ Runner プロセスの別スレッドで重なりうるため（排他がないと、
/// 追加どうしの上書きや、取り出し中に足された依頼の消去が起きる）。
/// shared_preferences は "flutter." で始まるキーしか読まないので、このキーとは混ざらない。
// NOTE: @unchecked の根拠：UserDefaults 自体はスレッド安全で、読み取り→書き戻しはすべて lock の内側
struct RapiPendingStore: @unchecked Sendable {
  static let key = "rapiPendingRequests"

  /// 預ける上限。古いものから捨てる（何度失敗しても溜まり続けないように）
  static let defaultLimit = 20

  /// すべての RapiPendingStore で共有する（インスタンスごとに作ると排他にならない）
  private static let lock = NSLock()

  let defaults: UserDefaults
  var limit: Int = RapiPendingStore.defaultLimit

  /// [body] を排他で実行する。中で defaults を読み書きする処理はすべてここを通す
  private func locked<T>(_ body: () -> T) -> T {
    Self.lock.lock()
    defer { Self.lock.unlock() }
    return body()
  }

  private func read() -> [RapiPendingRequest] {
    guard let data = defaults.data(forKey: Self.key) else { return [] }
    var all = (try? JSONDecoder().decode([RapiPendingRequest].self, from: data)) ?? []
    if all.contains(where: { $0.id.isEmpty }) {
      for i in all.indices where all[i].id.isEmpty { all[i].id = UUID().uuidString }
      write(all)
    }
    return all
  }

  private func write(_ all: [RapiPendingRequest]) {
    if all.isEmpty {
      defaults.removeObject(forKey: Self.key)
    } else if let data = try? JSONEncoder().encode(all) {
      defaults.set(data, forKey: Self.key)
    }
  }

  /// 預かっている依頼（古い順）。読むだけで消さない
  func peekAll() -> [RapiPendingRequest] { locked { read() } }

  /// 依頼を1件足す（同じ id があれば置き換える。通信の前に預け、結果に合わせて理由を書き換えるため）
  func upsert(_ request: RapiPendingRequest) {
    locked {
      var all = read()
      if let i = all.firstIndex(where: { $0.id == request.id }) {
        all[i] = request
      } else {
        all.append(request)
        if all.count > limit { all.removeFirst(all.count - limit) }
      }
      write(all)
    }
  }

  /// [ids] の依頼だけを消す（Dart が受け取って保存し終えた分。MethodChannel の ackPendingRequests）。
  /// 読んだあとに足された依頼は ids に入っていないので残る
  func remove(ids: Set<String>) {
    if ids.isEmpty { return }
    locked { write(read().filter { !ids.contains($0.id) }) }
  }
}

/// 接続先の URL を整える（Dart の ApiConfig.normalizeBaseUrl と同じ：末尾の / を落とし、スキームがなければ http://）
func rapiNormalizeBaseUrl(_ raw: String) -> String {
  var value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
  while value.hasSuffix("/") { value.removeLast() }
  if !value.isEmpty && !value.contains("://") { value = "http://" + value }
  return value
}

/// Dart の ApiConfig.defaultBaseUrl。この URL のままなら未ペアリング
let rapiDefaultBaseUrl = "http://localhost:3001"

/// 依頼文を整える（前後の空白を落とし、上限で切る）。空なら nil
func rapiPrepareText(_ raw: String) -> String? {
  let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
  if trimmed.isEmpty { return nil }
  return trimmed.count > rapiMaxTextLength ? String(trimmed.prefix(rapiMaxTextLength)) : trimmed
}

/// ショートカットの画面に出す文面
enum RapiDialogText {
  static let savedToApp = "アプリに入れておきました。"

  /// 振り分け先の日本語名（アプリでの確認が要るもの）
  static func intentLabel(_ intent: String) -> String {
    switch intent {
    case "create": return "タスク作成"
    case "change": return "タスクの変更"
    case "roadmap": return "計画"
    case "tidy": return "片付け"
    case "consult": return "相談"
    case "watch": return "見守り"
    default: return "依頼"
    }
  }

  /// アプリでの確認が要る依頼を預けたとき
  static func needsApp(intent: String) -> String {
    "〈\(intentLabel(intent))〉として受け取りました。確認が要るので、アプリを開くと続きから進められます。"
  }

  /// 会話の返事。長ければ先頭を切って「続きはアプリで」を添える
  static func chatReply(_ content: String) -> String {
    let text = content.trimmingCharacters(in: .whitespacesAndNewlines)
    if text.isEmpty { return "ラピから返事がありませんでした。アプリで続きを確かめてください。" }
    if text.count <= rapiMaxDialogLength { return text }
    return String(text.prefix(rapiMaxDialogLength)) + "…\n（続きはアプリで）"
  }

  /// 問い合わせの返事。POST /assistant/ask の {available, total, rows: [{title}]}
  static func askReply(_ json: [String: Any]) -> String {
    guard json["available"] as? Bool == true else { return "質問を読み取れませんでした。言い方を変えてもう一度どうぞ。" }
    let total = (json["total"] as? NSNumber)?.intValue ?? 0
    if total == 0 { return "該当するタスクはありませんでした。" }
    let rows = json["rows"] as? [[String: Any]] ?? []
    let titles = rows.compactMap { $0["title"] as? String }.prefix(rapiAskTitleLimit)
    var text = "\(total)件：" + titles.joined(separator: "、")
    if total > titles.count { text += " ほか" }
    return text
  }

  /// 送れなかったときの文面（いずれも「アプリに入れておきました」を添える）
  static func failure(_ reason: RapiPendingReason) -> String {
    let head: String
    switch reason {
    case .unpaired: head = "まだデスクトップとつながっていません。アプリでペアリングしてください。"
    case .unauthorized: head = "接続の許可が切れています。アプリで接続し直してください。"
    case .offline: head = "デスクトップに届きませんでした（同じネットワークにいますか？）。"
    case .timeout: head = "デスクトップの返事が間に合いませんでした。"
    case .locked: head = "ロックを解除してからもう一度どうぞ。"
    case .needsConfirmation: head = "アプリでの確認が要ります。"
    }
    return head + savedToApp
  }
}
