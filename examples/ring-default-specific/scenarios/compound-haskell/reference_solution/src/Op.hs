module Op
  ( Op(..)
  , apply
  ) where

data Op = Add | Sub | Mul | Div | Mod
  deriving (Eq, Show)

apply :: Op -> Int -> Int -> Int
apply Add x y = x + y
apply Sub x y = x - y
apply Mul x y = x * y
apply Div x y = x `div` y
apply Mod x y = x `mod` y
