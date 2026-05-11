The repository in the current working directory contains `stelm`, a
small C library and CLI for reading and writing a versioned binary log
format made of TLV (type, length, value) records. See README.md for the
format specification.

You have three tasks. They are independent — each is graded separately,
and you may attempt any subset in any order.

1. **Bug fix.** There is an off-by-one in the record-loop bounds check
   inside `src/parser.c`. A maliciously-crafted file whose last record
   declares a `length` exceeding the bytes remaining is currently
   accepted instead of rejected. Fix the bounds check so such files are
   rejected while well-formed files continue to parse correctly.

2. **Feature.** Add support for a new value type `BOOL`. Update the
   parser, encoder, dumper, and the CLI's `append` command. A BOOL
   payload is a single byte; valid values are 0 (false) and 1 (true).
   Reject malformed BOOL records (wrong length or out-of-range value).
   The dumper must display BOOL records as `BOOL: true` or `BOOL: false`,
   one per line, consistent with the existing `<TYPE_NAME>: <value>`
   format.

3. **Refactor.** Error handling is inconsistent across modules:
   `src/parser.c` returns `int` with a `last_error` global,
   `src/encoder.c` returns `NULL` pointers without context, and
   `src/header.c` uses `assert()` on user input. Unify all three to use
   the `tlv_status` enum already declared in `include/tlv.h`. Remove the
   global, replace asserts on user input with `tlv_status` returns, and
   change encoder functions to write into caller-provided buffers.

Run `make` to build.
