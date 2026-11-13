import argparse
import hashlib
import re
from pathlib import Path

PACKAGE_ID = "niktifin47.APIFormatFix"
MANIFEST_VERSION = "1.10.0"
REPOSITORY_URL = "https://github.com/niktifin47/API-format-fix-final"


def create_manifests(version: str, asset: Path, release_url: str, output_dir: Path) -> Path:
    if not re.fullmatch(r"\d+\.\d+\.\d+", version):
        raise ValueError("Version must use the semantic format MAJOR.MINOR.PATCH.")
    if not release_url.startswith("https://"):
        raise ValueError("The Winget installer URL must use HTTPS.")
    if not asset.is_file():
        raise FileNotFoundError(f"Windows release asset not found: {asset}")

    digest = hashlib.sha256()
    with asset.open("rb") as installer:
        for chunk in iter(lambda: installer.read(1024 * 1024), b""):
            digest.update(chunk)
    checksum = digest.hexdigest().upper()
    destination = output_dir / "manifests" / "n" / "niktifin47" / "APIFormatFix" / version
    destination.mkdir(parents=True, exist_ok=True)

    (destination / f"{PACKAGE_ID}.yaml").write_text(
        f"""PackageIdentifier: {PACKAGE_ID}
PackageVersion: {version}
DefaultLocale: en-US
ManifestType: version
ManifestVersion: {MANIFEST_VERSION}
""",
        encoding="utf-8",
    )
    (destination / f"{PACKAGE_ID}.installer.yaml").write_text(
        f"""PackageIdentifier: {PACKAGE_ID}
PackageVersion: {version}
Installers:
- Architecture: x64
  InstallerUrl: {release_url}
  InstallerSha256: {checksum}
  InstallerType: zip
  NestedInstallerType: portable
  NestedInstallerFiles:
  - RelativeFilePath: api-format-fix.exe
    PortableCommandAlias: api-format-fix
ManifestType: installer
ManifestVersion: {MANIFEST_VERSION}
""",
        encoding="utf-8",
    )
    (destination / f"{PACKAGE_ID}.locale.en-US.yaml").write_text(
        f"""PackageIdentifier: {PACKAGE_ID}
PackageVersion: {version}
PackageLocale: en-US
Publisher: niktifin47
PackageName: API Format Fix
License: BSD-3-Clause
ShortDescription: Extract and restyle text from common document formats.
PackageUrl: {REPOSITORY_URL}
ReleaseNotesUrl: {REPOSITORY_URL}/releases/tag/v{version}
ManifestType: defaultLocale
ManifestVersion: {MANIFEST_VERSION}
""",
        encoding="utf-8",
    )
    return destination


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate Winget manifests for a GitHub Release.")
    parser.add_argument("--version", required=True, help="Release version without the leading v")
    parser.add_argument("--asset", required=True, type=Path, help="Windows ZIP release asset")
    parser.add_argument("--release-url", required=True, help="Public HTTPS URL for the Windows ZIP")
    parser.add_argument("--output-dir", required=True, type=Path)
    args = parser.parse_args()
    print(create_manifests(args.version, args.asset, args.release_url, args.output_dir))


if __name__ == "__main__":
    main()
