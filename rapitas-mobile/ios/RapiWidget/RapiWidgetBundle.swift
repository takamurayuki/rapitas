//
// RapiWidgetBundle.swift
//
// ウィジェット拡張（RapiWidgetExtension）の入口。第2段階で Live Activity（RapiLiveActivity）をここに足す。
//

import SwiftUI
import WidgetKit

@main
struct RapiWidgetBundle: WidgetBundle {
  var body: some Widget {
    RapiHomeWidget()
  }
}
