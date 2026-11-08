# Legacy Refactor Kata

**Stack:** TypeScript, node:test  
**Effort:** ~0.5 day  
**Status:** Built

A tests-first refactor of a messy legacy file, in small commits.

Rather than a well-known kata like Gilded Rose (which interviewers have seen solved many times), the
legacy code is an original, Vention-flavoured **quote calculator for a machine design**: aluminium
extrusions cut to length, plates, fasteners, motors, actuators, controllers, assembly labour, tiered and
promo discounts, regional shipping, Canadian and EU tax, and lead time. It's written the way rushed
production code often is: one 180-line function, `any` everywhere, magic numbers, a global variable, a
`console.log`, a dependency on the clock, dead code, and two bugs nobody had noticed.

## Features

- [x] A messy ~190-line legacy TypeScript file (`legacy/quote.ts` is the frozen original)
- [x] Tests first: a golden master over 1,002 generated cases, a check that those cases reach every branch, and readable spec tests
- [x] Refactored in small commits, each one green; behaviour identical to the legacy code until the bug fixes
- [x] Two bugs fixed afterwards, each test-first in its own commit, with the golden master proving nothing else changed

See **[REFACTORING.md](REFACTORING.md)** for the step-by-step log, and `history/refactor-steps.bundle`
for the actual commit history (12 steps plus docs).

## How to run

```powershell
cd vention/snack4-refactor-kata
npm install
npm test           # spec tests + golden master
npm run typecheck  # tsc --strict
npm run demo       # prints a sample quote
```

## Layout

```
legacy/quote.ts      the original, frozen; the golden master compares against it
src/
├── quote.ts         createQuote(): the pure entry point, and the deprecated calculateQuote() wrapper
├── items.ts         one pricing function per item type
├── rules.ts         assembly labour, discount, shipping, tax rate, lead time
├── catalog.ts       every price, weight, rate and threshold, by name
├── money.ts         round2()
└── types.ts         Item, Design, Customer, Quote
tests/
├── cases.ts         seeded generator for the 1,002 golden-master cases
├── golden.test.ts   current vs legacy, with an explicit list of intentional changes
└── spec.test.ts     the rules, as worked examples
scripts/demo.ts
```

## Design decisions

- **Characterize before changing.** There was no spec, so the legacy behaviour is the spec. The golden
  master runs every generated case through both versions and requires deep equality down to the
  floating-point bit, and a second test proves the cases actually reach every branch, so "all green"
  means something.
- **Test the tests.** Before trusting the net I planted mistakes: a one-cent change to a fee fails it.
  Later, a near-miss (`=== true` instead of truthiness) showed a gap, which was fixed in the tests
  before the code was trusted again.
- **Refactor and fix in separate commits.** Commits 3–10 change no behaviour; 11 and 12 each change one
  thing on purpose. Mixing the two makes both harder to review and to revert.
- **Intentional changes are written down, not hand-waved.** After the fixes, the golden master still
  compares against legacy, but a case may only differ if a listed fix explains it, and each fix must
  change at least one case. So every other quote is provably unchanged.
- **Keep the old API working.** `calculateQuote()` remains, marked deprecated, with its exact side
  effects, so callers can migrate to the pure `createQuote()` in their own time.
- **Don't fix what isn't yours to fix.** Half-cent rounding of floating-point values is imperfect
  (see REFACTORING.md), but changing how invoices round is a business decision. It's documented, not
  silently changed.

## Talking point

Modernising legacy code safely: pin behaviour down with characterization tests, change structure in
small reversible steps, and keep behaviour changes separate and deliberate. Same approach as the
PlayFab save-system refactor: there, too, existing player data meant the old behaviour had to be
preserved exactly until each change was intended.
