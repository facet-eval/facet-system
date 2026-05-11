module Eval
  ( Stack
  , EvalError(..)
  , step
  , eval
  ) where

import Control.Monad (foldM)
import Op (apply)
import Token (Token(..))

type Stack = [Int]

data EvalError
  = StackUnderflow
  | TooManyOperands
  | EmptyStack
  | DivByZero
  deriving (Eq, Show)

step :: Stack -> Token -> Either EvalError Stack
step xs (TNum n) = Right (n : xs)
step (b:a:xs) (TOp op) = Right (apply op a b : xs)
step _ (TOp _) = Left StackUnderflow

eval :: [Token] -> Either EvalError Int
eval ts = do
  stk <- foldM step [] ts
  case stk of
    [n] -> Right n
    []  -> Left EmptyStack
    _   -> Left TooManyOperands
