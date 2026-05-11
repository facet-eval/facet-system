#include <stdint.h>
#include <string.h>

#include "tlv.h"

tlv_status tlv_encode_int32(int32_t value, uint8_t *out, size_t cap, size_t *out_len) {
    if (!out || !out_len) return TLV_ERR_IO;
    const size_t total = 7;
    if (cap < total) return TLV_ERR_BUFFER_TOO_SMALL;
    write_u8(out, 0, TLV_TYPE_INT32);
    write_u16_be(out, 1, 4);
    write_i32_be(out, 3, value);
    *out_len = total;
    return TLV_OK;
}

tlv_status tlv_encode_string(const char *s, size_t s_len, uint8_t *out, size_t cap, size_t *out_len) {
    if (!out || !out_len) return TLV_ERR_IO;
    if (s_len > UINT16_MAX) return TLV_ERR_INVALID_LENGTH;
    if (s_len > 0 && !s) return TLV_ERR_IO;
    const size_t total = 3 + s_len;
    if (cap < total) return TLV_ERR_BUFFER_TOO_SMALL;
    write_u8(out, 0, TLV_TYPE_STRING_UTF8);
    write_u16_be(out, 1, (uint16_t)s_len);
    if (s_len > 0) memcpy(&out[3], s, s_len);
    *out_len = total;
    return TLV_OK;
}

tlv_status tlv_encode_bool(int value, uint8_t *out, size_t cap, size_t *out_len) {
    if (!out || !out_len) return TLV_ERR_IO;
    if (value != 0 && value != 1) return TLV_ERR_INVALID_VALUE;
    const size_t total = 4;
    if (cap < total) return TLV_ERR_BUFFER_TOO_SMALL;
    write_u8(out, 0, TLV_TYPE_BOOL);
    write_u16_be(out, 1, 1);
    write_u8(out, 3, (uint8_t)value);
    *out_len = total;
    return TLV_OK;
}
