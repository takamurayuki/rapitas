//
// RapiNativeClient.swift
//
// ショートカット「ラピに依頼」からバックエンドを呼ぶ、URLSession の薄い包み。
// Dart の Dio（lib/services/api_client.dart）と同じく Authorization: Bearer だけを付け、
// Origin と Sec-Fetch-Site は付けない（バックエンドの CSRF ガードを素通りする「非ブラウザのクライアント」になる）。
// ペアリングで発行された端末トークンは、デスクトップのゲートウェイが本体のトークンに差し替える。
//

import Foundation

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

struct RapiNativeClient {
  let baseUrl: String
  let token: String?
  var session: URLSession = .shared

  /// POST して JSON を受け取る
  ///
  /// - Parameters:
  ///   - path: /assistant/route など
  ///   - body: 送る JSON
  ///   - timeout: この要求の待ち時間（App Intent は裏での実行時間に限りがあるので短めに切る）
  /// - Throws: RapiClientError
  func post(_ path: String, _ body: [String: Any], timeout: TimeInterval) async throws -> [String: Any] {
    guard let url = URL(string: baseUrl + path) else { throw RapiClientError.offline }
    var request = URLRequest(url: url, timeoutInterval: timeout)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    if let token, !token.isEmpty {
      request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    }
    request.httpBody = try JSONSerialization.data(withJSONObject: body)

    let data: Data
    let response: URLResponse
    do {
      (data, response) = try await session.data(for: request)
    } catch let error as URLError where error.code == .timedOut {
      throw RapiClientError.timeout
    } catch {
      throw RapiClientError.offline
    }
    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
    if status == 401 || status == 403 { throw RapiClientError.unauthorized }
    guard (200..<300).contains(status),
          let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    else { throw RapiClientError.badResponse(status) }
    return json
  }

  /// POST /assistant/route {text, hasOpenTask}（決めるだけで、何も実行しない）
  func route(_ text: String, timeout: TimeInterval) async throws -> [String: Any] {
    try await post("/assistant/route", ["text": text, "hasOpenTask": false], timeout: timeout)
  }

  /// POST /copilot/chat {message, taskId: null, conversationHistory: []} → {success, content}
  func chat(_ text: String, timeout: TimeInterval) async throws -> String {
    let json = try await post(
      "/copilot/chat",
      ["message": text, "taskId": NSNull(), "conversationHistory": [Any]()],
      timeout: timeout
    )
    guard json["success"] as? Bool == true else { throw RapiClientError.badResponse(200) }
    return json["content"] as? String ?? ""
  }

  /// POST /assistant/ask {text} → {success, available, total, rows}
  func ask(_ text: String, timeout: TimeInterval) async throws -> [String: Any] {
    try await post("/assistant/ask", ["text": text], timeout: timeout)
  }
}
