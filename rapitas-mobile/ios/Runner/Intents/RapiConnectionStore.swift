//
// RapiConnectionStore.swift
//
// Dart が保存した接続先とトークンを、Swift から読むだけの窓口（書き出しも複製もしない）。
// App Intent はアプリ本体（Runner）のプロセスで動くので、同じ UserDefaults とキーチェーンを読める。
// トークンを App Group や共有キーチェーンに置かないので、ウィジェット拡張からは読めない（design.md §2.2）。
//
// NOTE: 保存形式はプラグインの実装に依存する。パッケージを上げるときはここを見直す。
// - URL：shared_preferences（レガシー API）は UserDefaults.standard に "flutter." を前に付けて置く。
//   Dart 側のキーは lib/providers/connection_provider.dart の _urlKey（backendUrl）
// - トークン：flutter_secure_storage 9.2.4 の既定オプション（ios/Classes/FlutterSecureStorage.swift）。
//   kSecClassGenericPassword、service = "flutter_secure_storage_service"（AppleOptions.defaultAccountName）、
//   account = Dart 側の _tokenKey（rapitasApiToken）、kSecAttrAccessibleWhenUnlocked、access group なし。値は UTF-8
//

import Foundation
import Security

// NOTE: RapiConnectionResult は RapiRequestFlow.swift（Linux の swift test に入れるため）
enum RapiConnectionStore {
  static let urlDefaultsKey = "flutter.backendUrl"
  static let keychainService = "flutter_secure_storage_service"
  static let keychainAccount = "rapitasApiToken"

  /// 接続先とトークンを読む。URL が既定の localhost のままでトークンもなければ未ペアリング
  static func read(defaults: UserDefaults = .standard) -> RapiConnectionResult {
    let stored = defaults.string(forKey: urlDefaultsKey).map(rapiNormalizeBaseUrl)
    let baseUrl = (stored?.isEmpty == false ? stored : nil) ?? rapiDefaultBaseUrl

    let token: String?
    switch readToken() {
    case .success(let value): token = value
    case .failure(let error) where error == .locked: return .locked
    case .failure: token = nil
    }
    // NOTE: Dart の isWidgetUnpaired と同じ判定。localhost は端末自身なので、デスクトップには届かない
    if baseUrl == rapiDefaultBaseUrl { return .unpaired }
    return .ready(baseUrl: baseUrl, token: token)
  }

  enum TokenError: Error, Equatable {
    case locked
    case other(OSStatus)
  }

  /// キーチェーンからトークンを読む。項目がなければ nil
  static func readToken() -> Result<String?, TokenError> {
    let query: [CFString: Any] = [
      kSecClass: kSecClassGenericPassword,
      kSecAttrService: keychainService,
      kSecAttrAccount: keychainAccount,
      kSecReturnData: true,
      kSecMatchLimit: kSecMatchLimitOne,
    ]
    var item: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &item)
    switch status {
    case errSecSuccess:
      guard let data = item as? Data, let text = String(data: data, encoding: .utf8) else { return .success(nil) }
      let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
      return .success(trimmed.isEmpty ? nil : trimmed)
    case errSecItemNotFound:
      return .success(nil)
    case errSecInteractionNotAllowed:
      return .failure(.locked)
    default:
      return .failure(.other(status))
    }
  }
}
