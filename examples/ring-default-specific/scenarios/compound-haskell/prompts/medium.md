The repository in the current working directory contains `rpncalc`, a
small Haskell library and CLI implementing a postfix (RPN) calculator
on integers. See README.md for the syntax.

You have three tasks. They are independent — each is graded separately,
and you may attempt any subset in any order.

1. **Bug fix.** There is an operand-order bug in the `step` function in
   `src/Eval.hs`. Non-commutative operators (`sub`, `div`) currently
   produce results with the operands swapped — for example,
   `echo "5 2 sub" | rpncalc` returns `-3` instead of `3`. Fix the
   pattern match so operands are applied in the correct order.

2. **Feature.** Add support for the modulo operator `mod`. Update the
   operator ADT, the lexer, and the evaluator. The CLI must accept
   `mod` as a token alongside the existing `add`, `sub`, `mul`, `div`.
   Use Haskell's standard `mod` semantics on positive operands.

3. **Refactor.** The evaluator in `src/Eval.hs` currently uses partial
   functions: `step` and `eval` call `error` on stack underflow,
   too-many-operands, etc. The `EvalError` data type is already
   declared in the same module but unused. Refactor `step` and `eval`
   to return `Either EvalError` and propagate errors purely. Update
   `app/Main.hs` to print errors to stderr and exit with a non-zero
   code on `Left`. Lexer errors are out of scope — leave `src/Lex.hs`
   unchanged.

Run `cabal build` to compile.
