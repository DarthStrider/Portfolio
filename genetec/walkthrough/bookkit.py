"""Shared helpers for the line-by-line walkthrough PDFs (ReportLab, DejaVu fonts).

Code listings are read from the real files and located by anchor strings, so line numbers are
computed at build time and stay correct when a file changes. A missing anchor stops the build.
"""
import math, os, re
from reportlab.lib.pagesizes import letter
from reportlab.lib import colors
from reportlab.lib.units import inch
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.fonts import addMapping
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer, PageBreak, Table,
                                TableStyle, KeepTogether, CondPageBreak)
from reportlab.platypus.tableofcontents import TableOfContents
from reportlab.graphics.shapes import Drawing, Rect, String, Line, Polygon

F = "/usr/share/fonts/truetype/dejavu/"
for name, file in [("Sans", "DejaVuSans.ttf"), ("Sans-Bold", "DejaVuSans-Bold.ttf"), ("Sans-Oblique", "DejaVuSans-Oblique.ttf"),
                   ("Sans-BoldOblique", "DejaVuSans-BoldOblique.ttf"), ("Mono", "DejaVuSansMono.ttf"), ("Mono-Bold", "DejaVuSansMono-Bold.ttf")]:
    pdfmetrics.registerFont(TTFont(name, F + file))
addMapping("Sans", 0, 0, "Sans"); addMapping("Sans", 1, 0, "Sans-Bold"); addMapping("Sans", 0, 1, "Sans-Oblique"); addMapping("Sans", 1, 1, "Sans-BoldOblique")
addMapping("Mono", 0, 0, "Mono"); addMapping("Mono", 1, 0, "Mono-Bold"); addMapping("Mono", 0, 1, "Mono"); addMapping("Mono", 1, 1, "Mono-Bold")

INK = colors.HexColor("#1b2430"); MUTED = colors.HexColor("#5d6b78"); RULE = colors.HexColor("#d5dde5")
SOFT = colors.HexColor("#f1f4f7"); NOTEBG = colors.HexColor("#fdf5dc")
LANG = {
    "cs": ("C#", "#7a3e9d"), "xaml": ("XAML", "#1f6fb8"), "sql": ("SQL", "#b5541c"), "json": ("JSON", "#5d6b78"),
    "ts": ("TypeScript", "#2f74c0"), "tsx": ("TSX", "#2f74c0"), "css": ("CSS", "#8a5a2b"), "yaml": ("YAML", "#8a6a2f"),
    "xml": ("MSBuild", "#5d6b78"), "docker": ("Dockerfile", "#1d63ed"), "conf": ("nginx", "#2f8a3a"), "sh": ("Shell", "#3d4b57"),
    "html": ("HTML", "#c2410c"),
}


class Book:
    def __init__(self, root, accent="#1f4e79", highlight="#e8a33d"):
        self.root = root
        self.story = []
        self.cache = {}
        self.ACC = colors.HexColor(accent)
        self.HIL = colors.HexColor(highlight)
        b = ParagraphStyle("body", fontName="Sans", fontSize=9.8, leading=14.3, textColor=INK, spaceAfter=6.5)
        self.s = {
            "body": b,
            "small": ParagraphStyle("small", parent=b, fontSize=8.4, leading=11.6, textColor=MUTED),
            "cell": ParagraphStyle("cell", parent=b, fontSize=8.5, leading=11.6, spaceAfter=0),
            "cellb": ParagraphStyle("cellb", parent=b, fontName="Sans-Bold", fontSize=8.5, leading=11.6, spaceAfter=0),
            "part": ParagraphStyle("part", fontName="Sans-Bold", fontSize=26, leading=31, textColor=self.ACC, spaceAfter=12),
            "h1": ParagraphStyle("h1", fontName="Sans-Bold", fontSize=16, leading=21, textColor=self.ACC, spaceBefore=4, spaceAfter=8, keepWithNext=1),
            "h2": ParagraphStyle("h2", fontName="Sans-Bold", fontSize=11.5, leading=15.5, textColor=INK, spaceBefore=9, spaceAfter=4, keepWithNext=1),
            "bullet": ParagraphStyle("bullet", parent=b, leftIndent=13, bulletIndent=2, spaceAfter=3),
            "note": ParagraphStyle("note", parent=b, leftIndent=62, firstLineIndent=-62, spaceAfter=4.5),
            "code": ParagraphStyle("code", fontName="Mono", fontSize=7.3, leading=9.4, textColor=INK),
            "callout": ParagraphStyle("callout", parent=b, backColor=NOTEBG, borderPadding=(7, 9, 7, 9),
                                      leftIndent=9, rightIndent=9, spaceBefore=5, spaceAfter=12),
            "q": ParagraphStyle("q", parent=b, fontName="Sans-Bold", spaceAfter=2.5, keepWithNext=1),
            "toc0": ParagraphStyle("t0", fontName="Sans-Bold", fontSize=10, leading=15, textColor=self.ACC, spaceBefore=4),
            "toc1": ParagraphStyle("t1", fontName="Sans", fontSize=9, leading=12, leftIndent=16, textColor=INK),
        }

    # ---------------- text ----------------
    def P(self, t, style="body"): self.story.append(Paragraph(t, self.s[style]))

    def H1(self, t):
        self.story.append(CondPageBreak(2.2 * inch))
        self.story.append(Heading(t, self.s["h1"], 1))

    def H2(self, t): self.story.append(Paragraph(t, self.s["h2"]))

    def B(self, items):
        for i in items:
            self.story.append(Paragraph(i, self.s["bullet"], bulletText="•"))
        self.story.append(Spacer(1, 3))

    def CALL(self, t): self.story.append(Paragraph(t, self.s["callout"]))

    def PART(self, label, title, intro):
        self.story.append(PageBreak()); self.story.append(Spacer(1, 1.6 * inch))
        self.story.append(Paragraph(label, ParagraphStyle("pn", parent=self.s["body"], fontSize=12, textColor=MUTED)))
        self.story.append(Heading(title, self.s["part"], 0))
        self.P(intro)
        self.story.append(PageBreak())

    def T(self, rows, widths):
        data = [[Paragraph(c, self.s["cellb"] if r == 0 else self.s["cell"]) for c in row] for r, row in enumerate(rows)]
        t = Table(data, colWidths=[w * inch for w in widths], repeatRows=1)
        t.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LINEBELOW", (0, 0), (-1, -1), 0.5, RULE),
                               ("LINEBELOW", (0, 0), (-1, 0), 1, self.ACC), ("BACKGROUND", (0, 0), (-1, 0), SOFT),
                               ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                               ("LEFTPADDING", (0, 0), (-1, -1), 4), ("RIGHTPADDING", (0, 0), (-1, -1), 4)]))
        self.story.append(t); self.story.append(Spacer(1, 9))

    def QA(self, q, a):
        self.story.append(KeepTogether([Paragraph(q, self.s["q"]), Paragraph(a, self.s["body"])]))

    def EX(self, title, text, hint):
        self.story.append(KeepTogether([
            Paragraph(f"<b>{title}</b>", self.s["q"]), Paragraph(text, self.s["body"]),
            Paragraph(f"<i>Hint.</i> {hint}", self.s["small"]), Spacer(1, 6)]))

    def page_break(self): self.story.append(PageBreak())
    def space(self, h=8): self.story.append(Spacer(1, h))

    # ---------------- source ----------------
    def src(self, path):
        if path not in self.cache:
            with open(os.path.join(self.root, path), encoding="utf-8") as f:
                self.cache[path] = f.read().rstrip("\n").split("\n")
        return self.cache[path]

    def ln(self, path, needle, after=1):
        """1-based number of the first line containing needle, at or after line `after`."""
        for i, line in enumerate(self.src(path)[after - 1:], start=after):
            if needle in line:
                return i
        raise SystemExit(f"anchor not found in {path}: {needle!r}")

    def block_end(self, path, start):
        """The line where the brace block opened on or after `start` closes."""
        depth, opened = 0, False
        for i, line in enumerate(self.src(path)[start - 1:], start=start):
            stripped = re.sub(r'"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'|`[^`]*`', "", line).split("//")[0]
            for ch in stripped:
                if ch == "{": depth += 1; opened = True
                elif ch == "}": depth -= 1
            if opened and depth == 0:
                return i
        return len(self.src(path))

    def listing(self, path, a, b, lang):
        lines = self.src(path)[a - 1:b]
        maxc = 96
        rows = []
        for n, line in enumerate(lines, start=a):
            line = line.replace("\t", "    ")
            first = True
            while True:
                chunk, line = line[:maxc], line[maxc:]
                text = f"<font color='#94a3b0'>{(str(n) if first else ''):>4}</font>  {esc(chunk)}"
                rows.append(Paragraph(text.replace(" ", "&nbsp;").replace("<font&nbsp;color=", "<font color="), self.s["code"]))
                first = False
                if not line:
                    break
                line = "      " + line
        name, color = LANG[lang]
        head = Paragraph(f"<font color='{color}'><b>{name}</b></font>  <font color='#5d6b78'>{esc(path)}, "
                         f"{'line' if a == b else 'lines'} {a}{'' if a == b else '–' + str(b)}</font>", self.s["small"])
        t = Table([[r] for r in rows], colWidths=[6.75 * inch])
        t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), SOFT), ("LEFTPADDING", (0, 0), (-1, -1), 7),
                               ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
                               ("TOPPADDING", (0, 0), (-1, 0), 6), ("BOTTOMPADDING", (0, -1), (-1, -1), 6),
                               ("LINEBEFORE", (0, 0), (0, -1), 2.5, colors.HexColor(color))]))
        self.story.append(CondPageBreak(1.1 * inch))
        self.story.append(head); self.story.append(Spacer(1, 2)); self.story.append(t); self.story.append(Spacer(1, 8))
        return a, b

    def code(self, path, start, lang, end=None, after=1, doc=True):
        """From the line containing `start` to the line containing `end` (or, without `end`, to the
        close of the brace block that starts there). Doc comments directly above are included."""
        a = self.ln(path, start, after)
        b = self.ln(path, end, a) if end else self.block_end(path, a)
        if doc:
            while a > 1 and self.src(path)[a - 2].strip().startswith(("//", "///", "*", "/**", "#", "--", "<!--")):
                a -= 1
        return self.listing(path, a, b, lang)

    def whole(self, path, lang):
        return self.listing(path, 1, len(self.src(path)), lang)

    def lines(self, path, a, b, lang): return self.listing(path, a, b, lang)

    def notes(self, path, items):
        """items: (needle or (needle, needle2), text). The line references are resolved from the file."""
        for ref, text in items:
            if isinstance(ref, tuple):
                x = self.ln(path, ref[0]); y = self.ln(path, ref[1], x)
                label = f"Lines {x}–{y}" if y != x else f"Line {x}"
            else:
                label = f"Line {self.ln(path, ref)}"
            self.story.append(Paragraph(f"<b>{label}</b>&nbsp;&nbsp;{text}", self.s["note"]))
        self.story.append(Spacer(1, 6))

    # ---------------- diagrams ----------------
    def box(self, d, x, y, w, h, title, lines, col=None):
        col = col or self.ACC
        d.add(Rect(x, y, w, h, rx=5, ry=5, fillColor=colors.white, strokeColor=col, strokeWidth=1.2))
        d.add(Rect(x, y + h - 4, w, 4, fillColor=col, strokeColor=col, strokeWidth=0))
        d.add(String(x + w / 2, y + h - 17, title, fontName="Sans-Bold", fontSize=8.5, fillColor=INK, textAnchor="middle"))
        for i, s in enumerate(lines):
            d.add(String(x + w / 2, y + h - 29 - i * 10, s, fontName="Sans", fontSize=7, fillColor=MUTED, textAnchor="middle"))

    def arrow(self, d, x1, y1, x2, y2, col=MUTED, dash=None, label=None):
        d.add(Line(x1, y1, x2, y2, strokeColor=col, strokeWidth=0.9, strokeDashArray=dash))
        a = math.atan2(y2 - y1, x2 - x1)
        d.add(Polygon([x2, y2, x2 - 5.5 * math.cos(a - 0.4), y2 - 5.5 * math.sin(a - 0.4),
                       x2 - 5.5 * math.cos(a + 0.4), y2 - 5.5 * math.sin(a + 0.4)], fillColor=col, strokeColor=col))
        if label:
            d.add(String((x1 + x2) / 2 + 4, (y1 + y2) / 2 + 3, label, fontName="Sans", fontSize=6.5, fillColor=col))

    def figure(self, d, caption):
        self.story.append(KeepTogether([d, Paragraph(caption, self.s["small"]), Spacer(1, 8)]))

    # ---------------- front matter and build ----------------
    def cover(self, title, subtitle, lead, parts):
        self.story.append(Spacer(1, 1.4 * inch))
        self.story.append(Paragraph(title, ParagraphStyle("t", fontName="Sans-Bold", fontSize=36, leading=42, textColor=self.ACC)))
        self.story.append(Paragraph(subtitle, ParagraphStyle("st", fontName="Sans", fontSize=15, leading=21, textColor=INK, spaceAfter=18)))
        self.story.append(Paragraph(lead, ParagraphStyle("lead", parent=self.s["body"], fontSize=11, leading=16)))
        self.space(0.35 * inch)
        self.T([["Part", "What it covers"]] + parts, [1.95, 4.8])
        self.P("Every code listing shows the real file and its real line numbers. The notes under a listing refer to "
               "those numbers, so you can read the book with the project open beside it.", "small")
        self.page_break()
        self.story.append(Paragraph("Contents", self.s["h1"]))
        toc = TableOfContents(); toc.levelStyles = [self.s["toc0"], self.s["toc1"]]; toc.dotsMinLevel = 0
        self.story.append(toc)

    def build(self, out, title, footer):
        book = self

        class Doc(BaseDocTemplate):
            def __init__(self, path):
                super().__init__(path, pagesize=letter, leftMargin=0.85 * inch, rightMargin=0.85 * inch,
                                 topMargin=0.8 * inch, bottomMargin=0.8 * inch, title=title, author="Kyle Gartner")
                frame = Frame(self.leftMargin, self.bottomMargin, self.width, self.height, id="f")
                self.addPageTemplates([PageTemplate("p", [frame], onPage=self.decorate)])
                self._n = 0

            def decorate(self, c, doc):
                if doc.page == 1:
                    c.saveState(); c.setFillColor(book.ACC); c.rect(0, letter[1] - 0.32 * inch, letter[0], 0.32 * inch, stroke=0, fill=1)
                    c.setFillColor(book.HIL); c.rect(0, letter[1] - 0.36 * inch, letter[0], 0.04 * inch, stroke=0, fill=1); c.restoreState()
                    return
                c.saveState(); c.setFont("Sans", 7.5); c.setFillColor(MUTED)
                c.drawString(0.85 * inch, 0.5 * inch, footer)
                c.drawRightString(letter[0] - 0.85 * inch, 0.5 * inch, str(doc.page)); c.restoreState()

            def afterFlowable(self, fl):
                if isinstance(fl, Heading):
                    self.notify("TOCEntry", (fl.toc_level, fl.toc_text, self.page))
                    self._n += 1
                    key = f"h{self._n}"
                    self.canv.bookmarkPage(key)
                    self.canv.addOutlineEntry(fl.toc_text, key, level=fl.toc_level, closed=fl.toc_level == 0)

        os.makedirs(os.path.dirname(out), exist_ok=True)
        Doc(out).multiBuild(self.story)
        print("wrote", out)


class Heading(Paragraph):
    def __init__(self, text, style, level):
        super().__init__(text, style)
        self.toc_level = level
        self.toc_text = re.sub("<[^>]+>", "", text)


def esc(s): return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def M(s):
    """Inline code: monospace, escaped."""
    return f"<font face='Mono' size='8.6'>{esc(s)}</font>"
