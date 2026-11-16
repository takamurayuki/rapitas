//
// RapiHomeScreenChannel.swift
//
// MethodChannel `rapitas/home_screen`（Dart 側は lib/services/home_screen_bridge.dart）。
// - writeWidgetSnapshot(json)：App Group の共有 UserDefaults にスナップショットを書き、ウィジェットに描き直しを頼む
// - peekPendingRequests()：ショートカット「ラピに依頼」が預けた依頼を読む（消さない）
// - ackPendingRequests([id])：Dart が自分の保存先に書けた依頼を消す
//   （読んですぐ消すと、Dart が保存する前にアプリが終わったとき依頼が失われるので2段階にしている）
//
// NOTE: 共有 UserDefaults に書くのは Dart が組み立てた表示用の値だけ（トークン・URL は入らない）。
// アプリが前面にいる間の reloadTimelines は、WidgetKit の更新回数の上限に数えられない。
//

import Flutter
import Foundation
import WidgetKit

enum RapiHomeScreenChannel {
  static let name = "rapitas/home_screen"

  static func register(with messenger: FlutterBinaryMessenger) {
    let channel = FlutterMethodChannel(name: name, binaryMessenger: messenger)
    channel.setMethodCallHandler { call, result in
      switch call.method {
      case "writeWidgetSnapshot":
        guard let json = call.arguments as? String else {
          result(FlutterError(code: "bad_args", message: "snapshot must be a JSON string", details: nil))
          return
        }
        guard let shared = UserDefaults(suiteName: RapiShared.appGroupId) else {
          // App Group がプロファイルに入っていない（ポータル未登録など）。アプリの動作は止めない
          result(FlutterError(code: "no_app_group", message: RapiShared.appGroupId, details: nil))
          return
        }
        shared.set(json, forKey: RapiShared.snapshotKey)
        WidgetCenter.shared.reloadTimelines(ofKind: RapiShared.widgetKind)
        result(nil)
      case "peekPendingRequests":
        result(RapiPendingStore(defaults: .standard).peekAll().map(\.channelValue))
      case "ackPendingRequests":
        guard let ids = call.arguments as? [String] else {
          result(FlutterError(code: "bad_args", message: "ids must be a list of strings", details: nil))
          return
        }
        RapiPendingStore(defaults: .standard).remove(ids: Set(ids))
        result(nil)
      default:
        result(FlutterMethodNotImplemented)
      }
    }
  }
}
