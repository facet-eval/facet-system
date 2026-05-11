The repository in the current working directory contains `rpncalc`, a
small Haskell library and CLI implementing a postfix (RPN) calculator
on integers.

Syntax:
- Input is whitespace-separated tokens read from stdin: integer literals
  and operator words (`add`, `sub`, `mul`, `div`).
- Each number pushes onto an internal stack. Each operator pops two
  operands (stack-top is the right operand) and pushes the result.
- Output is the final stack value, printed to stdout. The stack must
  contain exactly one value at end of input.

You have three tasks. They are independent — each is graded separately,
and you may attempt any subset in any order.

1. **Bug fix.** In `src/Eval.hs`, the `step` function currently
   pattern-matches as:
       step (a:b:xs) (TOp op) = apply op a b : xs
   Here `a` is bound to the top of the stack, but the top of the stack
   is the right operand (pushed second). The fix is to swap operand
   roles, either by renaming the pattern variables:
       step (b:a:xs) (TOp op) = apply op a b : xs
   or by swapping arguments to `apply`:
       step (a:b:xs) (TOp op) = apply op b a : xs
   After the fix, `echo "5 2 sub" | rpncalc` must print `3` and
   `echo "5 2 div" | rpncalc` must print `2`.

2. **Feature.** Add support for the modulo operator `mod` (constructor
   `Mod`). Update:
   - `src/Op.hs`: add `Mod` to the `Op` ADT, and a corresponding case
     in `apply` using Haskell's `mod`.
   - `src/Lex.hs`: recognize the literal token `mod` and produce
     `TOp Mod`.
   - `src/Eval.hs`: ensure `step` handles the new operator (the
     existing operator pattern dispatches via `apply`, so this
     typically follows automatically).
   The CLI must accept inputs like `7 3 mod` (result: `1`) and
   `0 5 mod` (result: `0`). Tests use only positive operands, so the
   choice between `mod` and `rem` is invisible — use `mod`.

3. **Refactor.** Convert the evaluator's error handling from partial
   functions to a pure `Either EvalError` discipline. The `EvalError`
   data type is already declared in `src/Eval.hs`:
       data EvalError
         = StackUnderflow
         | TooManyOperands
         | EmptyStack
         | DivByZero
         deriving (Eq, Show)
   The post-refactor public API of `Eval.hs` must expose exactly:
       step :: Stack -> Token -> Either EvalError Stack
       eval :: [Token] -> Either EvalError Int
   Replace every `error` call in `step` and `eval` with the appropriate
   `Left ...` constructor:
   - Stack underflow on an operator → `Left StackUnderflow`.
   - Empty stack at end of input → `Left EmptyStack`.
   - More than one element on the stack at end → `Left TooManyOperands`.
   You may use `foldM` from `Control.Monad` to thread the `Either`
   through the fold. Update `app/Main.hs` to print error values to
   stderr and exit with a non-zero exit code on `Left`. Leave
   `src/Lex.hs` untouched — lexer errors are out of scope.

Run `cabal build` to compile.
