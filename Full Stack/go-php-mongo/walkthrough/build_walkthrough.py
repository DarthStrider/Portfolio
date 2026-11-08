"""Builds the Northline line-by-line walkthrough PDF from the real source files.

Run: python3 walkthrough/build_walkthrough.py  (needs reportlab and the DejaVu fonts).
Line numbers are computed from the files themselves (anchor strings), so they stay correct.
"""
import os, re, sys
from reportlab.lib.pagesizes import letter
from reportlab.lib import colors
from reportlab.lib.units import inch
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.fonts import addMapping
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer, PageBreak,
                                Table, TableStyle, Preformatted, KeepTogether, CondPageBreak, NextPageTemplate)
from reportlab.platypus.tableofcontents import TableOfContents
from reportlab.graphics.shapes import Drawing, Rect, String, Line, Polygon

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "walkthrough", "northline-walkthrough.pdf")

F = "/usr/share/fonts/truetype/dejavu/"
for name, file in [("Sans", "DejaVuSans.ttf"), ("Sans-Bold", "DejaVuSans-Bold.ttf"), ("Sans-Oblique", "DejaVuSans-Oblique.ttf"),
                   ("Sans-BoldOblique", "DejaVuSans-BoldOblique.ttf"), ("Mono", "DejaVuSansMono.ttf"), ("Mono-Bold", "DejaVuSansMono-Bold.ttf")]:
    pdfmetrics.registerFont(TTFont(name, F + file))
addMapping("Sans", 0, 0, "Sans"); addMapping("Sans", 1, 0, "Sans-Bold"); addMapping("Sans", 0, 1, "Sans-Oblique"); addMapping("Sans", 1, 1, "Sans-BoldOblique")
addMapping("Mono", 0, 0, "Mono"); addMapping("Mono", 1, 0, "Mono-Bold"); addMapping("Mono", 0, 1, "Mono"); addMapping("Mono", 1, 1, "Mono-Bold")

INK = colors.HexColor("#17262a"); SPRUCE = colors.HexColor("#1e3b36"); MOSS = colors.HexColor("#586b64")
LICHEN = colors.HexColor("#d3ddd8"); SOFT = colors.HexColor("#eef2f1"); BLAZE = colors.HexColor("#f2c230")
GO = colors.HexColor("#00758f"); PHP = colors.HexColor("#6c5aa6"); REACT = colors.HexColor("#1f8fbf"); MONGO = colors.HexColor("#3f8a3a"); INFRA = colors.HexColor("#8a6a2f")

body = ParagraphStyle("body", fontName="Sans", fontSize=9.8, leading=14.2, textColor=INK, spaceAfter=6.5)
small = ParagraphStyle("small", parent=body, fontSize=8.4, leading=11.5, textColor=MOSS)
cell = ParagraphStyle("cell", parent=body, fontSize=8.6, leading=11.6, spaceAfter=0)
cellb = ParagraphStyle("cellb", parent=cell, fontName="Sans-Bold")
part = ParagraphStyle("part", fontName="Sans-Bold", fontSize=26, leading=31, textColor=SPRUCE, spaceAfter=12)
h1 = ParagraphStyle("h1", fontName="Sans-Bold", fontSize=16, leading=21, textColor=SPRUCE, spaceBefore=4, spaceAfter=8, keepWithNext=1)
h2 = ParagraphStyle("h2", fontName="Sans-Bold", fontSize=11.5, leading=15.5, textColor=INK, spaceBefore=9, spaceAfter=4, keepWithNext=1)
bullet = ParagraphStyle("bullet", parent=body, leftIndent=13, bulletIndent=2, spaceAfter=3)
note = ParagraphStyle("note", parent=body, leftIndent=58, firstLineIndent=-58, spaceAfter=4.5)
code = ParagraphStyle("code", fontName="Mono", fontSize=7.3, leading=9.4, textColor=INK)
callout = ParagraphStyle("callout", parent=body, backColor=colors.HexColor("#f6f0d8"), borderPadding=(7, 9, 7, 9),
                         leftIndent=9, rightIndent=9, spaceBefore=5, spaceAfter=12)
qstyle = ParagraphStyle("q", parent=body, fontName="Sans-Bold", spaceAfter=2.5, keepWithNext=1)
tocs = [ParagraphStyle("t0", fontName="Sans-Bold", fontSize=10, leading=14.5, textColor=SPRUCE),
        ParagraphStyle("t1", fontName="Sans", fontSize=9, leading=12, leftIndent=16, textColor=INK)]

story = []


class Heading(Paragraph):
    def __init__(self, text, style, level):
        super().__init__(text, style)
        self.toc_level = level
        self.toc_text = re.sub("<[^>]+>", "", text)


def P(t, s=body): story.append(Paragraph(t, s))
def H1(t): story.append(CondPageBreak(2.2 * inch)); story.append(Heading(t, h1, 1))
def H2(t): story.append(Paragraph(t, h2))
def B(items):
    for i in items:
        story.append(Paragraph(i, bullet, bulletText="•"))
    story.append(Spacer(1, 3))
def PART(n, title, intro):
    story.append(PageBreak()); story.append(Spacer(1, 1.6 * inch))
    story.append(Paragraph(f"Part {n}", ParagraphStyle("pn", parent=body, fontSize=12, textColor=MOSS)))
    story.append(Heading(title, part, 0)); P(intro)
    story.append(PageBreak())
def CALL(t): story.append(Paragraph(t, callout))
def T(rows, widths):
    data = [[Paragraph(c, cellb if r == 0 else cell) for c in row] for r, row in enumerate(rows)]
    t = Table(data, colWidths=widths, repeatRows=1)
    t.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LINEBELOW", (0, 0), (-1, -1), 0.5, LICHEN),
                           ("LINEBELOW", (0, 0), (-1, 0), 1, SPRUCE), ("BACKGROUND", (0, 0), (-1, 0), SOFT),
                           ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                           ("LEFTPADDING", (0, 0), (-1, -1), 4), ("RIGHTPADDING", (0, 0), (-1, -1), 4)]))
    story.append(t); story.append(Spacer(1, 9))

# ---------------- source helpers ----------------
_cache = {}
def src(path):
    if path not in _cache:
        with open(os.path.join(ROOT, path)) as f:
            _cache[path] = f.read().split("\n")
    return _cache[path]

def ln(path, needle, after=1):
    """1-based line number of the first line containing needle, at or after line `after`."""
    for i, line in enumerate(src(path)[after - 1:], start=after):
        if needle in line:
            return i
    raise SystemExit(f"anchor not found in {path}: {needle!r}")

def block_end(path, start):
    """Line where the brace block opened on/after `start` closes."""
    depth, opened = 0, False
    for i, line in enumerate(src(path)[start - 1:], start=start):
        stripped = re.sub(r'"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'|`[^`]*`', "", line)
        stripped = stripped.split("//")[0]
        for ch in stripped:
            if ch == "{": depth += 1; opened = True
            elif ch == "}": depth -= 1
        if opened and depth == 0:
            return i
    return len(src(path))

def esc(s): return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

MAXC = 96
def listing(path, a, b, lang):
    lines = src(path)[a - 1:b]
    out = []
    for n, line in enumerate(lines, start=a):
        line = line.replace("\t", "    ")
        first = True
        while True:
            chunk, line = line[:MAXC], line[MAXC:]
            out.append(f"<font color='#8a9a94'>{(str(n) if first else ''):>4}</font>  {esc(chunk)}")
            first = False
            if not line:
                break
            line = "      " + line
    pre = Preformatted("\n".join(out), code)
    # Preformatted can't render markup; use XPreformatted-like Paragraph lines instead.
    paras = [Paragraph(o.replace(" ", "&nbsp;").replace("<font&nbsp;color=", "<font color="), code) for o in out]
    tag = {"go": ("Go", GO), "php": ("PHP", PHP), "ts": ("TypeScript", REACT), "conf": ("nginx", INFRA)}[lang]
    head = Paragraph(f"<font color='{tag[1].hexval().replace('0x', '#')}'><b>{tag[0]}</b></font>  "
                     f"<font color='#586b64'>{esc(path)}, lines {a}–{b}</font>", small)
    t = Table([[p] for p in paras], colWidths=[6.75 * inch])
    t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), SOFT), ("LEFTPADDING", (0, 0), (-1, -1), 7),
                           ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
                           ("TOPPADDING", (0, 0), (-1, 0), 6), ("BOTTOMPADDING", (0, -1), (-1, -1), 6),
                           ("LINEBEFORE", (0, 0), (0, -1), 2.5, tag[1])]))
    story.append(head)
    story.append(Spacer(1, 2))
    story.append(t)
    story.append(Spacer(1, 8))

def code_block(path, start_needle, lang, end_needle=None, after=1):
    a = ln(path, start_needle, after)
    b = ln(path, end_needle, a) if end_needle else block_end(path, a)
    # include the doc comment directly above
    while a > 1 and src(path)[a - 2].strip().startswith(("//", "*", "/**", "#")):
        a -= 1
    listing(path, a, b, lang)
    return a, b

def notes(path, items):
    """items: list of (needle or (needle, needle2), text). Line refs are resolved from the file."""
    for ref, text in items:
        if isinstance(ref, tuple):
            x = ln(path, ref[0]); y = ln(path, ref[1], x)
            label = f"Lines {x}–{y}" if y != x else f"Line {x}"
        else:
            label = f"Line {ln(path, ref)}"
        story.append(Paragraph(f"<b>{label}</b>&nbsp;&nbsp;{text}", note))
    story.append(Spacer(1, 6))

def QA(q, a):
    story.append(KeepTogether([Paragraph(q, qstyle), Paragraph(a, body)]))

# ---------------- diagram ----------------
def box(d, x, y, w, h, title, lines, col):
    d.add(Rect(x, y, w, h, rx=5, ry=5, fillColor=colors.white, strokeColor=col, strokeWidth=1.3))
    d.add(Rect(x, y + h - 4, w, 4, fillColor=col, strokeColor=col, strokeWidth=0))
    d.add(String(x + w / 2, y + h - 17, title, fontName="Sans-Bold", fontSize=8.5, fillColor=INK, textAnchor="middle"))
    for i, s in enumerate(lines):
        d.add(String(x + w / 2, y + h - 29 - i * 10, s, fontName="Sans", fontSize=7, fillColor=MOSS, textAnchor="middle"))

def arrow(d, x1, y1, x2, y2, col=MOSS, dash=None):
    import math
    d.add(Line(x1, y1, x2, y2, strokeColor=col, strokeWidth=0.9, strokeDashArray=dash))
    a = math.atan2(y2 - y1, x2 - x1)
    d.add(Polygon([x2, y2, x2 - 5.5 * math.cos(a - 0.4), y2 - 5.5 * math.sin(a - 0.4),
                   x2 - 5.5 * math.cos(a + 0.4), y2 - 5.5 * math.sin(a + 0.4)], fillColor=col, strokeColor=col))

def arch():
    d = Drawing(486, 360)
    box(d, 168, 312, 150, 44, "Browser (React)", ["storefront + /admin"], REACT)
    arrow(d, 243, 312, 243, 292)
    box(d, 143, 248, 200, 44, "gateway (nginx)", ["serves the app, routes /api/v1/*"], INFRA)
    xs = [4, 125, 246, 367]; w = 115; y = 150; h = 70
    svc = [("auth (Go)", ["accounts, roles", "signs JWTs"], GO), ("order (Go)", ["cart, stock, checkout", "orders, coupons, email"], GO),
           ("payment (Go)", ["intents, webhooks", "refunds"], GO), ("catalog (PHP)", ["products, categories", "reviews, pages"], PHP)]
    for x, (n, s, c) in zip(xs, svc):
        box(d, x, y, w, h, n, s, c); arrow(d, 243, 248, x + w / 2, y + h)
    arrow(d, 246, 185, 240, 185, col=GO)
    d.add(String(243, 190, "sync", fontName="Sans", fontSize=6.5, fillColor=GO, textAnchor="middle"))
    box(d, 4, 86, 478, 38, "RabbitMQ: topic exchange shop.events", ["product.* · stock.changed · payment.* · order.* · refund.issued"], INFRA)
    for x in xs:
        arrow(d, x + w / 2, y, x + w / 2, 124, dash=[2, 2])
    box(d, 4, 4, 478, 56, "MongoDB replica set", ["auth_db · orders_db · payments_db · catalog_db",
                                                 "each service owns one database and its own outbox collection"], MONGO)
    for x in xs:
        d.add(Line(x + w / 2, 86, x + w / 2, 60, strokeColor=MONGO, strokeWidth=0.9))
    return d

# ======================= CONTENT =======================
story.append(Spacer(1, 1.5 * inch))
P("Northline", ParagraphStyle("t", fontName="Sans-Bold", fontSize=38, leading=44, textColor=SPRUCE))
P("Line by Line: an online store in Go, PHP, MongoDB and React",
  ParagraphStyle("st", fontName="Sans", fontSize=15, leading=21, textColor=INK, spaceAfter=18))
P("A walkthrough of the go-php-mongo project: what each service does, why it is built the way it is, "
  "and the code that matters, explained line by line. Interview questions and exercises follow each part.",
  ParagraphStyle("lead", parent=body, fontSize=11, leading=16))
story.append(Spacer(1, 0.4 * inch))
T([["Part", "What it covers"],
   ["1. The system", "Services, data ownership, events, the life of an order"],
   ["2. Go platform", "JWTs with the standard library, the outbox, MongoDB transactions"],
   ["3. Orders and money", "Pricing and tax, reserving stock, checkout, payments, refunds, sessions"],
   ["4. PHP catalog", "Laravel without an ORM, verifying Go's tokens, faceted search, the events worker"],
   ["5. Front end and infrastructure", "The API client, the payment page, nginx, Docker Compose"],
   ["6. Practice", "Interview questions with answers, and exercises"]], [1.9 * inch, 4.85 * inch])
P("How to read it: every code listing shows the real file and its real line numbers. The notes under it "
  "refer to those numbers, so you can open the file side by side.", small)

story.append(PageBreak())
story.append(Paragraph("Contents", h1))
toc = TableOfContents(); toc.levelStyles = tocs; toc.dotsMinLevel = 0
story.append(toc)

# ---------------- PART 1 ----------------
PART(1, "The system", "What the store does, how it's divided, and how the pieces cooperate without sharing a database.")

H1("1.1 What the store does")
P("Northline is a complete online shop for an invented Canadian outdoor-goods brand. Customers browse a "
  "catalog, search and filter it, put items in a cart (signed in or not), check out with an address in any "
  "province, get charged the right tax, pay, receive emails, and follow their order as it ships. They can "
  "save addresses and, once they've bought something, review it.")
P("Staff use an admin panel to create products and variants, upload images, receive stock, move orders "
  "through packing and shipping, cancel and refund, moderate reviews, edit the About/Shipping/Returns pages, "
  "make discount codes, and (admins only) grant staff access.")

H1("1.2 Four services, two languages")
story.append(arch())
story.append(Spacer(1, 6))
T([["Service", "Language", "Owns", "Why here"],
   ["auth", "Go", "Users, passwords, sessions, roles. Holds the JWT signing key.", "Security code with no dependencies: password hashing and RS256 are in Go's standard library."],
   ["order", "Go", "Carts, stock, orders, coupons, order emails.", "The concurrency-sensitive core: two people buying the last unit at the same moment."],
   ["payment", "Go", "Payment attempts, provider webhooks, refunds.", "Money movement: idempotency and signature checks matter most here."],
   ["catalog", "PHP (Laravel 12)", "Products, categories, reviews, CMS pages, uploads.", "Mostly forms, validation and editorial CRUD, which Laravel makes quick."]],
  [0.75 * inch, 0.95 * inch, 2.35 * inch, 2.7 * inch])

H1("1.3 Three ways services talk")
H2("A public key instead of a session lookup")
P("auth-service signs short-lived access tokens with an RSA private key. The other three services only "
  "have the public key, mounted read-only from a shared Docker volume. Each one checks a token's signature "
  "itself, so a request to the catalog never waits on auth-service, and a compromised catalog can't create tokens.")
H2("Events for everything that can happen later")
P("When something happens that another service cares about (a product changed, a payment went through), "
  "the service writes an event. RabbitMQ delivers it to every service that subscribed to that type. The "
  "sender doesn't know or care who listens, so new listeners can be added without touching it.")
H2("One synchronous call where it has to be")
P("Before charging, payment-service must know the order's exact total right now. An event might not have "
  "arrived yet, so it asks order-service directly over HTTP at <font face='Mono'>/internal/orders/{id}</font>. "
  "That path is protected by a shared secret and the gateway has no route to it.")
CALL("<b>Rule of thumb:</b> use an event when the other side can act a little later and you don't need an "
     "answer; use a direct call when you need an authoritative answer before you can continue.")

H1("1.4 Who owns which data")
P("Each service has its own MongoDB database, and no service reads another's. Where one service needs "
  "another's data, it keeps its own copy, fed by events. order-service keeps a <font face='Mono'>product_cache</font> "
  "with each SKU's name and price from <font face='Mono'>product.updated</font>; the catalog keeps each "
  "variant's <font face='Mono'>available</font> count from <font face='Mono'>stock.changed</font>.")
P("The payoff: customers can still pay while the PHP catalog is being redeployed, and a slow catalog "
  "query can't lock up checkout. The cost: the copies are briefly out of date after a change "
  "(eventual consistency), which the design has to tolerate. Checkout, for example, always prices from "
  "order-service's own copy and never trusts a price sent by the browser.")

H1("1.5 The life of an order")
P("Following one purchase through the system shows every moving part. Numbers are the steps in order.")
T([["#", "Where", "What happens"],
   ["1", "catalog → order", "Earlier, when the product was saved, <b>product.updated</b> created stock records and the price copy in order-service."],
   ["2", "browser → order", "<b>POST /cart/items</b>. A guest gets a random <font face='Mono'>guest_id</font> cookie; the cart is keyed by it."],
   ["3", "browser → order", "<b>POST /checkout</b>. In one transaction: older unpaid orders by this shopper are cancelled, stock is <i>reserved</i>, the order is saved as <font face='Mono'>pending_payment</font>, and a <b>stock.changed</b> event goes in the outbox."],
   ["4", "browser → payment → order", "<b>POST /payments/intent</b>. payment-service asks order-service for the total, creates a payment with the provider, returns a client secret."],
   ["5", "browser → provider → payment", "The card step happens at the provider. The provider calls the <b>webhook</b>; payment-service verifies the signature and writes <b>payment.succeeded</b>."],
   ["6", "payment → order", "order-service consumes it: order → <font face='Mono'>paid</font>, reserved stock is <i>committed</i>, the cart is emptied, <b>order.placed</b> is written."],
   ["7", "order → order, catalog", "The email queue sends the receipt. The catalog records a verified purchase, so the buyer may review the product."],
   ["8", "browser", "The order page polls until it sees <font face='Mono'>paid</font>, then shows the confirmation."],
   ["9", "admin → order", "Staff move it to processing, shipped (with tracking) and delivered; each step emits an event and an email where it matters."]],
  [0.3 * inch, 1.55 * inch, 4.9 * inch])
P("If the shopper never pays, a sweeper cancels the order after 15 minutes and puts the reserved units "
  "back on sale. If the money arrives after that, the late payment is refunded automatically, since the "
  "stock may already be sold to someone else.")

# ---------------- PART 2 ----------------
PART(2, "Go platform code", "The shared building blocks every Go service uses: tokens, the outbox, MongoDB transactions.")

f = "services/go/internal/platform/token/token.go"
H1("2.1 Verifying a JWT with the standard library")
P("A JWT is three base64url parts: header, payload, signature. The signature is RSA over SHA-256 of "
  "<font face='Mono'>header.payload</font>. Verifying needs only <font face='Mono'>crypto/rsa</font>.")
code_block(f, "func (v *Verifier) Verify(", "go")
notes(f, [
    ('parts := strings.Split(tok, ".")', "A token must have exactly three parts; anything else is rejected before any work is done."),
    (("if parts[0] != header {", 'h.Alg != "RS256"'), "The most important check in the file. The classic JWT attack sends a header saying "
     "<font face='Mono'>\"alg\": \"none\"</font> (no signature) or <font face='Mono'>HS256</font> (an HMAC keyed with the "
     "<i>public</i> key, which the attacker has). The algorithm is pinned to RS256 and the header is never trusted to choose it."),
    ('digest := sha256.Sum256([]byte(parts[0] + "." + parts[1]))', "The signature covers the raw base64 text exactly as received, not a re-encoding of the decoded JSON."),
    ("rsa.VerifyPKCS1v15(", "RS256 means RSASSA-PKCS1-v1_5 with SHA-256. If any byte of the header or payload changed, this fails."),
    ("if c.Issuer != Issuer", "The signature is valid, but was the token meant for this system? Issuer and subject are checked."),
    ("if now.Unix() >= c.ExpiresAt", "Expiry last. <font face='Mono'>now</font> is a parameter, which lets tests check expiry without sleeping."),
])
P("PHP does the same check with <font face='Mono'>firebase/php-jwt</font> (section 4.2). Because both follow "
  "the standard, a token signed in Go verifies in PHP; the project's checks confirmed this with PHP's own "
  "<font face='Mono'>openssl_verify</font>.")

f = "services/go/internal/platform/events/events.go"
H1("2.2 The transactional outbox")
P("The problem: saving an order and publishing <i>order.placed</i> are two different systems (MongoDB and "
  "RabbitMQ). If the process dies between them, the order exists but nobody hears about it; publish first "
  "and die, and everyone hears about an order that doesn't exist.")
P("The fix: write the event into an <font face='Mono'>outbox</font> collection in the <i>same database "
  "transaction</i> as the order. Either both are saved or neither is. A separate loop then publishes "
  "whatever is in the outbox.")
code_block(f, "func RelayOnce(", "go")
notes(f, [
    ("evs, err := ob.Pending(ctx, 100)", "Read up to 100 unpublished events, oldest first (the Mongo implementation sorts by <font face='Mono'>occurredAt</font>)."),
    ("if err := pub.Publish(ctx, ev); err != nil {", "If RabbitMQ is down, stop this batch. The same event is retried next tick, so order is preserved and nothing is skipped."),
    ("if err := ob.MarkSent(ctx, ev.ID); err != nil {", "Published but not yet marked? It will be published again. This is why delivery is <i>at-least-once</i> and why every consumer must be idempotent."),
])
CALL("<b>At-least-once, not exactly-once.</b> Exactly-once delivery across a database and a broker isn't "
     "achievable in practice. Instead, every message carries an <font face='Mono'>eventId</font>, consumers "
     "record the IDs they've handled (the <font face='Mono'>processed_events</font> collection, with a 7-day TTL), "
     "and handlers are written so running twice has the same effect as running once.")

f = "services/go/internal/platform/mongox/mongox.go"
H1("2.3 MongoDB transactions in driver v2")
code_block(f, "func Tx(", "go")
notes(f, [
    ("sess, err := client.StartSession()", "A session is the server-side context a transaction lives in."),
    ("_, err = sess.WithTransaction(ctx, func(ctx context.Context) (any, error) {", "WithTransaction starts, commits, and retries on transient errors such as a write conflict with another checkout. That's why the callback must be safe to run more than once."),
    ("return nil, fn(ctx)", "In driver v2 the session travels inside the <font face='Mono'>ctx</font> passed to the callback. Any collection call made with that ctx joins the transaction; a call made with the outer ctx would silently run outside it."),
])
P("Multi-document transactions require a replica set. In Docker Compose that is a one-member set: "
  "<font face='Mono'>mongod --replSet rs0</font>, initiated by the container's healthcheck on first start.")

# ---------------- PART 3 ----------------
PART(3, "Orders and money", "The rules where a bug costs real money: prices, tax, stock, payments and refunds.")

f = "services/go/internal/order/pricing.go"
H1("3.1 Pricing and Canadian tax")
P("All money is integer cents. Floating point can't represent 0.10 exactly; summing float prices "
  "across thousands of orders drifts by cents, which accountants notice.")
code_block(f, "func Quote(", "go")
notes(f, [
    ("for _, l := range lines {", "Subtotal is the sum of line totals, which were priced from order-service's own product copy."),
    (("if coupon != nil {", "t.DiscountCents = d"), "The coupon is checked against the subtotal (active, not expired, uses left, minimum spend). An invalid code returns a <font face='Mono'>CouponError</font> the checkout page shows under the field."),
    ("if goods < FreeShippingOverCents", "Free shipping is judged <i>after</i> the discount: $80 of goods with 10% off is $72, which pays shipping. Deciding this order explicitly avoids arguments with customers."),
    ("t.TaxCents = pctOf(goods+t.ShippingCents, tax.Rate)", "Tax applies to discounted goods plus shipping, since shipping is taxable in Canada."),
])
code_block(f, "func pctOf(", "go")
P("Rates are stored in thousandths of a percent: Ontario's 13% is <font face='Mono'>13000</font> and Quebec's "
  "14.975% is exactly <font face='Mono'>14975</font>. Adding 50,000 before dividing by 100,000 rounds half up "
  "with integer arithmetic only, and it happens in this one function.")
H2("The order status machine")
code_block(f, "var transitions = map[string][]string{", "go")
P("Allowed moves are data, not scattered <font face='Mono'>if</font> statements. <font face='Mono'>NextStatuses</font> "
  "filters out <i>paid</i> and <i>refunded</i>, which only payment events may set, and the admin UI shows exactly the "
  "buttons it returns.")

f = "services/go/internal/order/mongostore.go"
H1("3.2 Never selling what you don't have")
P("Stock has two numbers: <font face='Mono'>onHand</font> (on the shelf) and <font face='Mono'>reserved</font> "
  "(promised to checkouts waiting for payment). What a new customer can buy is the difference.")
code_block(f, "func availableAtLeast(", "go")
code_block(f, "func (s *MongoStore) Reserve(", "go")
notes(f, [
    ("filter := availableAtLeast(l.Qty)", "The filter matches the stock document only if <font face='Mono'>onHand − reserved ≥ qty</font>. <font face='Mono'>$expr</font> lets a filter compare two fields of the same document."),
    ('bson.M{"$inc": bson.M{"reserved": l.Qty}', "Increment <font face='Mono'>reserved</font> in the same operation. MongoDB applies a single-document update atomically: check and increment can't be split by another request."),
    ("if res.MatchedCount == 0 {", "Zero matches means not enough stock. Note it and keep checking the other lines, so the error can list every short SKU."),
    ("return &ErrInsufficient{SKUs: short}", "Returning an error aborts the surrounding transaction, which undoes the increments already made for earlier lines. All lines are reserved, or none."),
])
CALL("<b>Why not read, check, then write?</b> Two shoppers could both read \"1 available\", both pass the "
     "check, and both write. Putting the condition inside the update removes that race without locks.")
P("Later, <font face='Mono'>Commit</font> moves a paid order's quantity out of both numbers (it left the "
  "shelf), <font face='Mono'>Release</font> gives back an expired reservation, and <font face='Mono'>Restock</font> "
  "returns a cancelled paid order to the shelf.")

f = "services/go/internal/order/service.go"
H1("3.3 Checkout")
code_block(f, "func (s *Service) Checkout(", "go")
notes(f, [
    ("if user != nil {", "A signed-in shopper's receipt goes to their account email; the form's email field is ignored for them."),
    ("lines, err := s.orderLines(ctx, owner)", "Order lines are a snapshot of the cart at current prices from order-service's product copy. Nothing price-related comes from the browser."),
    ("n, err := s.Store.NextOrderNumber(ctx)", "Order numbers come from a counter <i>outside</i> the transaction. A failed checkout leaves a gap (harmless), and concurrent checkouts don't all conflict on one counter document."),
    ("guestKey = id.Secret(24)", "A guest has no account, so they get a random key that opens this order. Only its SHA-256 hash is stored, like a password."),
    ("err = s.Store.Tx(ctx, func(ctx context.Context) error {", "Everything inside commits together: cancel older unpaid orders, reserve stock, save the order, count the coupon use, queue stock.changed."),
    ("if err := s.cancelOlderPending(ctx, owner, now); err != nil {", "If someone abandons a payment page and checks out again, their first order would still hold stock. It's released first."),
    ("var short *ErrInsufficient", "The store's error becomes a 409 with a message a shopper understands; the cart page then shows which lines changed."),
])

H1("3.4 When the payment arrives")
code_block(f, "func (s *Service) OnPaymentSucceeded(", "go")
notes(f, [
    ("if !decode(ev, &d) {", "A malformed payload can't be fixed by retrying, so it's logged and acknowledged instead of being redelivered forever."),
    ("To: StatusPaid, PaymentID: d.PaymentID, At: now})", "A compare-and-set: only an order still in <font face='Mono'>pending_payment</font> becomes paid. A redelivered event finds it already paid."),
    ("if errors.Is(err, ErrStatus) {", "The order wasn't pending. Either it's already paid (a duplicate, do nothing) or..."),
    ('if cur.Status == StatusCancelled && cur.PaymentID == "" {', "...it expired before the money arrived. Its stock may be sold, so it isn't revived. An order.cancelled event with refund=true asks payment-service to return the money."),
    ("if err := s.Store.Commit(ctx, o.StockLines()); err != nil {", "Reserved units leave the shelf for good."),
    ("return s.Store.AddEvents(ctx, events.Must(events.OrderPlaced", "order.placed carries what listeners need (items, email, user), so the email sender and the catalog never have to call back."),
])

f = "services/go/internal/payment/provider.go"
H1("3.5 Trusting a webhook")
P("Anyone can POST to <font face='Mono'>/payments/webhook</font>. Before believing \"payment succeeded\", the "
  "service proves the message came from Stripe and is recent.")
code_block(f, "func VerifyStripeSignature(", "go")
notes(f, [
    ('case "t":', "The header looks like <font face='Mono'>t=1731100000,v1=5257a8...</font>. <font face='Mono'>t</font> is when Stripe signed it."),
    ("if d := now.Sub(time.Unix(ts, 0)); d > tolerance || d < -tolerance {", "A message older than five minutes is refused. Because the time is inside the signed data, an attacker can't replay an old captured webhook with a new time."),
    ("mac := hmac.New(sha256.New, []byte(secret))", "HMAC-SHA256 with the webhook secret, over <font face='Mono'>timestamp.rawbody</font>. The handler reads the raw bytes; decoding and re-encoding JSON would change them."),
    ("if hmac.Equal(s, want) {", "<font face='Mono'>hmac.Equal</font> compares in constant time. Several v1 values can be present while Stripe rotates secrets."),
])
P("After the signature, the event ID is recorded with a unique index (<font face='Mono'>FirstSeen</font>). "
  "Stripe retries webhooks, sometimes for days; the second copy is acknowledged and ignored.")

f = "services/go/internal/payment/service.go"
H1("3.6 Refunds that can't pay out twice")
code_block(f, "func (s *Service) Refund(", "go")
notes(f, [
    ("remaining := p.AmountCents - p.RefundedCents", "Partial refunds are allowed, but never more than what's left."),
    ('refID, err := s.Provider.Refund(ctx, p.ProviderRef, amount, fmt.Sprintf("refund-%s-%d-%d"', "The provider call happens first, with an <i>idempotency key</i> built from the payment's refund history. If saving the result fails and staff click again, the key is the same, so Stripe returns the original refund instead of sending money twice."),
    ("full := p.RefundedCents+amount == p.AmountCents", "A full refund moves the payment to refunded; order-service hears refund.issued and updates the order."),
])

f = "services/go/internal/auth/service.go"
H1("3.7 Sessions: rotation and reuse detection")
P("Access tokens last 15 minutes and live only in the browser's memory. The refresh token lasts 30 days, "
  "sits in an httpOnly cookie that JavaScript can't read, and is replaced every time it's used.")
code_block(f, "func (s *Service) Refresh(", "go")
notes(f, [
    ("t, err := s.Store.RefreshByHash(ctx, id.Hash(refresh))", "Only hashes of refresh tokens are stored. A database leak doesn't hand out live sessions."),
    ("if t.RevokedAt != nil {", "A token that was already exchanged is being used again. The real browser always has the newest one, so a replay means a copy was stolen."),
    ("if err := s.Store.RevokeFamily(ctx, t.FamilyID, now); err != nil {", "End the whole chain. The thief and the real user are both signed out; the real user signs in again, the thief can't."),
    ("ok, err := s.Store.RetireRefresh(ctx, t.Hash, id.Hash(next), now)", "Retire the old token with a conditional update that only matches a live token. If two refreshes race with one token, only one wins; the other is treated as reuse."),
    ("return s.issue(ctx, u, t.FamilyID, next)", "New access token with the user's <i>current</i> roles, so promoting someone to staff takes effect within one refresh."),
])

# ---------------- PART 4 ----------------
PART(4, "The PHP catalog", "Laravel 12 for routing, validation and commands; the official MongoDB library for data.")

H1("4.1 Why no ORM")
P("Laravel's Eloquent is built around SQL. Adapters exist for MongoDB, but they translate an ORM's ideas "
  "into document queries. This service uses the official <font face='Mono'>mongodb/mongodb</font> library "
  "directly, in small repository classes, so every query is the query that runs, and the product search "
  "can use an aggregation pipeline. Laravel still provides routing, validation, dependency injection, "
  "error rendering and console commands.")
P("Business rules live in <font face='Mono'>app/Domain</font> as plain PHP with no framework or database "
  "imports. That's what makes them unit-testable in milliseconds: product validation, query building, "
  "category trees and the event format.")

f = "services/catalog/app/Http/Middleware/VerifyJwt.php"
H1("4.2 Verifying Go's tokens in PHP")
code_block(f, "private function userFrom(", "php")
notes(f, [
    ("if ($header === '') {", "No header means anonymous: browsing is public. A <i>bad</i> header is still a 401, so the React client knows to refresh."),
    ("JWT::$leeway = 5;", "Containers' clocks can differ slightly; five seconds of slack avoids rejecting a token issued \"in the future\"."),
    ("new Key(self::publicKey(), 'RS256')", "The library takes the algorithm with the key, pinning RS256 exactly as the Go verifier does."),
    ("if (($claims->iss ?? null) !== 'shop-auth'", "Same issuer and subject rules as Go."),
])
P("Routes choose the level: <font face='Mono'>jwt:optional</font> for review listings (signed-in users see a "
  "\"write a review\" form), <font face='Mono'>jwt</font> for posting a review, <font face='Mono'>jwt:staff</font> "
  "for the admin group and <font face='Mono'>jwt:admin</font> for deleting products. As in Go, admin implies staff.")

f = "services/catalog/app/Domain/ProductQuery.php"
H1("4.3 From query string to MongoDB filter")
code_block(f, "public static function build(", "php")
notes(f, [
    ("$filter = $includeHidden ? [] : ['status' => 'active'];", "The storefront only ever sees active products; the admin list can see drafts and archived ones."),
    ("$filter['categoryIds'] = ['$in' => array_values($categoryIds)];", "The controller passes the chosen category plus its descendants, so \"Apparel\" includes T-shirts and Hoodies."),
    ("$filter['priceMax'] = ['$gte' => $min];", "Each product stores its cheapest and dearest variant. A product belongs in a $20–$50 range if its range overlaps it: priceMax ≥ 20 and priceMin ≤ 50."),
    ("$filter['$text'] = ['$search' => mb_substr($q, 0, 100)];", "Text search uses the weighted index (name 10, brand 5, description 1) and understands stems: \"hoodies\" finds \"hoodie\"."),
    ("$sort['_id'] = 1;", "A unique tiebreaker. Without it, products with equal sort keys can swap places between page loads, so page 2 repeats or skips items."),
])

f = "services/catalog/app/Data/ProductRepository.php"
H1("4.4 One aggregation for a whole listing page")
code_block(f, "public function search(", "php")
notes(f, [
    ("['$match' => $q['filter']],", "Filter first, so every later stage works on matching products only (and the indexes are used)."),
    ("'items' => [", "<font face='Mono'>$facet</font> runs several sub-pipelines over the same matched documents. This one sorts, skips, limits and drops the long description."),
    ("'total' => [['$count' => 'n']],", "The total for \"Page 2 of 5\", from the same match, in the same round trip."),
    ("'price' => [['$group'", "The price range of everything matching, for the filter's placeholder values."),
])

f = "services/catalog/app/Console/Commands/EventsWork.php"
H1("4.5 The events worker")
P("PHP serves each web request and forgets it, so long-running work belongs in a separate process. "
  "<font face='Mono'>php artisan events:work</font> runs in its own container from the same image.")
code_block(f, "$channel->basic_consume(", "php", end_needle="});")
notes(f, [
    ("$msg->nack(false); // undecodable", "Garbage can't be fixed by retrying: reject without requeueing."),
    ("if ($outbox->seen($event['eventId'])) {", "Already handled: acknowledge and move on. This is the PHP side of at-least-once delivery."),
    ("$msg->nack(true); // requeue", "A real failure (MongoDB unreachable, say) puts the message back for another try."),
])
code_block(f, "while (true) {", "php")
P("One loop alternates between publishing the catalog's outbox and waiting up to one second for incoming "
  "messages. If the connection drops, the command exits and Docker's restart policy starts a fresh worker, "
  "which is simpler and safer than reconnect logic.")

# ---------------- PART 5 ----------------
PART(5, "Front end and infrastructure", "How the React app talks to four services as one, and how nine containers start in the right order.")

f = "web/src/api/client.ts"
H1("5.1 One API client")
code_block(f, "export function refreshSession(", "ts")
notes(f, [
    ("refreshing ??= (async () => {", "If five requests get a 401 at once, they share one refresh request instead of starting five (which would also trip reuse detection)."),
    ('const res = await send("POST", "/auth/refresh");', "No token is sent; the browser attaches the httpOnly refresh cookie by itself, because its path is /api/v1/auth."),
    ("setSession(s);", "Listeners (the auth context) update the signed-in user everywhere."),
])
code_block(f, "export async function api<T>(", "ts")
notes(f, [
    ('if (res.status === 401 && accessToken && !path.startsWith("/auth/")) {', "Only retry when there was a token to expire, and never for the auth endpoints themselves."),
    ("if (!res.ok) throw await toError(res);", "Every service returns errors in the same shape, so one function turns them into an ApiError with per-field messages for the forms."),
])

H1("5.2 The payment page")
P("<font face='Mono'>Pay</font> in <font face='Mono'>pages/shop/Checkout.tsx</font> asks payment-service for an "
  "intent. With the built-in test provider it shows \"Pay\" and \"Simulate a declined card\"; with Stripe it "
  "lazy-loads Stripe's script and mounts its PaymentElement, an iframe where card numbers are typed straight "
  "into Stripe. Either way the app then navigates to the order page, which polls every 1.5 seconds while the "
  "order is still <font face='Mono'>pending_payment</font>, because the confirmation travels payment-service → "
  "RabbitMQ → order-service.")

f = "gateway/nginx.conf"
H1("5.3 The gateway")
code_block(f, "resolver 127.0.0.11", "conf", end_needle="set $catalog")
notes(f, [
    ("resolver 127.0.0.11", "Docker's internal DNS. With service addresses in variables, nginx resolves them per request (cached 10 s): it starts even if a service is still building, and follows a restarted container to its new IP."),
])
code_block(f, "location ~ ^/api/v1/auth/(login", "conf", end_needle="location ~ ^/api/v1/admin/(catalog|content)")
P("Sign-in endpoints get a stricter rate limit (10 a minute per IP) than the rest. Routing is by path "
  "prefix only; the gateway knows nothing about tokens, which each service checks itself.")

H1("5.4 Starting nine containers in order")
T([["Container", "Waits for", "Why"],
   ["mongo", "—", "Its healthcheck also initiates the replica set on first start."],
   ["rabbitmq, mailpit", "—", ""],
   ["auth", "mongo healthy", "Creates the JWT key pair in the shared volume, then reports healthy."],
   ["order, payment", "auth + rabbitmq healthy", "They need the public key and the broker."],
   ["catalog", "auth + mongo healthy", "Creates indexes, seeds the demo store once, then serves."],
   ["catalog-worker", "catalog healthy", "Indexes exist; seeded events are waiting in the outbox."],
   ["gateway", "the four services started", "Builds and serves the React app; routes the API."]],
  [1.4 * inch, 1.7 * inch, 3.65 * inch])
P("Both the Go and the PHP Dockerfiles run their test suites while building. An image is only produced when "
  "the tests pass, so <font face='Mono'>docker compose up --build</font> is also a test run.")

# ---------------- PART 6 ----------------
PART(6, "Practice", "Questions an interviewer might ask about this project, with the answers the code supports, then exercises.")

H1("6.1 Interview questions")
QA("Why split the backend into services at all? What does it cost?",
   "Each service can be deployed, scaled and changed on its own, and a failure in one (the catalog) doesn't stop "
   "another (checkout). The costs are real: data is duplicated and briefly inconsistent, a request may cross "
   "several processes, and there's more infrastructure (a broker, more containers). For a small team a modular "
   "monolith is often the better start; this project shows the patterns that become necessary once you split.")
QA("How do you stop two customers buying the last item?",
   "The stock update is conditional: increment <i>reserved</i> only if <i>onHand − reserved ≥ qty</i>, in a single "
   "atomic document update. For multi-line carts, all lines are reserved inside one transaction, so a shortage on "
   "any line rolls back the others.")
QA("What is the transactional outbox and what problem does it solve?",
   "Writing data and publishing a message are two systems, so one can succeed without the other. The outbox writes "
   "the message into the same database transaction as the data, and a relay publishes it afterwards. It guarantees "
   "the message goes out at least once if, and only if, the data was saved.")
QA("If messages can arrive twice, how is double-processing prevented?",
   "Every event has an ID that consumers record after handling. Handlers are also idempotent by construction: the "
   "paid transition is a compare-and-set from pending_payment, product upserts write the same values again, and "
   "stock records are created with $setOnInsert so a replay never resets counted stock.")
QA("Why RS256 rather than HS256 for the JWTs?",
   "With HS256 every service that verifies tokens holds the same secret and could therefore create tokens. With RS256 "
   "only auth-service holds the private key; the others hold a public key that can only verify.")
QA("Where is the access token stored in the browser, and why?",
   "In a JavaScript variable, never localStorage, so an injected script can't read it from storage. The long-lived "
   "refresh token is an httpOnly, SameSite=Strict cookie scoped to /api/v1/auth: script can't read it and other sites "
   "can't make the browser send it.")
QA("How do you know a webhook really came from Stripe?",
   "Stripe signs a timestamp plus the raw body with HMAC-SHA256 using a shared secret. The service recomputes it, "
   "compares in constant time, rejects messages older than five minutes, and ignores event IDs it has seen.")
QA("Why store money as integers?",
   "Binary floating point can't represent most decimal fractions exactly, so sums drift. Cents as integers are exact; "
   "tax rates in thousandths of a percent keep even Quebec's 14.975% exact, with rounding done once, explicitly.")
QA("What happens if the catalog service is down?",
   "Browsing and search fail, but carts, checkout and payment keep working: order-service prices from its own product "
   "copy. Events the catalog misses wait in its RabbitMQ queue and are processed when it comes back.")
QA("Why does payment-service call order-service directly instead of using an event?",
   "It needs the authoritative amount <i>before</i> it can create a payment. An event might not have arrived yet. "
   "Direct calls are the right tool when you need an answer to continue; events are for things that can happen later.")

H1("6.2 Exercises")
B(["<b>Wishlist.</b> Add a wishlist to auth-service (or a new service). Decide which service should own it and what "
   "events, if any, it needs. Add a heart button on product pages.",
   "<b>Low-stock alerts.</b> When a SKU's available stock crosses its low-stock threshold, email staff. Which service "
   "detects it, and how do you avoid sending the same alert on every sale below the threshold?",
   "<b>Search typo tolerance.</b> MongoDB text search doesn't handle typos. Add Meilisearch or MongoDB Atlas Search, "
   "fed by product.updated events, and compare results for \"hoody\".",
   "<b>Dead-letter queue.</b> A handler that always fails is requeued forever. Configure a dead-letter exchange and "
   "a retry limit in RabbitMQ, and add an admin page listing dead letters.",
   "<b>Kubernetes.</b> Write manifests like the other two Full Stack projects: Deployments, Services, a StatefulSet for "
   "MongoDB, Secrets for the keys, and an Ingress replacing the nginx gateway.",
   "<b>Contract tests.</b> Write a JSON Schema for each event in a shared folder, and test that the Go and PHP producers "
   "emit events that match it.",
   "<b>Tax configuration.</b> Move tax rates out of code into an admin-editable collection with effective dates, so "
   "a rate change can be scheduled ahead of time."])

H1("Appendix: endpoints by service")
T([["Path (under /api/v1)", "Service", "Who"],
   ["auth/register · login · refresh · logout · forgot-password · reset-password", "auth", "anyone"],
   ["me · me/password · me/addresses", "auth", "signed in"],
   ["admin/users", "auth", "admin"],
   ["cart · cart/items · cart/merge · checkout/quote · checkout", "order", "anyone (merge: signed in)"],
   ["orders · orders/{id}", "order", "owner, guest key, or staff"],
   ["admin/orders · admin/inventory · admin/stats · admin/coupons", "order", "staff (saving coupons: admin)"],
   ["payments/config · payments/intent · payments/{id} · payments/mock/confirm · payments/webhook", "payment", "anyone (intent checks ownership)"],
   ["admin/payments · admin/payments/refund", "payment", "staff (refund: admin)"],
   ["catalog/products · catalog/products/{slug} · catalog/categories · content/pages/{slug}", "catalog", "anyone"],
   ["catalog/products/{id}/reviews", "catalog", "read: anyone; write: verified buyers"],
   ["admin/catalog/* · admin/content/*", "catalog", "staff (delete product: admin)"]],
  [3.9 * inch, 0.8 * inch, 2.05 * inch])


# ======================= BUILD =======================
class Doc(BaseDocTemplate):
    def __init__(self, path):
        super().__init__(path, pagesize=letter, leftMargin=0.85 * inch, rightMargin=0.85 * inch,
                         topMargin=0.8 * inch, bottomMargin=0.8 * inch,
                         title="Northline — Line by Line walkthrough", author="Kyle Gartner")
        frame = Frame(self.leftMargin, self.bottomMargin, self.width, self.height, id="f")
        self.addPageTemplates([PageTemplate("p", [frame], onPage=self.decorate)])

    def decorate(self, c, doc):
        if doc.page == 1:
            c.saveState(); c.setFillColor(SPRUCE); c.rect(0, letter[1] - 0.32 * inch, letter[0], 0.32 * inch, stroke=0, fill=1)
            c.setFillColor(BLAZE); c.rect(0, letter[1] - 0.36 * inch, letter[0], 0.04 * inch, stroke=0, fill=1); c.restoreState()
            return
        c.saveState(); c.setFont("Sans", 7.5); c.setFillColor(MOSS)
        c.drawString(0.85 * inch, 0.5 * inch, "Northline — Line by Line")
        c.drawRightString(letter[0] - 0.85 * inch, 0.5 * inch, str(doc.page)); c.restoreState()

    def afterFlowable(self, fl):
        if isinstance(fl, Heading):
            self.notify("TOCEntry", (fl.toc_level, fl.toc_text, self.page))


os.makedirs(os.path.dirname(OUT), exist_ok=True)
Doc(OUT).multiBuild(story)
print("wrote", OUT)
