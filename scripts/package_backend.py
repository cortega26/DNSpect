from __future__ import annotations

import os
import platform
import shutil
import subprocess
import sys
from pathlib import Path


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    frontend_dist = root / "frontend" / "dist"
    if not frontend_dist.exists():
        raise SystemExit(
            "frontend/dist no existe. Ejecuta primero: cd frontend && npm run build"
        )
    data_dir = root / "data"
    if not data_dir.exists():
        raise SystemExit("data/ no existe.")

    backend_entry = root / "backend" / "app" / "packaged_main.py"
    if not backend_entry.exists():
        raise SystemExit("No se encontró backend/app/packaged_main.py")

    target_os = platform.system().lower()
    if "windows" in target_os:
        artifact_name = "dns-speed-lab-windows"
    elif "linux" in target_os:
        artifact_name = "dns-speed-lab-linux"
    else:
        artifact_name = f"dns-speed-lab-{target_os}"

    dist_dir = root / "dist"
    build_dir = root / "build"
    if dist_dir.exists():
        shutil.rmtree(dist_dir)
    if build_dir.exists():
        shutil.rmtree(build_dir)

    add_data_frontend = f"{frontend_dist}{os.pathsep}frontend_dist"
    add_data_data = f"{data_dir}{os.pathsep}data"
    cmd = [
        sys.executable,
        "-m",
        "PyInstaller",
        "--noconfirm",
        "--clean",
        "--onefile",
        "--name",
        artifact_name,
        "--add-data",
        add_data_frontend,
        "--add-data",
        add_data_data,
        str(backend_entry),
    ]
    for hidden_import in ("backports", "backports.tarfile"):
        cmd.extend(["--hidden-import", hidden_import])

    subprocess.run(cmd, cwd=root, check=True)

    output_bin = dist_dir / (artifact_name + (".exe" if "windows" in target_os else ""))
    if not output_bin.exists():
        raise SystemExit(f"No se generó binario esperado: {output_bin}")

    release_dir = root / "release"
    if release_dir.exists():
        shutil.rmtree(release_dir)
    release_dir.mkdir(parents=True, exist_ok=True)

    bundle_dir = release_dir / artifact_name
    bundle_dir.mkdir(parents=True, exist_ok=True)
    shutil.copy2(output_bin, bundle_dir / output_bin.name)

    readme = bundle_dir / "README-RUN.txt"
    readme.write_text(
        """
DNS Speed Lab - Binario empaquetado

1) Ejecuta el binario.
2) Se levanta un servidor local en http://127.0.0.1:8000 (o DNS_SPEED_LAB_PORT).
3) Abre el navegador en esa URL si no se abre automáticamente.

Variables opcionales:
- DNS_SPEED_LAB_HOST (default 127.0.0.1)
- DNS_SPEED_LAB_PORT (default 8000)
- DNS_SPEED_LAB_OPEN_BROWSER (1/0)
""".strip()
        + "\n",
        encoding="utf-8",
    )

    archive_base = release_dir / artifact_name
    if "windows" in target_os:
        archive_path = shutil.make_archive(
            str(archive_base),
            "zip",
            root_dir=bundle_dir.parent,
            base_dir=bundle_dir.name,
        )
    else:
        archive_path = shutil.make_archive(
            str(archive_base),
            "gztar",
            root_dir=bundle_dir.parent,
            base_dir=bundle_dir.name,
        )

    print(f"Package ready: {archive_path}")


if __name__ == "__main__":
    main()
