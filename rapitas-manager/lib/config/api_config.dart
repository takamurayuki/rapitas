class ApiConfig {
  static const String defaultBaseUrl = 'http://localhost:3001';
  static const Duration connectTimeout = Duration(seconds: 10);
  static const Duration receiveTimeout = Duration(seconds: 30);
  static const String sseStreamPath = '/events/stream';

  String _baseUrl;

  ApiConfig({String? baseUrl}) : _baseUrl = baseUrl ?? defaultBaseUrl;

  String get baseUrl => _baseUrl;

  set baseUrl(String url) {
    _baseUrl = url.endsWith('/') ? url.substring(0, url.length - 1) : url;
  }

  String get sseUrl => '$_baseUrl$sseStreamPath';
}
