#!/usr/bin/env python3
"""Regenerate the binary task-test fixtures for compound-c.

Run: python3 make_fixtures.py [output_dir]
Default output_dir is the script's directory.
"""
import os
import struct
import sys

HEADER = b"TLV1\x01"  # magic + version


def encode_int32(value: int) -> bytes:
    return struct.pack(">B H i", 0x01, 4, value)


def encode_string(s: str) -> bytes:
    payload = s.encode("utf-8")
    return struct.pack(">B H", 0x02, len(payload)) + payload


def encode_raw_record(type_byte: int, declared_length: int, payload: bytes) -> bytes:
    """Build a record with an *explicitly declared* length (which may
    differ from the actual payload length, for crafting truncated fixtures)."""
    return struct.pack(">B H", type_byte, declared_length) + payload


def main() -> None:
    out_dir = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.abspath(__file__))
    os.makedirs(out_dir, exist_ok=True)

    # valid.tlv: header + INT32(42) + STRING_UTF8("hello")
    with open(os.path.join(out_dir, "valid.tlv"), "wb") as f:
        f.write(HEADER + encode_int32(42) + encode_string("hello"))

    # truncated.tlv: header + STRING_UTF8 with declared length=5 but only
    # 4 actual payload bytes after the 3-byte record header.
    #
    # file_size = 5 (header) + 1 (type) + 2 (length) + 4 (actual payload) = 12.
    # offset of the record = 5; declared length = 5.
    #   Buggy bound: 5 + 5 = 10 (not > 12) → accepts.
    #   Fixed bound: 5 + 3 + 5 = 13 (> 12) → rejects.
    with open(os.path.join(out_dir, "truncated.tlv"), "wb") as f:
        f.write(HEADER + encode_raw_record(0x02, 5, b"abcd"))

    # bool_valid.tlv: header + BOOL (type 0x04, length=1, payload=0x01).
    # Not consumed by tests; available for human inspection.
    with open(os.path.join(out_dir, "bool_valid.tlv"), "wb") as f:
        f.write(HEADER + encode_raw_record(0x04, 1, b"\x01"))

    # bool_bad_length.tlv: header + BOOL with length=2 (invalid).
    # Without Task 2: type 0x04 unknown → dump rejects.
    # With Task 2: BOOL recognized but length validated → dump rejects.
    with open(os.path.join(out_dir, "bool_bad_length.tlv"), "wb") as f:
        f.write(HEADER + encode_raw_record(0x04, 2, b"\x01\x01"))


if __name__ == "__main__":
    main()
