module Main (main) where

import Eval (eval)
import Lex (tokenize)
import System.Exit (exitFailure, exitSuccess)
import System.IO (hPrint, stderr)

main :: IO ()
main = do
  src <- getContents
  case eval (tokenize src) of
    Right n -> do
      print n
      exitSuccess
    Left e -> do
      hPrint stderr e
      exitFailure
