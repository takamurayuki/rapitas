import 'dart:async';
import 'dart:convert';
import 'package:eventsource/eventsource.dart';
import '../config/api_config.dart';

class SseService {
  final ApiConfig _config;
  EventSource? _eventSource;
  final _controller = StreamController<SseEvent>.broadcast();
  bool _isConnected = false;
  Timer? _reconnectTimer;

  SseService({required ApiConfig config}) : _config = config;

  Stream<SseEvent> get events => _controller.stream;
  bool get isConnected => _isConnected;

  Future<void> connect() async {
    if (_isConnected) return;

    try {
      _eventSource = await EventSource.connect(
        Uri.parse(_config.sseUrl),
      );
      _isConnected = true;

      _eventSource!.listen(
        (Event event) {
          if (event.data != null && event.data!.isNotEmpty) {
            try {
              final data = jsonDecode(event.data!);
              _controller.add(SseEvent(
                type: event.event ?? 'message',
                data: data,
              ));
            } catch (_) {
              _controller.add(SseEvent(
                type: event.event ?? 'message',
                data: {'raw': event.data},
              ));
            }
          }
        },
        onError: (error) {
          _isConnected = false;
          _scheduleReconnect();
        },
        onDone: () {
          _isConnected = false;
          _scheduleReconnect();
        },
      );
    } catch (e) {
      _isConnected = false;
      _scheduleReconnect();
    }
  }

  void _scheduleReconnect() {
    _reconnectTimer?.cancel();
    _reconnectTimer = Timer(const Duration(seconds: 5), () {
      connect();
    });
  }

  void disconnect() {
    _reconnectTimer?.cancel();
    _eventSource = null;
    _isConnected = false;
  }

  void dispose() {
    disconnect();
    _controller.close();
  }
}

class SseEvent {
  final String type;
  final dynamic data;

  SseEvent({required this.type, required this.data});
}
