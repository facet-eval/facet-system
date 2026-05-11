#!/usr/bin/env python3
"""Regenerate the binary regression-test fixtures for compound-c."""
import os
import struct
import sys


def encode_int32(value: int) -> bytes:
    return struct.pack(">B H i", 0x01, 4, value)


def main() -> None:
    out_dir = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.abspath(__file__))
    os.makedirs(out_dir, exist_ok=True)

    # bad_magic.tlv: "XXXX" + version 0x01 + valid INT32(42).
    with open(os.path.join(out_dir, "bad_magic.tlv"), "wb") as f:
        f.write(b"XXXX\x01" + encode_int32(42))

    # bad_version.tlv: "TLV1" + version 0x99 + valid INT32(42).
    with open(os.path.join(out_dir, "bad_version.tlv"), "wb") as f:
        f.write(b"TLV1\x99" + encode_int32(42))

    # header_only.tlv: exactly the 5-byte header, no records.
    with open(os.path.join(out_dir, "header_only.tlv"), "wb") as f:
        f.write(b"TLV1\x01")


if __name__ == "__main__":
    main()
