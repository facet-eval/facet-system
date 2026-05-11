# rpncalc

A tiny command-line postfix (RPN) calculator on integers.

## Syntax

- Input is whitespace-separated tokens read from stdin: integer literals
  and operator words.
- Numbers push onto an internal stack.
- Operators pop two operands (stack-top is the **right** operand) and
  push the result.
- Output is the final stack value, printed to stdout. The stack must
  contain exactly one value at end of input.

## Operator catalog

| Word | Effect |
|---|---|
| `add` | left + right |
| `sub` | left - right |
| `mul` | left * right |
| `div` | left `div` right (integer, Haskell semantics) |

## Errors

Any error (stack underflow, too many operands, empty stack, division by
zero, unknown token) currently aborts the program via `error`, exiting
non-zero.

## Build and run

```bash
cabal build
echo "5 2 add" | cabal run -v0 rpncalc    # → 7
echo "5 2 sub" | cabal run -v0 rpncalc    # → 3   (after Task 1 fix)
```
