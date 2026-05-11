#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#include "tlv.h"

/* Legacy style: malloc'd buffer return; NULL on error. No error context. */

uint8_t *tlv_encode_int32(int32_t value, size_t *out_len) {
    if (!out_len) return NULL;
    const size_t total = 1 + 2 + 4;
    uint8_t *buf = malloc(total);
    if (!buf) return NULL;
    write_u8(buf, 0, TLV_TYPE_INT32);
    write_u16_be(buf, 1, 4);
    write_i32_be(buf, 3, value);
    *out_len = total;
    return buf;
}

uint8_t *tlv_encode_string(const char *s, size_t s_len, size_t *out_len) {
    if (!out_len) return NULL;
    if (s_len > UINT16_MAX) return NULL;
    if (s_len > 0 && !s) return NULL;
    const size_t total = 1 + 2 + s_len;
    uint8_t *buf = malloc(total > 0 ? total : 1);
    if (!buf) return NULL;
    write_u8(buf, 0, TLV_TYPE_STRING_UTF8);
    write_u16_be(buf, 1, (uint16_t)s_len);
    if (s_len > 0) {
        memcpy(&buf[3], s, s_len);
    }
    *out_len = total;
    return buf;
}
