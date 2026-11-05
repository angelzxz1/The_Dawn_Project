//! What the plugin tests share: dawn-test-plugin's library, built, and
//! laid out as this system keeps CLAP files.

#![allow(dead_code)]

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::OnceLock;

/// dawn-test-plugin's library, built (once) in a target folder of its
/// own, so this doesn't wait on the build running the tests.
pub fn test_plugin() -> &'static Path {
    static BUILT: OnceLock<PathBuf> = OnceLock::new();
    BUILT.get_or_init(|| {
        let workspace = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        let target = workspace.join("target").join("test-plugin");
        let status = Command::new(env!("CARGO"))
            .args(["build", "--quiet", "-p", "dawn-test-plugin", "--target-dir"])
            .arg(&target)
            .current_dir(&workspace)
            .status()
            .expect("cargo runs");
        assert!(status.success(), "dawn-test-plugin builds");
        let name = format!(
            "{}dawn_test_plugin{}",
            std::env::consts::DLL_PREFIX,
            std::env::consts::DLL_SUFFIX
        );
        target.join("debug").join(name)
    })
}

pub fn info_plist(bundle: &Path, executable: &str) {
    let plist = format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>{executable}</string>
<key>CFBundleIdentifier</key><string>com.dawn-project.test.{}</string>
<key>CFBundlePackageType</key><string>BNDL</string>
</dict></plist>
"#,
        executable.replace(' ', "-").to_lowercase()
    );
    std::fs::write(bundle.join("Contents").join("Info.plist"), plist).unwrap();
}

/// Lays the library out as a CLAP file (a bundle, on macOS) named `name`.
pub fn clap_file(folder: &Path, name: &str) -> PathBuf {
    let path = folder.join(format!("{name}.clap"));
    if cfg!(target_os = "macos") {
        let binary_folder = path.join("Contents").join("MacOS");
        std::fs::create_dir_all(&binary_folder).unwrap();
        std::fs::copy(test_plugin(), binary_folder.join(name)).unwrap();
        info_plist(&path, name);
    } else {
        std::fs::copy(test_plugin(), &path).unwrap();
    }
    path
}
