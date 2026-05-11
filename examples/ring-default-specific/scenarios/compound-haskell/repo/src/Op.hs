module Op
  ( Op(..)
  , apply
  ) where

data Op = Add | Sub | Mul | Div
  deriving (Eq, Show)

-- | Apply a binary operator. Partial: native `div` crashes on zero.
apply :: Op -> Int -> Int -> Int
apply Add x y = x + y
apply Sub x y = x - y
apply Mul x y = x * y
apply Div x y = x `div` y
