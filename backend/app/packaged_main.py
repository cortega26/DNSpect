"""PyInstaller entry point for the DNSpect packaged binary.

This module exists so that PyInstaller has a single-file entry point
that imports and runs the CLI. It is not used when running from source.
"""

from app.cli import main

if __name__ == "__main__":
    main()
