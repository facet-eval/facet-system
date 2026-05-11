The repository in the current working directory contains `stelm`, a
small C library and CLI for reading and writing a versioned binary log
format made of TLV (type, length, value) records.

Format:
- File header: 5 bytes — `magic[4] = "TLV1"` followed by
  `version[u8] = 0x01`.
- Each record: `type[u8] + length[u16 big-endian] + payload[length]`.
- Existing types: `0x01 INT32` (4 bytes big-endian signed),
  `0x02 STRING_UTF8` (variable, raw UTF-8 bytes).
- Dump format: `<TYPE_NAME>: <value>`, one per line. INT32 values are
  decimal; STRING_UTF8 values are quoted.

You have three tasks. They are independent — each is graded separately,
and you may attempt any subset in any order.

1. **Bug fix.** In `src/parser.c`, the per-record bounds check inside
   the parse loop currently reads:
       if (offset + length > file_size) return TLV_ERR_TRUNCATED;
   It must account for the 3-byte record header (`type` + `length`) that
   has just been consumed:
       if (offset + 3 + length > file_size) return TLV_ERR_TRUNCATED;
   Apply the fix. After the fix, parsing must reject any file where the
   last record's declared length would over-read past EOF, while still
   accepting all well-formed files.

2. **Feature.** Add support for a new value type `BOOL`. Update
   `src/types.c` (encode, decode, dump) and the CLI's `append` command
   in `src/main.c`. A BOOL record has `length = 1` and
   `payload[0] ∈ {0, 1}`. Reject any BOOL record with `length != 1` by
   returning `TLV_ERR_INVALID_LENGTH`, and any with `payload[0] > 1` by
   returning `TLV_ERR_INVALID_VALUE`. The dumper must print `BOOL: true`
   for value 1 and `BOOL: false` for value 0. The `append` command must
   accept `--type=bool --value=true` and `--type=bool --value=false`.

3. **Refactor.** Unify error handling across `src/parser.c`,
   `src/encoder.c`, and `src/header.c` to use the `tlv_status` enum
   declared in `include/tlv.h`. The public API in `include/tlv.h` after
   the refactor must expose at least the following signatures:
       tlv_status tlv_parse_buffer(const uint8_t *buf, size_t len,
                                   tlv_record_list *out);
       tlv_status tlv_encode_int32(int32_t value, uint8_t *out,
                                   size_t cap, size_t *out_len);
       tlv_status tlv_encode_string(const char *s, size_t s_len,
                                    uint8_t *out, size_t cap,
                                    size_t *out_len);
       tlv_status tlv_validate_header(const uint8_t *buf, size_t len);
   Remove the `last_error` global from `parser.c`. Replace `assert()`
   calls on user input in `header.c` with `tlv_status` returns. Encoder
   functions must return `tlv_status` and write into a caller-provided
   output buffer, returning `TLV_ERR_BUFFER_TOO_SMALL` if `cap` is
   insufficient.

Run `make` to build.
