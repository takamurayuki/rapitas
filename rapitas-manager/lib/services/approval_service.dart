import '../models/approval_request.dart';
import 'api_client.dart';

class ApprovalService {
  final ApiClient _client;

  ApprovalService(this._client);

  Future<List<ApprovalRequest>> getApprovals() async {
    final response = await _client.get('/approvals');
    final List<dynamic> data = response.data is List
        ? response.data
        : (response.data['approvals'] ?? []);
    return data.map((json) => ApprovalRequest.fromJson(json)).toList();
  }

  Future<ApprovalRequest> getApproval(String id) async {
    final response = await _client.get('/approvals/$id');
    return ApprovalRequest.fromJson(response.data);
  }

  Future<void> approve(String id) async {
    await _client.post('/approvals/$id/approve');
  }

  Future<void> reject(String id, {String? reason}) async {
    await _client.post('/approvals/$id/reject', data: {
      if (reason != null) 'reason': reason,
    });
  }
}
