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
  var text: String
  var createdAt: String
  var reason: RapiPendingReason
}

/// 預けた依頼の置き場。拡張は使わないので App Group ではなくアプリ内に置く（design.md §5.4）
///
/// NOTE: shared_preferences は "flutter." で始まるキーしか読まないので、このキーとは混ざらない。
struct RapiPendingStore {
  static let key = "rapiPendingRequests"

  /// 預ける上限。古いものから捨てる（何度失敗しても溜まり続けないように）
  static let limit = 20

  let defaults: UserDefaults

  /// 預かっている依頼（古い順）
  func load() -> [RapiPendingRequest] {
    guard let data = defaults.data(forKey: Self.key) else { return [] }
    return (try? JSONDecoder().decode([RapiPendingRequest].self, from: data)) ?? []
  }

  /// 依頼を1件足す
  func append(_ request: RapiPendingRequest) {
    var all = load()
    all.append(request)
    if all.count > Self.limit { all.removeFirst(all.count - Self.limit) }
    if let data = try? JSONEncoder().encode(all) { defaults.set(data, forKey: Self.key) }
  }

  /// すべて取り出して消す（MethodChannel の takePendingRequests）
  func takeAll() -> [RapiPendingRequest] {
    let all = load()
    defaults.removeObject(forKey: Self.key)
    return all
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
