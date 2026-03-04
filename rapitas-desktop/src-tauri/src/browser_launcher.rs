#[cfg(target_os = "windows")]
use std::process::Command;

#[cfg(target_os = "windows")]
pub fn launch_browser_with_size(
    url: &str,
    x: i32,
    y: i32,
    width: i32,
    height: i32,
) -> Result<(), String> {
    // デフォルトブラウザのパスを取得
    let browser_result = get_default_browser();

    if let Ok(browser_path) = browser_result {
        let browser_name = browser_path.to_lowercase();

        if browser_name.contains("chrome") || browser_name.contains("msedge") {
            // Chrome/Edge: 既存のブラウザインスタンスで新しいタブとして開く
            // --new-tabフラグを使用して同じブラウザ内で開く
            Command::new(&browser_path)
                .args(&[
                    "--new-tab",
                    &format!("--window-position={},{}", x, y),
                    &format!("--window-size={},{}", width, height),
                    "--force-device-scale-factor=1",
                    url,
                ])
                .spawn()
                .map_err(|e| format!("ブラウザ起動失敗: {}", e))?;
        } else if browser_name.contains("firefox") {
            // Firefox: 新しいタブとして開く
            Command::new(&browser_path)
                .args(&[
                    "-new-tab",
                    "-width",
                    &width.to_string(),
                    "-height",
                    &height.to_string(),
                    url,
                ])
                .spawn()
                .map_err(|e| format!("ブラウザ起動失敗: {}", e))?;
        } else {
            // その他のブラウザ
            Command::new(&browser_path)
                .arg(url)
                .spawn()
                .map_err(|e| format!("ブラウザ起動失敗: {}", e))?;
        }
    } else {
        // デフォルトブラウザが見つからない場合は標準の方法で開く
        open::that(url).map_err(|e| format!("ブラウザ起動失敗: {}", e))?;
    }

    Ok(())
}

#[cfg(target_os = "windows")]
fn get_default_browser() -> Result<String, String> {
    use std::ffi::{OsStr, OsString};
    use std::os::windows::ffi::{OsStrExt, OsStringExt};
    use std::ptr;
    use winapi::um::shellapi::FindExecutableW;

    // HTTP URLに関連付けられた実行ファイルを検索
    let url_wide: Vec<u16> = OsStr::new("http://example.com")
        .encode_wide()
        .chain(Some(0))
        .collect();

    let mut exe_path: [u16; 260] = [0; 260];

    unsafe {
        let result = FindExecutableW(url_wide.as_ptr(), ptr::null(), exe_path.as_mut_ptr());

        if result as usize > 32 {
            let len = exe_path
                .iter()
                .position(|&c| c == 0)
                .unwrap_or(exe_path.len());
            let path = OsString::from_wide(&exe_path[..len]);
            Ok(path.to_string_lossy().to_string())
        } else {
            // レジストリから直接取得を試みる
            get_browser_from_registry()
        }
    }
}

#[cfg(target_os = "windows")]
fn get_browser_from_registry() -> Result<String, String> {
    use std::ffi::{OsStr, OsString};
    use std::os::windows::ffi::{OsStrExt, OsStringExt};
    use std::ptr;
    use winapi::shared::minwindef::{DWORD, HKEY};
    use winapi::um::winreg::{RegOpenKeyExW, RegQueryValueExW, HKEY_CURRENT_USER};

    unsafe {
        let key_path = OsStr::new(
            r"Software\Microsoft\Windows\Shell\Associations\UrlAssociations\http\UserChoice",
        )
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<u16>>();

        let mut hkey: HKEY = ptr::null_mut();
        let result = RegOpenKeyExW(
            HKEY_CURRENT_USER,
            key_path.as_ptr(),
            0,
            0x20019, // KEY_READ
            &mut hkey,
        );

        if result != 0 {
            return Err("レジストリキーを開けませんでした".to_string());
        }

        let value_name = OsStr::new("ProgId")
            .encode_wide()
            .chain(Some(0))
            .collect::<Vec<u16>>();

        let mut buffer: [u16; 256] = [0; 256];
        let mut size: DWORD = (buffer.len() * 2) as DWORD;

        let result = RegQueryValueExW(
            hkey,
            value_name.as_ptr(),
            ptr::null_mut(),
            ptr::null_mut(),
            buffer.as_mut_ptr() as *mut u8,
            &mut size,
        );

        winapi::um::winreg::RegCloseKey(hkey);

        if result != 0 {
            return Err("ProgIdを取得できませんでした".to_string());
        }

        let len = buffer.iter().position(|&c| c == 0).unwrap_or(buffer.len());
        let prog_id = OsString::from_wide(&buffer[..len]);
        let prog_id_str = prog_id.to_string_lossy().to_string();

        // ProgIdからブラウザパスを推定
        if prog_id_str.contains("Chrome") {
            Ok(r"C:\Program Files\Google\Chrome\Application\chrome.exe".to_string())
        } else if prog_id_str.contains("Edge") {
            Ok(r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe".to_string())
        } else if prog_id_str.contains("Firefox") {
            Ok(r"C:\Program Files\Mozilla Firefox\firefox.exe".to_string())
        } else {
            Err("サポートされていないブラウザです".to_string())
        }
    }
}

#[cfg(not(target_os = "windows"))]
#[allow(dead_code)]
pub fn launch_browser_with_size(
    url: &str,
    _x: i32,
    _y: i32,
    _width: i32,
    _height: i32,
) -> Result<(), String> {
    // Windows以外の環境では通常の方法で開く
    open::that(url).map_err(|e| format!("ブラウザ起動失敗: {}", e))
}
