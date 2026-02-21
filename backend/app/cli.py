from __future__ import annotations

import os
import threading
import time
import webbrowser

import uvicorn

from app.main import app as fastapi_app


def _to_int(value: str, default: int) -> int:
    try:
        return int(value)
    except ValueError:
        return default


def main() -> None:
    host = os.getenv("DNS_SPEED_LAB_HOST", "127.0.0.1")
    port = _to_int(os.getenv("DNS_SPEED_LAB_PORT", "8000"), 8000)
    open_browser = os.getenv("DNS_SPEED_LAB_OPEN_BROWSER", "1").strip().lower() in {"1", "true", "yes"}

    if open_browser:

        def _open() -> None:
            time.sleep(1)
            webbrowser.open(f"http://{host}:{port}")

        threading.Thread(target=_open, daemon=True).start()

    uvicorn.run(fastapi_app, host=host, port=port, reload=False)


if __name__ == "__main__":
    main()
