"use client";

import { useState, useEffect } from "react";
import { ResumableExecutionsBanner } from "./ResumableExecutionsBanner";
import { API_BASE_URL } from "@/utils/api";

export function ResumableExecutionsWrapper() {
  const [autoResume, setAutoResume] = useState(false);
  const [isSettingsLoaded, setIsSettingsLoaded] = useState(false);

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/settings`);
        if (res.ok) {
          const data = await res.json();
          setAutoResume(data.autoResumeInterruptedTasks ?? false);
        }
      } catch (error) {
        console.error("Failed to fetch settings:", error);
      } finally {
        setIsSettingsLoaded(true);
      }
    };

    fetchSettings();
  }, []);

  // Wait for settings to load before rendering the banner
  if (!isSettingsLoaded) {
    return null;
  }

  return (
    <ResumableExecutionsBanner
      autoResume={autoResume}
      onAutoResumeComplete={() => {
        // Could show a notification that tasks were auto-resumed
        console.log("Auto-resume completed");
      }}
    />
  );
}
