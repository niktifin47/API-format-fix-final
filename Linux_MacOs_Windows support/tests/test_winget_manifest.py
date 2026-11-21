import hashlib
import subprocess
import sys
from pathlib import Path


def test_winget_manifest_contains_release_url_and_asset_hash(tmp_path: Path):
    asset = tmp_path / "api-format-fix-windows-x64.zip"
    asset.write_bytes(b"test release asset")
    output = tmp_path / "manifests"
    script = Path(__file__).parents[1] / "scripts" / "create_winget_manifests.py"

    subprocess.run(
        [
            sys.executable,
            str(script),
            "--version",
            "0.1.0",
            "--asset",
            str(asset),
            "--release-url",
            "https://github.com/niktifin47/API-format-fix-final/releases/download/v0.1.0/api-format-fix-windows-x64.zip",
            "--output-dir",
            str(output),
        ],
        check=True,
        capture_output=True,
        text=True,
    )

    manifest = (
        output
        / "manifests"
        / "n"
        / "niktifin47"
        / "APIFormatFix"
        / "0.1.0"
        / "niktifin47.APIFormatFix.installer.yaml"
    )
    content = manifest.read_text(encoding="utf-8")
    assert (
        "https://github.com/niktifin47/API-format-fix-final/releases/download/v0.1.0/api-format-fix-windows-x64.zip"
        in content
    )
    assert hashlib.sha256(asset.read_bytes()).hexdigest().upper() in content
