/// Server-Sent Events のテキストをイベント単位に区切るパーサー。
///
/// 通信は扱わない（sse_service.dart が受け取った文字列を流し込む）。
/// 仕様: https://html.spec.whatwg.org/multipage/server-sent-events.html#event-stream-interpretation
class SseParser {
  final StringBuffer _line = StringBuffer();
  final StringBuffer _data = StringBuffer();
  bool _hasData = false;
  String? _eventType;
  String? _lastEventId;
  bool _pendingCr = false;

  /// 直近に受け取ったイベント ID（再接続時の Last-Event-ID）
  String? get lastEventId => _lastEventId;

  /// 受け取った文字列を足し、ここまでで完成したイベントを返す。
  ///
  /// @param chunk - 受信したテキスト（行の途中で切れていてよい） / 受信チャンク
  /// @returns 完成したイベント / 確定したイベント一覧
  List<RawSseEvent> add(String chunk) {
    final events = <RawSseEvent>[];
    for (var i = 0; i < chunk.length; i++) {
      final char = chunk[i];
      if (_pendingCr) {
        _pendingCr = false;
        // CRLF は1つの改行として扱う
        if (char == '\n') continue;
      }
      if (char == '\r' || char == '\n') {
        if (char == '\r') _pendingCr = true;
        final event = _processLine(_line.toString());
        _line.clear();
        if (event != null) events.add(event);
      } else {
        _line.write(char);
      }
    }
    return events;
  }

  RawSseEvent? _processLine(String line) {
    if (line.isEmpty) return _dispatch();
    // コロンで始まる行はコメント（バックエンドの keep-alive ping）
    if (line.startsWith(':')) return null;

    final colon = line.indexOf(':');
    final field = colon == -1 ? line : line.substring(0, colon);
    var value = colon == -1 ? '' : line.substring(colon + 1);
    if (value.startsWith(' ')) value = value.substring(1);

    switch (field) {
      case 'event':
        _eventType = value;
      case 'data':
        if (_hasData) _data.write('\n');
        _data.write(value);
        _hasData = true;
      case 'id':
        // NUL を含む id は仕様上無視する
        if (!value.contains('\u0000')) _lastEventId = value;
      default:
        // retry など、このクライアントでは使わないフィールドは読み飛ばす
        break;
    }
    return null;
  }

  RawSseEvent? _dispatch() {
    if (!_hasData) {
      _eventType = null;
      return null;
    }
    final event = RawSseEvent(
      type: (_eventType == null || _eventType!.isEmpty) ? 'message' : _eventType!,
      data: _data.toString(),
      id: _lastEventId,
    );
    _data.clear();
    _hasData = false;
    _eventType = null;
    return event;
  }
}

/// パース済みのイベント（data は JSON 化する前の文字列）
class RawSseEvent {
  final String type;
  final String data;
  final String? id;

  const RawSseEvent({required this.type, required this.data, this.id});
}
