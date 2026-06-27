/**
 * GitHubPage
 *
 * Route entry for the GitHub integration overview. Thin orchestrator: wires the
 * dashboard data hook to the section sub-components and the add-integration modal.
 */
'use client';

import { useState } from 'react';
import { useGithubDashboard } from './_hooks/use-github-dashboard';
import {
  GitHubPageSkeleton,
  GitHubPageHeader,
  GitHubCliStatusBanner,
  GitHubRepoList,
  GitHubPrList,
  GitHubIssueList,
  AddIntegrationModal,
} from './_components';

export default function GitHubPage() {
  const {
    integrations,
    ghStatus,
    recentPRs,
    recentIssues,
    loading,
    syncing,
    fetchData,
    syncIntegration,
  } = useGithubDashboard();
  const [showAddModal, setShowAddModal] = useState(false);

  if (loading) {
    return <GitHubPageSkeleton />;
  }

  return (
    <div className="h-[calc(100vh-5rem)] overflow-auto bg-background scrollbar-thin">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <GitHubPageHeader onAdd={() => setShowAddModal(true)} />

        <GitHubCliStatusBanner status={ghStatus} />

        <GitHubRepoList
          integrations={integrations}
          syncing={syncing}
          onSync={syncIntegration}
          onAdd={() => setShowAddModal(true)}
        />

        <GitHubPrList pullRequests={recentPRs} />

        <GitHubIssueList issues={recentIssues} />

        {showAddModal && (
          <AddIntegrationModal
            onClose={() => setShowAddModal(false)}
            onSuccess={() => {
              setShowAddModal(false);
              fetchData();
            }}
          />
        )}
      </div>
    </div>
  );
}
