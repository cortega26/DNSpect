from __future__ import annotations

import os
import threading
import time
import urllib.error
import urllib.request

from app.main import app as fastapi_app

HAS_GUI = False
try:
    import gi

    gi.require_version("Gtk", "3.0")
    gi.require_version("WebKit2", "4.1")
    from gi.repository import Gtk, WebKit2  # noqa: F401

    HAS_GUI = True
except (ImportError, ValueError):
    pass


def _to_int(value: str, default: int) -> int:
    try:
        return int(value)
    except ValueError:
        return default


def _wait_for_server(url: str, max_retries: int = 50, delay: float = 0.2) -> None:
    for _ in range(max_retries):
        try:
            with urllib.request.urlopen(url, timeout=0.5) as response:  # nosec B310
                if response.status == 200:
                    return
        except (urllib.error.URLError, OSError):
            pass
        time.sleep(delay)


def _start_server(host: str, port: int) -> None:
    import uvicorn

    config = uvicorn.Config(app=fastapi_app, host=host, port=port, log_level="info")
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()


def _start_native_gui(host: str, port: int) -> None:
    if not os.environ.get("DISPLAY") and not os.environ.get("WAYLAND_DISPLAY"):
        raise RuntimeError("No display available for native GUI")

    from gi.repository import GLib, Gtk, WebKit2

    GLib.set_prgname("io.github.cortega26.DNSpect")
    Gtk.Window.set_default_icon_name("io.github.cortega26.DNSpect")

    _start_server(host, port)
    _wait_for_server(f"http://{host}:{port}/api/health")

    win = Gtk.Window()
    win.set_title("DNSpect — DNS Resolver Benchmark")
    win.set_default_size(1100, 800)
    win.set_position(Gtk.WindowPosition.CENTER)

    webview = WebKit2.WebView()
    webview.load_uri(f"http://{host}:{port}")
    win.add(webview)

    win.connect("destroy", Gtk.main_quit)
    win.show_all()

    Gtk.main()


def _start_browser_mode(host: str, port: int) -> None:
    import webbrowser

    def _open() -> None:
        _wait_for_server(f"http://{host}:{port}/api/health")
        webbrowser.open(f"http://{host}:{port}")

    threading.Thread(target=_open, daemon=True).start()

    import uvicorn

    uvicorn.run(fastapi_app, host=host, port=port, reload=False)


def main() -> None:
    host = os.getenv("DNS_SPEED_LAB_HOST", "127.0.0.1")
    port = _to_int(os.getenv("DNS_SPEED_LAB_PORT", "8000"), 8000)

    gui = os.getenv("DNS_SPEED_LAB_GUI", "auto").strip().lower()
    open_browser = os.getenv("DNS_SPEED_LAB_OPEN_BROWSER", "").strip().lower()
    if open_browser in {"1", "true", "yes"}:
        gui = "browser"

    if gui == "headless":
        _start_server(host, port)
        _wait_for_server(f"http://{host}:{port}/api/health")
        print(f"DNSpect server running on http://{host}:{port}. Press Ctrl+C to stop.", flush=True)
        try:
            while True:
                time.sleep(3600)
        except KeyboardInterrupt:
            pass
        return

    if gui == "native" or (gui == "auto" and HAS_GUI):
        if not HAS_GUI:
            msg = "PyGObject/WebKit2 no están disponibles. Instala python3-gi y gir1.2-webkit2-4.1."
            raise RuntimeError(msg)
        try:
            _start_native_gui(host, port)
        except RuntimeError:
            if gui == "native":
                raise
            _start_browser_mode(host, port)
        return

    if gui == "browser" or (gui == "auto" and not HAS_GUI):
        _start_browser_mode(host, port)
        return

    msg = f"Valor inválido para DNS_SPEED_LAB_GUI: {gui!r}. Usa: auto, native, browser, headless"
    raise ValueError(msg)


if __name__ == "__main__":
    main()
