module Eval
  ( Stack
  , EvalError(..)
  , step
  , eval
  ) where

import Op (apply)
import Token (Token(..))

type Stack = [Int]

-- | Possible evaluation errors. Declared here from the start; the
--   initial implementation does not yet thread them through (the
--   evaluator currently calls `error` instead). The refactor task
--   wires this type through `step` and `eval`.
data EvalError
  = StackUnderflow
  | TooManyOperands
  | EmptyStack
  | DivByZero
  deriving (Eq, Show)

-- | One folding step: push numbers, dispatch operators.
--
-- BUG: the operator clause binds `a` to the top of the stack, but
-- the top of the stack is the *right* operand of the binary op
-- (pushed second). So `apply op a b` swaps operands for non-
-- commutative operators (`sub`, `div`).
step :: Stack -> Token -> Stack
step xs (TNum n) = n : xs
step (a:b:xs) (TOp op) = apply op a b : xs
step _ (TOp _) = error "Eval: stack underflow"

-- | Evaluate a token stream by folding `step` over the empty stack.
--   Errors out on a non-singleton final stack.
eval :: [Token] -> Int
eval ts = case foldl step [] ts of
  [n] -> n
  []  -> error "Eval: empty stack"
  _   -> error "Eval: too many operands"
