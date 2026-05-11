# stelm

A tiny C library and CLI for reading and writing the on-flash event log
of an embedded sensor node. Records are stored as TLV (type-length-value)
entries.

## Format

- File header: 5 bytes — `magic[4] = "TLV1"` followed by `version[u8] = 0x01`.
- Each record: `type[u8] + length[u16 big-endian] + payload[length]`.
- Endianness: big-endian for all multi-byte integers.

### Existing types

| Tag | Name | Payload |
|---|---|---|
| `0x01` | `INT32` | 4 bytes, big-endian signed |
| `0x02` | `STRING_UTF8` | variable (length bytes), raw UTF-8, no NUL terminator |

### Dump format

`<TYPE_NAME>: <value>`, one record per line.

- `INT32` values are printed in decimal: `INT32: 42`.
- `STRING_UTF8` values are printed quoted: `STRING_UTF8: "hello"`.

## Build

```bash
make
```

This produces `libtlv.a` and the `tlv` binary.

## CLI

```bash
tlv dump <file>
tlv append <file> --type=<type> --value=<value>
```

`<type>` is one of `int32`, `string` (and `bool` after the BOOL feature
is added).
