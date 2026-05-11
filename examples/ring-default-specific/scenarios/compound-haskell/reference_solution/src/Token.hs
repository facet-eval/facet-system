module Token
  ( Token(..)
  ) where

import Op (Op)

data Token
  = TNum Int
  | TOp Op
  deriving (Eq, Show)
