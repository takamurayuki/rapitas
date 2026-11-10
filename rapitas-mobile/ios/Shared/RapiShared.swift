//
// RapiShared.swift
//
// アプリ本体（Runner）とウィジェット拡張（RapiWidgetExtension）の両方に入れる共有定義。
// App Group の名前、ウィジェットのスナップショットの形、ディープリンクの URL を置く。
// Foundation だけで書く（この VM の SwiftPM で swift test を回せるように）。
//
// NOTE: スナップショットを書くのは Dart（lib/providers/home_widget_sync_provider.dart）。
// キー名と値の形を変えるときは両方を合わせ、版（v）を上げる。
//

import Foundation

/// アプリと拡張で共有する名前
public enum RapiShared {
  /// App Group。Runner.entitlements と RapiWidget.entitlements に同じ値を書く
  public static let appGroupId = "group.com.rapitas.rapitasMobile"

  /// 共有 UserDefaults に置くスナップショットのキー
  public static let snapshotKey = "rapiWidgetSnapshot.v1"

  /// ウィジェットの kind（reloadTimelines(ofKind:) で使う）
  public static let widgetKind = "RapiHomeWidget"

  /// この時間を過ぎたスナップショットは「HH:MM 時点」と出して古いと分かるようにする
  public static let staleAfter: TimeInterval = 30 * 60
}

/// ディープリンク。ホスト部（app）は固定のダミー（rapitas://rapi と書くと rapi がホストになり、
/// go_router に届くパスが空になるため。design.md §4.1）
public enum RapiDeepLink {
  public static let compose = URL(string: "rapitas://app/rapi?compose=1")!
  public static let approvals = URL(string: "rapitas://app/approvals")!
  public static let executions = URL(string: "rapitas://app/executions")!
  public static let tasks = URL(string: "rapitas://app/tasks")!

  /// タスク詳細
  public static func task(_ id: String) -> URL {
    let safe = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id
    return URL(string: "rapitas://app/tasks/\(safe)") ?? tasks
  }
}

/// ウィジェットのスナップショット（形は design.md §3.2）
public struct RapiWidgetSnapshot: Codable, Equatable {
  public enum Connection: String, Codable {
    case ok
    case unpaired
    case error
  }

  public struct Count: Codable, Equatable {
    public var count: Int
  }

  public struct ExecutingTop: Codable, Equatable {
    public var taskId: String
    public var title: String
    /// running | waiting_for_input
    public var status: String
    public var startedAt: String?

    public var isWaitingForInput: Bool { status == "waiting_for_input" }
    public var startedDate: Date? { startedAt.flatMap(RapiDate.parse) }
  }

  public struct Executing: Codable, Equatable {
    public var count: Int
    public var top: ExecutingTop?
  }

  public struct Today: Codable, Equatable {
    public var count: Int
    public var overdue: Int?
    public var titles: [String]
  }

  public var v: Int
  public var updatedAt: String
  public var connection: Connection
  public var desktopName: String?
  public var approvals: Count?
  public var executing: Executing?
  public var today: Today?

  public var updatedDate: Date? { RapiDate.parse(updatedAt) }

  /// 共有 UserDefaults に置かれた JSON 文字列を読む。形が違えば nil
  public static func decode(_ json: String) -> RapiWidgetSnapshot? {
    guard let data = json.data(using: .utf8) else { return nil }
    return try? JSONDecoder().decode(RapiWidgetSnapshot.self, from: data)
  }

  /// [now] の時点で古くなっているか（updatedAt が読めなければ古いものとする）
  public func isStale(at now: Date) -> Bool {
    guard let updated = updatedDate else { return true }
    return now.timeIntervalSince(updated) >= RapiShared.staleAfter
  }

  /// 古くなる時刻（Timeline の2件目の entry をここに置く）
  public var staleDate: Date? { updatedDate?.addingTimeInterval(RapiShared.staleAfter) }
}

/// Dart の DateTime.toIso8601String()（UTC・小数秒つき）と、小数秒なしの ISO 8601 の両方を読む
public enum RapiDate {
  public static func parse(_ text: String) -> Date? {
    let fractional = ISO8601DateFormatter()
    fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let date = fractional.date(from: text) { return date }
    let plain = ISO8601DateFormatter()
    plain.formatOptions = [.withInternetDateTime]
    return plain.date(from: text)
  }

  /// 小数秒つきの UTC（Dart の DateTime.parse で読める形）
  public static func format(_ date: Date) -> String {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter.string(from: date)
  }
}
