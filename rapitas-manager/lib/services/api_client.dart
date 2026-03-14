import 'package:dio/dio.dart';
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
    _dio.interceptors.add(LogInterceptor(
      requestBody: true,
      responseBody: true,
    ));
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
