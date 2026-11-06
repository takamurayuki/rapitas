import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/approval_request.dart';
import 'service_providers.dart';

final approvalListProvider = FutureProvider<List<ApprovalRequest>>((ref) async {
  final service = ref.watch(approvalServiceProvider);
  return service.getApprovals();
});
