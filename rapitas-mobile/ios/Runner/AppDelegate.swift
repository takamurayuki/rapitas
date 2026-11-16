import Flutter
import UIKit

@main
@objc class AppDelegate: FlutterAppDelegate {
  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    GeneratedPluginRegistrant.register(with: self)
    // ホーム画面ウィジェットとショートカットの窓口（lib/services/home_screen_bridge.dart）。
    // NOTE: rootViewController を探さず registrar の messenger を使う（起動経路によらず同じエンジンに届く）
    if let registrar = self.registrar(forPlugin: "RapiHomeScreenChannel") {
      RapiHomeScreenChannel.register(with: registrar.messenger())
    }
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }
}
