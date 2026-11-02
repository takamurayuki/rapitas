import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import '../config/api_config.dart';

class ApiClient {
  late final Dio _dio;
  final ApiConfig _config;

  ApiClient({required ApiConfig config}) : _config = config {
    _dio = Dio(BaseOptions(
      baseUrl: config.baseUrl,
      connectTimeout: ApiConfig.connectTimeout,
      receiveTimeout: ApiConfig.receiveTimeout,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    ));
    // NOTE(security): Bodies and headers are deliberately NOT logged, and the
    // interceptor is debug-only. It previously ran in release builds with
    // `requestBody: true, responseBody: true`, so any API key or token sent in
    // a request body — and every response body it came back in — was written in
    // plain text wherever Dart's logs are collected. This package's own
    // CLAUDE.md requires that raw keys never be exposed in the mobile app, and
    // the API-client pattern it documents uses a bare LogInterceptor (bodies
    // default to off). Method, path and status are what debugging a client
    // needs; the payload is not.
    if (kDebugMode) {
      _dio.interceptors.add(LogInterceptor(
        request: true,
        requestHeader: false,
        requestBody: false,
        responseHeader: false,
        responseBody: false,
      ));
    }
  }

  void updateBaseUrl(String baseUrl) {
    _config.baseUrl = baseUrl;
    _dio.options.baseUrl = _config.baseUrl;
  }

  Future<Response<T>> get<T>(
    String path, {
    Map<String, dynamic>? queryParameters,
  }) {
    return _dio.get<T>(path, queryParameters: queryParameters);
  }

  Future<Response<T>> post<T>(
    String path, {
    dynamic data,
    Map<String, dynamic>? queryParameters,
  }) {
    return _dio.post<T>(path, data: data, queryParameters: queryParameters);
  }

  Future<Response<T>> patch<T>(
    String path, {
    dynamic data,
  }) {
    return _dio.patch<T>(path, data: data);
  }

  Future<Response<T>> delete<T>(String path) {
    return _dio.delete<T>(path);
  }
}
