class ApprovalRequest {
  final String id;
  final String? configId;
  final String? requestType;
  final String title;
  final String? description;
  final Map<String, dynamic>? proposedChanges;
  final String status; // pending, approved, rejected, expired
  final DateTime? expiresAt;
  final DateTime? approvedAt;
  final DateTime? rejectedAt;
  final String? rejectionReason;
  final DateTime createdAt;

  ApprovalRequest({
    required this.id,
    this.configId,
    this.requestType,
    required this.title,
    this.description,
    this.proposedChanges,
    this.status = 'pending',
    this.expiresAt,
    this.approvedAt,
    this.rejectedAt,
    this.rejectionReason,
    required this.createdAt,
  });

  factory ApprovalRequest.fromJson(Map<String, dynamic> json) {
    return ApprovalRequest(
      id: json['id'] as String,
      configId: json['configId'] as String?,
      requestType: json['requestType'] as String?,
      title: json['title'] as String,
      description: json['description'] as String?,
      proposedChanges: json['proposedChanges'] != null
          ? Map<String, dynamic>.from(json['proposedChanges'] as Map)
          : null,
      status: json['status'] as String? ?? 'pending',
      expiresAt: json['expiresAt'] != null
          ? DateTime.parse(json['expiresAt'] as String)
          : null,
      approvedAt: json['approvedAt'] != null
          ? DateTime.parse(json['approvedAt'] as String)
          : null,
      rejectedAt: json['rejectedAt'] != null
          ? DateTime.parse(json['rejectedAt'] as String)
          : null,
      rejectionReason: json['rejectionReason'] as String?,
      createdAt: DateTime.parse(json['createdAt'] as String),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'configId': configId,
      'requestType': requestType,
      'title': title,
      'description': description,
      'proposedChanges': proposedChanges,
      'status': status,
      'expiresAt': expiresAt?.toIso8601String(),
      'approvedAt': approvedAt?.toIso8601String(),
      'rejectedAt': rejectedAt?.toIso8601String(),
      'rejectionReason': rejectionReason,
      'createdAt': createdAt.toIso8601String(),
    };
  }

  bool get isPending => status == 'pending';
  bool get isApproved => status == 'approved';
  bool get isRejected => status == 'rejected';
  bool get isExpired => status == 'expired';
}
