-- Task 3 (refactor): eval must return Either EvalError Int.
--
-- Compiled with: ghc -i<workspace>/src TestRefactor.hs -o test_refactor
-- (or against the cabal-built library, depending on the oracle's choice.)
-- Exits 0 on success, non-zero on failure.

module Main (main) where

import Eval (eval, EvalError(..))
import Token (Token(..))
import Op (Op(..))
import System.Exit (exitFailure, exitSuccess)
import System.IO (hPutStrLn, stderr)

main :: IO ()
main = do
  case eval [TOp Add] of
    Left StackUnderflow -> pure ()
    other               -> failWith ("expected Left StackUnderflow, got " ++ show other)

  case eval [TNum 1, TNum 2, TNum 3] of
    Left TooManyOperands -> pure ()
    other                -> failWith ("expected Left TooManyOperands, got " ++ show other)

  case eval [TNum 5, TNum 2, TOp Add] of
    Right 7 -> pure ()
    other   -> failWith ("expected Right 7, got " ++ show other)

  exitSuccess

failWith :: String -> IO a
failWith msg = do
  hPutStrLn stderr ("task3: " ++ msg)
  exitFailure
