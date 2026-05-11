module Lex
  ( tokenize
  ) where

import Op (Op(..))
import Token (Token(..))
import Text.Read (readMaybe)

-- | Turn whitespace-separated input into a stream of tokens.
--   Errors out on unknown words. (Lexer errors are intentionally
--   out of refactor scope.)
tokenize :: String -> [Token]
tokenize = map toToken . words

toToken :: String -> Token
toToken "add" = TOp Add
toToken "sub" = TOp Sub
toToken "mul" = TOp Mul
toToken "div" = TOp Div
toToken w = case readMaybe w of
  Just n  -> TNum n
  Nothing -> error ("Lex: unknown token: " ++ w)
