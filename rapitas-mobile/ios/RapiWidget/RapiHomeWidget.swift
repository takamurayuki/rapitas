//
// RapiHomeWidget.swift
//
// ホーム画面のラピ（中サイズ）。アプリが App Group に書いたスナップショットを表示するだけで、
// 自分ではデータを取りに行かない（トークンを持たないため。design.md §3）。
// 見た目の正本は hidden_files/ui-preview/rapi-widget-mock.html（338×158pt、ライト・ダーク）。
//
// 各部のタップ先（design.md §3.4）：上の「ラピに話しかける…」→ 入力欄にフォーカスしたチャット、
// 承認待ち → /approvals、実行中 → /executions、今日 → /tasks。
//

import SwiftUI
import WidgetKit

// MARK: - Timeline

struct RapiWidgetEntry: TimelineEntry {
  let date: Date
  /// nil ならアプリがまだ一度も書いていない
  let snapshot: RapiWidgetSnapshot?
}

struct RapiWidgetProvider: TimelineProvider {
  func placeholder(in context: Context) -> RapiWidgetEntry {
    RapiWidgetEntry(date: Date(), snapshot: .sample)
  }

  func getSnapshot(in context: Context, completion: @escaping (RapiWidgetEntry) -> Void) {
    // ウィジェットの追加画面では、まだ値がなくても見本を出す
    let stored = Self.load()
    completion(RapiWidgetEntry(date: Date(), snapshot: context.isPreview ? (stored ?? .sample) : stored))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<RapiWidgetEntry>) -> Void) {
    let now = Date()
    let snapshot = Self.load()
    var entries = [RapiWidgetEntry(date: now, snapshot: snapshot)]
    // 古くなる時刻に2件目を置き、「HH:MM 時点」の表示へ切り替える。新しい値はアプリが reloadTimelines で届ける
    if let stale = snapshot?.staleDate, stale > now {
      entries.append(RapiWidgetEntry(date: stale, snapshot: snapshot))
    }
    completion(Timeline(entries: entries, policy: .never))
  }

  static func load() -> RapiWidgetSnapshot? {
    guard let json = UserDefaults(suiteName: RapiShared.appGroupId)?.string(forKey: RapiShared.snapshotKey) else {
      return nil
    }
    return RapiWidgetSnapshot.decode(json)
  }
}

struct RapiHomeWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: RapiShared.widgetKind, provider: RapiWidgetProvider()) { entry in
      RapiHomeWidgetView(entry: entry)
    }
    .configurationDisplayName("ラピ")
    .description("承認待ち・実行中・今日のタスクを見て、ラピにすぐ話しかけられます。")
    .supportedFamilies([.systemMedium])
  }
}

// MARK: - 色

private enum RapiWidgetColor {
  static let accent = Color("AccentColor")
  static let background = Color("WidgetBackground")
  /// 入力待ちを目立たせる色（モックの --warn）
  static func warn(_ scheme: ColorScheme) -> Color {
    scheme == .dark ? Color(red: 0.984, green: 0.749, blue: 0.141) : Color(red: 0.851, green: 0.467, blue: 0.024)
  }
  /// 「ラピに話しかける…」の地色（モックの --chip）
  static func chip(_ scheme: ColorScheme) -> Color {
    scheme == .dark ? Color(red: 0.165, green: 0.165, blue: 0.251) : Color(red: 0.933, green: 0.949, blue: 1.0)
  }
}

// MARK: - 表示

struct RapiHomeWidgetView: View {
  let entry: RapiWidgetEntry
  @Environment(\.colorScheme) private var scheme

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      header
      Divider().padding(.top, 10)
      content.padding(.top, 8)
    }
    .widgetURL(RapiDeepLink.compose)
    .rapiWidgetBackground(RapiWidgetColor.background)
  }

  private var header: some View {
    Link(destination: RapiDeepLink.compose) {
      HStack(spacing: 8) {
        Image("RapiAvatar")
          .resizable()
          .scaledToFit()
          .frame(width: 40, height: 44)
          .padding(.leading, -4)
          .accessibilityHidden(true)
        HStack {
          Text("ラピに話しかける…")
            .font(.system(size: 13))
            .foregroundStyle(.secondary)
            .lineLimit(1)
          Spacer(minLength: 4)
          Image(systemName: "square.and.pencil")
            .font(.system(size: 13, weight: .medium))
            .foregroundStyle(RapiWidgetColor.accent)
        }
        .padding(.horizontal, 12)
        .frame(height: 30)
        .background(Capsule().fill(RapiWidgetColor.chip(scheme)))
        if let stamp {
          Text(stamp)
            .font(.system(size: 10))
            .foregroundStyle(.secondary)
            .lineLimit(1)
            .fixedSize()
        }
      }
      .frame(height: 36)
    }
  }

  /// 古い値・取得失敗のときに出す「HH:MM 時点」
  private var stamp: String? {
    guard let snapshot = entry.snapshot, snapshot.connection != .unpaired else { return nil }
    guard snapshot.connection == .error || snapshot.isStale(at: entry.date) else { return nil }
    guard let updated = snapshot.updatedDate else { return nil }
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "ja_JP")
    formatter.dateFormat = Calendar.current.isDate(updated, inSameDayAs: entry.date) ? "H:mm" : "M/d H:mm"
    return formatter.string(from: updated) + " 時点"
  }

  @ViewBuilder private var content: some View {
    if let snapshot = entry.snapshot, snapshot.connection != .unpaired {
      columns(snapshot)
    } else {
      message(
        entry.snapshot == nil ? "アプリを開くと、ここに表示されます" : "デスクトップとまだつながっていません",
        sub: "アプリでデスクトップの QR コードを読み取ってください"
      )
    }
  }

  private func message(_ title: String, sub: String) -> some View {
    VStack(alignment: .leading, spacing: 2) {
      Text(title).font(.system(size: 13))
      Text(sub).font(.system(size: 11)).foregroundStyle(.secondary)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
  }

  /// 列の幅の比（承認待ちは数字だけなので狭く、タスク名を出す2列を広くする。モックと同じ）
  private static let columnWeights: [CGFloat] = [0.7, 1.15, 1.15]
  private static let separatorWidth: CGFloat = 20.5

  private func columns(_ s: RapiWidgetSnapshot) -> some View {
    GeometryReader { geo in
      let total = Self.columnWeights.reduce(0, +)
      let usable = max(0, geo.size.width - Self.separatorWidth * 2)
      let width = { (i: Int) in usable * Self.columnWeights[i] / total }
      HStack(alignment: .top, spacing: 0) {
        Link(destination: RapiDeepLink.approvals) {
          column("承認待ち", count: s.approvals?.count ?? 0, highlight: true) {
            if (s.approvals?.count ?? 0) > 0 { detail("確認する", secondary: true) }
          }
        }
        .frame(width: width(0), alignment: .leading)
        separator
        Link(destination: RapiDeepLink.executions) {
          column("実行中", count: s.executing?.count ?? 0) {
            if let top = s.executing?.top { executingDetail(top) }
          }
        }
        .frame(width: width(1), alignment: .leading)
        separator
        Link(destination: RapiDeepLink.tasks) {
          column("今日", count: s.today?.count ?? 0) {
            ForEach(Array((s.today?.titles ?? []).prefix(2).enumerated()), id: \.offset) { _, title in
              detail("・" + title)
            }
            if (s.today?.titles.count ?? 0) < 2, let overdue = s.today?.overdue, overdue > 0 {
              detail("うち期限切れ \(overdue)", secondary: true)
            }
          }
        }
        .frame(width: width(2), alignment: .leading)
      }
      .frame(maxHeight: .infinity, alignment: .top)
    }
  }

  private var separator: some View {
    Rectangle()
      .fill(Color.secondary.opacity(0.25))
      .frame(width: 0.5)
      .padding(.horizontal, 10)
      .frame(maxHeight: .infinity)
  }

  private func column<Details: View>(
    _ label: String,
    count: Int,
    highlight: Bool = false,
    @ViewBuilder details: () -> Details
  ) -> some View {
    VStack(alignment: .leading, spacing: 0) {
      Text(label).font(.system(size: 11)).foregroundStyle(.secondary)
        .frame(maxWidth: .infinity, alignment: .leading)
      Text("\(count)")
        .font(.system(size: 24, weight: .semibold))
        .monospacedDigit()
        .foregroundStyle(count == 0 ? AnyShapeStyle(.secondary) : highlight ? AnyShapeStyle(RapiWidgetColor.accent) : AnyShapeStyle(.primary))
      details()
    }
  }

  private func detail(_ text: String, secondary: Bool = false) -> some View {
    Text(text)
      .font(.system(size: 11))
      .foregroundStyle(secondary ? AnyShapeStyle(.secondary) : AnyShapeStyle(.primary))
      .lineLimit(1)
      .truncationMode(.tail)
  }

  @ViewBuilder private func executingDetail(_ top: RapiWidgetSnapshot.ExecutingTop) -> some View {
    detail(top.title)
    // 経過時間は端末側で進むので、アプリからの更新が来なくても止まって見えない
    let label = top.isWaitingForInput ? "入力待ち・" : "実行中・"
    Group {
      if let started = top.startedDate {
        Text(label) + Text(started, style: .timer)
      } else {
        Text(String(label.dropLast()))
      }
    }
    .font(.system(size: 11, weight: top.isWaitingForInput ? .semibold : .regular))
    .foregroundStyle(top.isWaitingForInput ? AnyShapeStyle(RapiWidgetColor.warn(scheme)) : AnyShapeStyle(.secondary))
    .lineLimit(1)
  }
}

private extension View {
  /// iOS 17 以降は containerBackground が必須（ないと「containerBackground を使ってください」と表示される）
  @ViewBuilder func rapiWidgetBackground(_ color: Color) -> some View {
    if #available(iOSApplicationExtension 17.0, *) {
      containerBackground(color, for: .widget)
    } else {
      padding(16).background(color)
    }
  }
}

extension RapiWidgetSnapshot {
  /// ウィジェットの追加画面とプレースホルダーに出す見本
  static var sample: RapiWidgetSnapshot {
    RapiWidgetSnapshot(
      v: 1,
      updatedAt: RapiDate.format(Date()),
      connection: .ok,
      desktopName: nil,
      approvals: Count(count: 2),
      executing: Executing(
        count: 1,
        top: ExecutingTop(taskId: "0", title: "ログイン画面の不具合修正", status: "running",
                          startedAt: RapiDate.format(Date().addingTimeInterval(-754)))
      ),
      today: Today(count: 3, overdue: 0, titles: ["週次レポートの提出", "請求書の確認"])
    )
  }
}
