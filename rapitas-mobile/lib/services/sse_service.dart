import 'dart:async';
import 'dart:convert';
import 'dart:math';
import 'package:dio/dio.dart';
import '../config/api_config.dart';
import 'sse_parser.dart';

/// SSE の接続状態
enum SseConnectionState {
  /// まだ繋いでいない／明示的に切断した
  idle,
  connecting,
  connected,

  /// 切れたので再接続を待っている
  reconnecting,

  /// トークン誤りなど、待っても直らない失敗。設定を直すまで再接続しない
  unauthorized,
}

/// デスクトップ版バックエンドの `/events/stream` を購読するサービス。
///
/// スマホは画面オフや回線切り替えで接続が切れるのが普通なので、
/// 指数バックオフで繋ぎ直し、無通信が続いた接続は死んだものとみなして張り直す。
///
/// NOTE: 以前は eventsource パッケージを使っていたが、(1) サーバー側が閉じても
/// 購読側に完了が届かず接続が黙って死ぬ、(2) エラー時に止められない再接続ループを
/// 内部で回し続ける、の2点がモバイルで致命的だったため Dio のストリームで受ける形にした。
class SseService {
  static const Duration _initialBackoff = Duration(seconds: 1);
  static const Duration _maxBackoff = Duration(seconds: 30);

  /// バックエンドは60秒ごとに ping を送る。2回分届かなければ切れたとみなす
  static const Duration idleTimeout = Duration(seconds: 150);

  final ApiConfig _config;
  final Dio _dio;
  final Random _random;
  final _events = StreamController<SseEvent>.broadcast();
  final _states = StreamController<SseConnectionState>.broadcast();

  CancelToken? _cancelToken;
  StreamSubscription<String>? _subscription;
  Timer? _reconnectTimer;
  Timer? _idleTimer;
  int _attempt = 0;
  String? _lastEventId;
  bool _disposed = false;
  bool _wantsConnection = false;
  SseConnectionState _state = SseConnectionState.idle;

  SseService({required ApiConfig config, Dio? dio, Random? random})
      : _config = config,
        _dio = dio ??
            // NOTE: receiveTimeout は付けない（既定の null＝無制限）。ストリームは開きっぱなしなので、
            // 切断の検知は idleTimeout の無通信監視で行う。
            Dio(BaseOptions(
              connectTimeout: ApiConfig.connectTimeout,
            )),
        _random = random ?? Random();

  /// ping を除いたイベント
  Stream<SseEvent> get events => _events.stream;

  SseConnectionState get state => _state;
  bool get isConnected => _state == SseConnectionState.connected;

  /// 現在の状態から始まる状態ストリーム（購読が遅れても最初の状態を取りこぼさない）
  Stream<SseConnectionState> get connectionStates async* {
    yield _state;
    yield* _states.stream;
  }

  /// 接続を始める。すでに接続中・接続待ちなら何もしない。
  Future<void> connect() async {
    if (_disposed) return;
    _wantsConnection = true;
    if (_state == SseConnectionState.connecting || _state == SseConnectionState.connected) return;
    _reconnectTimer?.cancel();
    _setState(SseConnectionState.connecting);

    final cancelToken = CancelToken();
    _cancelToken = cancelToken;
    try {
      final response = await _dio.get<ResponseBody>(
        _config.sseUrl,
        cancelToken: cancelToken,
        options: Options(
          responseType: ResponseType.stream,
          headers: {
            'Accept': 'text/event-stream',
            'Cache-Control': 'no-cache',
            // EventSource と違いヘッダーを付けられるので、トークンは URL に載せない（ログに残さないため）
            ..._config.authHeaders,
            if (_lastEventId != null) 'Last-Event-ID': _lastEventId!,
          },
        ),
      );
      if (_disposed || !_wantsConnection || cancelToken.isCancelled) return;

      final parser = SseParser();
      _attempt = 0;
      _setState(SseConnectionState.connected);
      _touchIdle();
      _subscription = response.data!.stream
          .cast<List<int>>()
          .transform(const Utf8Decoder(allowMalformed: true))
          .listen(
            (chunk) {
              _touchIdle();
              for (final event in parser.add(chunk)) {
                if (event.id != null) _lastEventId = event.id;
                _emit(event);
              }
            },
            onError: (Object error) => _onFailure(error),
            onDone: () => _onFailure(null),
            cancelOnError: true,
          );
    } catch (error) {
      if (cancelToken.isCancelled) return;
      _onFailure(error);
    }
  }

  void _emit(RawSseEvent event) {
    if (event.type == 'ping') return;
    dynamic data;
    try {
      data = jsonDecode(event.data);
    } catch (_) {
      data = {'raw': event.data};
    }
    _events.add(SseEvent(type: event.type, data: data, id: event.id));
  }

  void _touchIdle() {
    _idleTimer?.cancel();
    _idleTimer = Timer(idleTimeout, () => _onFailure(TimeoutException('SSE idle', idleTimeout)));
  }

  void _closeStream() {
    _idleTimer?.cancel();
    _subscription?.cancel();
    _subscription = null;
    _cancelToken?.cancel();
    _cancelToken = null;
  }

  void _onFailure(Object? error) {
    _closeStream();
    if (_disposed || !_wantsConnection) return;
    if (isUnauthorized(error)) {
      _setState(SseConnectionState.unauthorized);
      return;
    }
    _setState(SseConnectionState.reconnecting);
    _reconnectTimer?.cancel();
    _reconnectTimer = Timer(backoffFor(_attempt, random: _random), connect);
    _attempt++;
  }

  /// 再接続までの待ち時間。1秒から倍々で30秒まで伸ばし、揺らぎを足して一斉再接続を避ける。
  ///
  /// @param attempt - 連続失敗回数（0始まり） / 何回目の再接続か
  /// @returns 待ち時間 / バックオフ時間
  static Duration backoffFor(int attempt, {Random? random}) {
    final exponent = min(max(attempt, 0), 5);
    final base = min(_initialBackoff.inMilliseconds * (1 << exponent), _maxBackoff.inMilliseconds);
    final jitter = ((random ?? Random()).nextDouble() * base * 0.2).round();
    return Duration(milliseconds: min(base + jitter, _maxBackoff.inMilliseconds));
  }

  /// バックエンドがトークン不一致で拒否したか（rapitas-backend の local-auth は 401 を返す）。
  ///
  /// @param error - 接続時の例外 / 発生したエラー
  /// @returns 再試行しても直らない認証エラーなら true / 認証エラーか
  static bool isUnauthorized(Object? error) {
    if (error is DioException) {
      final status = error.response?.statusCode;
      return status == 401 || status == 403;
    }
    return false;
  }

  /// 接続を切る（設定変更時やアプリ終了時）。
  void disconnect() {
    _wantsConnection = false;
    _reconnectTimer?.cancel();
    _closeStream();
    _setState(SseConnectionState.idle);
  }

  void _setState(SseConnectionState next) {
    if (_state == next || _states.isClosed) return;
    _state = next;
    _states.add(next);
  }

  void dispose() {
    disconnect();
    _disposed = true;
    _events.close();
    _states.close();
  }
}

class SseEvent {
  final String type;
  final dynamic data;

  /// バックエンドが付けたイベント ID
  final String? id;

  SseEvent({required this.type, required this.data, this.id});
}
