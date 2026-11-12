"""Builds "Four Snacks, Line by Line" (genetec-snacks-book.pdf) from the real source files.

Run from anywhere: python3 genetec/walkthrough/build_walkthrough.py  (needs reportlab and the DejaVu fonts).
Line numbers are computed from the files at build time, so rebuild after changing the code.
"""
import os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from bookkit import Book  # noqa: E402
import part0_intro, part1_camera_monitor, part2_access_log, part3_plugins, part4_dashboard, part5_ci  # noqa: E402

ONLY = set(sys.argv[1:])  # e.g. "1" builds only part 1, for drafting

book = Book(os.path.dirname(HERE), accent="#1f4e79", highlight="#e8a33d")
parts = [part0_intro, part1_camera_monitor, part2_access_log, part3_plugins, part4_dashboard, part5_ci]
part0_intro.front(book)
for i, part in enumerate(parts):
    if not ONLY or str(i) in ONLY:
        part.write(book)
book.build(os.path.join(HERE, "genetec-snacks-book.pdf"), "Four Snacks, Line by Line — Genetec", "Four Snacks, Line by Line")
