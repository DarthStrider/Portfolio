# Refactoring log

How `src/quote.ts` went from one 180-line function to small, typed, tested modules: 12 steps, each its own
commit, plus a final commit adding these docs.
Every commit leaves all tests green. Commits 3–10 change no behaviour at all (checked against the frozen
legacy code on 1,002 generated cases); commits 11–12 change behaviour on purpose, one bug each.

The full commit history is in `history/refactor-steps.bundle`:

```powershell
git clone history/refactor-steps.bundle steps
cd steps
git log --stat        # every step, with its explanation
git show HEAD~10      # e.g. the commit that named the magic numbers
```

## The steps

| # | Commit | What changed | How it was checked |
|---|---|---|---|
| 1 | Add the legacy quote calculator, as found | The starting point: one function, `any` everywhere, magic numbers, a global and a `console.log` | – |
| 2 | Add characterization tests before touching anything | Frozen copy in `legacy/`; golden master over 1,002 generated cases; 20 spec tests that write the rules down | A one-cent change to the cut fee makes the golden master fail |
| 3 | Name the magic numbers | Every price, weight and rate moves to `catalog.ts`; if/else ladders become table lookups | Golden master + spec tests |
| 4 | Introduce types; let/const and a switch | `types.ts`, no more `any`; `var` → `let/const`, `==` → `===`, item if-chain → `switch` | Same, plus `tsc --strict` |
| 5 | Extract `round2()` | Six copies of `Math.round(x * 100) / 100` become one function with the identical formula | Same |
| 6 | Remove the unreachable minimum rush lead time | Lead time is at least 5 days, so halving can't go below 3: the "at least 2" check was dead | Coverage test couldn't reach it; golden master unchanged |
| 7 | Price each item type in its own function | `items.ts`: six small pricing functions behind `priceItem()` | Same |
| 8 | Extract the pricing rules | `rules.ts`: `assemblyLabor`, `discount`, `shipping`, `taxRate`, `leadTimeDays` | Same; kept legacy truthiness for `rush`/`assembly` (see below) |
| 9 | Golden master: also send non-boolean flags | Generated cases now include `1`, `"yes"`, `0`, `""` for the flags | Reintroducing `=== true` now fails the golden master |
| 10 | Separate the pure calculation from its side effects | `createQuote(design, customer, now)` is pure; `calculateQuote` stays as a deprecated wrapper with the old global and log line | Golden master through the wrapper; new tests for purity and for the wrapper's side effects |
| 11 | Fix: fasteners are sold in whole packs, rounded up | `Math.round` → `Math.ceil`; 120 bolts were billed as 100 | Spec test written first and seen failing; golden master allows changes only where nearest and round-up disagree (209 cases) |
| 12 | Fix: judge the free-shipping threshold after discounts | Threshold uses what the customer pays after discounts, not the pre-discount parts total | Spec test first, both sides of the line; 17 more cases changed, all CA/US orders at the threshold |

## Things the process caught

- **Dead code.** The coverage test asked for at least two cases at the 2-day minimum lead time and got
  none. Working out why showed the check could never fire.
- **A gap in the safety net.** While extracting rules I nearly wrote `design.rush === true` where the
  legacy code used truthiness. The golden master didn't object, because every generated case sent a
  real boolean. The fix was to the tests first (commit 9), and only then is the code trusted.
- **Order of floating-point additions.** Reordering `subtotal + labor - disc + ship` gives slightly
  different raw numbers, but every money output is rounded to the cent, which absorbed the difference in
  all 1,002 cases. The refactor kept the original order anyway.
- **Rounding that looks wrong but isn't a refactoring question.** `round2(136.965)` is `136.96`, because
  136.965 is stored as 136.96499999… in binary floating point. Changing that (e.g. to integer cents) is a
  behaviour change for whoever owns invoicing, so it's noted in `money.ts` and left alone.

## Before and after

| | Before | After |
|---|---|---|
| Longest function | 180 lines (`calculateQuote`) | 62 lines (`createQuote`, with comments); everything else ≤ 29 |
| `any` | everywhere | none |
| Magic numbers in logic | 69 (49 distinct values) | 0, all named in `catalog.ts` (only unit conversions like ÷1000 for mm→m remain) |
| Side effects | global + console log + clock, mixed into the calculation | none in `createQuote`; kept only in the deprecated wrapper |
| Tests | none | 23 (golden master over 1,002 cases, branch-coverage check, 21 spec tests) |
| Known bugs | 2, undocumented | fixed, each with a test |

Total lines went up (190 → about 470 in `src/`), mostly types and doc comments. That's normal for this
kind of refactor: what goes down is how much you have to hold in your head to change any one rule.
