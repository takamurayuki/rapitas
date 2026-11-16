//! sidecar_job
//!
//! A Windows Job Object that kills every process in it when its last handle
//! closes (ADR-0010 phase 1). The backend sidecar is put in it right after it
//! starts; everything the backend then starts (agent CLIs, git, tsc, preview
//! dev servers) joins the job automatically, so quitting or crashing the app
//! ends them all — `kill_backend` alone only ever reached the sidecar itself.

use windows::Win32::Foundation::{CloseHandle, HANDLE};
use windows::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
    SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
};
use windows::Win32::System::Threading::{OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE};

/// A job whose processes are all terminated when it is dropped (or when this
/// process exits for any reason, since the OS then closes the handle).
pub struct KillOnCloseJob(HANDLE);

// SAFETY: a job handle is a kernel object handle; Win32 job APIs are thread-safe.
unsafe impl Send for KillOnCloseJob {}
unsafe impl Sync for KillOnCloseJob {}

impl KillOnCloseJob {
    /// Create an unnamed job with kill-on-close set.
    ///
    /// # Errors
    /// Returns the Win32 error when the job cannot be created or configured.
    /// / ジョブを作成・設定できない場合に Win32 エラーを返す。
    pub fn new() -> windows::core::Result<Self> {
        // SAFETY: no security attributes, unnamed job; the handle is owned by the returned value.
        let handle = unsafe { CreateJobObjectW(None, None)? };
        let job = Self(handle);
        let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        // SAFETY: `info` is a valid JOBOBJECT_EXTENDED_LIMIT_INFORMATION and outlives the call.
        unsafe {
            SetInformationJobObject(
                job.0,
                JobObjectExtendedLimitInformation,
                &info as *const _ as *const core::ffi::c_void,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )?;
        }
        Ok(job)
    }

    /// Put a running process (and so all its future descendants) in the job.
    ///
    /// # Arguments
    /// * `pid` - The process to contain / ジョブに入れるプロセスのID
    ///
    /// # Errors
    /// Returns the Win32 error when the process cannot be opened or assigned.
    /// / プロセスを開けない・割り当てられない場合に Win32 エラーを返す。
    pub fn assign_pid(&self, pid: u32) -> windows::core::Result<()> {
        // SAFETY: the process handle is closed below whether or not assignment succeeds.
        unsafe {
            let process = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, false, pid)?;
            let result = AssignProcessToJobObject(self.0, process);
            let _ = CloseHandle(process);
            result
        }
    }
}

impl Drop for KillOnCloseJob {
    fn drop(&mut self) {
        // SAFETY: the handle was created by CreateJobObjectW and is closed once.
        unsafe {
            let _ = CloseHandle(self.0);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::{Child, Command};
    use std::time::{Duration, Instant};
    use windows::Win32::Foundation::WAIT_TIMEOUT;
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
        TH32CS_SNAPPROCESS,
    };
    use windows::Win32::System::Threading::{WaitForSingleObject, PROCESS_SYNCHRONIZE};

    /// A parent (cmd) with a long-running grandchild-to-be (ping), like the
    /// backend with an agent CLI under it.
    // NOTE: The Child is returned and every caller waits on it; clippy only
    // sees this function, where the success path hands it over un-waited.
    #[allow(clippy::zombie_processes)]
    fn spawn_parent_with_child() -> (Child, u32) {
        let mut parent = Command::new("cmd")
            .args(["/c", "ping -n 60 127.0.0.1 >nul"])
            .spawn()
            .expect("spawn cmd");
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            if let Some(pid) = child_of(parent.id()) {
                return (parent, pid);
            }
            if Instant::now() >= deadline {
                let _ = parent.kill();
                let _ = parent.wait();
                panic!("ping never started under cmd");
            }
            std::thread::sleep(Duration::from_millis(50));
        }
    }

    fn child_of(parent_pid: u32) -> Option<u32> {
        // SAFETY: snapshot handle is closed before returning; entry is sized per the API.
        unsafe {
            let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0).ok()?;
            let mut entry = PROCESSENTRY32W {
                dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
                ..Default::default()
            };
            let mut found = None;
            if Process32FirstW(snapshot, &mut entry).is_ok() {
                loop {
                    if entry.th32ParentProcessID == parent_pid {
                        found = Some(entry.th32ProcessID);
                        break;
                    }
                    if Process32NextW(snapshot, &mut entry).is_err() {
                        break;
                    }
                }
            }
            let _ = CloseHandle(snapshot);
            found
        }
    }

    fn still_running(pid: u32) -> bool {
        // SAFETY: handle closed before returning.
        unsafe {
            let Ok(handle) = OpenProcess(PROCESS_SYNCHRONIZE, false, pid) else {
                return false;
            };
            let running = WaitForSingleObject(handle, 2000) == WAIT_TIMEOUT;
            let _ = CloseHandle(handle);
            running
        }
    }

    fn kill_pid(pid: u32) {
        let _ = Command::new("taskkill")
            .args(["/F", "/PID", &pid.to_string()])
            .output();
    }

    #[test]
    fn killing_only_the_parent_leaves_its_child_running() {
        // The behaviour before ADR-0010: kill_backend reached the sidecar only.
        let (mut parent, child) = spawn_parent_with_child();
        parent.kill().expect("kill parent");
        let _ = parent.wait();
        let orphaned = still_running(child);
        kill_pid(child);
        assert!(orphaned, "expected the child to outlive its killed parent");
    }

    #[test]
    fn closing_the_job_ends_the_parent_and_its_child() {
        let job = KillOnCloseJob::new().expect("create job");
        let (mut parent, child) = spawn_parent_with_child();
        job.assign_pid(parent.id()).expect("assign parent");
        // ping started before assignment, so put it in too — the backend's
        // children start long after it is assigned and join on their own.
        job.assign_pid(child).expect("assign child");

        drop(job);
        let parent_gone = parent.wait().is_ok();
        let child_gone = !still_running(child);
        if !child_gone {
            kill_pid(child);
        }
        assert!(
            parent_gone && child_gone,
            "job close left a process running"
        );
    }

    #[test]
    fn a_process_started_after_assignment_joins_the_job() {
        let job = KillOnCloseJob::new().expect("create job");
        // cmd waits 1s before starting ping, so ping starts inside the job.
        let mut parent = Command::new("cmd")
            .args(["/c", "ping -n 2 127.0.0.1 >nul & ping -n 60 127.0.0.1 >nul"])
            .spawn()
            .expect("spawn cmd");
        job.assign_pid(parent.id()).expect("assign parent");
        std::thread::sleep(Duration::from_millis(2500));
        let child = child_of(parent.id()).expect("second ping running under cmd");

        drop(job);
        let _ = parent.wait();
        let child_gone = !still_running(child);
        if !child_gone {
            kill_pid(child);
        }
        assert!(
            child_gone,
            "a descendant started after assignment survived the job"
        );
    }
}
