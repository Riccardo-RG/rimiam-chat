"""Render one bounded PDF page as an inert JPEG. The original enters on stdin."""
import os
import resource
import sys

resource.setrlimit(resource.RLIMIT_CPU, (4, 4))
resource.setrlimit(resource.RLIMIT_NOFILE, (128, 128))
if sys.platform.startswith("linux"):
    resource.setrlimit(resource.RLIMIT_AS, (256 << 20, 256 << 20))

os.execvp("pdftoppm", [
    "pdftoppm", "-f", "1", "-l", "1", "-singlefile", "-scale-to", "1000",
    "-jpeg", "-jpegopt", "quality=74", "-",
])
