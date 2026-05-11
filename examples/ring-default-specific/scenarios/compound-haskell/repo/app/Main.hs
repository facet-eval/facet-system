module Main (main) where

import Eval (eval)
import Lex (tokenize)

main :: IO ()
main = do
  src <- getContents
  let result = eval (tokenize src)
  print result
